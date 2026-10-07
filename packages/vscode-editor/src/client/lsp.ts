import type { RemoteResult } from '@deepseek-ai/dsh-api-remotes/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { fileAddressFor } from '@deepseek-ai/dsh-util-workspace-path'
import type { EditorLspRequest, EditorLspResult, LspRange } from '../lsp-contract.ts'
import { monaco } from './monaco.ts'

export type QueryEditorLsp = (sessionId: SessionId, request: EditorLspRequest, signal?: AbortSignal) => Promise<RemoteResult<EditorLspResult>>
export type LocationResult = Extract<EditorLspResult, { kind: 'locations' }>
export type NavigationOperation = Exclude<EditorLspRequest['operation'], 'hover'>
export type ResultsState = { operation: NavigationOperation; loading?: boolean; result?: LocationResult; error?: string }
export const navigationOperations: readonly NavigationOperation[] = ['goToDefinition', 'findReferences', 'goToImplementation']

let instanceSerial = 0

/** Monaco rejects two models with the same URI, so every preview instance owns a distinct URI. */
export function editorModelUri(filePath: string): monaco.Uri {
  return monaco.Uri.from({ scheme: 'dsh-editor', path: '/' + filePath, query: String(++instanceSerial) })
}

export function monacoRange(range: LspRange): monaco.Range {
  return new monaco.Range(range.start.line + 1, range.start.character + 1, range.end.line + 1, range.end.character + 1)
}

/** Decode a `file:` URI into the Host path spelling accepted by DSH. */
export function fileUriPath(uri: string): string {
  const target = new URL(uri)
  if (target.protocol !== 'file:' || (target.hostname && target.hostname !== 'localhost')) throw new Error('Unsupported language service location')
  return decodeURIComponent(target.pathname).replace(/^\/([A-Za-z]:\/)/, '$1')
}

/** LSP file URIs are Host paths; resolve them in the originating tab's Session, never the browser's filesystem. */
export function locationAddress(sessionId: string, uri: string, workspaceUri: string): string {
  const path = fileUriPath(uri)
  const cwd = fileUriPath(workspaceUri)
  return fileAddressFor(sessionId, cwd, path)
}

/** Prefer a readable Host path; malformed locations keep their original URI. */
export function locationLabel(uri: string): string {
  try { return fileUriPath(uri) } catch { return uri }
}

/** Each registration ignores every model except this instance's model, including duplicate previews of the same file. */
export function bindEditorLsp(options: {
  editor: monaco.editor.IStandaloneCodeEditor; model: monaco.editor.ITextModel;
  sessionId: SessionId; filePath: string; signal: AbortSignal; query: QueryEditorLsp;
  label: (operation: NavigationOperation) => string; showResults: (state: ResultsState | null) => void;
  openLocation: (location: LocationResult['locations'][number], result: LocationResult) => void;
  selectLocation: (location: LocationResult['locations'][number]) => boolean;
}): { dispose(): void; cancelNavigation(): void; open(location: LocationResult['locations'][number], result: LocationResult): void } {
  const { editor, model, signal } = options
  let disposed = false
  let navigationRevision = 0
  const pending = new Map<EditorLspRequest['operation'], AbortController>()
  const cancelAll = () => { for (const controller of pending.values()) controller.abort(); pending.clear() }
  const onAbort = () => { disposed = true; cancelAll() }
  signal.addEventListener('abort', onAbort, { once: true })
  if (signal.aborted) onAbort()
  const change = model.onDidChangeContent(() => { cancelAll(); navigationRevision++; options.showResults(null) })
  const query = async (operation: EditorLspRequest['operation'], position: monaco.Position, token?: monaco.CancellationToken): Promise<EditorLspResult | undefined> => {
    if (disposed || signal.aborted || model.isDisposed() || token?.isCancellationRequested) return
    pending.get(operation)?.abort()
    const controller = new AbortController()
    pending.set(operation, controller)
    const cancellation = token?.onCancellationRequested(() => controller.abort())
    const version = model.getVersionId()
    const current = () => !disposed && !controller.signal.aborted && !model.isDisposed() && editor.getModel() === model && model.getVersionId() === version
    try {
      const response = await options.query(options.sessionId, {
        operation, filePath: options.filePath, position: { line: position.lineNumber - 1, character: position.column - 1 },
      }, controller.signal)
      if (!current()) return
      if (!response.ok) throw new Error(response.error.message)
      return response.value
    } catch (error) {
      if (current()) throw error
      return undefined
    } finally {
      cancellation?.dispose()
      if (pending.get(operation) === controller) pending.delete(operation)
    }
  }
  const locations = async (candidate: monaco.editor.ITextModel, position: monaco.Position, token: monaco.CancellationToken, operation: NavigationOperation) => {
    if (candidate !== model) return undefined
    try {
      const result = await query(operation, position, token)
      if (result?.kind !== 'locations') return undefined
      return result.locations.map(location => ({ uri: monaco.Uri.parse(location.uri), range: monacoRange(location.range) }))
    } catch { return undefined }
  }
  const registrations = [
    monaco.languages.registerHoverProvider('*', {
      async provideHover(candidate, position, token) {
        if (candidate !== model) return undefined
        try {
          const result = await query('hover', position, token)
          if (result?.kind !== 'hover' || !result.hover) return undefined
          return { contents: [{ value: result.hover.contents, isTrusted: false, supportHtml: false }], range: result.hover.range ? monacoRange(result.hover.range) : undefined }
        } catch { return undefined }
      },
    }),
    monaco.languages.registerDefinitionProvider('*', { provideDefinition: (candidate, position, token) => locations(candidate, position, token, 'goToDefinition') }),
    monaco.languages.registerReferenceProvider('*', { provideReferences: (candidate, position, _context, token) => locations(candidate, position, token, 'findReferences') }),
    monaco.languages.registerImplementationProvider('*', { provideImplementation: (candidate, position, token) => locations(candidate, position, token, 'goToImplementation') }),
    ...navigationOperations.map((operation, index) => editor.addAction({
      id: 'vscode-editor.' + operation, label: options.label(operation), contextMenuGroupId: 'navigation', contextMenuOrder: index + 1,
      keybindings: operation === 'goToDefinition' ? [monaco.KeyCode.F12] : operation === 'findReferences' ? [monaco.KeyMod.Shift | monaco.KeyCode.F12] : [monaco.KeyMod.CtrlCmd | monaco.KeyCode.F12],
      async run() {
        const position = editor.getPosition()
        if (!position || disposed) return
        const revision = ++navigationRevision
        for (const operation of navigationOperations) pending.get(operation)?.abort()
        options.showResults({ operation, loading: true })
        try {
          const result = await query(operation, position)
          if (disposed || revision !== navigationRevision || result?.kind !== 'locations') return
          if (operation !== 'findReferences' && result.locations.length === 1 && !result.truncated) {
            open(result.locations[0]!, result)
            options.showResults(null)
          } else options.showResults({ operation, result })
        } catch (error) {
          if (!disposed && revision === navigationRevision) options.showResults({ operation, error: error instanceof Error ? error.message : String(error) })
        }
      },
    })),
  ]
  const open = (location: LocationResult['locations'][number], result: LocationResult): void => {
    if (!options.selectLocation(location)) options.openLocation(location, result)
  }
  return {
    open,
    cancelNavigation() { navigationRevision++; for (const operation of navigationOperations) pending.get(operation)?.abort() },
    dispose() { disposed = true; navigationRevision++; cancelAll(); change.dispose(); signal.removeEventListener('abort', onAbort); for (const registration of registrations) registration.dispose() },
  }
}
