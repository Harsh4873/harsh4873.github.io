import type { Paper, PaperAnalysis } from '../model';

export const LOCAL_ANALYSIS_MODEL = 'sift-local-v1';

export type AnalysisMode = 'local' | 'ai';

type AnalysisSourcePaper = Pick<Paper, 'title' | 'authors' | 'year' | 'doi' | 'sourceUrl'>;

export type AnalysisMetadataPatch = Partial<AnalysisSourcePaper>;

export function completedAnalysisPatch(
  paper: AnalysisSourcePaper,
  analysis: PaperAnalysis,
  model: string | undefined,
  completedAt = new Date().toISOString(),
) {
  return {
    title: analysis.title || paper.title,
    authors: analysis.authors.length ? analysis.authors : paper.authors,
    year: analysis.publication.year ?? paper.year,
    doi: analysis.publication.doi ?? paper.doi,
    sourceUrl: analysis.publication.url ?? paper.sourceUrl,
    summary: analysis,
    analysisStatus: 'ready' as const,
    analysisProgress: 100,
    analysisModel: model,
    analysisCompletedAt: completedAt,
    analysisError: undefined,
    analysisLease: undefined,
  };
}

/**
 * Keep metadata enrichment separate from the transaction-owned analysis
 * projection. A field is eligible only when it still matches the value at
 * analysis start, so a concurrent user or synced-device edit always wins.
 */
export function analysisMetadataPatchPreservingEdits(
  started: AnalysisSourcePaper,
  latest: AnalysisSourcePaper,
  analysis: PaperAnalysis,
): AnalysisMetadataPatch {
  const proposed: AnalysisSourcePaper = {
    title: analysis.title || latest.title,
    authors: analysis.authors.length ? analysis.authors : latest.authors,
    year: analysis.publication.year ?? latest.year,
    doi: analysis.publication.doi ?? latest.doi,
    sourceUrl: analysis.publication.url ?? latest.sourceUrl,
  };
  const patch: AnalysisMetadataPatch = {};
  if (started.title === latest.title && proposed.title !== latest.title) patch.title = proposed.title;
  if (JSON.stringify(started.authors) === JSON.stringify(latest.authors)
    && JSON.stringify(proposed.authors) !== JSON.stringify(latest.authors)) patch.authors = proposed.authors;
  if (started.year === latest.year && proposed.year !== latest.year) patch.year = proposed.year;
  if (started.doi === latest.doi && proposed.doi !== latest.doi) patch.doi = proposed.doi;
  if (started.sourceUrl === latest.sourceUrl && proposed.sourceUrl !== latest.sourceUrl) patch.sourceUrl = proposed.sourceUrl;
  return patch;
}

export function isLocalAnalysis(model?: string): boolean {
  return model === LOCAL_ANALYSIS_MODEL;
}
