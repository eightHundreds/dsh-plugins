import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { SideChatInjected } from './contracts.js'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import { SideChatController } from '../controller.js'
import { BranchAction, NativeConversationPanel, SideChatDock } from './views.js'
import { NS, en, zh } from './locales.js'

declare const __DSH_CSS_MODULES__: string

export const name = 'side-chat'
export const inject = ['slots', 'locale', 'sessions', 'uiSession', 'uiConversation', 'uiWorkspace', 'sidebarRight', 'sidebarRightTabs']
const ID = '@dsk/side-chat'
const SIDECHAT_TAB_KIND = 'sidechat'

export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'side-chat: locale')
  const t = ctx.locale.bind(NS)

  const controller = new SideChatController<SessionReference>({
    fork: options => ctx.sessions.fork(options),
    retain: (id, options) => ctx.sessions.retain(id, { source: 'sideChat', signal: options.signal }),
    dock: {
      open: () => {
        try {
          ctx.sidebarRight.openTab(SIDECHAT_TAB_KIND)
        } catch (e) {
          console.error('Failed to open sidechat tab in sidebar right:', e)
        }
      },
    },
    storage: {
      read: () => localStorage.getItem(`${ID}:v1`),
      write: value => localStorage.setItem(`${ID}:v1`, value),
    },
  })
  ctx.effect(() => () => controller.dispose(), 'side-chat: ownership')
  const face = (): SideChatInjected => ({
    hooks: { sideChat: controller },
    branch: input => controller.branch(input),
    open: () => controller.open(),
    close: () => controller.close(),
    select: childId => controller.select(childId),
    activate: () => controller.activate(),
  })
  const mainSelection = ctx.uiSession.adapter.current
  const followMain = () => {
    // Use the renderer's selected binding, not mutable catalog retention counts.
    const key = mainSelection.getSnapshot().key
    const main = key === undefined ? undefined : ctx.sessions.binding(key as SessionId)?.sessionId
    if (key === undefined) controller.clearMainSelection()
    else controller.setMainSelection(main)
  }
  ctx.effect(() => {
    followMain()
    return mainSelection.subscribe(followMain)
  }, 'side-chat: main selection')
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.dskSidechat = ''
    style.textContent = __DSH_CSS_MODULES__
    document.head.append(style)
    return () => style.remove()
  }, 'side-chat: styles')

  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: ID,
    kind: SIDECHAT_TAB_KIND,
    priority: 'extension',
    title: () => t('title'),
  }), 'side-chat: sidebar right tab definition')

  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab', key: ID, locale: NS, inject: face,
    children: { 'dsk.sidechat.conversation': { kind: 'single', scope: 'session' } },
  }, SideChatDock)), 'side-chat: dock')
  ctx.effect(() => ctx.slots.inject('dsk.sidechat.conversation', () => ctx.slots.register({
    name: 'dsk.sidechat.conversation',
  }, NativeConversationPanel)), 'side-chat: conversation')
  ctx.effect(() => ctx.slots.inject('conversation.chat.assistant-actions', () => ctx.slots.register({
    name: 'conversation.chat.assistant-actions', id: ID, locale: NS, inject: face, order: 20,
  }, BranchAction)), 'side-chat: assistant action')
}
