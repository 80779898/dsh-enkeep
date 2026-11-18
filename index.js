/**
 * dsh-enkeep — Host half of the bundle.
 *
 * The Host half owns the configuration schema. Both fields are volatile so the
 * Client half can read/write them through ctx.configForms without restarting
 * the plugin (no custom RPC, no state file needed).
 *
 * Function-plugin form: only named exports (name / inject / Config / apply).
 * Do NOT add a default export — the Loader would discard this namespace.
 */

import Schema from '@deepseek-ai/schemastery'

export const name = 'enkeep'

export const Config = Schema.object({
  chatWidth: Schema.union(['narrow', 'wide']).default('narrow').volatile(),
  showLauncher: Schema.boolean().default(true).volatile(),
})

export function apply(ctx, config) {
  // Observe volatile changes made from the Client config form. Both values are
  // consumed there via configForms; here we only keep a diagnostic trace.
  ctx.on('loader/volatile-update', () => {
    const width = config.chatWidth.get()
    const launcher = config.showLauncher.get()
    ctx.logger?.info('[enkeep] volatile config: chatWidth=%s showLauncher=%s', width, launcher)
  })
}
