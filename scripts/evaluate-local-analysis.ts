import {
  EVALUATION_PAPERS,
  buildEvaluationEngineInput,
  cacheFileLabel,
  calculateEvaluationMetrics,
  compactMetricRow,
  extractPaperText,
  loadPaperBytes,
  runEngineTwice,
  type EvaluationMetrics,
} from '../tests/research-eval/harness';
import { analyzeExtractedPaper } from '../src/lib/local-analysis';

interface CommandOptions {
  ids: Set<string>;
  offline: boolean;
  refresh: boolean;
  json: boolean;
  extractOnly: boolean;
  diagnostics: boolean;
}

function commandOptions(arguments_: readonly string[]): CommandOptions {
  const selected = arguments_.find((argument) => argument.startsWith('--paper='))?.slice('--paper='.length);
  return {
    ids: new Set((selected ? selected.split(',') : EVALUATION_PAPERS.map((paper) => paper.id)).map((id) => id.trim()).filter(Boolean)),
    offline: arguments_.includes('--offline'),
    refresh: arguments_.includes('--refresh'),
    json: arguments_.includes('--json'),
    extractOnly: arguments_.includes('--extract-only'),
    diagnostics: arguments_.includes('--diagnostics'),
  };
}

function printHumanResults(metrics: readonly EvaluationMetrics[], cacheEvents: readonly string[]): void {
  cacheEvents.forEach((event) => console.log(event));
  console.table(metrics.map(compactMetricRow));
  console.log('\nPrimary paper sources:');
  metrics.forEach((metric) => console.log(`- ${metric.title}: ${metric.sourceUrl}`));
  metrics.forEach((metric) => {
    if (!metric.failures.length && !metric.warnings.length) return;
    console.log(`\n${metric.title}:`);
    metric.failures.forEach((failure) => console.log(`  FAIL: ${failure}`));
    metric.warnings.forEach((warning) => console.log(`  WARN: ${warning}`));
    metric.schemaIssues.forEach((issue) => console.log(`  SCHEMA: ${issue}`));
  });
}

async function main(): Promise<void> {
  const options = commandOptions(process.argv.slice(2));
  const selected = EVALUATION_PAPERS.filter((paper) => options.ids.has(paper.id));
  const unknown = [...options.ids].filter((id) => !EVALUATION_PAPERS.some((paper) => paper.id === id));
  if (unknown.length) throw new Error(`Unknown paper id(s): ${unknown.join(', ')}. Use attention, adam, or bert.`);
  if (!selected.length) throw new Error('Select at least one evaluation paper.');

  const engine = options.extractOnly ? undefined : analyzeExtractedPaper;
  const results: EvaluationMetrics[] = [];
  const cacheEvents: string[] = [];
  const extractionRows: Array<Record<string, string | number>> = [];
  const sectionDiagnostics: Array<{ paper: string; headings: string[] }> = [];
  for (const paper of selected) {
    const loaded = await loadPaperBytes(paper, { offline: options.offline, refresh: options.refresh });
    cacheEvents.push(`${paper.id}: ${loaded.downloaded ? 'downloaded' : 'cached'} ${cacheFileLabel(loaded.cachePath)}`);
    const extracted = await extractPaperText(loaded.bytes);
    if (!engine) {
      const characters = extracted.pages.reduce((total, page) => total + page.text.length, 0);
      extractionRows.push({
        paper: paper.id,
        pages: extracted.pages.length,
        textPages: extracted.pages.filter((page) => page.text.trim()).length,
        outlineItems: extracted.outline.length,
        resolvedOutlineItems: extracted.outline.filter((item) => item.page !== undefined).length,
        characters,
        charactersPerPage: Math.round(characters / Math.max(1, extracted.pages.length)),
        titleMetadata: extracted.metadata.title ? 'yes' : 'no',
      });
      continue;
    }
    const runs = await runEngineTwice(engine, buildEvaluationEngineInput(paper, extracted));
    sectionDiagnostics.push({
      paper: paper.id,
      headings: runs.firstAnalysis.sectionSummaries.map((section) => section.heading),
    });
    results.push(calculateEvaluationMetrics({
      paper,
      sourceBytes: loaded.bytes,
      extracted,
      ...runs,
    }));
  }

  if (options.extractOnly) {
    if (options.json) console.log(JSON.stringify({
      sources: selected.map(({ id, title, pdfUrl, expectedSha256 }) => ({ id, title, pdfUrl, expectedSha256 })),
      extraction: extractionRows,
    }, null, 2));
    else {
      cacheEvents.forEach((event) => console.log(event));
      console.table(extractionRows);
      console.log('\nPrimary paper sources:');
      selected.forEach((paper) => console.log(`- ${paper.title}: ${paper.pdfUrl}`));
    }
    return;
  }

  if (options.json) {
    console.log(JSON.stringify({
      generatedAt: new Date().toISOString(),
      sources: selected.map(({ id, title, pdfUrl, arxivId, expectedSha256 }) => ({ id, title, pdfUrl, arxivId, expectedSha256 })),
      results,
    }, null, 2));
  } else {
    printHumanResults(results, cacheEvents);
  }
  if (options.diagnostics) {
    sectionDiagnostics.forEach(({ paper, headings }) => console.log(`\n${paper} headings (${headings.length}): ${headings.join(' | ')}`));
  }
  if (results.some((result) => result.failures.length)) process.exitCode = 1;
}

await main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
