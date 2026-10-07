import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import { MonacoPreview } from './MonacoPreview.tsx'
import { installWorkers } from './monaco.ts'
import { SUPPORTED_EXTENSIONS } from './languages.ts'
import { syncTheme } from './theme.ts'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { editorLspContribution } from '../lsp-remote.ts'
import { NS, zh, en } from './locales.ts'
declare const __DSH_CSS_MODULES__: string

declare const __EDITOR_CSS__: string
export const name = 'vscode-editor'
export const inject = ['slots', 'documentPreviews', 'theme', 'remote', 'locale']
const ID = '@dshx/vscode-editor/preview'

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
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'vscode-editor: locale')
  let mounting = false
  ctx.effect(async () => {
    if (mounting) throw new Error('vscode-editor: LSP remote is already mounting')
    mounting = true
    const disposeRemote = await ctx.remote.$mount(editorLspContribution)
    const body = ctx.inject(['remote.vscodeEditorLsp'], scope => {
      const queryLsp = (sessionId: Parameters<typeof scope.remote.vscodeEditorLsp.query>[0], request: Parameters<typeof scope.remote.vscodeEditorLsp.query>[1], signal?: AbortSignal) => scope.remote.vscodeEditorLsp.query(sessionId, request, signal)
      scope.effect(() => scope.slots.inject('sidebar.right.tab.document', () => scope.slots.register(
        { name: 'sidebar.right.tab.document', key: ID, locale: NS }, props => <MonacoPreview {...props} queryLsp={queryLsp} />,
      )), 'vscode-editor: preview body')
    })
    try { await body } catch (error) { await body.dispose(); await disposeRemote(); throw error }
    return async () => { mounting = false; await body.dispose(); await disposeRemote() }
  }, 'vscode-editor: LSP remote')
}
