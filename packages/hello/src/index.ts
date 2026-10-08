import type { Context } from '@deepseek-ai/cordis'

export const name = 'example-hello'

/** A deliberately small host plugin: resources belong to this plugin's fiber. */
export function apply(ctx: Context): void {
  ctx.effect(() => {
    console.info('[@dshx/hello] loaded')
    return () => {
      console.info('[@dshx/hello] disposed')
    }
  })
}
