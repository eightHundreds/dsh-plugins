import type {
  DiagnosticSeverity,
  LspDiagnostic,
  LspDocumentSymbol,
  LspHover,
  LspLocation,
  LspOperation,
  LspRange,
} from './types'
import { LspError, assertNever } from './types'
import type {
  WireDiagnostic,
  WireDiagnosticReport,
  WireDocumentSymbol,
  WireHover,
  WireLocation,
  WireLocationLink,
  WireMarkedString,
  WireProviderCapability,
  WireRange,
  WireServerCapabilities,
  WireSymbolInformation,
  WireTextDocumentSyncKind,
} from './protocol'

export function requestMethod(operation: LspOperation): string {
  switch (operation) {
    case 'goToDefinition': return 'textDocument/definition'
    case 'goToTypeDefinition': return 'textDocument/typeDefinition'
    case 'findReferences': return 'textDocument/references'
    case 'goToImplementation': return 'textDocument/implementation'
    case 'hover': return 'textDocument/hover'
    case 'diagnostics': return 'textDocument/diagnostic'
    case 'documentSymbols': return 'textDocument/documentSymbol'
    default: return assertNever(operation, 'requestMethod')
  }
}

function capabilityValue(capabilities: WireServerCapabilities, operation: LspOperation): WireProviderCapability {
  switch (operation) {
    case 'goToDefinition': return capabilities.definitionProvider
    case 'goToTypeDefinition': return capabilities.typeDefinitionProvider
    case 'findReferences': return capabilities.referencesProvider
    case 'goToImplementation': return capabilities.implementationProvider
    case 'hover': return capabilities.hoverProvider
    case 'diagnostics': return capabilities.diagnosticProvider
    case 'documentSymbols': return capabilities.documentSymbolProvider
    default: return assertNever(operation, 'capabilityValue')
  }
}

function supportsCapability(value: WireProviderCapability): boolean {
  if (value === undefined) return false
  if (typeof value === 'boolean') return value
  return true
}

export function supportsOperation(capabilities: WireServerCapabilities, operation: LspOperation): boolean {
  return supportsCapability(capabilityValue(capabilities, operation))
}

export function supportsTransientOpen(sync: WireServerCapabilities['textDocumentSync']): boolean {
  if (sync === undefined) return false
  if (typeof sync === 'number') return isOpenCloseKind(sync)
  return sync.openClose === true
}

function isOpenCloseKind(kind: WireTextDocumentSyncKind): boolean {
  return kind === 1 || kind === 2
}

export function negotiatePositionEncoding(encoding: string | undefined): 'utf-16' {
  if (encoding === undefined || encoding === 'utf-16') return 'utf-16'
  throw new Error(`server negotiated unsupported position encoding "${encoding}"; this host requires utf-16`)
}

function toRange(range: WireRange): LspRange {
  return {
    start: { line: range.start.line, character: range.start.character },
    end: { line: range.end.line, character: range.end.character },
  }
}

function isLocationLink(value: Record<string, unknown>): boolean {
  return typeof value.targetUri === 'string' && isRange(value.targetSelectionRange)
}

function isLocation(value: Record<string, unknown>): boolean {
  return typeof value.uri === 'string' && isRange(value.range)
}

function isRange(value: unknown): value is WireRange {
  if (value === null || typeof value !== 'object') return false
  const range = value as Record<string, unknown>
  return isPosition(range.start) && isPosition(range.end)
}

function isPosition(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false
  const position = value as Record<string, unknown>
  return isProtocolCoordinate(position.line) && isProtocolCoordinate(position.character)
}

function isProtocolCoordinate(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

export function normalizeLocations(payload: unknown): LspLocation[] {
  if (payload === null) return []
  if (payload === undefined) throw malformedResponse('LSP navigation result was missing')
  const elements = Array.isArray(payload) ? payload : [payload]
  const locations: LspLocation[] = []
  for (const element of elements) {
    if (element === null || typeof element !== 'object') {
      throw malformedResponse('LSP navigation result contained a non-object entry')
    }
    const record = element as Record<string, unknown>
    if (isLocationLink(record)) {
      const link = record as unknown as WireLocationLink
      locations.push({ uri: link.targetUri, range: toRange(link.targetSelectionRange) })
    } else if (isLocation(record)) {
      const location = record as unknown as WireLocation
      locations.push({ uri: location.uri, range: toRange(location.range) })
    } else {
      throw malformedResponse('LSP navigation result contained neither a Location nor a LocationLink')
    }
  }
  return locations
}

function renderMarkedString(value: WireMarkedString): string {
  if (typeof value === 'string') return value
  return `\`\`\`${value.language}\n${value.value}\n\`\`\``
}

export function normalizeHover(payload: unknown): LspHover | null {
  if (payload === null) return null
  if (payload === undefined) throw malformedResponse('LSP hover result was missing')
  if (typeof payload !== 'object') throw malformedResponse('LSP hover result was not an object')
  const hover = payload as WireHover
  const contents = renderHoverContents(hover.contents)
  if (contents === '') return null
  const range = hover.range
  if (range === undefined) return { contents }
  if (!isRange(range)) throw malformedResponse('LSP hover result contained a malformed range')
  return { contents, range: toRange(range) }
}

function renderHoverContents(contents: unknown): string {
  if (contents === null || contents === undefined) {
    throw malformedResponse('LSP hover result had no contents')
  }
  if (typeof contents === 'string') return contents
  if (Array.isArray(contents)) {
    return contents.map((value) => {
      if (isMarkedString(value)) return renderMarkedString(value)
      throw malformedResponse('LSP hover contents contained a malformed MarkedString')
    }).join('\n\n')
  }
  if (typeof contents !== 'object') {
    throw malformedResponse('LSP hover contents were not MarkupContent, MarkedString, or an array')
  }
  const record = contents as Record<string, unknown>
  if (record.kind === 'markdown' || record.kind === 'plaintext') {
    if (typeof record.value !== 'string') {
      throw malformedResponse('LSP hover MarkupContent value was not a string')
    }
    return record.value
  }
  if (typeof record.language === 'string' && typeof record.value === 'string') {
    return renderMarkedString({ language: record.language, value: record.value })
  }
  throw malformedResponse('LSP hover contents were not MarkupContent, MarkedString, or an array')
}

function isMarkedString(value: unknown): value is WireMarkedString {
  if (typeof value === 'string') return true
  if (value === null || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return typeof record.language === 'string' && typeof record.value === 'string'
}

const SEVERITY_MAP: Record<number, DiagnosticSeverity> = {
  1: 'error',
  2: 'warning',
  3: 'information',
  4: 'hint',
}

export function normalizeDiagnostics(payload: unknown): LspDiagnostic[] {
  if (payload === null || payload === undefined) return []
  let items: readonly WireDiagnostic[] = []
  if (Array.isArray(payload)) {
    items = payload
  } else if (typeof payload === 'object') {
    const report = payload as WireDiagnosticReport
    if (Array.isArray(report.items)) items = report.items
  }
  return items.map((item) => ({
    range: toRange(item.range),
    severity: (item.severity && SEVERITY_MAP[item.severity]) ?? 'error',
    code: item.code,
    source: item.source,
    message: item.message,
  }))
}

const SYMBOL_KIND_NAMES: Record<number, string> = {
  1: 'File',
  2: 'Module',
  3: 'Namespace',
  4: 'Package',
  5: 'Class',
  6: 'Method',
  7: 'Property',
  8: 'Field',
  9: 'Constructor',
  10: 'Enum',
  11: 'Interface',
  12: 'Function',
  13: 'Variable',
  14: 'Constant',
  15: 'String',
  16: 'Number',
  17: 'Boolean',
  18: 'Array',
  19: 'Object',
  20: 'Key',
  21: 'Null',
  22: 'EnumMember',
  23: 'Struct',
  24: 'Event',
  25: 'Operator',
  26: 'TypeParameter',
}

export function normalizeDocumentSymbols(payload: unknown): LspDocumentSymbol[] {
  if (!Array.isArray(payload)) return []
  return payload.map(normalizeSingleSymbol).filter(Boolean) as LspDocumentSymbol[]
}

function normalizeSingleSymbol(item: unknown): LspDocumentSymbol | null {
  if (item === null || typeof item !== 'object') return null
  const record = item as Record<string, unknown>
  if (typeof record.name !== 'string') return null
  const kindNum = typeof record.kind === 'number' ? record.kind : 0
  const kindStr = SYMBOL_KIND_NAMES[kindNum] ?? `Symbol(${kindNum})`

  // Hierarchical DocumentSymbol
  if (isRange(record.range) && isRange(record.selectionRange)) {
    const docSymbol = item as WireDocumentSymbol
    const children = Array.isArray(docSymbol.children)
      ? (docSymbol.children.map(normalizeSingleSymbol).filter(Boolean) as LspDocumentSymbol[])
      : undefined
    return {
      name: docSymbol.name,
      detail: docSymbol.detail,
      kind: kindStr,
      range: toRange(docSymbol.range),
      selectionRange: toRange(docSymbol.selectionRange),
      children,
    }
  }

  // Flat SymbolInformation
  if (record.location && isRange((record.location as WireLocation).range)) {
    const symInfo = item as WireSymbolInformation
    return {
      name: symInfo.name,
      detail: symInfo.containerName,
      kind: kindStr,
      range: toRange(symInfo.location.range),
      selectionRange: toRange(symInfo.location.range),
    }
  }

  return null
}

function malformedResponse(message: string): LspError {
  return new LspError(message, 'LSP_MALFORMED_RESPONSE')
}
