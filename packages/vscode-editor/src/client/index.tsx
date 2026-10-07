import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import { MonacoPreview } from './MonacoPreview.tsx'
import { installWorkers } from './monaco.ts'
import { SUPPORTED_EXTENSIONS } from './languages.ts'
import { syncTheme } from './theme.ts'
declare const __DSH_CSS_MODULES__: string

declare const __EDITOR_CSS__: string
export const name = 'vscode-editor'
export const inject = ['slots', 'documentPreviews', 'theme']
const ID = '@dsk/vscode-editor/preview'

export function apply(ctx: Context): void {
  ctx.effect(installWorkers, 'vscode-editor: workers')
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.vscodeEditor = 'monaco'
    style.textContent = __EDITOR_CSS__ + __DSH_CSS_MODULES__
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
    id: ID, extensions: SUPPORTED_EXTENSIONS,
    priority: 'extension', title: () => 'Monaco', loading: 'text-pages', wrap: true,
  }), 'vscode-editor: preview definition')
  ctx.effect(() => ctx.slots.inject('sidebar.right.tab.document', () => ctx.slots.register(
    { name: 'sidebar.right.tab.document', key: ID }, MonacoPreview,
  )), 'vscode-editor: preview body')
}
