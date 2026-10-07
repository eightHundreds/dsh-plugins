import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import type {} from '@deepseek-ai/dsh-lsp'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-typert-registry'
import type { EditorLspRequest, EditorLspResult } from './lsp-contract.ts'
import { queryEditorLsp } from './lsp-query.ts'
import { editorLspContribution, editorLspHostContribution } from './lsp-remote.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    vscodeEditorLsp: EditorLspHost
  }
}

/** Host bridge: session cwd and preset LSP, without activating an Agent. */
export class EditorLspHost extends TypertRemoteService {
  static inject = ['sessions', 'typert']
  private readonly disposeSignal = new AbortController()

  constructor(ctx: Context) {
    super(ctx, 'vscodeEditorLsp')
    ctx.typert.register(editorLspHostContribution)
    ctx.typert.remotes.register(editorLspContribution)
    ctx.effect(() => () => this.disposeSignal.abort())
  }

  /** @param signal - Remote carrier cancellation; disposal and the ten-second budget abort too. */
  @Remote
  query(sessionId: SessionId, request: EditorLspRequest, signal?: AbortSignal): Promise<EditorLspResult> {
    return queryEditorLsp({ resolve: id => this.resolve(id), disposeSignal: this.disposeSignal.signal }, sessionId, request, signal)
  }

  private async resolve(sessionId: string) {
    const id = sessionId as SessionId
    const session = this.ctx.sessions.get(id)
    const live = session?.header
    const stored = live === undefined ? await this.ctx.get('sessionPersistence')?.stat(id) : undefined
    const header = live ?? stored?.header
    if (header === undefined) return undefined
    const agent = this.ctx.get('agents')?.get(id)
    const liveAgent = agent?.session === session ? agent : undefined
    const preset = liveAgent === undefined ? undefined : this.ctx.get('agentPresets')?.serviceFor(liveAgent, 'lsp')
    const lsp = preset ?? this.ctx.get('lsp')
    return { workspaceRoot: header.cwd, ...(lsp === undefined ? {} : { lsp }) }
  }
}

export default EditorLspHost
