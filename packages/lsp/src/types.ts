import { HarnessError } from '@deepseek-ai/dsh-llm'

export type LspProviderId = string

export function LspProviderId(id: string): LspProviderId {
  return id as LspProviderId
}

export type LspOperation =
  | 'goToDefinition'
  | 'findReferences'
  | 'goToImplementation'
  | 'hover'
  | 'diagnostics'
  | 'documentSymbols'
  | 'goToTypeDefinition'

export interface LspPosition {
  readonly line: number
  readonly character: number
}

export interface LspRange {
  readonly start: LspPosition
  readonly end: LspPosition
}

export interface LspQueryRequest {
  readonly operation: LspOperation
  readonly filePath: string
  readonly position: LspPosition
  readonly workspaceRoot: string
}

export interface LspProviderQuery extends LspQueryRequest {
  readonly languageId: string
}

export interface LspLocation {
  readonly uri: string
  readonly range: LspRange
}

export interface LspHover {
  readonly contents: string
  readonly range?: LspRange
}

export type DiagnosticSeverity = 'error' | 'warning' | 'information' | 'hint'

export interface LspDiagnostic {
  readonly range: LspRange
  readonly severity: DiagnosticSeverity
  readonly code?: string | number
  readonly source?: string
  readonly message: string
}

export interface LspDocumentSymbol {
  readonly name: string
  readonly detail?: string
  readonly kind: string
  readonly range: LspRange
  readonly selectionRange: LspRange
  readonly children?: readonly LspDocumentSymbol[]
}

export type LspQueryResult =
  | { readonly kind: 'locations'; readonly locations: readonly LspLocation[]; readonly resolvedWorkspaceUri: string }
  | { readonly kind: 'hover'; readonly hover: LspHover | null }
  | { readonly kind: 'diagnostics'; readonly diagnostics: readonly LspDiagnostic[] }
  | { readonly kind: 'documentSymbols'; readonly symbols: readonly LspDocumentSymbol[] }

export interface LspProvider {
  readonly id: LspProviderId
  readonly extensionToLanguage: Readonly<Record<string, string>>
  query(request: LspProviderQuery, signal?: AbortSignal): Promise<LspQueryResult>
}

export interface LspService {
  registerProvider(provider: LspProvider): () => void
  query(request: LspQueryRequest, signal?: AbortSignal): Promise<LspQueryResult>
}

export class LspError extends HarnessError {}

export const MAX_TIMER_DELAY_MS = 2147483647

export function assertNever(value: never, label: string): never {
  throw new Error(`Unhandled ${label}: ${JSON.stringify(value)}`)
}
