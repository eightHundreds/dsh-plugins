import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { fileURLToPath } from 'node:url'
import { assetHandler } from './assets.ts'
import { EditorLspHost } from './lsp-host.ts'

export const name = 'vscode-editor'
export const inject = ['webServer', 'sessions', 'typert']

export function apply(ctx: Context): void {
  ctx.plugin(EditorLspHost)
  const root = fileURLToPath(new URL('./assets', import.meta.url))
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix', path: '/vscode-editor/assets',
    handler: assetHandler(root, '/vscode-editor/assets'),
  }), 'vscode-editor: Monaco assets')
}
