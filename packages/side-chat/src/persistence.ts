import type { SessionId } from '@deepseek-ai/dsh-session/types';

/** Storage belongs to the host adapter; this module never accesses browser globals. */
export interface StorageAdapter {
  read(): string | null | undefined;
  write(value: string): void;
}

export interface BranchRecord {
  readonly childId: SessionId;
  readonly actualParentId: SessionId;
  readonly atSeq: number;
  readonly createdAt: number;
}

export interface SourceRecord {
  readonly sourceId: SessionId;
  readonly selectedId?: SessionId;
  readonly branches: readonly BranchRecord[];
}

export interface PersistedState {
  readonly version: 1;
  readonly lastSourceId?: SessionId;
  readonly sources: readonly SourceRecord[];
}

const emptyState = (): PersistedState => ({ version: 1, sources: [] });
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isId = (value: unknown): value is SessionId => typeof value === 'string' && value.trim().length > 0;

/** Reject unsupported versions and malformed records rather than trusting localStorage. */
function validate(value: unknown): PersistedState | undefined {
  if (!isObject(value) || value.version !== 1 || !Array.isArray(value.sources)) return;
  if (value.lastSourceId !== undefined && !isId(value.lastSourceId)) return;
  const sourceIds = new Set<string>();
  const childIds = new Set<string>();
  const sources: SourceRecord[] = [];
  for (const source of value.sources) {
    if (!isObject(source) || !isId(source.sourceId) || sourceIds.has(source.sourceId)
      || !Array.isArray(source.branches)) return;
    sourceIds.add(source.sourceId);
    const branches: BranchRecord[] = [];
    for (const branch of source.branches) {
      if (!isObject(branch) || !isId(branch.childId) || !isId(branch.actualParentId)
        || childIds.has(branch.childId)
        || typeof branch.atSeq !== 'number' || !Number.isSafeInteger(branch.atSeq) || branch.atSeq < 0
        || typeof branch.createdAt !== 'number' || !Number.isFinite(branch.createdAt) || branch.createdAt < 0) return;
      childIds.add(branch.childId);
      branches.push({
        childId: branch.childId,
        actualParentId: branch.actualParentId,
        atSeq: branch.atSeq,
        createdAt: branch.createdAt,
      });
    }
    if (source.selectedId !== undefined
      && (!isId(source.selectedId) || !branches.some((branch) => branch.childId === source.selectedId))) return;
    sources.push({
      sourceId: source.sourceId,
      ...(source.selectedId === undefined ? {} : { selectedId: source.selectedId }),
      branches,
    });
  }
  if (value.lastSourceId !== undefined && !sourceIds.has(value.lastSourceId)) return;
  return { version: 1, ...(value.lastSourceId === undefined ? {} : { lastSourceId: value.lastSourceId }), sources };
}

/** Serialization allowlists only identifiers and fork metadata, never session messages. */
export function encodeState(state: PersistedState): string {
  const validated = validate(state);
  if (!validated) throw new TypeError('Invalid side-chat persisted state');
  return JSON.stringify(validated);
}

export function decodeState(raw: string | null | undefined): PersistedState {
  if (typeof raw !== 'string') return emptyState();
  try {
    return validate(JSON.parse(raw)) ?? emptyState();
  } catch {
    return emptyState();
  }
}

export function loadState(storage?: Pick<StorageAdapter, 'read'>): PersistedState {
  try {
    return decodeState(storage?.read());
  } catch {
    return emptyState();
  }
}

/** Write errors propagate so the controller can expose a recoverable persistence error. */
export function saveState(storage: Pick<StorageAdapter, 'write'>, state: PersistedState): void {
  storage.write(encodeState(state));
}
