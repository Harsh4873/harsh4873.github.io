import { z } from 'zod';

/** Sift's synced domain model. Original PDF bytes never belong in this shape. */
export const RESEARCH_STATE_VERSION = 1 as const;
export const RESEARCH_ADMIN_EMAIL = 'hdav4873@gmail.com' as const;

const SHORT_TEXT = 500;
const LONG_TEXT = 50_000;
const MAX_PAPER_DOCUMENT_BYTES = 850_000;

const boundedText = (maximum = SHORT_TEXT) => z.string().max(maximum);
const nonEmptyText = (maximum = SHORT_TEXT) => boundedText(maximum).trim().min(1);
const isoDateTime = z.string().max(64).refine(
  (value) => Number.isFinite(Date.parse(value)),
  'Expected an ISO-compatible timestamp.',
);
const entityId = z.string()
  .min(1)
  .max(240)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, 'Invalid record id.');
const httpsUrl = z.string().url().max(2_048).refine((value) => {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}, 'Only HTTPS URLs are supported.');
const optionalHttpsUrl = httpsUrl.optional();

export const ConfidenceSchema = z.enum(['high', 'medium', 'low']);
export type Confidence = z.infer<typeof ConfidenceSchema>;

export const EvidenceRefSchema = z.object({
  page: z.number().int().min(1).max(100_000),
  label: boundedText(200).optional(),
  section: boundedText(500).optional(),
  quote: boundedText(10_000).optional(),
  explanation: boundedText(10_000).optional(),
  bbox: z.tuple([
    z.number().finite(),
    z.number().finite(),
    z.number().finite(),
    z.number().finite(),
  ]).optional(),
}).strict();
export type EvidenceRef = z.infer<typeof EvidenceRefSchema>;

export const EvidenceDetailSchema = z.object({
  quote: boundedText(10_000),
  paraphrase: boundedText(20_000),
  context: boundedText(20_000),
}).strict();
export type EvidenceDetail = z.infer<typeof EvidenceDetailSchema>;

const MethodSummarySchema = z.object({
  name: nonEmptyText(),
  description: boundedText(20_000),
  page: z.number().int().min(1).max(100_000),
  evidence: EvidenceDetailSchema,
}).strict();

const KeyFindingSchema = z.object({
  claim: nonEmptyText(20_000),
  importance: boundedText(20_000),
  certainty: boundedText(2_000),
  page: z.number().int().min(1).max(100_000),
  evidence: EvidenceDetailSchema,
}).strict();

const SectionSummarySchema = z.object({
  heading: nonEmptyText(),
  summary: boundedText(30_000),
  startPage: z.number().int().min(1).max(100_000),
  endPage: z.number().int().min(1).max(100_000),
  keyPoints: z.array(boundedText(5_000)).max(100),
  evidence: z.array(z.object({
    page: z.number().int().min(1).max(100_000),
    quote: boundedText(10_000),
    paraphrase: boundedText(20_000),
    context: boundedText(20_000),
  }).strict()).max(100),
}).strict().refine((value) => value.endPage >= value.startPage, {
  message: 'Section end page must not precede its start page.',
});

const FigureSummarySchema = z.object({
  label: boundedText(200).nullable(),
  title: boundedText(1_000).nullable(),
  page: z.number().int().min(1).max(100_000),
  description: boundedText(20_000),
  interpretation: boundedText(20_000),
  keyTakeaway: boundedText(20_000),
  evidence: EvidenceDetailSchema,
  limitations: z.array(boundedText(5_000)).max(100),
}).strict();

const TableSummarySchema = z.object({
  label: boundedText(200).nullable(),
  title: boundedText(1_000).nullable(),
  page: z.number().int().min(1).max(100_000),
  description: boundedText(20_000),
  interpretation: boundedText(20_000),
  keyTakeaway: boundedText(20_000),
  evidence: EvidenceDetailSchema,
  limitations: z.array(boundedText(5_000)).max(100),
  columns: z.array(boundedText(1_000)).max(250),
}).strict();

const EquationSummarySchema = z.object({
  label: boundedText(200).nullable(),
  page: z.number().int().min(1).max(100_000),
  latex: boundedText(20_000),
  plainLanguage: boundedText(20_000),
  role: boundedText(10_000),
  variables: z.array(z.object({
    symbol: boundedText(500),
    meaning: boundedText(5_000),
  }).strict()).max(250),
  evidence: EvidenceDetailSchema,
}).strict();

const LimitationSummarySchema = z.object({
  limitation: nonEmptyText(20_000),
  impact: boundedText(20_000),
  page: z.number().int().min(1).max(100_000),
  evidence: EvidenceDetailSchema,
}).strict();

const GlossaryEntrySchema = z.object({
  term: nonEmptyText(),
  definition: boundedText(10_000),
  page: z.number().int().min(1).max(100_000),
}).strict();

const ReferenceSummarySchema = z.object({
  citation: nonEmptyText(10_000),
  doi: boundedText(512).nullable(),
  url: httpsUrl.nullable(),
  page: z.number().int().min(1).max(100_000),
}).strict();

export const SourceLedgerEntrySchema = z.object({
  id: entityId,
  type: z.enum(['claim', 'method', 'figure', 'table', 'equation', 'limitation', 'reference', 'other']),
  title: nonEmptyText(1_000),
  claim: boundedText(20_000),
  page: z.number().int().min(1).max(100_000),
  quote: boundedText(10_000),
  paraphrase: boundedText(20_000),
  context: boundedText(20_000),
  confidence: ConfidenceSchema,
}).strict();
export type SourceLedgerEntry = z.infer<typeof SourceLedgerEntrySchema>;

export const PaperAnalysisSchema = z.object({
  title: nonEmptyText(1_000),
  authors: z.array(nonEmptyText()).max(100),
  paperType: boundedText(500),
  publication: z.object({
    venue: boundedText(1_000).nullable(),
    year: z.number().int().min(1000).max(3000).nullable(),
    doi: boundedText(512).nullable(),
    url: httpsUrl.nullable(),
  }).strict(),
  overview: boundedText(LONG_TEXT),
  researchQuestion: boundedText(LONG_TEXT),
  abstractSummary: boundedText(LONG_TEXT),
  methods: z.array(MethodSummarySchema).max(200),
  keyFindings: z.array(KeyFindingSchema).max(300),
  sectionSummaries: z.array(SectionSummarySchema).max(300),
  figures: z.array(FigureSummarySchema).max(300),
  tables: z.array(TableSummarySchema).max(300),
  equations: z.array(EquationSummarySchema).max(500),
  limitations: z.array(LimitationSummarySchema).max(200),
  glossary: z.array(GlossaryEntrySchema).max(500),
  references: z.array(ReferenceSummarySchema).max(1_000),
  sourceLedger: z.array(SourceLedgerEntrySchema).max(1_000),
  synthesis: z.object({
    contribution: boundedText(LONG_TEXT),
    novelty: boundedText(LONG_TEXT),
    implications: z.array(boundedText(10_000)).max(200),
    openQuestions: z.array(boundedText(10_000)).max(200),
  }).strict(),
  warnings: z.array(boundedText(5_000)).max(100),
}).strict();
export type PaperAnalysis = z.infer<typeof PaperAnalysisSchema>;
export type PaperSummary = PaperAnalysis;

const entityStampShape = {
  id: entityId,
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
  deleted: z.literal(true).optional(),
  deletedAt: isoDateTime.optional(),
} as const;

function requireCompleteTombstone(
  value: { deleted?: true; deletedAt?: string },
  context: z.RefinementCtx,
) {
  if ((value.deleted === true) !== (value.deletedAt !== undefined)) {
    context.addIssue({ code: 'custom', message: 'Tombstones require deleted and deletedAt together.' });
  }
}

export const PaperFileSchema = z.object({
  storageKey: entityId,
  name: nonEmptyText(1_000),
  sizeBytes: z.number().int().min(1).max(50 * 1024 * 1024),
  mimeType: z.literal('application/pdf'),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
}).strict();
export type PaperFile = z.infer<typeof PaperFileSchema>;

export const AnalysisStatusSchema = z.enum([
  'local',
  'queued',
  'uploading',
  'analyzing',
  'ready',
  'error',
]);
export type AnalysisStatus = z.infer<typeof AnalysisStatusSchema>;

export const PaperSchema = z.object({
  ...entityStampShape,
  title: nonEmptyText(1_000),
  authors: z.array(nonEmptyText()).max(100),
  year: z.number().int().min(1000).max(3000).optional(),
  venue: boundedText(1_000).optional(),
  doi: boundedText(512).optional(),
  sourceUrl: optionalHttpsUrl,
  abstract: boundedText(LONG_TEXT).optional(),
  pageCount: z.number().int().min(1).max(100_000).optional(),
  file: PaperFileSchema,
  tags: z.array(nonEmptyText(100)).max(50),
  favorite: z.boolean(),
  archived: z.boolean(),
  lastOpenedAt: isoDateTime.optional(),
  analysisStatus: AnalysisStatusSchema,
  analysisProgress: z.number().finite().min(0).max(100).optional(),
  analysisError: boundedText(2_000).optional(),
  analysisModel: boundedText(200).optional(),
  analysisCompletedAt: isoDateTime.optional(),
  openaiFileId: boundedText(512).optional(),
  summary: PaperAnalysisSchema.optional(),
}).strict().superRefine((value, context) => {
  requireCompleteTombstone(value, context);
  if (value.file.storageKey !== value.id) {
    context.addIssue({ code: 'custom', path: ['file', 'storageKey'], message: 'PDF storage key must match the paper id.' });
  }
  if (value.analysisStatus === 'ready' && !value.summary) {
    context.addIssue({ code: 'custom', path: ['summary'], message: 'A ready paper requires a structured summary.' });
  }
  const bytes = new TextEncoder().encode(JSON.stringify(value)).byteLength;
  if (bytes > MAX_PAPER_DOCUMENT_BYTES) {
    context.addIssue({
      code: 'custom',
      message: `Paper metadata exceeds the ${MAX_PAPER_DOCUMENT_BYTES}-byte sync limit.`,
    });
  }
});
export type Paper = z.infer<typeof PaperSchema>;

export const NoteSchema = z.object({
  ...entityStampShape,
  paperId: entityId,
  page: z.number().int().min(1).max(100_000).optional(),
  section: boundedText(500).optional(),
  body: nonEmptyText(100_000),
  color: z.enum(['amber', 'blue', 'green', 'rose']),
}).strict().superRefine(requireCompleteTombstone);
export type Note = z.infer<typeof NoteSchema>;

export const MessageContextSchema = z.object({
  tab: z.enum(['brief', 'sections', 'visuals', 'equations', 'ledger', 'notes', 'sources']),
  page: z.number().int().min(1).max(100_000).optional(),
  section: boundedText(500).optional(),
  selectedText: boundedText(15_000).optional(),
}).strict();
export type MessageContext = z.infer<typeof MessageContextSchema>;

export const ResearchMessageSchema = z.object({
  ...entityStampShape,
  paperId: entityId,
  role: z.enum(['user', 'assistant']),
  content: nonEmptyText(75_000),
  context: MessageContextSchema,
  citations: z.array(EvidenceRefSchema).max(200),
  grounded: z.boolean().optional(),
  uncertainty: boundedText(10_000).optional(),
  responseId: boundedText(512).optional(),
  model: boundedText(200).optional(),
}).strict().superRefine(requireCompleteTombstone);
export type ResearchMessage = z.infer<typeof ResearchMessageSchema>;

export const ResearchProfileSchema = z.object({
  email: z.string().email().max(320),
  displayName: boundedText(500),
  photoURL: optionalHttpsUrl,
  onboardingComplete: z.boolean(),
  updatedAt: isoDateTime,
}).strict();
export type ResearchProfile = z.infer<typeof ResearchProfileSchema>;

export const ResearchSettingsSchema = z.object({
  theme: z.enum(['system', 'light', 'dark']),
  readerWidth: z.enum(['comfortable', 'wide', 'full']),
  defaultZoom: z.number().finite().min(0.5).max(4),
  autoAnalyze: z.boolean(),
  rememberChat: z.boolean(),
  updatedAt: isoDateTime,
}).strict();
export type ResearchSettings = z.infer<typeof ResearchSettingsSchema>;

export const ResearchStateSchema = z.object({
  version: z.literal(RESEARCH_STATE_VERSION),
  profile: ResearchProfileSchema,
  settings: ResearchSettingsSchema,
  papers: z.array(PaperSchema).max(5_000),
  notes: z.array(NoteSchema).max(50_000),
  messages: z.array(ResearchMessageSchema).max(100_000),
}).strict();
export type ResearchState = z.infer<typeof ResearchStateSchema>;

export function parseResearchState(value: unknown): ResearchState {
  return ResearchStateSchema.parse(value);
}

export interface CreateIdFactoryOptions {
  now?: () => number;
  random?: () => number;
}

function normalizePrefix(prefix: string): string {
  const normalized = prefix.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return normalized || 'item';
}

export function createIdFactory(options: CreateIdFactoryOptions = {}): (prefix?: string) => string {
  const now = options.now ?? Date.now;
  const random = options.random ?? Math.random;
  let sequence = 0;
  return (prefix = 'item') => {
    sequence = (sequence + 1) % 1_679_616;
    const time = Math.max(0, Math.floor(now())).toString(36);
    const entropy = Math.floor(Math.max(0, Math.min(0.999999999999, random())) * 2_176_782_336)
      .toString(36)
      .padStart(6, '0');
    return `${normalizePrefix(prefix)}_${time}_${entropy}${sequence.toString(36).padStart(4, '0')}`;
  };
}

export const createId = createIdFactory();

export function createStarterState(now = new Date(0).toISOString()): ResearchState {
  return {
    version: RESEARCH_STATE_VERSION,
    profile: {
      email: RESEARCH_ADMIN_EMAIL,
      displayName: '',
      onboardingComplete: false,
      updatedAt: now,
    },
    settings: {
      theme: 'system',
      readerWidth: 'comfortable',
      defaultZoom: 1,
      autoAnalyze: false,
      rememberChat: true,
      updatedAt: now,
    },
    papers: [],
    notes: [],
    messages: [],
  };
}

export function isTombstoned(entity: { deleted?: true }): boolean {
  return entity.deleted === true;
}
