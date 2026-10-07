import type { SessionId } from '@deepseek-ai/dsh-session/types';

/** Recover only identities explicitly reported by the Host after a partial fork failure. */
export function createdForkId(error: unknown): SessionId | undefined {
  if (typeof error !== 'object' || error === null || !('rpcError' in error)) return;
  const failure = error.rpcError;
  if (typeof failure !== 'object' || failure === null || !('code' in failure)
    || failure.code !== 'session/workspace-attach-failed' || !('details' in failure)) return;
  const details = failure.details;
  if (typeof details !== 'object' || details === null || !('sessionId' in details)) return;
  // Brand only at this validated decode boundary; there is no runtime SDK import.
  return typeof details.sessionId === 'string' && details.sessionId.trim()
    ? details.sessionId as SessionId : undefined;
}
