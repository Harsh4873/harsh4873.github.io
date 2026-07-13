import type { AnalysisMode } from './analysis-result';

export type AnalysisCoordination = 'pending' | 'cloud' | 'local';

/**
 * Only free local analysis that was claimed locally may keep mutating local
 * state without a cloud transaction. Once a run has cloud ownership, losing
 * coordination must fail closed so another session cannot be overwritten.
 */
export function canFallBackToLocalAnalysis(
  mode: AnalysisMode,
  coordination: AnalysisCoordination,
): boolean {
  return mode === 'local' && coordination === 'local';
}
