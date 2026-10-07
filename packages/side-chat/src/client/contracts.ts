import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SideChatController, SideChatSnapshot } from '../controller.js'
import type { zh } from './locales.js'

export interface SideChatInjected {
  hooks: { sideChat: HostObservable<SideChatSnapshot<SessionReference>> }
  branch: SideChatController<SessionReference>['branch']
  open: () => void
  close: () => void
  select: (childId: SessionId) => void
  activate: () => void
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'dsk.sidechat.conversation': { kind: 'single'; scope: 'session' }
  }
  interface LocaleNamespaceMap {
    sidechat: keyof typeof zh
  }
}

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap {
    sideChat: true
  }
}
