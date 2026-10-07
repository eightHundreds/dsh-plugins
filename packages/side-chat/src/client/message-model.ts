import type { ChatConversationViewNode } from '@deepseek-ai/dsh-client-ui-chat/client'

export type SideChatRole = 'user' | 'assistant' | 'context' | 'tool'
export type SideChatMessageStatus = 'running' | 'settled' | 'interrupted' | 'failed'
export type SideChatPart =
  | { kind: 'text' | 'reasoning'; text: string }
  | { kind: 'image' | 'unsupported' }

export interface SideChatMessageModel {
  readonly role: SideChatRole
  readonly name?: string
  readonly status?: SideChatMessageStatus
  readonly parts: readonly SideChatPart[]
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined
}

/** Read only recognized public text blocks; opaque tool payloads remain opaque. */
export function messageParts(value: unknown): SideChatPart[] {
  if (!Array.isArray(value)) return []
  const parts: SideChatPart[] = []
  for (const item of value) {
    const block = record(item)
    if (!block) continue
    const kind = block.kind ?? block.type
    if ((kind === 'text' || kind === 'reasoning') && typeof block.text === 'string') {
      if (block.text.length > 0) parts.push({ kind, text: block.text })
    } else if (kind === 'image') parts.push({ kind: 'image' })
    // Tool calls have their own lifecycle row; never duplicate them as assistant text.
    else if (kind !== 'tool-call') parts.push({ kind: 'unsupported' })
  }
  return parts
}

function status(value: unknown): SideChatMessageStatus | undefined {
  return value === 'running' || value === 'settled' || value === 'interrupted' || value === 'failed'
    ? value : undefined
}

/** Project one live Chat node without relying on unavailable rc2 tool-payload exports. */
export function messageModel(node: ChatConversationViewNode | undefined): SideChatMessageModel | null {
  if (!node || node.visibility === 'hidden') return null
  const data = record(node.data)
  if (!data) return null
  switch (node.kind) {
    case 'user':
    case 'steering':
      return { role: 'user', parts: messageParts(data.content) }
    case 'context':
    case 'turn-trigger':
      return { role: 'context', parts: messageParts(data.content) }
    case 'assistant-step':
      return { role: 'assistant', status: status(data.status), parts: messageParts(data.blocks) }
    case 'tool-call': {
      const root = record(data.root)
      if (!root) return null
      const call = record(root.call)
      const name = typeof root.name === 'string' ? root.name
        : typeof call?.name === 'string' ? call.name : undefined
      const settled = root.kind === 'tool-result'
      const error = record(root.error)
      return {
        role: 'tool', name,
        status: error?.code === 'interrupted' ? 'interrupted'
          : settled ? root.isError === true ? 'failed' : 'settled' : 'running',
        parts: settled ? messageParts(root.content) : [],
      }
    }
    case 'turn-error':
      return {
        role: 'context', status: 'failed',
        parts: typeof data.message === 'string' && data.message.length > 0
          ? [{ kind: 'text', text: data.message }] : [],
      }
    // These are navigation/control or request-inspection nodes, not messages.
    case 'turn-tail':
    case 'turn-process':
    case 'request-prompt':
      return null
    default:
      return { role: 'context', name: node.kind, parts: [{ kind: 'unsupported' }] }
  }
}

export interface DraftStamp {
  readonly text: string
  readonly revision: number
}

/** A later edit, including editing away and back, must survive an earlier accepted send. */
export function sameDraft(current: DraftStamp | undefined, submitted: DraftStamp): boolean {
  return current?.revision === submitted.revision && current.text === submitted.text
}

export interface EnterInput {
  readonly key: string
  readonly shiftKey: boolean
  readonly ctrlKey: boolean
  readonly metaKey: boolean
  readonly altKey: boolean
  readonly repeat: boolean
  readonly composing: boolean
  readonly keyCode: number
}

/** Enter submits once; IME confirmation and modified/repeated Enter remain editor input. */
export function shouldSubmitOnEnter(input: EnterInput): boolean {
  return input.key === 'Enter' && !input.shiftKey && !input.ctrlKey && !input.metaKey
    && !input.altKey && !input.repeat && !input.composing && input.keyCode !== 229
}
