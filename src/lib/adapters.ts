import type { Note, Paper, PaperAnalysis, ResearchMessage } from '../model';
import type {
  EvidenceRef,
  UiLedgerItem,
  UiMessage,
  UiNote,
  UiPaper,
  UiReference,
  UiSummary,
} from './ui-types';

function stableId(prefix: string, index: number) {
  return `${prefix}-${index + 1}`;
}

function evidence(page: number, quote?: string, label?: string): EvidenceRef[] {
  return [{ page, quote: quote?.trim() || undefined, label }];
}

function firstSentence(text: string) {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (!compact) return '';
  const sentence = compact.match(/^.+?[.!?](?:\s|$)/)?.[0]?.trim();
  return sentence || (compact.length > 220 ? `${compact.slice(0, 217).trimEnd()}…` : compact);
}

export function analysisToUi(analysis: PaperAnalysis): UiSummary {
  const visuals = [
    ...analysis.figures.map((figure, index) => ({
      id: stableId('figure', index),
      kind: 'figure' as const,
      label: figure.label || `Figure ${index + 1}`,
      title: figure.title || figure.keyTakeaway || `Figure ${index + 1}`,
      explanation: figure.description || figure.interpretation,
      whyItMatters: figure.keyTakeaway || figure.interpretation,
      page: figure.page,
      evidence: evidence(figure.page, figure.evidence.quote, figure.label || undefined),
    })),
    ...analysis.tables.map((table, index) => ({
      id: stableId('table', index),
      kind: 'table' as const,
      label: table.label || `Table ${index + 1}`,
      title: table.title || table.keyTakeaway || `Table ${index + 1}`,
      explanation: table.description || table.interpretation,
      whyItMatters: table.keyTakeaway || table.interpretation,
      page: table.page,
      evidence: evidence(table.page, table.evidence.quote, table.label || undefined),
    })),
  ].sort((left, right) => left.page - right.page);

  const references: UiReference[] = analysis.references.map((reference, index) => ({
    id: stableId('reference', index),
    title: reference.citation,
    doi: reference.doi ?? undefined,
    url: reference.url ?? undefined,
    citedPages: [reference.page],
  }));

  const ledger: UiLedgerItem[] = analysis.sourceLedger.map((entry) => ({
    id: entry.id,
    claim: entry.claim || entry.title,
    interpretation: entry.paraphrase || undefined,
    caveat: entry.context || undefined,
    confidence: entry.confidence,
    evidence: evidence(entry.page, entry.quote, entry.title),
  }));

  return {
    oneLine: firstSentence(analysis.abstractSummary || analysis.overview),
    overview: analysis.overview,
    abstractSummary: analysis.abstractSummary || undefined,
    researchQuestion: analysis.researchQuestion || undefined,
    methods: analysis.methods.map((method) => `${method.name}: ${method.description}`).join('\n\n') || undefined,
    methodItems: analysis.methods.map((method, index) => ({
      id: stableId('method', index),
      title: method.name,
      detail: method.description,
      evidence: evidence(method.page, method.evidence.quote, 'Method'),
      confidence: 'high',
    })),
    keyFindings: analysis.keyFindings.map((finding, index) => ({
      id: stableId('finding', index),
      title: finding.claim,
      detail: finding.importance || finding.certainty,
      evidence: evidence(finding.page, finding.evidence.quote, 'Finding'),
      confidence: finding.certainty.toLocaleLowerCase().includes('low') ? 'low'
        : finding.certainty.toLocaleLowerCase().includes('moderate') ? 'medium' : 'high',
    })),
    sections: analysis.sectionSummaries.map((section, index) => ({
      id: stableId('section', index),
      heading: section.heading,
      summary: section.summary,
      takeaway: section.keyPoints[0],
      startPage: section.startPage,
      endPage: section.endPage,
      evidence: section.evidence.map((item) => ({ page: item.page, quote: item.quote, label: section.heading })),
    })),
    visuals,
    equations: analysis.equations.map((equation, index) => ({
      id: stableId('equation', index),
      label: equation.label || `Equation ${index + 1}`,
      expression: equation.latex || undefined,
      explanation: equation.plainLanguage || equation.role,
      variables: equation.variables,
      page: equation.page,
      evidence: evidence(equation.page, equation.evidence.quote, equation.label || undefined),
    })),
    ledger,
    limitations: analysis.limitations.map((limitation, index) => ({
      id: stableId('limitation', index),
      title: limitation.limitation,
      detail: limitation.impact,
      evidence: evidence(limitation.page, limitation.evidence.quote, 'Limitation'),
      confidence: 'high',
    })),
    glossary: analysis.glossary.map((entry) => ({
      term: entry.term,
      definition: entry.definition,
      evidence: evidence(entry.page, undefined, 'Glossary'),
    })),
    references,
    synthesis: {
      contribution: analysis.synthesis.contribution || undefined,
      novelty: analysis.synthesis.novelty || undefined,
      implications: analysis.synthesis.implications,
      openQuestions: analysis.synthesis.openQuestions,
    },
    warnings: analysis.warnings,
  };
}

export function paperToUi(paper: Paper, availableLocal: boolean): UiPaper {
  return {
    id: paper.id,
    title: paper.title,
    authors: paper.authors,
    year: paper.year,
    doi: paper.doi,
    sourceUrl: paper.sourceUrl,
    pageCount: paper.pageCount,
    fileName: paper.file.name,
    fileSize: paper.file.sizeBytes,
    storageKey: paper.file.storageKey,
    availableLocal,
    createdAt: paper.createdAt,
    updatedAt: paper.updatedAt,
    lastOpenedAt: paper.lastOpenedAt,
    analysisStatus: paper.analysisStatus,
    analysisProgress: paper.analysisProgress,
    analysisError: paper.analysisError,
    openaiFileId: paper.openaiFileId,
    summary: paper.summary ? analysisToUi(paper.summary) : undefined,
  };
}

export function noteToUi(note: Note): UiNote {
  return {
    id: note.id,
    paperId: note.paperId,
    body: note.body,
    page: note.page,
    section: note.section,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  };
}

export function messageToUi(message: ResearchMessage): UiMessage {
  return {
    id: message.id,
    paperId: message.paperId,
    role: message.role,
    content: message.content,
    citations: message.citations.map(({ page, label, quote }) => ({ page, label, quote })),
    grounded: message.grounded,
    uncertainty: message.uncertainty,
    createdAt: message.createdAt,
    context: {
      tab: message.context.tab,
      page: message.context.page,
      selectedText: message.context.selectedText,
    },
  };
}
