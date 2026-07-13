import { PaperSchema, type Paper } from '../model';
import { isAnalysisLeaseFresh } from './analysis-lease';

export const ANALYSIS_PAPER_MUTATION_FIELDS = [
  'analysisStatus',
  'analysisProgress',
  'analysisError',
  'analysisModel',
  'analysisCompletedAt',
  'analysisLease',
  'openaiFileId',
  'summary',
] as const;

export const ANALYSIS_PAPER_FIELDS = [
  ...ANALYSIS_PAPER_MUTATION_FIELDS,
  'analysisUpdatedAt',
  'analysisRunId',
] as const;

type AnalysisPaperMutationField = typeof ANALYSIS_PAPER_MUTATION_FIELDS[number];

export type AnalysisPaperPatch = Partial<Pick<Paper, AnalysisPaperMutationField>>;

export type AnalysisPaperMutationOperation =
  | { type: 'claim'; maximumAgeMs: number }
  | { type: 'owned'; runId: string }
  | { type: 'idle-file-clear'; expectedFileId: string };

export type AnalysisPaperMutationResult =
  | { status: 'applied'; paper: Paper }
  | { status: 'conflict'; paper?: Paper }
  | { status: 'local-only'; paper: Paper }
  | { status: 'unavailable'; message: string };

export function isAnalysisPaperWorking(paper: Pick<Paper, 'analysisStatus'>): boolean {
  return paper.analysisStatus === 'queued'
    || paper.analysisStatus === 'uploading'
    || paper.analysisStatus === 'analyzing';
}

export function pickAnalysisPaperPatch(patch: AnalysisPaperPatch): AnalysisPaperPatch {
  const picked: AnalysisPaperPatch = {};
  for (const field of ANALYSIS_PAPER_MUTATION_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(patch, field)) {
      Object.assign(picked, { [field]: patch[field] });
    }
  }
  return picked;
}

function nextAnalysisUpdatedAt(current: Paper, nowMs: number): string {
  const previousMs = Math.max(
    current.analysisUpdatedAt ? Date.parse(current.analysisUpdatedAt) : 0,
    current.analysisLease ? Date.parse(current.analysisLease.heartbeatAt) : 0,
    current.analysisCompletedAt ? Date.parse(current.analysisCompletedAt) : 0,
  );
  const candidate = Math.max(nowMs, previousMs + 1);
  return new Date(candidate).toISOString();
}

export function applyAnalysisPaperPatch(
  current: Paper,
  patch: AnalysisPaperPatch,
  nowMs = Date.now(),
): Paper {
  if (!Number.isFinite(nowMs)) throw new Error('Analysis mutation requires a valid current time.');
  const analysisUpdatedAt = nextAnalysisUpdatedAt(current, nowMs);
  const analysisPatch = pickAnalysisPaperPatch(patch);
  if (analysisPatch.analysisLease) {
    analysisPatch.analysisLease = {
      ...analysisPatch.analysisLease,
      // The revision and lease heartbeat are one logical transaction. Using
      // the normalized clock keeps a clock-behind client from claiming a
      // lease that appears stale immediately.
      heartbeatAt: analysisUpdatedAt,
    };
  }
  return PaperSchema.parse({
    ...current,
    ...analysisPatch,
    // updatedAt is the metadata/entity clock. Keeping it stable prevents a
    // heartbeat from winning an unrelated title/tag conflict by accident.
    analysisUpdatedAt,
    analysisRunId: analysisPatch.analysisLease?.runId
      ?? current.analysisRunId
      ?? current.analysisLease?.runId,
  });
}

export function analysisMutationHasConflict(
  current: Paper,
  patch: AnalysisPaperPatch,
  operation: AnalysisPaperMutationOperation,
  nowMs = Date.now(),
): boolean {
  if (current.deleted) return true;
  if (operation.type === 'idle-file-clear') {
    const picked = pickAnalysisPaperPatch(patch);
    return isAnalysisPaperWorking(current)
      || !operation.expectedFileId
      || current.openaiFileId !== operation.expectedFileId
      || Object.keys(picked).length !== 1
      || !Object.prototype.hasOwnProperty.call(picked, 'openaiFileId')
      || picked.openaiFileId !== undefined;
  }
  if (operation.type === 'owned') return current.analysisLease?.runId !== operation.runId;

  const proposedLease = patch.analysisLease;
  if (!proposedLease || !Number.isFinite(operation.maximumAgeMs) || operation.maximumAgeMs < 0) return true;
  const currentLease = current.analysisLease;
  if (!currentLease || !isAnalysisPaperWorking(current)) return false;
  const sameClaim = currentLease.runId === proposedLease.runId
    && currentLease.ownerId === proposedLease.ownerId;
  return !sameClaim && isAnalysisLeaseFresh(currentLease, nowMs, operation.maximumAgeMs);
}
