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
import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises'
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
  // 输入框上方高频提示词快捷按钮显示数量（1~12）。volatile：设置页即时生效。
  quickPromptCount: Schema.number().step(1).min(1).max(12).default(6).volatile(),
})

export function apply(ctx, config) {
  // Observe volatile changes made from the Client config form. All values are
  // consumed there via configForms; here we only keep a diagnostic trace.
  ctx.on('loader/volatile-update', () => {
    const width = config.chatWidth.get()
    const launcher = config.showLauncher.get()
    const hours = config.activityWindowHours.get()
    const words = config.showCommonWords.get()
    const quickN = config.quickPromptCount.get()
    ctx.logger?.info('[enkeep] volatile config: chatWidth=%s showLauncher=%s activityWindowHours=%s showCommonWords=%s quickPromptCount=%s', width, launcher, hours, words, quickN)
  })

  installWordRoutes(ctx)
  installSkillRoutes(ctx)
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
 * 把一条词条收敛成 v2 的 `Prompt = {id, keyword, content, useCount}`。
 *  - v1 字符串 → `{id:'legacy-<i>', keyword:'', content:<原文>, useCount:0}`，原文一字不丢；
 *  - v2 对象 → 规范化四个字段；缺 id 时用内容的确定性 hash 兜底（重复读取不漂移）。
 *  - 空内容（'' / 非字符串 / 非对象）→ null，由 normalizePrompts 丢弃。
 */
function normalizePrompt(raw, i) {
  if (typeof raw === 'string') {
    return raw === '' ? null : { id: 'legacy-' + i, keyword: '', content: raw, useCount: 0 }
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const content = typeof raw.content === 'string' ? raw.content : ''
  if (content === '') return null
  let id = typeof raw.id === 'string' && raw.id !== '' ? raw.id : ''
  if (id === '') {
    let hash = 0
    for (const ch of content) hash = (Math.imul(hash, 31) + ch.charCodeAt(0)) | 0
    id = 'auto-' + i + '-' + (hash >>> 0).toString(36)
  }
  const keyword = typeof raw.keyword === 'string' ? raw.keyword : ''
  const useCount = Number.isFinite(raw.useCount) ? Math.max(0, Math.trunc(raw.useCount)) : 0
  return { id, keyword, content, useCount }
}

/** 列表规范化：逐条迁移 + 按 id 去重（保留首次出现）。 */
function normalizePrompts(list) {
  if (!Array.isArray(list)) return []
  const out = []
  const seen = new Set()
  list.forEach((raw, i) => {
    const p = normalizePrompt(raw, i)
    if (p === null || seen.has(p.id)) return
    seen.add(p.id)
    out.push(p)
  })
  return out
}

/**
 * 把任意输入收敛成 v2 结构：
 * `{ version:2, rev, updatedAt, mode, words: Prompt[], projects: {dir: Prompt[]} }`。
 * 兼容旧版 `words: string[]`：读取时自动迁移成 v2，写回即永久 v2。
 * 去重（按 id）、剔空、空桶丢弃等原语义保留。
 */
function normalize(value) {
  const src = value !== null && typeof value === 'object' ? value : {}

  const words = normalizePrompts(src.words)

  const projects = {}
  const rawProjects = src.projects !== null && typeof src.projects === 'object' && !Array.isArray(src.projects)
    ? src.projects
    : {}
  for (const [dir, list] of Object.entries(rawProjects)) {
    if (typeof dir !== 'string' || dir === '') continue
    const items = normalizePrompts(list)
    if (items.length > 0) projects[dir] = items
  }

  const mode = MODES.includes(src.mode) ? src.mode : 'all'
  const rev = Number.isFinite(src.rev) ? Math.max(0, Math.trunc(src.rev)) : 0
  const updatedAt = typeof src.updatedAt === 'string' ? src.updatedAt : ''
  return { version: 2, rev, updatedAt, mode, words, projects }
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

/**
 * 按 id 合并两个词表（保持左侧顺序），用于首轮迁移：
 * 同 id 以 incoming（右侧）为准，右侧新条目追加到末尾。
 * 词条的 keyword/content/useCount 随对象整体迁移，故频率在合并中不丢。
 */
function mergeWords(a, b) {
  const byId = new Map()
  for (const p of a) byId.set(p.id, p)
  for (const p of b) byId.set(p.id, p)
  return [...byId.values()]
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

// ---------------------------------------------------------------------------
// Skill quick-pick (server side, READ-ONLY scan of installed skills)
// ---------------------------------------------------------------------------
// Mirrors `dsh-skill-filesystem`'s scan so the offered list matches what the
// official `/` menu can actually load. Inserting a `/name` gesture for a skill
// the provider hides/refuses is a silent no-op — the same trap skill-picker hit
// in its issue #10, so every filter rule below is load-bearing.

/** Client header for the skill route (same auth-gate model as the word route). */
const SKILL_HEADER = 'x-dsh-enkeep-skills'
const SKILL_ENTRY = 'SKILL.md'
/** Frontmatter keys the official provider rejects outright. */
const LEGACY_INVOCATION_KEYS = ['disableModelInvocation', 'modelInvocable', 'userInvocable']
/** Public skill-name grammar (dsh-skill's SKILL_NAME regex). */
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function agentsHome() {
  return process.env.DSH_AGENTS_HOME ?? path.join(os.homedir(), '.agents')
}

/** The YAML frontmatter block of a SKILL.md body, or undefined when absent. */
function frontmatterBlock(content) {
  const m = typeof content === 'string' ? content.match(/^---\r?\n([\s\S]*?)\r?\n---/) : null
  return m ? m[1] : undefined
}

/**
 * Parse the YAML frontmatter subset. Returns null when frontmatter is absent —
 * the official provider drops such a skill entirely. `keys` records presence
 * even for bare `key:` lines, which legacy-key rejection needs.
 */
function parseFrontmatter(content) {
  const block = frontmatterBlock(content)
  if (block === undefined) return null
  const data = {}
  const keys = {}
  for (const line of block.split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (!kv) continue
    keys[kv[1]] = true
    const value = kv[2].trim().replace(/^["']|["']$/g, '')
    if (value !== '') data[kv[1]] = value
  }
  return { data, keys }
}

/** YAML booleans plus case-insensitive true/false, yes/no, on/off, 1/0. */
function frontmatterBoolean(data, key) {
  if (!Object.hasOwn(data, key)) return undefined
  const v = data[key]
  if (v === 1 || v === '1') return true
  if (v === 0 || v === '0') return false
  if (typeof v === 'string') {
    switch (v.toLowerCase()) {
      case 'true': case 'yes': case 'on': return true
      case 'false': case 'no': case 'off': return false
    }
  }
  throw new TypeError(`frontmatter field "${key}" must be a boolean`)
}

/**
 * Validate one SKILL.md like the official provider and return its
 * user-invocable entry, or null when the provider would drop it. Mirroring this
 * prevents offering a `/name` gesture the composer would silently refuse.
 */
function parseSkill(content) {
  const fm = parseFrontmatter(content)
  if (fm === null) return null
  const { data, keys } = fm
  for (const legacy of LEGACY_INVOCATION_KEYS) {
    if (keys[legacy]) return null
  }
  let userInvocable
  try {
    // Validate both keys: a malformed value drops the whole skill upstream,
    // even when it only concerns the model-facing surface.
    frontmatterBoolean(data, 'disable-model-invocation')
    userInvocable = frontmatterBoolean(data, 'user-invocable') !== false
  } catch {
    return null
  }
  if (!userInvocable) return null
  const name = typeof data.name === 'string' ? data.name.trim() : ''
  const description = typeof data.description === 'string' ? data.description.trim() : ''
  if (name === '' || description === '' || !SKILL_NAME.test(name)) return null
  return { name, description }
}

/** Follow symlinks/junctions: a skill root may itself be a link to another repo. */
async function isDirectoryEntry(dirPath) {
  try { return (await stat(dirPath)).isDirectory() } catch { return false }
}

/**
 * Scan one root into the map (never throws). Both official layouts are
 * supported: directory bundle `<name>/SKILL.md` and flat file `<name>.md`.
 * Higher-priority roots are scanned later and overwrite the same name.
 */
async function scanSkillsDirInto(map, dir, { skipSystem = false } = {}) {
  let entries
  try { entries = await readdir(dir, { withFileTypes: true }) } catch { return }
  for (const entry of entries) {
    if (skipSystem && entry.name === '.system') continue
    const full = path.join(dir, entry.name)
    let content
    if (await isDirectoryEntry(full)) {
      try { content = await readFile(path.join(full, SKILL_ENTRY), 'utf8') }
      catch { continue } // no SKILL.md → provider ignores (incl. SKILL.md.disabled alone)
    } else if (entry.name.endsWith('.md')) {
      try { content = await readFile(full, 'utf8') } catch { continue }
    } else {
      continue
    }
    const skill = parseSkill(content)
    if (skill !== null) map.set(skill.name, skill)
  }
}

/**
 * Scan the four roots the official provider uses, low → high priority so that
 * project-level skills override same-named user-level ones. No writes.
 * @param {string} cwd - active session workspace root (undefined = user level only).
 */
export async function scanSkills(cwd) {
  const map = new Map()
  await scanSkillsDirInto(map, path.join(agentsHome(), 'skills'))          // user agents (lowest)
  await scanSkillsDirInto(map, path.join(dshHome(), 'skills'), { skipSystem: true }) // user
  if (typeof cwd === 'string' && cwd !== '') {
    await scanSkillsDirInto(map, path.join(cwd, '.agents', 'skills'))       // project agents
    await scanSkillsDirInto(map, path.join(cwd, '.dsh', 'skills'))          // project (highest)
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name))
}

async function handleSkills(req, res, url) {
  const json = (code, payload) => {
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify(payload))
  }
  if (req.method !== 'GET') { json(405, { ok: false, error: 'method not allowed' }); return }
  if (req.headers[SKILL_HEADER] !== '1') { json(403, { ok: false, error: 'missing client header' }); return }
  let cwd = url.searchParams.get('cwd') ?? ''
  if (cwd !== '' && !(path.isAbsolute(cwd) && await isDirectoryEntry(cwd))) cwd = ''
  try {
    json(200, { ok: true, skills: await scanSkills(cwd) })
  } catch (err) {
    json(500, { ok: false, error: String(err?.message ?? err) })
  }
}

/** Mount the read-only skill route, same capability probe as the word route. */
function installSkillRoutes(ctx) {
  ctx.effect(() => {
    if (ctx.webServer?.register === undefined) {
      console.error('[enkeep] webServer 服务不可用：技能快捷插入未启用。')
      return undefined
    }
    const handler = async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://dsh')
      if (url.pathname === '/dsh-enkeep-skills') {
        await handleSkills(req, res, url)
        return
      }
      res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ ok: false, error: 'not found' }))
    }
    return ctx.webServer.register({ kind: 'prefix', path: '/dsh-enkeep-skills', handler })
  }, 'enkeep: skill routes')
}
