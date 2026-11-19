/**
 * dsh-enkeep — Host half of the bundle.
 *
 * The Host half owns the configuration schema. All fields are volatile so the
 * Client half can read/write them through ctx.configForms without restarting
 * the plugin (no custom RPC for config, no state file for config).
 *
 * Additionally the Host half owns the **shared word library** used by the
 * ported "common words" feature: a server-side file at
 * `$DSH_HOME/dsh-enkeep-words.json`, read/written through a same-origin route
 * `GET/POST /dsh-enkeep-words/state`. This makes the library shared across
 * every DSH instance/profile (localStorage alone is origin-isolated), so
 * words survive restarts and are visible in every workspace.
 *
 * Function-plugin form: only named exports (name / inject / Config / apply).
 * Do NOT add a default export — the Loader would discard this namespace.
 */

import Schema from '@deepseek-ai/schemastery'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

export const name = 'enkeep'

/** Host 侧的共享词库路由需要 webServer 服务注册能力。 */
export const inject = ['webServer']

export const Config = Schema.object({
  chatWidth: Schema.union(['narrow', 'wide']).default('wide').volatile(),
  showLauncher: Schema.boolean().default(true).volatile(),
  // 活动区悬浮条：会话“更新于 N 小时内”的时间窗口（小时）。
  // 必须是 volatile，否则 Client configForms 的写入会被 Host 拒绝。
  activityWindowHours: Schema.number().step(1).min(1).max(720).default(24).volatile(),
  // 常用词入口：是否在 composer 显示常用词触发按钮。volatile 便于设置页即时切换。
  showCommonWords: Schema.boolean().default(true).volatile(),
})

export function apply(ctx, config) {
  // Observe volatile changes made from the Client config form. All values are
  // consumed there via configForms; here we only keep a diagnostic trace.
  ctx.on('loader/volatile-update', () => {
    const width = config.chatWidth.get()
    const launcher = config.showLauncher.get()
    const hours = config.activityWindowHours.get()
    const words = config.showCommonWords.get()
    ctx.logger?.info('[enkeep] volatile config: chatWidth=%s showLauncher=%s activityWindowHours=%s showCommonWords=%s', width, launcher, hours, words)
  })

  installWordRoutes(ctx)
}

// ---------------------------------------------------------------------------
// Shared word library (server side)
// ---------------------------------------------------------------------------

/** 客户端必须携带的请求头；DSH 插件路由在鉴权门之外，跨域 fetch 无法自定义头，故以此挡住任意网页。 */
const CLIENT_HEADER = 'x-dsh-enkeep-words'
/** 与客户端一致的显示模式枚举。 */
const MODES = ['all', 'global', 'current']
/** 请求体上限，防止坏客户端撑爆内存。 */
const MAX_BODY = 1_000_000

/** DSH home：与 skill-picker 同一套约定（环境变量优先，退回 ~/.dsh）。 */
function dshHome() {
  return process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh')
}

/** 共享词库文件：独立文件，放在 $DSH_HOME（非 profile 目录），全局可用。 */
function stateFile() {
  return path.join(dshHome(), 'dsh-enkeep-words.json')
}

/**
 * 把任意输入收敛成 `{ rev, updatedAt, mode, words: string[], projects: {dir: string[]} }`。
 * 去重、剔除空串与非字符串；空的项目桶直接丢弃（与客户端 saveProjects 的清理语义一致）。
 */
function normalize(value) {
  const src = value !== null && typeof value === 'object' ? value : {}

  const words = Array.isArray(src.words)
    ? [...new Set(src.words.filter((w) => typeof w === 'string' && w !== ''))]
    : []

  const projects = {}
  const rawProjects = src.projects !== null && typeof src.projects === 'object' && !Array.isArray(src.projects)
    ? src.projects
    : {}
  for (const [dir, list] of Object.entries(rawProjects)) {
    if (typeof dir !== 'string' || dir === '') continue
    if (!Array.isArray(list)) continue
    const items = [...new Set(list.filter((w) => typeof w === 'string' && w !== ''))]
    if (items.length > 0) projects[dir] = items
  }

  const mode = MODES.includes(src.mode) ? src.mode : 'all'
  const rev = Number.isFinite(src.rev) ? Math.max(0, Math.trunc(src.rev)) : 0
  const updatedAt = typeof src.updatedAt === 'string' ? src.updatedAt : ''
  return { rev, updatedAt, mode, words, projects }
}

/**
 * 读取共享状态。
 *  - 文件不存在（首次运行）→ null，调用方走首轮播种；
 *  - 文件损坏 → 先隔离现场再返回 null，绝不静默销毁已有内容；
 *  - 其他 IO 错误（权限等）→ 原样抛出，让上层回 500。
 */
async function readState() {
  let raw
  try {
    raw = await readFile(stateFile(), 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
  try {
    return normalize(JSON.parse(raw))
  } catch {
    const quarantined = `${stateFile()}.corrupt-${Date.now()}`
    try {
      await rename(stateFile(), quarantined)
      console.error(`[enkeep] 词库文件无法解析，已隔离到 ${quarantined}`)
    } catch { /* 隔离失败也不阻断，只是丢不掉现场 */ }
    return null
  }
}

/** 原子写入（temp + rename），避免读到写了一半的文件。 */
async function writeState(state) {
  const next = normalize(state)
  const file = stateFile()
  await mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  await writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  await rename(tmp, file)
  return next
}

/** 词表并集（保持左侧顺序），用于首轮迁移。 */
function mergeWords(a, b) {
  const out = [...a]
  for (const w of b) if (!out.includes(w)) out.push(w)
  return out
}

/**
 * 首轮迁移：并集双方，而不是让先写的一方赢 —— 否则慢一步启动的那个实例
 * 会把自己的词条静默丢掉。`mode` 是标量无法并集，取传入方（incoming）。
 */
function mergeStates(stored, incoming) {
  const left = normalize(stored)
  const right = normalize(incoming)
  const projects = {}
  for (const dir of new Set([...Object.keys(left.projects), ...Object.keys(right.projects)])) {
    projects[dir] = mergeWords(left.projects[dir] ?? [], right.projects[dir] ?? [])
  }
  return normalize({
    rev: Math.max(left.rev, right.rev),
    updatedAt: right.updatedAt !== '' ? right.updatedAt : left.updatedAt,
    mode: right.mode,
    words: mergeWords(left.words, right.words),
    projects,
  })
}

/** 读取 JSON 请求体，带上限。 */
async function readJsonBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY) throw new Error('enkeep word state body too large')
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/**
 * `GET /dsh-enkeep-words/state` → `{ ok, state }`（首次写入前 `state: null`）。
 * `POST/PUT` 三种模式：
 *  - `?migrate=1` 并集迁移，用于首轮播种；
 *  - 带 `baseRev` 且与当前 `rev` 相同 → 接受，`rev` 自增；
 *  - `baseRev` 落后 → HTTP 200 + `{ ok:true, conflict:true, state }`，客户端三路合并后重试。
 */
async function handleState(req, res, url) {
  const json = (code, payload) => {
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify(payload))
  }

  if (req.headers[CLIENT_HEADER] !== '1') {
    json(403, { ok: false, error: 'missing client header' })
    return
  }

  try {
    if (req.method === 'POST' || req.method === 'PUT') {
      const incoming = await readJsonBody(req)
      const stored = await readState()

      if (url.searchParams.get('migrate') === '1') {
        const next = stored === null
          ? await writeState({ ...incoming, rev: 1 })
          : await writeState({ ...mergeStates(stored, incoming), rev: stored.rev + 1 })
        json(200, { ok: true, state: next })
        return
      }

      if (stored === null) {
        json(200, { ok: true, state: await writeState({ ...incoming, rev: 1 }) })
        return
      }

      const baseRev = Number.isFinite(incoming.baseRev) ? Math.trunc(incoming.baseRev) : -1
      if (baseRev !== stored.rev) {
        json(200, { ok: true, conflict: true, state: stored })
        return
      }

      const next = await writeState({
        rev: stored.rev + 1,
        updatedAt: new Date().toISOString(),
        mode: incoming.mode,
        words: incoming.words,
        projects: incoming.projects,
      })
      json(200, { ok: true, state: next })
      return
    }

    json(200, { ok: true, state: await readState() })
  } catch (error) {
    json(500, { ok: false, error: String(error?.message ?? error) })
  }
}

/** 挂载共享状态路由；先探测 webServer 能力，API 变化时留下明确日志。 */
function installWordRoutes(ctx) {
  ctx.effect(() => {
    if (ctx.webServer?.register === undefined) {
      console.error('[enkeep] webServer 服务不可用：共享词库未启用，常用词退回浏览器本地存储。')
      return undefined
    }
    const handler = async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://dsh')
      if (url.pathname === '/dsh-enkeep-words/state') {
        await handleState(req, res, url)
        return
      }
      res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: false, error: 'not found' }))
    }
    return ctx.webServer.register({ kind: 'prefix', path: '/dsh-enkeep-words', handler })
  }, 'enkeep: word routes')
}
