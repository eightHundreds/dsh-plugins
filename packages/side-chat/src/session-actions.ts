import type { SessionFace, SessionReference } from '@deepseek-ai/dsh-api-session-controller/client';

export type SessionActionErrorCode = 'reference-missing' | 'disposed' | 'pending-inbox' | 'inbox-unavailable';

/** Stable reasons for the caller's localized UI; remote failures propagate unchanged. */
export class SessionActionError extends Error {
  constructor(readonly code: SessionActionErrorCode) {
    super(code);
    this.name = 'SessionActionError';
  }
}

export interface SessionActions {
  send(text: string): Promise<void>;
  stop(): Promise<void>;
  loadOlder(): Promise<void>;
  /** Abort local admission waits; only stop() asks the Host to cancel a turn. */
  dispose(): void;
}

/** Inbox belongs to the Agent projection, not the rc2 SessionSnapshot. */
function guardInbox(session: SessionFace): void {
  const inbox = session.projections.faceOf('inbox').getSnapshot();
  if (typeof inbox !== 'object' || inbox === null
    || !('next-turn' in inbox) || !Array.isArray(inbox['next-turn'])
    || !('next-step' in inbox) || !Array.isArray(inbox['next-step'])) {
    throw new SessionActionError('inbox-unavailable');
  }
  if (inbox['next-turn'].length > 0 || inbox['next-step'].length > 0) {
    throw new SessionActionError('pending-inbox');
  }
  // This public read cannot atomically guard Host admission. Pending work must
  // be handled explicitly in the main conversation; never clear it here.
}

/** Cancel only this caller's wait, without releasing the owner's reference. */
async function waitReady(reference: SessionReference, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  let onAbort!: () => void;
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => { reject(signal.reason); };
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    await Promise.race([reference.ready, aborted]);
    signal.throwIfAborted();
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

/** Borrow the invocation's exact reference; selection and ownership stay with its owner. */
export function createSessionActions(
  getReference: () => SessionReference | undefined,
  onError?: (error: unknown) => void,
): SessionActions {
  const controllers = new Set<AbortController>();
  let disposed = false;

  const invoke = async (operation: (session: SessionFace, signal: AbortSignal) => Promise<void>): Promise<void> => {
    let controller: AbortController | undefined;
    try {
      if (disposed) throw new SessionActionError('disposed');
      // Capture before the first await. A later source switch must not retarget a command.
      const reference = getReference();
      if (reference === undefined) throw new SessionActionError('reference-missing');
      controller = new AbortController();
      controllers.add(controller);
      await waitReady(reference, controller.signal);
      // ready's value may outlive release: the getter checks the reference is still live.
      const session = reference.binding.session;
      controller.signal.throwIfAborted();
      await operation(session, controller.signal);
    } catch (error) {
      if (!disposed) {
        // Error reporting must not replace the original rejection.
        try { onError?.(error); } catch { /* The caller owns notification failures. */ }
      }
      throw error;
    } finally {
      if (controller !== undefined) controllers.delete(controller);
    }
  };

  return {
    send: (text) => invoke(async (session, signal) => {
      guardInbox(session);
      const submission = session.beginSubmission({ mode: 'queue', text, attachments: [] });
      let prompted = false;
      try {
        const content: Parameters<SessionFace['prompt']>[0] = [{ type: 'text', text }];
        const requestId = submission.requestId;
        signal.throwIfAborted();
        prompted = true;
        const result = await session.prompt(content, 'queue', signal, requestId);
        if (!result.ok) throw result.error;
      } catch (error) {
        // prompt owns retirement after entry, including standard failed results.
        if (!prompted) submission.abandon();
        throw error;
      }
    }),
    stop: () => invoke(async (session) => {
      const result = await session.cancel();
      if (!result.ok) throw result.error;
    }),
    loadOlder: () => invoke(async (session) => { await session.loadOlder(); }),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      for (const controller of controllers) controller.abort(new SessionActionError('disposed'));
      controllers.clear();
    },
  };
}
