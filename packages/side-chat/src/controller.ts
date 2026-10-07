import type { SessionId } from '@deepseek-ai/dsh-session/types';
import { createdForkId } from './fork-error.js';
import { loadState, saveState, type BranchRecord, type PersistedState, type SourceRecord, type StorageAdapter } from './persistence.js';

/** A host-owned opaque reference; the controller never inspects its binding. */
export interface OwnedReference {
  readonly ready: Promise<unknown>;
  release(): void;
}

export interface ForkOptions {
  sessionId: SessionId;
  atSeq: number;
    increaseTitle?: boolean;
  onCreated?: (childId: SessionId) => void;
}

export interface ControllerDependencies<TReference extends OwnedReference> {
  fork(options: ForkOptions): Promise<SessionId>;
  retain(id: SessionId, options: { source: string; signal: AbortSignal }): TReference;
  dock: { open(visible: boolean): void };
  storage?: StorageAdapter;
  now?: () => number;
}

export interface BranchInput {
  sessionId?: SessionId;
  atSeq: number;
  rootSourceId?: SessionId;
  increaseTitle?: boolean;
}

export interface SideChatSnapshot<TReference extends OwnedReference> {
  readonly sourceId?: SessionId;
  readonly mainSessionId?: SessionId;
  readonly selectedId?: SessionId;
  readonly branches: readonly BranchRecord[];
  /** Published only after ready, and removed when ownership is released. */
  readonly reference?: TReference;
  readonly visible: boolean;
  readonly pending: boolean;
  readonly loading: boolean;
  readonly composerDisabled: boolean;
  readonly error?: string;
}

interface Retained<TReference> {
  id: SessionId;
  reference: TReference;
  abort: AbortController;
  ready: boolean;
}

const message = (error: unknown): string => error instanceof Error ? error.message : String(error);

/** Pure state/ownership coordinator. All DSH and browser APIs live in host adapters. */
export class SideChatController<TReference extends OwnedReference> {
  private readonly sources = new Map<SessionId, SourceRecord>();
  /** Only an actual local side selection may overwrite a newer stored choice. */
  private readonly dirtySelections = new Set<SessionId>();
  private readonly flights = new Map<SessionId, Promise<SessionId | undefined>>();
  private readonly listeners = new Set<() => void>();
  private sourceId?: SessionId;
  private mainSessionId?: SessionId;
  private visible = false;
  private presented = true;
  private disposed = false;
  /** User intent invalidates old fork completions, even after switching away and back. */
  private intent = 0;
  private error?: string;
  private owned?: Retained<TReference>;
  private acquiring?: { id: SessionId; abort: AbortController; generation: number };
  private referenceGeneration = 0;
  private syncingReference = false;
  private referenceSyncRequested = false;
  private snapshot: SideChatSnapshot<TReference>;

  constructor(private readonly dependencies: ControllerDependencies<TReference>) {
    const state = loadState(dependencies.storage);
    for (const source of state.sources) this.sources.set(source.sourceId, source);
    this.sourceId = state.lastSourceId;
    this.snapshot = this.makeSnapshot();
  }

  /** Stable function identities are safe to pass directly to useSyncExternalStore. */
  readonly getSnapshot = (): SideChatSnapshot<TReference> => this.snapshot;
  readonly subscribe = (listener: () => void): (() => void) => {
    if (this.disposed) return () => {};
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  setMainSelection(id: SessionId | undefined): void {
    // An empty observation may be a transient catalog/layout transition, not
    // a user selection. Preserve the last authoritative identity and intent.
    if (this.disposed || id === undefined || this.mainSessionId === id) return;
    // Catalog insertion can reveal an already-current main source for the first
    // time. That is observation, not a new user selection invalidating a fork.
    const firstCurrentIdentity = this.mainSessionId === undefined && id === this.sourceId;
    this.mainSessionId = id;
    if (!firstCurrentIdentity) this.intent++;
    this.error = undefined;
    this.sourceId = this.rootFor(id);
    this.ensureSource(this.sourceId);
    this.persist();
    this.syncReference();
    this.publish();
  }

  /** Explicit absence from the selected main binding, not a catalog transition. */
  clearMainSelection(): void {
    if (this.disposed || this.mainSessionId === undefined) return;
    this.mainSessionId = undefined;
    this.syncReference();
    this.publish();
  }

  /** Effective layout visibility differs from the user's requested open state. */
  setPresented(presented: boolean): void {
    if (this.disposed || this.presented === presented) return;
    this.presented = presented;
    this.syncReference();
    this.publish();
  }

  open(): void {
    if (this.disposed) return;
    this.intent++;
    this.visible = true;
    this.error = undefined;
    this.dependencies.dock.open(true);
    this.syncReference();
    this.publish();
  }

  close(): void {
    if (this.disposed) return;
    this.intent++;
    this.visible = false;
    this.dependencies.dock.open(false);
    // This only releases presentation ownership. Forks continue and sessions survive.
    this.releaseReference();
    this.publish();
  }

  select(childId: SessionId): void {
    if (this.disposed) return;
    const source = [...this.sources.values()].find((entry) => entry.branches.some((branch) => branch.childId === childId));
    if (!source) return;
    this.intent++;
    this.sourceId = source.sourceId;
    this.sources.set(source.sourceId, { ...source, selectedId: childId });
    this.dirtySelections.add(source.sourceId);
    this.visible = true;
    this.error = undefined;
    this.persist();
    this.dependencies.dock.open(true);
    this.syncReference();
    this.publish();
  }

  /** Explicit retry after retain/ready failure, without creating another session. */
  activate(): void {
    if (this.disposed || !this.visible) return;
    this.error = undefined;
    this.syncReference();
    this.publish();
  }

  branch(input: BranchInput): Promise<SessionId | undefined> {
    if (this.disposed) return Promise.resolve(undefined);
    const targetSessionId = input.sessionId ?? this.mainSessionId;
    if (!targetSessionId || !targetSessionId.trim() || !Number.isSafeInteger(input.atSeq) || input.atSeq < 0
      || (input.rootSourceId !== undefined && !input.rootSourceId.trim())) {
      this.error = 'Invalid branch source or sequence';
      this.publish();
      return Promise.resolve(undefined);
    }
    const sourceId = input.rootSourceId ?? this.rootFor(targetSessionId);
    const existing = this.flights.get(sourceId);
    if (existing) return existing;
    this.intent++;
    const intent = this.intent;
    this.sourceId = sourceId;
    this.ensureSource(sourceId);
    this.visible = true;
    this.error = undefined;
    this.dependencies.dock.open(true);
    this.persist();
    this.syncReference();

    // Install the flight before calling the host: onCreated may fire synchronously.
    let finish!: (id: SessionId | undefined) => void;
    const flight = new Promise<SessionId | undefined>((resolve) => { finish = resolve; });
    this.flights.set(sourceId, flight);
    this.publish();
    let createdId: SessionId | undefined;
    const isCurrent = () => !this.disposed && this.intent === intent && this.sourceId === sourceId && this.visible;
    const onCreated = (childId: SessionId) => {
      if (createdId !== undefined) return;
      createdId = childId;
      if (this.disposed) {
        // HMR may have a successor controller. Append only this late identity,
        // never overwrite its current selection or unrelated new branches.
        if (this.dependencies.storage) {
          const latest = loadState(this.dependencies.storage);
          const source = latest.sources.find(entry => entry.sourceId === sourceId) ?? { sourceId, branches: [] };
          if (!latest.sources.some(entry => entry.branches.some(branch => branch.childId === childId))) {
            const updated = { ...source, branches: [...source.branches, {
              childId, actualParentId: targetSessionId, atSeq: input.atSeq,
              createdAt: (this.dependencies.now ?? Date.now)(),
            }] };
            try { saveState(this.dependencies.storage, { ...latest, sources: [...latest.sources.filter(entry => entry.sourceId !== sourceId), updated] }); }
            catch (error) { /* A disposed view cannot publish a storage failure. */ }
          }
        }
        return;
      }
      const source = this.ensureSource(sourceId);
      const branch = Object.freeze({
        childId,
        actualParentId: targetSessionId,
        atSeq: input.atSeq,
        createdAt: (this.dependencies.now ?? Date.now)(),
      });
      const current = isCurrent();
      this.sources.set(sourceId, {
        ...source,
        branches: source.branches.some((entry) => entry.childId === childId) ? source.branches : [...source.branches, branch],
        ...(current ? { selectedId: childId } : {}),
      });
      if (current) this.dirtySelections.add(sourceId);
      // Commit before rename or other host post-creation steps can throw.
      this.persist();
      if (current) this.syncReference();
      if (!this.disposed) this.publish();
    };
    const complete = (id: SessionId | undefined, error?: unknown) => {
      if (error !== undefined && isCurrent()) this.error = message(error);
      this.flights.delete(sourceId);
      if (!this.disposed) this.publish();
      finish(id);
    };
    try {
      const request = this.dependencies.fork({
        sessionId: targetSessionId,
        atSeq: input.atSeq,
        ...(input.increaseTitle === undefined ? {} : { increaseTitle: input.increaseTitle }),
        onCreated,
      });
      Promise.resolve(request).then((childId) => {
        onCreated(childId);
        complete(createdId);
      }, (error: unknown) => {
        // Some host versions report workspace failures before onCreated runs.
        const recovered = createdForkId(error);
        if (recovered !== undefined) onCreated(recovered);
        complete(createdId, error);
      });
    } catch (error) {
      const recovered = createdForkId(error);
      if (recovered !== undefined) onCreated(recovered);
      complete(createdId, error);
    }
    return flight;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.intent++;
    this.visible = false;
    this.dependencies.dock.open(false);
    this.releaseReference();
    this.publish();
    this.listeners.clear();
    // Pending forks intentionally retain their onCreated persistence callback.
  }

  private rootFor(id: SessionId): SessionId {
    for (const source of this.sources.values()) {
      if (source.branches.some((branch) => branch.childId === id)) return source.sourceId;
    }
    return id;
  }

  private ensureSource(id: SessionId): SourceRecord {
    let source = this.sources.get(id);
    if (!source) {
      source = { sourceId: id, branches: [] };
      this.sources.set(id, source);
    }
    return source;
  }

  private persist(): void {
    if (!this.dependencies.storage) return;
    // A disposed predecessor can append a late fork after this instance loaded.
    // Import missing metadata and preserve newer stored choices unless this call
    // explicitly changes that source's selection; never write a stale snapshot.
    const latest = loadState(this.dependencies.storage);
    for (const stored of latest.sources) {
      const local = this.sources.get(stored.sourceId);
      if (!local) {
        this.sources.set(stored.sourceId, stored);
        continue;
      }
      const missing = stored.branches.filter(branch => ![...this.sources.values()]
        .some(source => source.branches.some(existing => existing.childId === branch.childId)));
      this.sources.set(stored.sourceId, {
        ...(this.dirtySelections.has(stored.sourceId) ? local : stored),
        branches: [...local.branches, ...missing],
      });
    }
    const state: PersistedState = {
      version: 1,
      ...(this.sourceId === undefined ? {} : { lastSourceId: this.sourceId }),
      sources: [...this.sources.values()],
    };
    try {
      saveState(this.dependencies.storage, state);
      this.dirtySelections.clear();
    } catch (error) {
      if (!this.disposed) this.error = `Could not save side chat: ${message(error)}`;
    }
  }

  private releaseReference(): void {
    this.referenceGeneration++;
    // retain may synchronously reenter close/dispose before it returns a handle.
    // Invalidate and abort its placeholder now; release the handle on return.
    const acquiring = this.acquiring;
    this.acquiring = undefined;
    acquiring?.abort.abort();
    const owned = this.owned;
    if (!owned) return;
    this.owned = undefined;
    // Never expose a reference again after its ownership has been relinquished.
    this.publish();
    owned.abort.abort();
    owned.reference.release();
  }

  private desiredReferenceId(): SessionId | undefined {
    const selectedId = this.sourceId === undefined ? undefined : this.sources.get(this.sourceId)?.selectedId;
    return this.visible && this.presented && !this.disposed && selectedId !== this.mainSessionId ? selectedId : undefined;
  }

  private syncReference(): void {
    // Both retain and release may synchronously publish retainedBy/catalog
    // changes. Defer nested reconciliation until the host call has returned.
    this.referenceSyncRequested = true;
    // Record transient invalidation even if nested reconciliation is deferred:
    // hide/show or source away/back must not resurrect the earlier acquisition.
    if (this.acquiring && this.acquiring.id !== this.desiredReferenceId()) this.releaseReference();
    if (this.syncingReference) return;
    this.syncingReference = true;
    try {
      while (this.referenceSyncRequested) {
        this.referenceSyncRequested = false;
        const selectedId = this.desiredReferenceId();
        if (this.owned?.id === selectedId) continue;
        this.releaseReference();
        if (selectedId !== this.desiredReferenceId()) {
          this.referenceSyncRequested = true;
          continue;
        }
        if (selectedId === undefined) continue;
        const abort = new AbortController();
        const acquiring = { id: selectedId, abort, generation: this.referenceGeneration };
        this.acquiring = acquiring;
        let reference: TReference;
        try {
          reference = this.dependencies.retain(selectedId, { source: 'side-chat', signal: abort.signal });
        } catch (error) {
          if (this.acquiring === acquiring) this.acquiring = undefined;
          abort.abort();
          if (acquiring.generation === this.referenceGeneration && selectedId === this.desiredReferenceId()) this.error = message(error);
          continue;
        }
        const currentAcquisition = this.acquiring === acquiring && acquiring.generation === this.referenceGeneration;
        if (this.acquiring === acquiring) this.acquiring = undefined;
        const owned: Retained<TReference> = { id: selectedId, reference, abort, ready: false };
        // Always consume ready rejection, including a reference already stale
        // before retain returned. Never read or publish its binding after release.
        Promise.resolve(reference.ready).then(() => {
          if (this.owned !== owned || this.disposed) return;
          owned.ready = true;
          this.publish();
        }, (error: unknown) => {
          if (this.owned !== owned || this.disposed) return;
          this.error = message(error);
          this.releaseReference();
          this.publish();
        });
        if (!currentAcquisition || selectedId !== this.desiredReferenceId()) {
          abort.abort();
          reference.release();
          this.referenceSyncRequested = true;
          continue;
        }
        this.owned = owned;
      }
    } finally {
      this.syncingReference = false;
    }
  }

  private makeSnapshot(): SideChatSnapshot<TReference> {
    const source = this.sourceId === undefined ? undefined : this.sources.get(this.sourceId);
    return Object.freeze({
      sourceId: this.sourceId,
      mainSessionId: this.mainSessionId,
      selectedId: source?.selectedId,
      branches: Object.freeze((source?.branches ?? []).map((branch) => Object.freeze({ ...branch }))),
      reference: this.owned?.ready ? this.owned.reference : undefined,
      visible: this.visible,
      pending: this.sourceId !== undefined && this.flights.has(this.sourceId),
      loading: this.owned !== undefined && !this.owned.ready,
      composerDisabled: source?.selectedId !== undefined && source.selectedId === this.mainSessionId,
      error: this.error,
    });
  }

  private publish(): void {
    const next = this.makeSnapshot();
    const previous = this.snapshot;
    if (previous && next.sourceId === previous.sourceId && next.mainSessionId === previous.mainSessionId
      && next.selectedId === previous.selectedId && next.reference === previous.reference
      && next.visible === previous.visible && next.pending === previous.pending && next.loading === previous.loading
      && next.composerDisabled === previous.composerDisabled && next.error === previous.error
      && next.branches.length === previous.branches.length
      && next.branches.every((branch, index) => branch.childId === previous.branches[index]?.childId)) return;
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }
}
