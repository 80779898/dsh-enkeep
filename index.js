/**
 * dsh-enkeep — Host half of the bundle.
 *
 * The Host half owns the configuration schema. All fields are volatile so the
 * Client half can read/write them through ctx.configForms without restarting
 * the plugin (no custom RPC, no state file needed).
 *
 * Function-plugin form: only named exports (name / inject / Config / apply).
 * Do NOT add a default export — the Loader would discard this namespace.
 */

import Schema from '@deepseek-ai/schemastery'

export const name = 'enkeep'

export const Config = Schema.object({
  chatWidth: Schema.union(['narrow', 'wide']).default('wide').volatile(),
  showLauncher: Schema.boolean().default(true).volatile(),
  // 活动区悬浮条：会话“更新于 N 小时内”的时间窗口（小时）。
  // 必须是 volatile，否则 Client configForms 的写入会被 Host 拒绝。
  activityWindowHours: Schema.number().step(1).min(1).max(720).default(24).volatile(),
})

export function apply(ctx, config) {
  // Observe volatile changes made from the Client config form. All values are
  // consumed there via configForms; here we only keep a diagnostic trace.
  ctx.on('loader/volatile-update', () => {
    const width = config.chatWidth.get()
    const launcher = config.showLauncher.get()
    const hours = config.activityWindowHours.get()
    ctx.logger?.info('[enkeep] volatile config: chatWidth=%s showLauncher=%s activityWindowHours=%s', width, launcher, hours)
  })
}
