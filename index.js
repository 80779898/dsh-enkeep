/**
 * dsh-enkeep — Host half of the bundle.
 *
 * Function-plugin form: only named exports are allowed here
 * (name / inject / Config / apply). Do NOT add a default export —
 * the Loader would discard the function-plugin namespace.
 */

export const name = 'enkeep'

// Declare the services this plugin needs once capabilities are implemented.
// export const inject = ['tools']

// Declare configuration as a Standard Schema (Schemastery in this repo).
// export const Config = Schema.object({ ... })

export function apply(ctx) {
  // Register capabilities here. Anything registered through ctx
  // (ctx.on / ctx.tools.register / ctx.effect ...) is cleaned up on unload.
  //
  // Manual resources (timers, connections, watchers) must be wrapped:
  //   ctx.effect(() => {
  //     const timer = setInterval(...)
  //     return () => clearInterval(timer)
  //   })
}
