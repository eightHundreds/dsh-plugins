import type { LspOperation, LspPosition, LspRange, LspLocation } from '@deepseek-ai/dsh-lsp'
export type { LspRange }
export interface EditorLspRequest {
  readonly operation: LspOperation
  readonly filePath: string
  readonly position: LspPosition
}
export type EditorLspResult =
  | { readonly kind: 'hover'; readonly hover: { readonly contents: string; readonly range?: LspRange } | null }
  | { readonly kind: 'locations'; readonly locations: readonly LspLocation[]; readonly resolvedWorkspaceUri: string; readonly truncated: boolean }
