import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import { MonacoPreview } from './MonacoPreview.js'
import { installWorkers } from './monaco.js'
import { syncTheme } from './theme.js'

declare const __EDITOR_CSS__: string
export const name = 'vscode-editor'
export const inject = ['slots', 'documentPreviews', 'theme']
const ID = '@dsk/vscode-editor/preview'

export function apply(ctx: Context): void {
  ctx.effect(installWorkers, 'vscode-editor: workers')
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.vscodeEditor = 'monaco'
    style.textContent = __EDITOR_CSS__
    document.head.append(style)
    return () => style.remove()
  }, 'vscode-editor: styles')
  // Defer until the DSH presenter has applied the snapshot's CSS token overrides.
  ctx.effect(() => {
    let frame = requestAnimationFrame(() => syncTheme(ctx.theme.getTheme()))
    const off = ctx.on('theme/change', () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => syncTheme(ctx.theme.getTheme()))
    })
    return () => { cancelAnimationFrame(frame); off() }
  }, 'vscode-editor: theme')
  ctx.effect(() => ctx.documentPreviews.register({
    id: ID, extensions: ['js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'mts', 'cts'],
    priority: 'extension', title: () => 'Monaco', loading: 'text-pages', wrap: true,
  }), 'vscode-editor: preview definition')
  ctx.effect(() => ctx.slots.inject('sidebar.right.tab.document', () => ctx.slots.register(
    { name: 'sidebar.right.tab.document', key: ID }, MonacoPreview,
  )), 'vscode-editor: preview body')
}
