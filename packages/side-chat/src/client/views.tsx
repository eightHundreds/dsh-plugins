import type { ConversationViewsProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsRenderFactories, PropsRenderSlots, PropsRuntime, InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { SideChatInjected } from './contracts.js'
import type { SideChatSnapshot } from '../controller.js'
import styles from './styles.module.css'
import type { SessionListState, SessionReference, SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'
import {
  IconCompareSplitOutlineRegular,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'

type ActionProps = PropsRuntime<'conversation.chat.assistant-actions'> & InjectFace<SideChatInjected> & PropsLocale<'sidechat'>
export function BranchAction({ messageId, useChat, useSideChat, branch, t }: ActionProps) {
  const pending = useSideChat((state: SideChatSnapshot<SessionReference>) => state.pending)
  const turnInfo = useChat((chat: ChatSnapshot) => {
    for (const turn of chat.timeline.turns.values()) {
      const closing = turn.data.get('turn-tail')?.closing
      if (closing?.finalNode.messageId === messageId) {
        const atSeq = turn.end?.seq
        const data = turn.data.get('turn-tail')
        const keys = chat.locations.getTurn(turn.turn)
        let later = false
        for (let index = keys.length - 1; index >= 0; index--) {
          const node = chat.nodes.get(keys[index])
          if (!node || node.kind === 'turn-tail' || node.kind === 'turn-process' || node.kind === 'turn-max-tokens') continue
          if (node.anchorSeq > (closing.finalNode.seq ?? atSeq ?? -1)) {
            later = true
            break
          }
        }
        const unavailable = atSeq === undefined || data === undefined || data.branchUnavailable || later
        return { atSeq, unavailable }
      }
    }
    return undefined
  })

  if (turnInfo === undefined) return null
  const { atSeq, unavailable } = turnInfo
  const label = unavailable ? t('branchUnavailable') : pending ? t('branching') : t('branch')

  return (
    <Tooltip label={label} side="bottom">
      <button
        type="button"
        className={styles.action}
        data-dsk-sidechat-action
        aria-label={label}
        aria-disabled={unavailable || pending || undefined}
        disabled={unavailable || pending}
        onClick={() => {
          if (atSeq !== undefined && !unavailable && !pending) {
            void branch({ atSeq, increaseTitle: true })
          }
        }}
      >
        <IconCompareSplitOutlineRegular />
      </button>
    </Tooltip>
  )
}

export function FixedChatConversationView(props: ConversationViewsProps) {
  return <>{props.renderSlot('conversation.session', { view: 'chat' })}</>
}

type ToggleProps = PropsRuntime<'conversation.session.header.actions'> & InjectFace<SideChatInjected> & PropsLocale<'sidechat'>
export function SideChatToggle({ useSideChat, open, close, t }: ToggleProps) {
  const visible = useSideChat((state: SideChatSnapshot<SessionReference>) => state.visible)
  const count = useSideChat((state: SideChatSnapshot<SessionReference>) => state.branches.length)
  if (count === 0) return null
  return <button type="button" className={styles.action} data-dsk-sidechat-action title={t(visible ? 'close' : 'reopen')}
    onClick={() => visible ? close() : open()}>{t('title')}</button>
}

type NativeConversationProps = PropsRuntime<'dsk.sidechat.conversation'> & PropsRenderFactories
export function NativeConversationPanel({
  sessionId, useSession, useConversation, useSessions, renderFactorySlot,
}: NativeConversationProps) {
  const session = useSession((value: SessionSnapshot) => value)
  const conversation = useConversation((value: any) => value)
  const active = conversation.activeTargets.size > 0
    || (!session.blank && !session.awaitingFirstTurn)
    || session.running
  const shellPhase = active ? 'active' : session.promptAttempted ? 'engaging' : 'blank'
  const summaryBlank = useSessions((state: SessionListState) => state.byId[sessionId]?.blank)
  const settling = shellPhase === 'blank' && session.openState === 'loading' && summaryBlank !== true
  const hero = shellPhase === 'blank' && (session.openState === 'open' || summaryBlank === true)
  const phase = settling ? 'settling' : hero ? 'hero' : 'active'
  return renderFactorySlot('conversation.content', { variant: 'embedded', phase, hero }, {
    slots: { views: FixedChatConversationView },
  })
}

type DockProps = PropsRuntime<'sidebar.right.pane.tab'> & PropsRenderSlots<'dsk.sidechat.conversation'> & InjectFace<SideChatInjected> & PropsLocale<'sidechat'>
export function SideChatDock({ useSideChat, SessionProvider, renderSlot, useSessions, select, activate, t }: DockProps) {
  const state: SideChatSnapshot<SessionReference> = useSideChat((value: SideChatSnapshot<SessionReference>) => value)
  const catalog: SessionListState['byId'] = useSessions((list: SessionListState) => list.byId)
  return <section className={styles.root} data-dsk-sidechat aria-label={t('title')}>
    {state.branches.length > 1 && (
      <header>
        <select aria-label={t('selection')} value={state.selectedId ?? ''} onChange={event => {
          const selected = state.branches.find(branch => branch.childId === event.target.value)
          if (selected) select(selected.childId)
        }}>
          {state.branches.map((branch, index) => <option key={branch.childId} value={branch.childId}>
            {Object.values(catalog).find(row => row.id === branch.childId)?.title ?? t('branchLabel', { number: index + 1 })}
          </option>)}
        </select>
      </header>
    )}
    <div className={styles.hint}>{t('inherited')}</div>
    {state.error && <div className={[styles.notice, styles.error].join(' ')} role="alert">{t('error', { message: state.error })}
      <button type="button" onClick={() => activate()}>{t('retry')}</button>
    </div>}
    <div className={styles.body}>
      {state.composerDisabled ? <p className={styles.notice}>{t('sameSession')}</p>
        : state.loading ? <p className={styles.notice} role="status">{t('loading')}</p>
          : state.reference ? <SessionProvider session={state.reference}>{renderSlot('dsk.sidechat.conversation', {})}</SessionProvider>
            : <p className={styles.notice}>{t('empty')}</p>}
    </div>
  </section>
}
