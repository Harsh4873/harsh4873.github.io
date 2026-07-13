export type WorkspaceTab = 'brief' | 'sections' | 'visuals' | 'equations' | 'ledger' | 'notes' | 'sources';

export type AnalysisStage = 'local' | 'queued' | 'uploading' | 'analyzing' | 'ready' | 'error';

export interface EvidenceRef {
  page: number;
  label?: string;
  quote?: string;
}

export interface UiFinding {
  id: string;
  title: string;
  detail: string;
  evidence: EvidenceRef[];
  confidence?: 'high' | 'medium' | 'low';
}

export interface UiSection {
  id: string;
  heading: string;
  summary: string;
  takeaway?: string;
  startPage?: number;
  endPage?: number;
  evidence: EvidenceRef[];
}

export interface UiVisual {
  id: string;
  kind: 'figure' | 'table';
  label: string;
  title: string;
  explanation: string;
  whyItMatters?: string;
  page: number;
  evidence: EvidenceRef[];
}

export interface UiEquation {
  id: string;
  label: string;
  expression?: string;
  explanation: string;
  variables?: Array<{ symbol: string; meaning: string }>;
  page: number;
  evidence: EvidenceRef[];
}

export interface UiLedgerItem {
  id: string;
  claim: string;
  interpretation?: string;
  caveat?: string;
  confidence: 'high' | 'medium' | 'low';
  evidence: EvidenceRef[];
}

export interface UiReference {
  id: string;
  title: string;
  authors?: string[];
  year?: number;
  venue?: string;
  doi?: string;
  url?: string;
  citedPages?: number[];
}

export interface UiSummary {
  oneLine: string;
  overview: string;
  abstractSummary?: string;
  researchQuestion?: string;
  methods?: string;
  methodItems?: UiFinding[];
  keyFindings: UiFinding[];
  sections: UiSection[];
  visuals: UiVisual[];
  equations: UiEquation[];
  ledger: UiLedgerItem[];
  limitations: UiFinding[];
  glossary: Array<{ term: string; definition: string; evidence?: EvidenceRef[] }>;
  references: UiReference[];
  synthesis?: {
    contribution?: string;
    novelty?: string;
    implications: string[];
    openQuestions: string[];
  };
  warnings?: string[];
}

export interface UiPaper {
  id: string;
  title: string;
  authors: string[];
  year?: number;
  doi?: string;
  sourceUrl?: string;
  pageCount?: number;
  fileName: string;
  fileSize: number;
  storageKey: string;
  availableLocal: boolean;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt?: string;
  analysisStatus: AnalysisStage;
  analysisProgress?: number;
  analysisError?: string;
  openaiFileId?: string;
  summary?: UiSummary;
}

export interface UiNote {
  id: string;
  paperId: string;
  body: string;
  page?: number;
  section?: string;
  createdAt: string;
  updatedAt: string;
}

export interface UiMessage {
  id: string;
  paperId: string;
  role: 'user' | 'assistant';
  content: string;
  citations: EvidenceRef[];
  grounded?: boolean;
  uncertainty?: string;
  createdAt: string;
  context?: {
    tab?: WorkspaceTab;
    page?: number;
    selectedText?: string;
  };
}

export interface PdfOutlineItem {
  title: string;
  page?: number;
  depth: number;
}

export interface PdfSearchHit {
  page: number;
  excerpt: string;
  matches: number;
}

export interface ReaderContext {
  tab: WorkspaceTab;
  page: number;
  selectedText: string;
}

export const EMPTY_SUMMARY: UiSummary = {
  oneLine: '',
  overview: '',
  keyFindings: [],
  sections: [],
  visuals: [],
  equations: [],
  ledger: [],
  limitations: [],
  glossary: [],
  references: [],
  methodItems: [],
  synthesis: { implications: [], openQuestions: [] },
  warnings: [],
};
