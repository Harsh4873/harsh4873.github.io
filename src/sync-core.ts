import type { Note, Paper, ResearchMessage, ResearchState } from './model';
import { ANALYSIS_PAPER_FIELDS } from './lib/analysis-paper-coordinator';

interface Stamped {
  updatedAt: string;
}

interface SyncedEntity extends Stamped {
  id: string;
  deleted?: true;
}

export type CloudSingletonName = 'profile' | 'settings';
export type EntityCollectionName = 'papers' | 'notes' | 'messages';

export interface CloudSingletonDocuments {
  profile: ResearchState['profile'] | null;
  settings: ResearchState['settings'] | null;
}

/** Canonical JSON is used as an argument-order-independent LWW tie-break. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) {
    return `[${value
      .filter((item) => item !== undefined)
      .map((item) => stableStringify(item))
      .join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`);
  return `{${entries.join(',')}}`;
}

/** Remove values Firestore cannot encode while retaining null and falsy data. */
export function omitUndefinedDeep<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value
      .filter((item) => item !== undefined)
      .map((item) => omitUndefinedDeep(item)) as unknown as T;
  }
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (item !== undefined) result[key] = omitUndefinedDeep(item);
  }
  return result as T;
}

function timestampValue(value: string): number {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function selectNewer<T extends Stamped>(left: T, right: T): T {
  const leftTime = timestampValue(left.updatedAt);
  const rightTime = timestampValue(right.updatedAt);
  if (leftTime !== rightTime) return leftTime > rightTime ? left : right;
  const leftText = stableStringify(left);
  const rightText = stableStringify(right);
  if (leftText === rightText) return left;
  return leftText > rightText ? left : right;
}

/**
 * A tombstone is irreversible. It wins even if a disconnected device edited
 * an older live copy under a later or incorrect wall clock. Firestore applies
 * the same invariant, so a stale client cannot resurrect a deleted record.
 */
export function selectEntityWinner<T extends SyncedEntity>(left: T, right: T): T {
  if (left.deleted === true && right.deleted !== true) return left;
  if (right.deleted === true && left.deleted !== true) return right;
  return selectNewer(left, right);
}

export function mergeById<T extends SyncedEntity>(local: T[], remote: T[]): T[] {
  const merged = new Map<string, T>();
  for (const item of [...local, ...remote]) {
    const existing = merged.get(item.id);
    merged.set(item.id, existing ? selectEntityWinner(existing, item) : item);
  }
  return [...merged.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function timestampOrZero(value?: string): number {
  if (!value) return 0;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function analysisRevision(paper: Paper): number {
  return Math.max(
    timestampOrZero(paper.analysisUpdatedAt),
    timestampOrZero(paper.analysisLease?.heartbeatAt),
    timestampOrZero(paper.analysisCompletedAt),
  );
}

function analysisProjection(paper: Paper): Partial<Paper> {
  const projection: Partial<Paper> = {};
  for (const field of ANALYSIS_PAPER_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(paper, field)) {
      Object.assign(projection, { [field]: paper[field] });
    }
  }
  return projection;
}

export interface PaperMergeOptions {
  /** Protect one canonical side's active generation from a different run. */
  preferredActiveSide?: 'left' | 'right';
}

function paperAnalysisRunId(paper: Paper): string | undefined {
  return paper.analysisLease?.runId ?? paper.analysisRunId;
}

function preferredActiveWinner(
  left: Paper,
  right: Paper,
  options: PaperMergeOptions,
): Paper | undefined {
  if (!options.preferredActiveSide) return undefined;
  const preferred = options.preferredActiveSide === 'left' ? left : right;
  const other = preferred === left ? right : left;
  if (!preferred.analysisLease || !['queued', 'uploading', 'analyzing'].includes(preferred.analysisStatus)) {
    return undefined;
  }
  return paperAnalysisRunId(other) === preferred.analysisLease.runId ? undefined : preferred;
}

function selectAnalysisWinner(
  left: Paper,
  right: Paper,
  entityWinner: Paper,
  options: PaperMergeOptions,
): Paper {
  const preferred = preferredActiveWinner(left, right, options);
  if (preferred) return preferred;
  const leftRevision = analysisRevision(left);
  const rightRevision = analysisRevision(right);
  if (leftRevision !== rightRevision) return leftRevision > rightRevision ? left : right;

  // A lease cannot disappear at the same logical analysis revision. This also
  // protects legacy in-flight leases that predate analysisUpdatedAt.
  if (Boolean(left.analysisLease) !== Boolean(right.analysisLease)) {
    return left.analysisLease ? left : right;
  }

  const leftText = stableStringify(analysisProjection(left));
  const rightText = stableStringify(analysisProjection(right));
  if (leftText === rightText) return entityWinner;
  return leftText > rightText ? left : right;
}

/**
 * Merge metadata by entity LWW while resolving analysis state with its own
 * revision clock. A title/tag edit from a stale tab therefore cannot erase an
 * active lease, and a later transactional completion can still clear it.
 */
export function mergePaperRecords(
  left: Paper,
  right: Paper,
  options: PaperMergeOptions = {},
): Paper {
  const entityWinner = selectEntityWinner(left, right);
  const analysisWinner = selectAnalysisWinner(left, right, entityWinner, options);
  const merged: Record<string, unknown> = { ...entityWinner };
  for (const field of ANALYSIS_PAPER_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(analysisWinner, field)) {
      merged[field] = analysisWinner[field];
    } else {
      delete merged[field];
    }
  }
  return merged as Paper;
}

export function mergePapersById(
  local: Paper[],
  remote: Paper[],
  preferRemoteActive = false,
): Paper[] {
  const merged = new Map(local.map((paper) => [paper.id, paper]));
  for (const paper of remote) {
    const existing = merged.get(paper.id);
    merged.set(paper.id, existing
      ? mergePaperRecords(existing, paper, preferRemoteActive ? { preferredActiveSide: 'right' } : undefined)
      : paper);
  }
  return [...merged.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function mergeResearchStates(
  local: ResearchState,
  remote: ResearchState,
  preferRemoteActivePapers: boolean,
): ResearchState {
  return {
    version: 1,
    profile: selectNewer(local.profile, remote.profile),
    settings: selectNewer(local.settings, remote.settings),
    papers: mergePapersById(local.papers, remote.papers, preferRemoteActivePapers),
    notes: mergeById(local.notes, remote.notes),
    messages: mergeById(local.messages, remote.messages),
  };
}

export function mergeStates(local: ResearchState, remote: ResearchState): ResearchState {
  return mergeResearchStates(local, remote, false);
}

export function serializeSingletonDocument<T extends Stamped>(singleton: T): T {
  return omitUndefinedDeep({ ...singleton });
}

export function serializeEntityDocument<T extends SyncedEntity>(entity: T) {
  return {
    id: entity.id,
    data: omitUndefinedDeep({ ...entity }) as Record<string, unknown>,
  };
}

export function isCloudSingleton(value: unknown): value is Stamped & Record<string, unknown> {
  return Boolean(value)
    && typeof value === 'object'
    && typeof (value as Partial<Stamped>).updatedAt === 'string';
}

export function materializeCloudState(
  singletons: CloudSingletonDocuments,
  papers: unknown[],
  notes: unknown[],
  messages: unknown[],
  fallback: ResearchState,
): unknown {
  return {
    version: 1,
    profile: singletons.profile ?? fallback.profile,
    settings: singletons.settings ?? fallback.settings,
    papers,
    notes,
    messages,
  };
}

export interface InitialSyncResolution {
  state: ResearchState;
  uploadProfile: boolean;
  uploadSettings: boolean;
  uploadPapers: Paper[];
  uploadNotes: Note[];
  uploadMessages: ResearchMessage[];
}

function uploadCandidates<T extends SyncedEntity>(merged: T[], cloud: T[]): T[] {
  const cloudById = new Map(cloud.map((item) => [item.id, item]));
  return merged.filter((item) => {
    const remote = cloudById.get(item.id);
    return !remote || stableStringify(item) !== stableStringify(remote);
  });
}

export function resolveInitialSync(
  local: ResearchState,
  cloud: ResearchState | null,
): InitialSyncResolution {
  if (!cloud) {
    return {
      state: local,
      uploadProfile: true,
      uploadSettings: true,
      uploadPapers: local.papers,
      uploadNotes: local.notes,
      uploadMessages: local.messages,
    };
  }
  // Cloud transactions are the coordination authority for active analysis.
  // A different offline generation may still contribute newer metadata, but
  // it cannot displace the cloud's in-flight analysis projection.
  const state = mergeResearchStates(local, cloud, true);
  return {
    state,
    uploadProfile: stableStringify(state.profile) !== stableStringify(cloud.profile),
    uploadSettings: stableStringify(state.settings) !== stableStringify(cloud.settings),
    uploadPapers: uploadCandidates(state.papers, cloud.papers),
    uploadNotes: uploadCandidates(state.notes, cloud.notes),
    uploadMessages: uploadCandidates(state.messages, cloud.messages),
  };
}
