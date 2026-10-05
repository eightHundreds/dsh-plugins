import type { Context } from '@deepseek-ai/cordis'

export const name = 'example-hello'

/** A deliberately small host plugin: resources belong to this plugin's fiber. */
export function apply(ctx: Context): void {
  ctx.effect(() => {
    console.info('[@dsk/hello] loaded')
    return () => {
      console.info('[@dsk/hello] disposed')
    }
  })
}
