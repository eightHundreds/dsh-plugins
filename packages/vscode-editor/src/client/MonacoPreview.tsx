import { useEffect, useRef, useState } from 'react'
import type { DocumentPreviewProps } from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { parseFileAddress } from '@deepseek-ai/dsh-util-workspace-path'
import { bindEditorLsp, editorModelUri, locationAddress, locationLabel, monacoRange, sameSessionFile, type QueryEditorLsp, type ResultsState } from './lsp.ts'
import type {} from './locales.ts'
import { monaco } from './monaco.ts'
import { getLanguageForPath } from './languages.ts'
import { THEME_ID } from './theme.ts'
import styles from './preview.module.css'

// Tab lifetime signals let answered navigation survive body remounts without retaining closed tabs.
const answeredNavigation = new WeakMap<AbortSignal, string>()

/** The official owner keeps reading/paging/reload; this body owns only the read-only editor. */
export type MonacoPreviewProps = DocumentPreviewProps & PropsLocale<'vscodeEditor'> & { queryLsp: QueryEditorLsp }

export function MonacoPreview({ content, resourceAddress, wrap, scrollportRef, useTabInfo, queryLsp, t }: MonacoPreviewProps) {
  const container = useRef<HTMLDivElement>(null)
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const { tab } = useTabInfo()
  const navigation = tab.navigation
  const [results, setResults] = useState<ResultsState | null>(null)
  const lsp = useRef<ReturnType<typeof bindEditorLsp> | null>(null)
  const live = useRef({ t, actions: tab.actions, setResults })
  live.current = { t, actions: tab.actions, setResults }

  useEffect(() => {
    if (!container.current) return
    const file = parseFileAddress(resourceAddress)
    const language = getLanguageForPath(file?.path ?? '')
    const model = monaco.editor.createModel(content.kind === 'text' ? content.text : '', language, editorModelUri(file?.path ?? 'untitled'))
    const instance = monaco.editor.create(container.current, {
      model, theme: THEME_ID, readOnly: true, domReadOnly: true,
      wordWrap: wrap ? 'on' : 'off', automaticLayout: true, minimap: { enabled: false }, scrollBeyondLastLine: false,
      fontFamily: getComputedStyle(document.body).getPropertyValue('--ds-font-family-code').trim() || 'monospace',
      fontSize: 13, padding: { top: 12, bottom: 12 }, renderLineHighlight: 'line',
    })
    editor.current = instance
    setResults(null)
    const binding = file?.scope === 'session' ? bindEditorLsp({
      editor: instance, model, sessionId: file.sessionId as SessionId, filePath: file.path, signal: tab.signal,
      query: queryLsp, label: operation => live.current.t(operation), showResults: state => live.current.setResults(state),
      selectLocation: (location, result) => {
        if (!sameSessionFile(file.sessionId, file.path, location.uri, result.resolvedWorkspaceUri)) return false
        const range = monacoRange(location.range)
        instance.setSelection(range); instance.revealRangeInCenter(range); instance.focus(); return true
      },
      openLocation: (location, result) => live.current.actions.openResource(
        locationAddress(file.sessionId, location.uri, result.resolvedWorkspaceUri), { params: { line: location.range.start.line + 1 } },
      ),
    }) : null
    lsp.current = binding
    // Monaco scrolls virtually. Adapt the owner's native-scroll contract explicitly.
    const port = container.current
    Object.defineProperties(port, {
      scrollTop: { configurable: true, get: () => instance.getScrollTop(), set: (value: number) => instance.setScrollTop(value) },
      scrollHeight: { configurable: true, get: () => instance.getScrollHeight() },
    })
    const scroll = instance.onDidScrollChange(() => port.dispatchEvent(new Event('scroll', { bubbles: true })))
    const definitionClick = instance.onMouseUp(event => {
      if (!event.event.metaKey || !event.event.leftButton || event.target.type !== monaco.editor.MouseTargetType.CONTENT_TEXT || !event.target.position) return
      event.event.preventDefault()
      event.event.stopPropagation()
      instance.setPosition(event.target.position)
      void instance.getAction('vscode-editor.goToDefinition')?.run()
    })
    scrollportRef(port)
    return () => { binding?.dispose(); lsp.current = null; scroll.dispose(); definitionClick.dispose(); scrollportRef(null); editor.current = null; instance.dispose(); model.dispose(); Reflect.deleteProperty(port, 'scrollTop'); Reflect.deleteProperty(port, 'scrollHeight') }
  }, [resourceAddress, scrollportRef, queryLsp, tab.signal])
  useEffect(() => {
    if (content.kind !== 'text') return
    const model = editor.current?.getModel()
    if (model && model.getValue() !== content.text) {
      const view = editor.current?.saveViewState()
      model.setValue(content.text)
      if (view) editor.current?.restoreViewState(view)
    }
  }, [content])
  useEffect(() => { editor.current?.updateOptions({ wordWrap: wrap ? 'on' : 'off' }) }, [wrap])
  useEffect(() => {
    const params = navigation.params
    const line = params && 'line' in params ? params.line : undefined
    if (typeof line !== 'number' || content.kind !== 'text') return
    const model = editor.current?.getModel()
    if (!model || line > model.getLineCount()) return
    const target = resourceAddress + ':' + navigation.revision + ':' + line
    if (answeredNavigation.get(tab.signal) === target) return
    answeredNavigation.set(tab.signal, target)
    editor.current?.setPosition({ lineNumber: Math.max(1, line), column: 1 })
    editor.current?.revealLineInCenter(Math.max(1, line))
  }, [resourceAddress, tab.signal, navigation.revision, navigation.params, content])
  return <div className={styles.body}>
    <div ref={container} data-code-preview data-vscode-editor-preview className={styles.preview} />
    {results && <section className={styles.results} aria-label={t('results')} onKeyDown={event => {
      if (event.key === 'Escape') { lsp.current?.cancelNavigation(); setResults(null); editor.current?.focus() }
    }}>
      <div className={styles.resultsHeader}>
        <strong>{t(results.operation)}</strong>
        <button type="button" onClick={() => { lsp.current?.cancelNavigation(); setResults(null); editor.current?.focus() }} aria-label={t('close')}>×</button>
      </div>
      {results.loading && <p role="status">{t('loading')}</p>}
      {results.error && <p role="alert">{t('failed', { message: results.error })}</p>}
      {results.result && <>
        {results.result.locations.length === 0 && <p role="status">{t('empty')}</p>}
        {results.result.truncated && <p role="status">{t('truncated')}</p>}
        <ul>{results.result.locations.map((location, index) => {
          const label = locationLabel(location.uri)
          return <li key={location.uri + ':' + location.range.start.line + ':' + location.range.start.character + ':' + index}>
            <button type="button" title={label} onClick={() => {
              if (!results.result) return
              try { lsp.current?.open(location, results.result) }
              catch (error) { setResults({ ...results, error: error instanceof Error ? error.message : String(error) }) }
            }}>{label}:{location.range.start.line + 1}</button>
          </li>
        })}</ul>
      </>}
    </section>}
  </div>
}
