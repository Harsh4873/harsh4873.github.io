import { analyzeExtractedPaper, type LocalPaperAnalysisInput } from './local-analysis';

type WorkerResponse =
  | { ok: true; analysis: ReturnType<typeof analyzeExtractedPaper> }
  | { ok: false; error: string };

self.onmessage = (event: MessageEvent<LocalPaperAnalysisInput>) => {
  let response: WorkerResponse;
  try {
    response = { ok: true, analysis: analyzeExtractedPaper(event.data) };
  } catch (error) {
    response = { ok: false, error: error instanceof Error ? error.message : 'Local analysis failed in the background worker.' };
  }
  self.postMessage(response);
};
