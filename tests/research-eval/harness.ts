import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getDocument,
  type PDFDocumentProxy,
} from 'pdfjs-dist/legacy/build/pdf.mjs';
import {
  PaperAnalysisSchema,
  type PaperAnalysis,
} from '../../src/model';
import { extractPdfTextLines } from '../../src/lib/pdf-text-extraction';
import type {
  ExtractedResearchPage,
  LocalPaperAnalysisInput,
} from '../../src/lib/local-analysis';

export interface EvaluationPaper {
  id: 'attention' | 'adam' | 'bert';
  title: string;
  fileName: string;
  pdfUrl: string;
  arxivId: string;
  expectedSha256: string;
  expectedSectionTerms: readonly string[];
  minimumSections: number;
  minimumFindings: number;
  minimumReferences: number;
}

/** Primary-source PDFs only. These URLs are official arXiv paper endpoints. */
export const EVALUATION_PAPERS: readonly EvaluationPaper[] = [
  {
    id: 'attention',
    title: 'Attention Is All You Need',
    fileName: 'attention-is-all-you-need.pdf',
    pdfUrl: 'https://arxiv.org/pdf/1706.03762v7',
    arxivId: '1706.03762',
    expectedSha256: 'bdfaa68d8984f0dc02beaca527b76f207d99b666d31d1da728ee0728182df697',
    expectedSectionTerms: ['introduction', 'background', 'model', 'attention', 'training', 'results', 'conclusion'],
    minimumSections: 6,
    minimumFindings: 3,
    minimumReferences: 15,
  },
  {
    id: 'adam',
    title: 'Adam: A Method for Stochastic Optimization',
    fileName: 'adam.pdf',
    pdfUrl: 'https://arxiv.org/pdf/1412.6980v9',
    arxivId: '1412.6980',
    expectedSha256: 'eab9c73ae2ceda884b94830bda99312254bac4806f6c9f045cbab90721ecda31',
    expectedSectionTerms: ['introduction', 'algorithm', 'convergence', 'experiments', 'conclusion'],
    minimumSections: 4,
    minimumFindings: 3,
    minimumReferences: 15,
  },
  {
    id: 'bert',
    title: 'BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding',
    fileName: 'bert.pdf',
    pdfUrl: 'https://arxiv.org/pdf/1810.04805v2',
    arxivId: '1810.04805',
    expectedSha256: '5692a5514787a8c6727b4ff3b726a3385798bc68e12138d1d4af83947e2acf6e',
    expectedSectionTerms: ['introduction', 'related work', 'bert', 'pre-training', 'experiments', 'ablation', 'conclusion'],
    minimumSections: 6,
    minimumFindings: 4,
    minimumReferences: 25,
  },
] as const;

export interface ExtractedPaper {
  pages: ExtractedResearchPage[];
  outline: Array<{ title: string; page?: number; depth?: number }>;
  metadata: {
    title?: string;
    author?: string;
    subject?: string;
  };
}

export type EvaluationEngine = (input: LocalPaperAnalysisInput) => PaperAnalysis;

export interface EvaluationReceiptMetrics {
  total: number;
  inRange: number;
  inRangeRate: number;
  quoted: number;
  quoteMatches: number;
  quoteMatchRate: number;
  ledgerTotal: number;
  ledgerInRange: number;
  ledgerInRangeRate: number;
}

export interface EvaluationMetrics {
  paperId: EvaluationPaper['id'];
  title: string;
  sourceUrl: string;
  sourceSha256: string;
  pages: number;
  textPages: number;
  outlineItems: number;
  resolvedOutlineItems: number;
  extractedCharacters: number;
  charactersPerPage: number;
  schemaValid: boolean;
  schemaIssues: string[];
  serializedAnalysisBytes: number;
  withinSyncCeiling: boolean;
  sectionCount: number;
  sectionPageCoverage: number;
  expectedSectionHits: number;
  expectedSectionCoverage: number;
  findingCount: number;
  methodCount: number;
  sourceFigureMarkers: number;
  analyzedFigures: number;
  sourceTableMarkers: number;
  analyzedTables: number;
  sourceEquationMarkers: number;
  analyzedEquations: number;
  sourceReferenceMarkers: number;
  analyzedReferences: number;
  ledgerEntries: number;
  abstractSummaryTokenOverlap: number;
  receipts: EvaluationReceiptMetrics;
  firstRuntimeMs: number;
  secondRuntimeMs: number;
  deterministic: boolean;
  analysisSha256: string;
  failures: string[];
  warnings: string[];
}

const MAX_PDF_BYTES = 50 * 1024 * 1024;
const MAX_SYNC_BYTES = 850_000;

function normalizedText(value: string): string {
  return value
    .normalize('NFKD')
    .toLocaleLowerCase('en-US')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizedTokens(value: string): string[] {
  return normalizedText(value).split(' ').filter((token) => token.length >= 3);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
    .join(',')}}`;
}

function sha256(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function ensurePdf(bytes: Uint8Array, source: string): void {
  if (bytes.byteLength < 5 || bytes.byteLength > MAX_PDF_BYTES) {
    throw new Error(`${source} is empty or exceeds the 50 MiB evaluation ceiling.`);
  }
  if (new TextDecoder('ascii').decode(bytes.subarray(0, 5)) !== '%PDF-') {
    throw new Error(`${source} did not return PDF bytes.`);
  }
}

/** Rejects valid-looking PDFs whose bytes do not match the pinned paper version. */
export function verifyPinnedPaperBytes(
  paper: Pick<EvaluationPaper, 'title' | 'expectedSha256'>,
  bytes: Uint8Array,
  source: string,
): string {
  ensurePdf(bytes, source);
  const actualSha256 = sha256(bytes);
  if (actualSha256 !== paper.expectedSha256.toLocaleLowerCase('en-US')) {
    throw new Error(
      `${source} SHA-256 mismatch for ${paper.title}: expected ${paper.expectedSha256}, received ${actualSha256}.`,
    );
  }
  return actualSha256;
}

export function evaluationCacheDirectory(): string {
  return process.env.SIFT_PAPER_CACHE?.trim() || join(tmpdir(), 'sift-papers');
}

export async function loadPaperBytes(
  paper: EvaluationPaper,
  options: { offline?: boolean; refresh?: boolean } = {},
): Promise<{ bytes: Uint8Array; cachePath: string; downloaded: boolean }> {
  const directory = evaluationCacheDirectory();
  const cachePath = join(directory, paper.fileName);
  await mkdir(directory, { recursive: true });

  if (!options.refresh) {
    try {
      const cached = new Uint8Array(await readFile(cachePath));
      verifyPinnedPaperBytes(paper, cached, cachePath);
      return { bytes: cached, cachePath, downloaded: false };
    } catch (error) {
      if (options.offline) {
        throw new Error(`No valid cached PDF for ${paper.title}: ${error instanceof Error ? error.message : 'unknown error'}`);
      }
    }
  }
  if (options.offline) throw new Error(`Offline evaluation requested, but ${cachePath} is not cached.`);

  const response = await fetch(paper.pdfUrl, {
    redirect: 'follow',
    headers: {
      Accept: 'application/pdf',
      'User-Agent': 'SiftResearchEvaluation/1.0 (source-only quality harness)',
    },
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) throw new Error(`Could not download ${paper.pdfUrl} (${response.status}).`);
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_PDF_BYTES) {
    throw new Error(`${paper.pdfUrl} exceeds the 50 MiB evaluation ceiling.`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  verifyPinnedPaperBytes(paper, bytes, paper.pdfUrl);

  const temporaryPath = `${cachePath}.${process.pid}.tmp`;
  try {
    await writeFile(temporaryPath, bytes);
    await rename(temporaryPath, cachePath);
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
  return { bytes, cachePath, downloaded: true };
}

function safeMetadataValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 2_000) : undefined;
}

function normalizeOutlineTitle(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

async function destinationPage(document: PDFDocumentProxy, destination: unknown): Promise<number | undefined> {
  try {
    const resolved = typeof destination === 'string' ? await document.getDestination(destination) : destination;
    if (!Array.isArray(resolved) || !resolved[0]) return undefined;
    const reference = resolved[0];
    if (typeof reference === 'number') return reference + 1;
    return (await document.getPageIndex(reference)) + 1;
  } catch {
    return undefined;
  }
}

/** Flattens PDF bookmarks with the same title, page, and depth semantics as PdfSession.outline(). */
export async function extractDocumentOutline(
  document: PDFDocumentProxy,
): Promise<ExtractedPaper['outline']> {
  const outline = await document.getOutline();
  if (!outline?.length) return [];
  const result: ExtractedPaper['outline'] = [];
  const visit = async (items: NonNullable<typeof outline>, depth: number): Promise<void> => {
    for (const item of items) {
      result.push({
        title: normalizeOutlineTitle(item.title) || 'Untitled section',
        page: await destinationPage(document, item.dest),
        depth,
      });
      if (item.items?.length) await visit(item.items, depth + 1);
    }
  };
  await visit(outline, 0);
  return result;
}

/** Text extraction only: this never creates a canvas, page image, or rendered PDF. */
export async function extractPaperText(bytes: Uint8Array): Promise<ExtractedPaper> {
  ensurePdf(bytes, 'PDF input');
  const task = getDocument({
    data: bytes.slice(),
    disableFontFace: true,
    standardFontDataUrl: fileURLToPath(new URL('../../node_modules/pdfjs-dist/standard_fonts/', import.meta.url)),
    useSystemFonts: false,
  });
  const document = await task.promise;
  try {
    const [rawMetadata, outline] = await Promise.all([
      document.getMetadata().catch(() => undefined),
      extractDocumentOutline(document),
    ]);
    const info = rawMetadata?.info as Record<string, unknown> | undefined;
    const pages: ExtractedResearchPage[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      try {
        const content = await page.getTextContent({ includeMarkedContent: false });
        const lines = extractPdfTextLines(content.items);
        pages.push({ page: pageNumber, lines, text: lines.join('\n') });
      } finally {
        page.cleanup();
      }
    }
    return {
      pages,
      outline,
      metadata: {
        title: safeMetadataValue(info?.Title),
        author: safeMetadataValue(info?.Author),
        subject: safeMetadataValue(info?.Subject),
      },
    };
  } finally {
    await task.destroy().catch(() => undefined);
  }
}

/** Builds the exact engine payload used by the evaluator, including available PDF bookmarks. */
export function buildEvaluationEngineInput(
  paper: EvaluationPaper,
  extracted: ExtractedPaper,
): LocalPaperAnalysisInput {
  return {
    pages: extracted.pages,
    title: paper.title,
    fileName: paper.fileName,
    metadata: {
      title: extracted.metadata.title || paper.title,
      author: extracted.metadata.author,
      subject: extracted.metadata.subject,
      url: paper.pdfUrl.replace('/pdf/', '/abs/'),
    },
    outline: extracted.outline,
  };
}

function uniqueMarkers(text: string, expression: RegExp): number {
  const matches = new Set<string>();
  for (const match of text.matchAll(expression)) matches.add(match[1].toLocaleLowerCase());
  return matches.size;
}

function sourceReferenceMarkers(pages: readonly ExtractedResearchPage[]): number {
  const allLines = pages.flatMap((page) => (page.lines ?? page.text.split(/\r?\n/)).map((line) => line.trim()));
  const referenceStart = allLines.findIndex((line) => /^references\b/i.test(line));
  const referenceLines = referenceStart >= 0 ? allLines.slice(referenceStart + 1) : allLines;
  const bracketed = new Set<string>();
  referenceLines.forEach((line) => {
    const match = /^\[\s*(\d{1,4})\s*\]/.exec(line);
    if (match) bracketed.add(match[1]);
  });
  if (bracketed.size) return bracketed.size;

  // Some arXiv papers use unnumbered bibliography entries. This conservative
  // fallback counts DOI/arXiv-bearing lines without guessing from author names.
  return referenceLines.filter((line) => /\b(?:doi:|arxiv:|https?:\/\/doi\.org\/)/i.test(line)).length;
}

interface Receipt {
  page: number;
  quote?: string;
  ledger: boolean;
}

function analysisReceipts(analysis: PaperAnalysis): Receipt[] {
  const receipts: Receipt[] = [];
  const add = (page: number, quote?: string, ledger = false) => receipts.push({ page, quote, ledger });
  analysis.methods.forEach((item) => add(item.page, item.evidence.quote));
  analysis.keyFindings.forEach((item) => add(item.page, item.evidence.quote));
  analysis.sectionSummaries.forEach((section) => {
    add(section.startPage);
    if (section.endPage !== section.startPage) add(section.endPage);
    section.evidence.forEach((item) => add(item.page, item.quote));
  });
  analysis.figures.forEach((item) => add(item.page, item.evidence.quote));
  analysis.tables.forEach((item) => add(item.page, item.evidence.quote));
  analysis.equations.forEach((item) => add(item.page, item.evidence.quote));
  analysis.limitations.forEach((item) => add(item.page, item.evidence.quote));
  analysis.glossary.forEach((item) => add(item.page));
  analysis.references.forEach((item) => add(item.page));
  analysis.sourceLedger.forEach((item) => add(item.page, item.quote, true));
  return receipts;
}

function receiptMetrics(analysis: PaperAnalysis, pages: readonly ExtractedResearchPage[]): EvaluationReceiptMetrics {
  const receipts = analysisReceipts(analysis);
  const pageText = new Map(pages.map((page) => [page.page, normalizedText(page.text)]));
  const inRange = receipts.filter((receipt) => pageText.has(receipt.page));
  const quoted = inRange.filter((receipt) => normalizedText(receipt.quote ?? '').length > 0);
  const quoteMatches = quoted.filter((receipt) => {
    const quote = normalizedText(receipt.quote ?? '');
    return quote.length > 0 && pageText.get(receipt.page)?.includes(quote);
  });
  const ledger = receipts.filter((receipt) => receipt.ledger);
  const ledgerInRange = ledger.filter((receipt) => pageText.has(receipt.page));
  return {
    total: receipts.length,
    inRange: inRange.length,
    inRangeRate: receipts.length ? inRange.length / receipts.length : 1,
    quoted: quoted.length,
    quoteMatches: quoteMatches.length,
    quoteMatchRate: quoted.length ? quoteMatches.length / quoted.length : 1,
    ledgerTotal: ledger.length,
    ledgerInRange: ledgerInRange.length,
    ledgerInRangeRate: ledger.length ? ledgerInRange.length / ledger.length : 1,
  };
}

function sectionPageCoverage(analysis: PaperAnalysis, pages: readonly ExtractedResearchPage[]): number {
  const textPages = new Set(pages.filter((page) => normalizedText(page.text)).map((page) => page.page));
  if (!textPages.size) return 0;
  const covered = new Set<number>();
  analysis.sectionSummaries.forEach((section) => {
    for (let page = section.startPage; page <= section.endPage; page += 1) {
      if (textPages.has(page)) covered.add(page);
    }
  });
  return covered.size / textPages.size;
}

function expectedSectionCoverage(analysis: PaperAnalysis, paper: EvaluationPaper): { hits: number; rate: number } {
  const headings = normalizedText(analysis.sectionSummaries.map((section) => section.heading).join(' '));
  const hits = paper.expectedSectionTerms.filter((term) => headings.includes(normalizedText(term))).length;
  return { hits, rate: hits / paper.expectedSectionTerms.length };
}

function abstractTokenOverlap(analysis: PaperAnalysis, pages: readonly ExtractedResearchPage[]): number {
  const source = new Set(normalizedTokens(pages.slice(0, Math.min(3, pages.length)).map((page) => page.text).join(' ')));
  const summary = new Set(normalizedTokens(analysis.abstractSummary));
  if (!summary.size) return 0;
  let overlap = 0;
  summary.forEach((token) => { if (source.has(token)) overlap += 1; });
  return overlap / summary.size;
}

function schemaIssueMessages(result: ReturnType<typeof PaperAnalysisSchema.safeParse>): string[] {
  if (result.success) return [];
  return result.error.issues.slice(0, 12).map((issue) => `${issue.path.join('.') || 'analysis'}: ${issue.message}`);
}

export function calculateEvaluationMetrics(input: {
  paper: EvaluationPaper;
  sourceBytes: Uint8Array;
  extracted: ExtractedPaper;
  firstAnalysis: unknown;
  secondAnalysis: unknown;
  firstRuntimeMs: number;
  secondRuntimeMs: number;
}): EvaluationMetrics {
  const firstResult = PaperAnalysisSchema.safeParse(input.firstAnalysis);
  const secondResult = PaperAnalysisSchema.safeParse(input.secondAnalysis);
  const analysis = firstResult.success ? firstResult.data : undefined;
  const firstStable = stableStringify(input.firstAnalysis);
  const secondStable = stableStringify(input.secondAnalysis);
  const allText = input.extracted.pages.map((page) => page.text).join('\n');
  const textPages = input.extracted.pages.filter((page) => normalizedText(page.text).length > 0).length;
  const extractedCharacters = input.extracted.pages.reduce((total, page) => total + page.text.length, 0);
  const serializedAnalysisBytes = Buffer.byteLength(JSON.stringify(input.firstAnalysis) ?? 'null');
  const receipts = analysis ? receiptMetrics(analysis, input.extracted.pages) : {
    total: 0,
    inRange: 0,
    inRangeRate: 0,
    quoted: 0,
    quoteMatches: 0,
    quoteMatchRate: 0,
    ledgerTotal: 0,
    ledgerInRange: 0,
    ledgerInRangeRate: 0,
  };
  const sections = analysis ? expectedSectionCoverage(analysis, input.paper) : { hits: 0, rate: 0 };
  const failures: string[] = [];
  const warnings: string[] = [];

  if (!firstResult.success) failures.push('PaperAnalysisSchema rejected the first output.');
  if (!secondResult.success) failures.push('PaperAnalysisSchema rejected the repeated output.');
  if (firstStable !== secondStable) failures.push('Repeated analysis was not byte-for-byte deterministic.');
  if (serializedAnalysisBytes >= MAX_SYNC_BYTES) failures.push('Serialized analysis exceeds the 850,000-byte sync ceiling.');
  if (receipts.inRangeRate < 1) failures.push('One or more page receipts are outside the PDF page range.');
  if (receipts.ledgerInRangeRate < 1) failures.push('One or more source-ledger pages are outside the PDF page range.');
  if (textPages / Math.max(1, input.extracted.pages.length) < 0.9) failures.push('Fewer than 90% of PDF pages yielded extractable text.');
  if (analysis && analysis.sectionSummaries.length < input.paper.minimumSections) warnings.push('Section coverage is below the paper-specific baseline.');
  if (analysis && analysis.keyFindings.length < input.paper.minimumFindings) warnings.push('Finding count is below the paper-specific baseline.');
  if (analysis && analysis.references.length < input.paper.minimumReferences) warnings.push('Reference extraction is below the paper-specific baseline.');
  if (analysis && sections.rate < 0.6) warnings.push('Expected section-heading coverage is below 60%.');
  if (analysis && receipts.quoteMatchRate < 0.75) warnings.push('Fewer than 75% of quoted receipts match normalized text on the cited page.');
  if (analysis && abstractTokenOverlap(analysis, input.extracted.pages) < 0.35) warnings.push('Abstract summary has low token overlap with the opening source pages.');

  return {
    paperId: input.paper.id,
    title: input.paper.title,
    sourceUrl: input.paper.pdfUrl,
    sourceSha256: sha256(input.sourceBytes),
    pages: input.extracted.pages.length,
    textPages,
    outlineItems: input.extracted.outline.length,
    resolvedOutlineItems: input.extracted.outline.filter((item) => item.page !== undefined).length,
    extractedCharacters,
    charactersPerPage: Math.round(extractedCharacters / Math.max(1, input.extracted.pages.length)),
    schemaValid: firstResult.success && secondResult.success,
    schemaIssues: [...schemaIssueMessages(firstResult), ...schemaIssueMessages(secondResult)],
    serializedAnalysisBytes,
    withinSyncCeiling: serializedAnalysisBytes < MAX_SYNC_BYTES,
    sectionCount: analysis?.sectionSummaries.length ?? 0,
    sectionPageCoverage: analysis ? sectionPageCoverage(analysis, input.extracted.pages) : 0,
    expectedSectionHits: sections.hits,
    expectedSectionCoverage: sections.rate,
    findingCount: analysis?.keyFindings.length ?? 0,
    methodCount: analysis?.methods.length ?? 0,
    sourceFigureMarkers: uniqueMarkers(allText, /\b(?:figure|fig\.)\s*([0-9]+[a-z]?)/gi),
    analyzedFigures: analysis?.figures.length ?? 0,
    sourceTableMarkers: uniqueMarkers(allText, /\btable\s*([0-9]+[a-z]?)/gi),
    analyzedTables: analysis?.tables.length ?? 0,
    sourceEquationMarkers: uniqueMarkers(allText, /\(\s*([0-9]{1,3})\s*\)/g),
    analyzedEquations: analysis?.equations.length ?? 0,
    sourceReferenceMarkers: sourceReferenceMarkers(input.extracted.pages),
    analyzedReferences: analysis?.references.length ?? 0,
    ledgerEntries: analysis?.sourceLedger.length ?? 0,
    abstractSummaryTokenOverlap: analysis ? abstractTokenOverlap(analysis, input.extracted.pages) : 0,
    receipts,
    firstRuntimeMs: Math.round(input.firstRuntimeMs),
    secondRuntimeMs: Math.round(input.secondRuntimeMs),
    deterministic: firstStable === secondStable,
    analysisSha256: sha256(firstStable),
    failures,
    warnings,
  };
}

export async function runEngineTwice(
  engine: EvaluationEngine,
  input: LocalPaperAnalysisInput,
): Promise<{ firstAnalysis: PaperAnalysis; secondAnalysis: PaperAnalysis; firstRuntimeMs: number; secondRuntimeMs: number }> {
  const firstStart = performance.now();
  const firstAnalysis = engine(input);
  const firstRuntimeMs = performance.now() - firstStart;
  const secondStart = performance.now();
  const secondAnalysis = engine(input);
  const secondRuntimeMs = performance.now() - secondStart;
  return { firstAnalysis, secondAnalysis, firstRuntimeMs, secondRuntimeMs };
}

export function compactMetricRow(metrics: EvaluationMetrics): Record<string, string | number> {
  const percent = (value: number) => `${Math.round(value * 100)}%`;
  return {
    paper: metrics.paperId,
    pages: `${metrics.textPages}/${metrics.pages}`,
    outline: `${metrics.resolvedOutlineItems}/${metrics.outlineItems}`,
    charsPerPage: metrics.charactersPerPage,
    runtimeMs: metrics.firstRuntimeMs,
    schema: metrics.schemaValid ? 'yes' : 'no',
    bytes: metrics.serializedAnalysisBytes,
    sections: `${metrics.sectionCount} · ${percent(metrics.sectionPageCoverage)}/${percent(metrics.expectedSectionCoverage)}`,
    findings: metrics.findingCount,
    visuals: `${metrics.analyzedFigures}/${metrics.sourceFigureMarkers}F ${metrics.analyzedTables}/${metrics.sourceTableMarkers}T ${metrics.analyzedEquations}/${metrics.sourceEquationMarkers}E`,
    references: `${metrics.analyzedReferences}/${metrics.sourceReferenceMarkers}`,
    ledger: metrics.ledgerEntries,
    pageReceipts: percent(metrics.receipts.inRangeRate),
    quoteMatches: percent(metrics.receipts.quoteMatchRate),
    abstractOverlap: percent(metrics.abstractSummaryTokenOverlap),
    deterministic: metrics.deterministic ? 'yes' : 'no',
    verdict: metrics.failures.length ? 'fail' : metrics.warnings.length ? 'warn' : 'pass',
  };
}

export function cacheFileLabel(path: string): string {
  return basename(path);
}
