/**
 * Post-edit diagnostics through the deployment's `ctx.lsp` seam.
 *
 * `@dshx/lsp` reads the file from disk and pulls `textDocument/diagnostic`, so
 * this runs only after a write has landed. LSP absence or failure never fails
 * the edit.
 */
import type { LspDiagnostic, LspService } from '@dshx/lsp'

export interface EditDiagnosticMessage {
  range: { start: { line: number; character: number }; end: { line: number; character: number } }
  severity: 'error' | 'warning' | 'information' | 'hint'
  message: string
  source?: string
  code?: string | number
}

export interface EditDiagnosticsResult {
  summary: string
  messages: readonly EditDiagnosticMessage[]
}

const MESSAGE_LIMIT = 50

export function renderDiagnostics(result: EditDiagnosticsResult | undefined): string {
  if (result === undefined || result.messages.length === 0) return ''
  const lines = result.messages.map(message => {
    const line = message.range.start.line + 1
    const character = message.range.start.character + 1
    const source = message.source === undefined ? '' : `[${message.source}] `
    const code = message.code === undefined ? '' : `[${message.code}] `
    return `${line}:${character} [${message.severity}] ${source}${code}${message.message.trim()}`
  })
  return [result.summary, ...lines].join('\n')
}

export function appendDiagnostics(text: string, result: EditDiagnosticsResult | undefined): string {
  const rendered = renderDiagnostics(result)
  return rendered.length === 0 ? text : `${text}\n\n${rendered}`
}

export async function collectEditDiagnostics(options: {
  lsp: LspService | undefined
  enabled: boolean
  deduplicate: boolean
  filePath: string
  workspaceRoot: string
  signal?: AbortSignal
}): Promise<EditDiagnosticsResult | undefined> {
  const { lsp, enabled, deduplicate, filePath, workspaceRoot, signal } = options
  if (!enabled || lsp === undefined || signal?.aborted === true) return undefined
  try {
    const result = await lsp.query({
      operation: 'diagnostics',
      filePath,
      position: { line: 0, character: 0 },
      workspaceRoot,
    }, signal)
    if (result.kind !== 'diagnostics') return undefined
    return toResult(result.diagnostics, deduplicate)
  } catch {
    return undefined
  }
}

function toResult(diagnostics: readonly LspDiagnostic[], deduplicate: boolean): EditDiagnosticsResult | undefined {
  const unique = deduplicate ? dedupe(diagnostics) : diagnostics
  const messages = unique.slice(0, MESSAGE_LIMIT).map(toMessage)
  if (messages.length === 0) return undefined
  return { summary: summarize(messages), messages }
}

function toMessage(diagnostic: LspDiagnostic): EditDiagnosticMessage {
  return {
    range: diagnostic.range,
    severity: diagnostic.severity,
    message: diagnostic.message,
    ...(diagnostic.source === undefined ? {} : { source: diagnostic.source }),
    ...(diagnostic.code === undefined ? {} : { code: diagnostic.code }),
  }
}

function dedupe(diagnostics: readonly LspDiagnostic[]): readonly LspDiagnostic[] {
  const seen = new Set<string>()
  const kept: LspDiagnostic[] = []
  for (const diagnostic of diagnostics) {
    const key = `${diagnostic.range.start.line}:${diagnostic.range.start.character}|${diagnostic.severity}|${diagnostic.message}`
    if (seen.has(key)) continue
    seen.add(key)
    kept.push(diagnostic)
  }
  return kept
}

function summarize(messages: readonly EditDiagnosticMessage[]): string {
  const counts = { error: 0, warning: 0, information: 0, hint: 0 }
  for (const message of messages) counts[message.severity]++
  const parts = (Object.keys(counts) as (keyof typeof counts)[])
    .filter(severity => counts[severity] > 0)
    .map(severity => `${counts[severity]} ${severity}(s)`)
  return parts.join(', ')
}
