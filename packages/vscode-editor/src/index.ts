import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { fileURLToPath } from 'node:url'
import { assetHandler } from './assets.ts'

export const name = 'vscode-editor'
export const inject = ['webServer']

export function apply(ctx: Context): void {
  const root = fileURLToPath(new URL('./assets', import.meta.url))
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix', path: '/vscode-editor/assets',
    handler: assetHandler(root, '/vscode-editor/assets'),
  }), 'vscode-editor: Monaco assets')
}
