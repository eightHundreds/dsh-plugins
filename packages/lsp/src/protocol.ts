export interface WirePosition {
  readonly line: number
  readonly character: number
}

export interface WireRange {
  readonly start: WirePosition
  readonly end: WirePosition
}

export interface WireLocation {
  readonly uri: string
  readonly range: WireRange
}

export interface WireLocationLink {
  readonly targetUri: string
  readonly targetSelectionRange: WireRange
  readonly targetRange?: WireRange
}

export interface WireMarkupContent {
  readonly kind: 'markdown' | 'plaintext'
  readonly value: string
}

export interface WireMarkedStringObject {
  readonly language: string
  readonly value: string
}

export type WireMarkedString = string | WireMarkedStringObject

export interface WireHover {
  readonly contents: WireMarkupContent | WireMarkedString | readonly WireMarkedString[]
  readonly range?: WireRange
}

export type WireTextDocumentSyncKind = 0 | 1 | 2

export interface WireTextDocumentSyncOptions {
  readonly openClose?: boolean
  readonly change?: WireTextDocumentSyncKind
}

export type WireProviderCapability = boolean | Record<string, unknown> | undefined

export interface WireDiagnostic {
  readonly range: WireRange
  readonly severity?: 1 | 2 | 3 | 4
  readonly code?: string | number
  readonly source?: string
  readonly message: string
}

export interface WireDiagnosticReport {
  readonly kind?: 'full' | 'unchanged'
  readonly items?: readonly WireDiagnostic[]
}

export interface WireDocumentSymbol {
  readonly name: string
  readonly detail?: string
  readonly kind: number
  readonly range: WireRange
  readonly selectionRange: WireRange
  readonly children?: readonly WireDocumentSymbol[]
}

export interface WireSymbolInformation {
  readonly name: string
  readonly kind: number
  readonly location: WireLocation
  readonly containerName?: string
}

export interface WireServerCapabilities {
  readonly positionEncoding?: string
  readonly textDocumentSync?: WireTextDocumentSyncKind | WireTextDocumentSyncOptions
  readonly definitionProvider?: WireProviderCapability
  readonly typeDefinitionProvider?: WireProviderCapability
  readonly referencesProvider?: WireProviderCapability
  readonly implementationProvider?: WireProviderCapability
  readonly hoverProvider?: WireProviderCapability
  readonly diagnosticProvider?: WireProviderCapability
  readonly documentSymbolProvider?: WireProviderCapability
}

export interface WireInitializeResult {
  readonly capabilities: WireServerCapabilities
}
