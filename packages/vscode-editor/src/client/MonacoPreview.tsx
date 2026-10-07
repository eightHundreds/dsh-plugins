import { useEffect, useRef } from 'react'
import type { DocumentPreviewProps } from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/client'
import { monaco } from './monaco.js'
import { THEME_ID } from './theme.js'

// Tab lifetime signals let answered navigation survive body remounts without retaining closed tabs.
const answeredNavigation = new WeakMap<AbortSignal, string>()

/** The official owner keeps reading/paging/reload; this body owns only the read-only editor. */
export function MonacoPreview({ content, resourceAddress, wrap, scrollportRef, useTabInfo }: DocumentPreviewProps) {
  const container = useRef<HTMLDivElement>(null)
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const { tab } = useTabInfo()
  const navigation = tab.navigation

  useEffect(() => {
    if (!container.current) return
    const path = decodeURIComponent(new URL(resourceAddress).pathname)
    const language = /[.](ts|tsx|mts|cts)$/i.test(path) ? 'typescript' : 'javascript'
    const model = monaco.editor.createModel(content.kind === 'text' ? content.text : '', language)
    const instance = monaco.editor.create(container.current, {
      model, theme: THEME_ID, readOnly: true, domReadOnly: true,
      wordWrap: wrap ? 'on' : 'off', automaticLayout: true, minimap: { enabled: false }, scrollBeyondLastLine: false,
      fontFamily: getComputedStyle(document.body).getPropertyValue('--ds-font-family-code').trim() || 'monospace',
      fontSize: 13, padding: { top: 12, bottom: 12 }, renderLineHighlight: 'line',
    })
    editor.current = instance
    // Monaco scrolls virtually. Adapt the owner's native-scroll contract explicitly.
    const port = container.current
    Object.defineProperties(port, {
      scrollTop: { configurable: true, get: () => instance.getScrollTop(), set: (value: number) => instance.setScrollTop(value) },
      scrollHeight: { configurable: true, get: () => instance.getScrollHeight() },
    })
    const scroll = instance.onDidScrollChange(() => port.dispatchEvent(new Event('scroll', { bubbles: true })))
    scrollportRef(port)
    return () => { scroll.dispose(); scrollportRef(null); editor.current = null; instance.dispose(); model.dispose(); Reflect.deleteProperty(port, 'scrollTop'); Reflect.deleteProperty(port, 'scrollHeight') }
  }, [resourceAddress, scrollportRef])
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
  return <div ref={container} data-code-preview data-vscode-editor-preview style={{ flex: '1 1 auto', width: '100%', height: '100%', minHeight: 0, minWidth: 0, overflow: 'hidden', whiteSpace: 'normal' }} />
}
