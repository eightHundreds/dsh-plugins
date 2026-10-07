import { useEffect, useRef, useState } from 'react'
import type {
  HostObservable, InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime, SlotHookFactory,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { ChatConversationViewNode, ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import styles from './styles.module.css'
import { messageModel, sameDraft, shouldSubmitOnEnter } from './message-model.js'
import type { DraftStamp, SideChatPart } from './message-model.js'

/** Copy is supplied by the plugin's locale boundary, including errors from its SessionFace adapter. */
export interface SideChatConversationCopy {
  readonly transcript: string
  readonly input: string
  readonly send: string
  readonly sending: string
  readonly stop: string
  readonly stopping: string
  readonly loadOlder: string
  readonly loadingOlder: string
  readonly empty: string
  readonly loading: string
  readonly pendingInteraction: string
  readonly openMain: string
  readonly user: string
  readonly assistant: string
  readonly context: string
  readonly reasoning: string
  readonly tool: string
  readonly running: string
  readonly settled: string
  readonly interrupted: string
  readonly failed: string
  readonly image: string
  readonly unsupported: string
}

/** Registered for the retained side Session, never for the current main Session. */
export interface SideChatConversationInjected {
  readonly keyedHooks: { readonly sideChatNode: (key: string) => HostObservable<ChatConversationViewNode | undefined> }
  /** Resolves only after accepted admission; rejects on transport or business failure. */
  readonly send: (text: string) => Promise<void>
  readonly stop: () => Promise<void>
  readonly loadOlder: () => Promise<void>
  readonly onOpenMain: () => void
  readonly errorMessage: (error: unknown) => string
}

export interface SideChatMessageHookContext {
  readonly key: string
  readonly useSideChatNode: InjectFace<SideChatConversationInjected>['useSideChatNode']
}

export interface SideChatMessageInjected {
  readonly hooks: {
    readonly node: SlotHookFactory<'dsk.sidechat.message', () => ChatConversationViewNode | undefined>
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'dsk.sidechat.message': {
      kind: 'keyed'
      scope: 'session'
      owner: { copy: SideChatConversationCopy }
      hookContext: SideChatMessageHookContext
      inject: SideChatMessageInjected
    }
  }
}

/** Pure contextual binding to the framework's keyed Hook; no business-owned external-store Hook. */
export const SIDE_CHAT_MESSAGE_INJECT: SideChatMessageInjected = {
  // rc2's published HostObservable alias loses keyed value inference; the injected source fixes it.
  hooks: { node: (_standard, context) => () => context.useSideChatNode(context.key) as ChatConversationViewNode | undefined },
}

function MessageParts({ parts, copy }: { parts: readonly SideChatPart[]; copy: SideChatConversationCopy }) {
  return <>{parts.map((part, index) => part.kind === 'reasoning'
    ? <details key={index} data-sidechat-reasoning><summary>{copy.reasoning}</summary>
      <div className={styles.textPart}>{part.text}</div></details>
    : part.kind === 'text'
      ? <div key={index} className={styles.textPart}>{part.text}</div>
      : <p key={index}>{part.kind === 'image' ? copy.image : copy.unsupported}</p>)}</>
}

export type SideChatMessageProps = PropsRuntime<'dsk.sidechat.message'>
export function SideChatMessage({ useNode, copy }: SideChatMessageProps) {
  const model = messageModel(useNode())
  if (!model) return null
  return <article data-sidechat-message={model.role}>
    <header><strong>{copy[model.role]}{model.name ? ` · ${model.name}` : ''}</strong>
      {model.status && <span> · {copy[model.status]}</span>}</header>
    <MessageParts parts={model.parts} copy={copy} />
  </article>
}

export type ConversationPanelProps = PropsRuntime<'dsk.sidechat.conversation'>
  & PropsRenderSlots<'dsk.sidechat.message'> & InjectFace<SideChatConversationInjected> & PropsLocale<'sidechat'>

export function ConversationPanel({
  sessionId, useChat, useSideChatNode, useSession, useSessionStatus, renderSlot,
  send, stop, loadOlder, onOpenMain, errorMessage, t,
}: ConversationPanelProps) {
  const copy: SideChatConversationCopy = {
    transcript: t('transcript'), input: t('input'), send: t('send'), sending: t('sending'), stop: t('stop'), stopping: t('stopping'),
    loadOlder: t('loadOlder'), loadingOlder: t('loadingOlder'), empty: t('empty'), loading: t('loading'), pendingInteraction: t('pendingInteraction'), openMain: t('openMain'),
    user: t('user'), assistant: t('assistant'), context: t('context'), reasoning: t('reasoning'), tool: t('tool'), running: t('running'), settled: t('settled'), interrupted: t('interrupted'), failed: t('failed'), image: t('image'), unsupported: t('nativeNotice'),
  }
  // Chat order updates independently of content; each child subscribes to its stable source.
  const order: readonly string[] = useChat((chat: ChatSnapshot) => chat.order)
  const session: SessionSnapshot = useSession((value: SessionSnapshot) => value)
  const interaction = useSessionStatus((status: SessionStatusSnapshot) => status.get(sessionId)?.pendingInteraction)
  const [drafts, setDrafts] = useState<ReadonlyMap<string, DraftStamp>>(() => new Map())
  const [sending, setSending] = useState<ReadonlySet<string>>(() => new Set())
  const [stopping, setStopping] = useState<ReadonlySet<string>>(() => new Set())
  const [errors, setErrors] = useState<ReadonlyMap<string, string>>(() => new Map())
  const revision = useRef(0)
  const sendLocks = useRef(new Set<string>())
  const stopLocks = useRef(new Set<string>())
  const composing = useRef(false)
  const compositionEnded = useRef(-Infinity)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  useEffect(() => {
    composing.current = false
    compositionEnded.current = -Infinity
  }, [sessionId])
  const draft = drafts.get(sessionId)
  const text = draft?.text ?? ''
  const isSending = sending.has(sessionId)
  const isStopping = stopping.has(sessionId)
  const unavailable = session.removed || session.openState !== 'open'
  const canSend = !unavailable && !interaction && !isSending && text.trim().length > 0

  function clearError(id: string) {
    setErrors(previous => {
      const next = new Map(previous)
      next.delete(id)
      return next
    })
  }

  async function submit() {
    if (!canSend || !draft || sendLocks.current.has(sessionId)) return
    const id = sessionId
    const submitted = draft
    sendLocks.current.add(id)
    setSending(previous => new Set(previous).add(id))
    clearError(id)
    try {
      await send(submitted.text)
      if (mounted.current) setDrafts(previous => {
        if (!sameDraft(previous.get(id), submitted)) return previous
        const next = new Map(previous)
        next.delete(id)
        return next
      })
    } catch (error) {
      if (mounted.current) setErrors(previous => new Map(previous).set(id, errorMessage(error)))
    } finally {
      sendLocks.current.delete(id)
      if (mounted.current) setSending(previous => {
        const next = new Set(previous)
        next.delete(id)
        return next
      })
    }
  }

  async function cancel() {
    if (unavailable || !session.running || stopLocks.current.has(sessionId)) return
    const id = sessionId
    stopLocks.current.add(id)
    setStopping(previous => new Set(previous).add(id))
    clearError(id)
    try { await stop() } catch (error) {
      if (mounted.current) setErrors(previous => new Map(previous).set(id, errorMessage(error)))
    } finally {
      stopLocks.current.delete(id)
      if (mounted.current) setStopping(previous => {
        const next = new Set(previous)
        next.delete(id)
        return next
      })
    }
  }

  async function older() {
    const id = sessionId
    clearError(id)
    try { await loadOlder() } catch (error) {
      if (mounted.current) setErrors(previous => new Map(previous).set(id, errorMessage(error)))
    }
  }

  return <div data-sidechat-conversation>
    <div data-sidechat-main-action><button type="button" onClick={onOpenMain}>{copy.openMain}</button></div>
    {interaction && <div role="status" data-sidechat-interaction>
      <p>{copy.pendingInteraction}</p><button type="button" onClick={onOpenMain}>{copy.openMain}</button>
    </div>}
    <div data-sidechat-transcript role="region" aria-label={copy.transcript}>
      {session.hasMore && <button type="button" disabled={unavailable || session.loadingOlder}
        onClick={() => { void older() }}>{session.loadingOlder ? copy.loadingOlder : copy.loadOlder}</button>}
      {session.openState === 'loading' && <p role="status">{copy.loading}</p>}
      {session.openState === 'open' && order.length === 0 && <p>{copy.empty}</p>}
      {order.map(key => <div key={key}>{renderSlot('dsk.sidechat.message', { copy }, {
        entryKey: 'node', hookContext: { key, useSideChatNode },
      })}</div>)}
      {session.pendingSubmissions.map(submission => <article key={submission.requestId} data-sidechat-pending>
        <strong>{copy.user} · {copy.sending}</strong>
        <div className={styles.textPart}>{submission.text}</div>
      </article>)}
    </div>
    <form onSubmit={event => { event.preventDefault(); void submit() }} data-sidechat-composer>
      <textarea key={sessionId} aria-label={copy.input} placeholder={copy.input} value={text} rows={3}
        disabled={unavailable} onChange={event => {
          const next = { text: event.target.value, revision: ++revision.current }
          setDrafts(previous => new Map(previous).set(sessionId, next))
        }}
        onCompositionStart={() => { composing.current = true }}
        onCompositionEnd={event => { composing.current = false; compositionEnded.current = event.timeStamp }}
        onKeyDown={event => {
          if (shouldSubmitOnEnter({ key: event.key, shiftKey: event.shiftKey,
            ctrlKey: event.ctrlKey, metaKey: event.metaKey, altKey: event.altKey,
            repeat: event.repeat, keyCode: event.nativeEvent.keyCode,
            composing: composing.current || event.nativeEvent.isComposing
              || event.timeStamp - compositionEnded.current < 50,
          })) { event.preventDefault(); void submit() }
        }} />
      <div><button type="submit" disabled={!canSend}>{isSending ? copy.sending : copy.send}</button>
        {session.running && <button type="button" disabled={unavailable || isStopping}
          onClick={() => { void cancel() }}>{isStopping ? copy.stopping : copy.stop}</button>}</div>
      {errors.get(sessionId) && <p role="alert">{errors.get(sessionId)}</p>}
      {(session.promptError || session.openError) && <p role="alert">
        {errorMessage(session.promptError?.error ?? session.openError)}</p>}
    </form>
  </div>
}
