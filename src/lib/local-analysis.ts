import { PaperAnalysisSchema, type PaperAnalysis } from '../model';

/** Text-only page input shared by the browser adapter and the source-only evaluator. */
export interface ExtractedResearchPage {
  page: number;
  text: string;
  lines?: readonly string[];
}

export interface LocalPaperAnalysisInput {
  pages: readonly ExtractedResearchPage[];
  title?: string;
  fileName?: string;
  metadata?: {
    title?: string;
    author?: string;
    subject?: string;
    year?: number;
    venue?: string;
    doi?: string;
    url?: string;
  };
  outline?: readonly { title: string; page?: number; depth?: number }[];
}

interface CleanPage {
  page: number;
  lines: string[];
  text: string;
}

interface LineRecord {
  page: number;
  line: string;
  index: number;
}

interface SectionRecord {
  heading: string;
  kind: SectionKind;
  startPage: number;
  endPage: number;
  startIndex: number;
  endIndex: number;
  lines: LineRecord[];
}

interface SentenceRecord {
  text: string;
  page: number;
  section: string;
  sectionKind: SectionKind;
  sourceIndex: number;
  position: number;
  tokens: string[];
  score: number;
}

type SectionKind =
  | 'abstract'
  | 'introduction'
  | 'background'
  | 'methods'
  | 'results'
  | 'discussion'
  | 'conclusion'
  | 'limitations'
  | 'references'
  | 'appendix'
  | 'other';

const STOP_WORDS = new Set(`
  a about above after again against all also am an and any are as at be because been before being below
  between both but by can could did do does doing down during each few for from further had has have having
  he her here hers herself him himself his how i if in into is it its itself just may me might more most must
  my myself no nor not of off on once only or other our ours ourselves out over own same she should so some
  such than that the their theirs them themselves then there these they this those through to too under until
  up very was we were what when where which while who whom why will with would you your yours yourself
  paper study work approach method methods result results figure figures table tables section equation using
  used use based show shows shown propose proposed provide provides however therefore thus respectively et al
`.trim().split(/\s+/));

const CANONICAL_HEADINGS: Array<[RegExp, SectionKind]> = [
  [/^(?:executive\s+)?abstract$/i, 'abstract'],
  [/^(?:\d+(?:\.\d+)*\s+)?(?:introduction|motivation|overview)$/i, 'introduction'],
  [/^(?:\d+(?:\.\d+)*\s+)?(?:background|related\s+work|prior\s+work|literature\s+review|preliminaries)$/i, 'background'],
  [/^(?:\d+(?:\.\d+)*\s+)?(?:method(?:s|ology)?|materials\s+and\s+methods|experimental\s+setup|study\s+design|data(?:set)?|model|approach|algorithm|training|implementation(?:\s+details)?)$/i, 'methods'],
  [/^(?:\d+(?:\.\d+)*\s+)?(?:result(?:s)?|experiment(?:s)?|evaluation|analysis|findings|ablation(?:\s+study)?|performance)$/i, 'results'],
  [/^(?:\d+(?:\.\d+)*\s+)?(?:discussion|interpretation|implications)$/i, 'discussion'],
  [/^(?:\d+(?:\.\d+)*\s+)?(?:conclusion(?:s)?|summary|concluding\s+remarks)$/i, 'conclusion'],
  [/^(?:\d+(?:\.\d+)*\s+)?(?:limitations?|threats\s+to\s+validity|caveats)$/i, 'limitations'],
  [/^(?:references|bibliography|works\s+cited)$/i, 'references'],
  [/^(?:appendix|appendices|supplement(?:ary\s+(?:material|information))?)(?:\s+[a-z0-9].*)?$/i, 'appendix'],
];

const RESULT_CUES = /\b(?:achiev(?:e|es|ed)|improv(?:e|es|ed|ement)|outperform(?:s|ed)?|result(?:s)?|find(?:s|ing|ings|found)|demonstrat(?:e|es|ed)|increase(?:s|d)?|decrease(?:s|d)?|reduc(?:e|es|ed|tion)|significant(?:ly)?|accuracy|precision|recall|score|error|effect|correlat(?:e|es|ed|ion)|higher|lower|better|worse|compared|versus|state[- ]of[- ]the[- ]art)\b/i;
const METHOD_CUES = /\b(?:we (?:use|train|evaluate|measure|estimate|sample|collect|compare|implement)|dataset|participants?|subjects?|procedure|protocol|architecture|algorithm|optimizer|baseline|random(?:ized|ly)?|experiment|training|evaluation|corpus|model)\b/i;
const LIMITATION_CUES = /\b(?:limitation|caveat|future work|further work|remains? (?:unclear|unknown|to be)|cannot|could not|may not|might not|does not|do not|restricted to|limited to|only evaluate|however|uncertain|threat to validity|generaliz(?:e|es|ation))\b/i;
const CONTRIBUTION_CUES = /\b(?:we (?:introduce|present|propose|develop|contribute)|our (?:main )?contribution|this (?:paper|work) (?:introduces|presents|proposes|develops)|novel|new (?:method|model|approach|framework|architecture|dataset))\b/i;
const QUESTION_CUES = /\b(?:we (?:ask|investigate|examine|study|test|evaluate|aim|seek)|research question|objective|purpose|whether|how (?:can|does|do|well)|to determine)\b/i;
const FUTURE_CUES = /\b(?:future work|further (?:study|research|work)|open question|remains? to be|should investigate|could explore)\b/i;
const MAX_LOCAL_ANALYSIS_BYTES = 700_000;

function compact(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function bounded(value: string, maximum: number): string {
  const clean = compact(value);
  if (clean.length <= maximum) return clean;
  return `${clean.slice(0, Math.max(1, maximum - 1)).trimEnd()}…`;
}

function dedupe<T>(items: readonly T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const identity = key(item);
    if (!identity || seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

function normalizedKey(value: string): string {
  return compact(value).toLocaleLowerCase('en-US').replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Repairs common PDF small-caps extraction such as `R EFERENCES` and `A LGORITHM`. */
function despaceHeading(value: string): string {
  let result = compact(value);
  for (let pass = 0; pass < 3; pass += 1) {
    result = result.replace(/\b([A-Z])\s+(?=[A-Z]{2,}\b)/g, '$1');
  }
  return result;
}

function normalizeDoi(value?: string): string | null {
  if (!value) return null;
  const match = compact(value).match(/10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i)?.[0];
  return match ? match.replace(/[.,;:)\]}]+$/g, '').slice(0, 512) : null;
}

function httpsUrl(value?: string): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' ? parsed.href.slice(0, 2_048) : null;
  } catch {
    return null;
  }
}

function cleanInputPages(input: readonly ExtractedResearchPage[]): CleanPage[] {
  const unique = new Map<number, string[]>();
  [...input]
    .filter((page) => Number.isInteger(page.page) && page.page >= 1 && page.page <= 100_000)
    .sort((left, right) => left.page - right.page)
    .forEach((page) => {
      if (unique.has(page.page)) return;
      const source = page.lines?.length ? page.lines : page.text.split(/\r?\n/);
      const lines = source.map((line) => bounded(line, 2_000)).filter(Boolean);
      unique.set(page.page, lines.length ? lines : [bounded(page.text, 50_000)].filter(Boolean));
    });

  const pages = [...unique.entries()].map(([page, lines]) => ({ page, lines, text: lines.join(' ') }));
  if (pages.length < 3) return pages;

  // Repeated running headers/footers pollute rankings and can look like section headings.
  const frequency = new Map<string, Set<number>>();
  pages.forEach((page) => {
    [...page.lines.slice(0, 3), ...page.lines.slice(-3)].forEach((line) => {
      const key = normalizedKey(line.replace(/\b(?:page\s*)?\d+\b/gi, '#'));
      if (key.length < 4 || key.length > 160) return;
      const locations = frequency.get(key) ?? new Set<number>();
      locations.add(page.page);
      frequency.set(key, locations);
    });
  });
  const threshold = Math.max(3, Math.ceil(pages.length * 0.34));
  const repeated = new Set([...frequency].filter(([, locations]) => locations.size >= threshold).map(([key]) => key));

  return pages.map((page) => {
    const lines = page.lines.filter((line, index) => {
      if (index >= 3 && index < page.lines.length - 3) return true;
      const key = normalizedKey(line.replace(/\b(?:page\s*)?\d+\b/gi, '#'));
      return !repeated.has(key) && !/^\s*(?:page\s+)?\d+\s*$/i.test(line);
    });
    return { page: page.page, lines, text: lines.join(' ') };
  });
}

function sectionKind(heading: string): SectionKind {
  const repaired = despaceHeading(heading);
  const normalized = repaired.replace(/^(?:section\s+)?(?:[ivxlcdm]+|\d+(?:\.\d+)*|[a-z])(?:[.):\s-]+)+/i, '');
  for (const [pattern, kind] of CANONICAL_HEADINGS) {
    if (pattern.test(normalized) || pattern.test(repaired)) return kind;
  }
  if (/\b(?:method|algorithm|model|data|training|setup|implementation|architecture)\b/i.test(normalized)) return 'methods';
  if (/\b(?:result|experiment|evaluation|analysis|finding|ablation|performance)\b/i.test(normalized)) return 'results';
  if (/\b(?:discussion|implication)\b/i.test(normalized)) return 'discussion';
  if (/\b(?:conclusion|summary)\b/i.test(normalized)) return 'conclusion';
  if (/\b(?:limitation|validity|caveat)\b/i.test(normalized)) return 'limitations';
  if (/\b(?:reference|bibliograph)\b/i.test(normalized)) return 'references';
  if (/\b(?:appendix|supplement)\b/i.test(normalized)) return 'appendix';
  if (/\b(?:background|related|prior|preliminar)\b/i.test(normalized)) return 'background';
  if (/\b(?:introduction|motivation|overview)\b/i.test(normalized)) return 'introduction';
  return 'other';
}

function looksLikeHeading(line: string): boolean {
  const value = despaceHeading(line);
  if (!value || value.length > 130 || value.split(/\s+/).length > 15) return false;
  if (/^(?:fig(?:ure)?|table|algorithm|equation|theorem|lemma|proof)\s*[.:\d]/i.test(value)) return false;
  if (/^(?:19|20)\d{2}\b/.test(value) || /[.!?,;]$/.test(value) || /\b(?:doi|https?:|@)\b/i.test(value)) return false;
  const letters = (value.match(/[A-Za-z]/g) ?? []).length;
  if (letters / Math.max(1, value.length) < 0.42 || /[=∑∏∫√∞∂∇]{2,}/.test(value)) return false;
  const words = value.match(/[A-Za-z][A-Za-z0-9'-]*/g) ?? [];
  if (words.length >= 6 && new Set(words.map((word) => word.toLocaleLowerCase())).size / words.length < 0.5) return false;
  if (/^\d{1,3}[.):]?\s+(?:we|the|this|that|these|those|for|in|as|note)\b/i.test(value)) return false;
  if (CANONICAL_HEADINGS.some(([pattern]) => pattern.test(value))) return true;
  if (/^[A-Z]\.\d+(?:\.\d+)*\s+[A-Z][^.!?]{1,105}$/u.test(value)) return true;
  if (/^(?:\d{1,3}(?:\.\d{1,3}){0,4}|[IVXLCDM]+|[A-Z])(?:[.):]|\s+-|\s+)\s*[A-Z][^.!?]{1,110}$/u.test(value)) return true;
  return false;
}

function flattenLines(pages: readonly CleanPage[]): LineRecord[] {
  let index = 0;
  return pages.flatMap((page) => page.lines.map((line) => ({ page: page.page, line, index: index++ })));
}

function buildSections(
  pages: readonly CleanPage[],
  outline: LocalPaperAnalysisInput['outline'],
): { sections: SectionRecord[]; lines: LineRecord[] } {
  const lines = flattenLines(pages);
  if (!lines.length) return { sections: [], lines };
  const headings: Array<{ heading: string; page: number; index: number; kind: SectionKind }> = [];

  lines.forEach((record) => {
    if (!looksLikeHeading(record.line)) return;
    const heading = bounded(despaceHeading(record.line), 500);
    headings.push({ heading, page: record.page, index: record.index, kind: sectionKind(heading) });
  });

  outline?.forEach((item) => {
    const heading = bounded(item.title, 500);
    if (!heading || !item.page || item.page < pages[0].page || item.page > pages.at(-1)!.page) return;
    const page = item.page;
    const nearest = lines.find((line) => line.page >= page)?.index ?? lines.at(-1)!.index;
    if (!headings.some((candidate) => normalizedKey(candidate.heading) === normalizedKey(heading) && Math.abs(candidate.page - page) <= 1)) {
      headings.push({ heading, page, index: Math.max(-1, nearest - 0.5), kind: sectionKind(heading) });
    }
  });

  const abstractLine = lines.find((record) => /^abstract\b/i.test(compact(record.line)));
  if (abstractLine && !headings.some((heading) => heading.kind === 'abstract')) {
    const inlineAbstract = !/^abstract\s*[:.]?$/i.test(compact(abstractLine.line));
    headings.push({ heading: 'Abstract', page: abstractLine.page, index: abstractLine.index - (inlineAbstract ? 0.5 : 0), kind: 'abstract' });
  }

  const ordered = dedupe(
    headings.sort((left, right) => left.index - right.index || left.heading.localeCompare(right.heading)),
    (heading) => `${heading.index}:${normalizedKey(heading.heading)}`,
  ).filter((heading, index, all) => index === 0 || heading.index !== all[index - 1].index || heading.kind !== all[index - 1].kind);

  if (!ordered.length) {
    const chunkSize = Math.max(1, Math.ceil(pages.length / 30));
    const pageChunks = Array.from({ length: Math.ceil(pages.length / chunkSize) }, (_, index) => {
      const chunk = pages.slice(index * chunkSize, (index + 1) * chunkSize);
      const chunkPages = new Set(chunk.map((page) => page.page));
      const pageLines = lines.filter((line) => chunkPages.has(line.page));
      const startPage = chunk[0]?.page ?? pages[0].page;
      const endPage = chunk.at(-1)?.page ?? startPage;
      return {
        heading: pages.length === 1 ? 'Document text' : `Pages ${startPage}–${endPage}`,
        kind: 'other' as const,
        startPage,
        endPage,
        startIndex: pageLines[0]?.index ?? 0,
        endIndex: pageLines.at(-1)?.index ?? 0,
        lines: pageLines,
      };
    });
    return { sections: pageChunks, lines };
  }

  // Preserve meaningful text before the first detected heading as front matter.
  if (ordered[0].index > 2) {
    ordered.unshift({ heading: 'Front matter', page: pages[0].page, index: 0, kind: 'other' });
  }

  const sections = ordered.slice(0, 80).map((heading, position, all): SectionRecord => {
    const next = all[position + 1];
    const startIndex = heading.index;
    const endIndex = next ? Math.max(startIndex, next.index - 1) : lines.at(-1)!.index;
    const content = lines.filter((line) => line.index > startIndex && line.index <= endIndex);
    return {
      heading: heading.heading,
      kind: heading.kind,
      startPage: heading.page,
      endPage: content.at(-1)?.page ?? heading.page,
      startIndex,
      endIndex,
      lines: content,
    };
  });
  return { sections: sections.filter((section) => section.lines.length || section.kind === 'abstract'), lines };
}

function stem(token: string): string {
  let value = token.toLocaleLowerCase('en-US').replace(/^['’]+|['’]+$/g, '');
  if (value.length > 5) value = value.replace(/(?:ization|ational|fulness|ousness|iveness|tional|biliti|lessli|entli|ation|alism|aliti|ousli|iviti|fulli|enci|anci|abli|izer|ator|alli|bli)$/i, '');
  if (value.length > 4) value = value.replace(/(?:ingly|edly|ments?|ness|able|ible|tion|sion|ings?|edly|edly|ed|ly)$/i, '');
  if (value.length > 3) value = value.replace(/(?:ies|sses|s)$/i, (suffix) => suffix === 'ies' ? 'y' : suffix === 'sses' ? 'ss' : '');
  return value;
}

function tokens(value: string): string[] {
  return (value.toLocaleLowerCase('en-US').match(/[a-z][a-z0-9'-]{2,}/g) ?? [])
    .map(stem)
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
}

function splitSentences(lines: readonly LineRecord[], section: SectionRecord): SentenceRecord[] {
  const records: SentenceRecord[] = [];
  let buffer = '';
  let bufferPage = section.startPage;
  let bufferSourceIndex = section.startIndex;

  const emit = (raw: string) => {
    const text = bounded(raw.replace(/\s+([,.;:!?])/g, '$1'), 1_400);
    if (text.length < 28 || tokens(text).length < 3) return;
    records.push({
      text,
      page: bufferPage,
      section: section.heading,
      sectionKind: section.kind,
      sourceIndex: bufferSourceIndex,
      position: records.length,
      tokens: tokens(text),
      score: 0,
    });
  };

  for (const record of lines) {
    const line = compact(record.line);
    if (!line) continue;
    if (looksLikeHeading(line) || /^(?:fig(?:ure)?|table)\s*\d+/i.test(line)) {
      if (buffer) emit(buffer);
      buffer = '';
      continue;
    }
    // Never let a sentence receipt inherit the next page merely because PDF
    // extraction omitted punctuation at the physical page boundary.
    if (buffer && record.page !== bufferPage) {
      emit(buffer);
      buffer = '';
    }
    if (!buffer) {
      bufferPage = record.page;
      bufferSourceIndex = record.index;
    }
    buffer = buffer ? `${buffer} ${line}` : line;

    const pieces = buffer.split(/(?<=[.!?])\s+(?=(?:[A-Z0-9“"'([]|We\b|The\b|This\b|Our\b))/u);
    buffer = pieces.pop() ?? '';
    pieces.forEach(emit);
    if (pieces.length && buffer) bufferSourceIndex = record.index;
    if (buffer.length > 1_500) {
      const breakAt = Math.max(buffer.lastIndexOf(';', 1_100), buffer.lastIndexOf(',', 1_100), 700);
      emit(buffer.slice(0, breakAt + 1));
      buffer = buffer.slice(breakAt + 1).trim();
    }
  }
  emit(buffer);
  return records;
}

function scoreSentences(sentences: SentenceRecord[]): SentenceRecord[] {
  if (!sentences.length) return sentences;
  const documentFrequency = new Map<string, number>();
  sentences.forEach((sentence) => {
    new Set(sentence.tokens).forEach((token) => documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1));
  });
  const termFrequency = new Map<string, number>();
  sentences.forEach((sentence) => sentence.tokens.forEach((token) => termFrequency.set(token, (termFrequency.get(token) ?? 0) + 1)));
  let maxTermFrequency = 1;
  termFrequency.forEach((frequency) => { if (frequency > maxTermFrequency) maxTermFrequency = frequency; });
  const sentenceCount = sentences.length;

  sentences.forEach((sentence) => {
    const unique = new Set(sentence.tokens);
    const lexical = [...unique].reduce((score, token) => {
      const tf = Math.sqrt((termFrequency.get(token) ?? 1) / maxTermFrequency);
      const idf = Math.log(1 + sentenceCount / (1 + (documentFrequency.get(token) ?? 1)));
      return score + tf * idf;
    }, 0) / Math.sqrt(Math.max(1, unique.size));
    const position = sentence.position === 0 ? 0.7 : sentence.position <= 2 ? 0.35 : 0;
    const section = sentence.sectionKind === 'abstract' ? 1.6
      : sentence.sectionKind === 'results' ? 1.15
        : sentence.sectionKind === 'conclusion' ? 1
          : sentence.sectionKind === 'methods' ? 0.65
            : sentence.sectionKind === 'references' ? -4 : 0.25;
    const cues = RESULT_CUES.test(sentence.text) ? 0.9 : CONTRIBUTION_CUES.test(sentence.text) ? 0.75 : 0;
    const numeric = /\b\d+(?:\.\d+)?\s*(?:%|percent|BLEU|F1|points?|times?|×)?\b/i.test(sentence.text) ? 0.45 : 0;
    const penalty = sentence.text.length < 45 ? 0.7 : sentence.text.length > 850 ? 0.4 : 0;
    sentence.score = lexical + position + section + cues + numeric - penalty;
  });
  return sentences;
}

function similarity(left: SentenceRecord, right: SentenceRecord): number {
  const a = new Set(left.tokens);
  const b = new Set(right.tokens);
  let overlap = 0;
  a.forEach((token) => { if (b.has(token)) overlap += 1; });
  return overlap / Math.max(1, a.size + b.size - overlap);
}

function selectSentences(
  source: readonly SentenceRecord[],
  count: number,
  predicate: (sentence: SentenceRecord) => boolean = () => true,
  requirePageDiversity = false,
): SentenceRecord[] {
  const candidates = source.filter(predicate).sort((left, right) => right.score - left.score || left.sourceIndex - right.sourceIndex);
  const selected: SentenceRecord[] = [];
  for (const candidate of candidates) {
    if (selected.length >= count) break;
    if (selected.some((item) => normalizedKey(item.text) === normalizedKey(candidate.text))) continue;
    if (selected.some((item) => similarity(item, candidate) > 0.72)) continue;
    if (requirePageDiversity && selected.filter((item) => item.page === candidate.page).length >= 2) continue;
    selected.push(candidate);
  }
  return selected;
}

function evidence(sentence: SentenceRecord, context?: string) {
  return {
    quote: bounded(sentence.text, 1_000),
    paraphrase: 'Local Analysis retained an extract from the paper; verify nuance in the page receipt.',
    context: bounded(context ?? `Extracted from ${sentence.section} on page ${sentence.page}.`, 2_000),
  };
}

function extractTitle(input: LocalPaperAnalysisInput, pages: readonly CleanPage[]): string {
  const candidates = [input.title, input.metadata?.title, input.fileName?.replace(/\.pdf$/i, '')]
    .map((item) => bounded(item ?? '', 1_000))
    .filter((item) => item && !/^(?:untitled|microsoft word|arxiv)$/i.test(item));
  if (candidates[0]) return candidates[0];
  const front = pages[0]?.lines.find((line) => line.length >= 8 && line.length <= 240 && !/^(?:arxiv|abstract|page\s+\d+)/i.test(line));
  return bounded(front || 'Untitled research paper', 1_000);
}

function extractAuthors(input: LocalPaperAnalysisInput, title: string, pages: readonly CleanPage[]): string[] {
  const metadata = compact(input.metadata?.author ?? '');
  if (metadata && !/^(?:unknown|anonymous|none)$/i.test(metadata)) {
    return dedupe(metadata.split(/\s*(?:;|\||\band\b)\s*|,(?=\s*[A-Z][a-z]+\s+[A-Z])/).map((author) => bounded(author, 500)).filter(Boolean), normalizedKey).slice(0, 100);
  }
  const first = pages[0]?.lines ?? [];
  const titleIndex = first.findIndex((line) => normalizedKey(line).includes(normalizedKey(title).slice(0, 30)));
  const candidates = first.slice(Math.max(0, titleIndex + 1), Math.max(0, titleIndex + 7))
    .filter((line) => line.length < 300 && !/@|\b(?:university|institute|department|abstract|arxiv|research|google|microsoft)\b/i.test(line));
  const likely = candidates.find((line) => /[A-Z][a-z]+\s+[A-Z][a-z]+/.test(line) && !/[.!?]$/.test(line));
  if (!likely) return [];
  return dedupe(likely.split(/\s*(?:,|;|\band\b)\s*/).map((author) => bounded(author.replace(/[∗*†‡\d]+$/g, ''), 500)).filter((author) => author.split(/\s+/).length >= 2), normalizedKey).slice(0, 100);
}

function extractYear(input: LocalPaperAnalysisInput, pages: readonly CleanPage[]): number | null {
  if (input.metadata?.year && input.metadata.year >= 1000 && input.metadata.year <= 3000) return input.metadata.year;
  const opening = pages.slice(0, 2).map((page) => page.text).join(' ');
  const years = [...opening.matchAll(/\b(?:19|20)\d{2}\b/g)].map((match) => Number(match[0]));
  return years[0] ?? null;
}

function paperType(title: string, sections: readonly SectionRecord[], allText: string): string {
  const value = `${title} ${sections.map((section) => section.heading).join(' ')} ${allText.slice(0, 4_000)}`;
  if (/\b(?:systematic review|meta-analysis)\b/i.test(value)) return 'systematic review';
  if (/\b(?:survey|review of|literature review)\b/i.test(title)) return 'review or survey';
  if (/\b(?:randomized controlled trial|randomised controlled trial|clinical trial)\b/i.test(value)) return 'experimental study';
  if (/\b(?:dataset|benchmark)\b/i.test(title) && /\b(?:introduce|present|release)\b/i.test(value)) return 'dataset or benchmark paper';
  if (/\b(?:algorithm|architecture|framework|model|method)\b/i.test(value)) return 'methods or systems paper';
  return 'research paper (locally inferred)';
}

function abstractText(sections: readonly SectionRecord[], sentences: readonly SentenceRecord[]): SentenceRecord[] {
  const explicit = sentences.filter((sentence) => sentence.sectionKind === 'abstract');
  if (explicit.length) return selectSentences(explicit, 4).sort((left, right) => left.sourceIndex - right.sourceIndex);
  const firstPage = sentences.reduce((minimum, sentence) => Math.min(minimum, sentence.page), sentences[0]?.page ?? 1);
  return selectSentences(sentences.filter((sentence) => sentence.page <= firstPage + 1 && sentence.sectionKind !== 'references'), 4)
    .sort((left, right) => left.sourceIndex - right.sourceIndex);
}

function extractCaptions(pages: readonly CleanPage[], kind: 'figure' | 'table') {
  const pattern = kind === 'figure'
    ? /^(fig(?:ure)?\s*[A-Z]?\d+[a-z]?)\s*([:.\-–—])?\s+(.+)$/i
    : /^(table\s*[A-Z]?\d+[a-z]?)\s*([:.\-–—])?\s+(.+)$/i;
  const result: Array<{ label: string; title: string; page: number; caption: string }> = [];
  pages.forEach((page) => {
    page.lines.forEach((line, index) => {
      const match = compact(line).match(pattern);
      if (!match) return;
      const captionLead = match[3];
      if (!match[2] && /^(?:shows?|illustrates?|presents?|compares?|reports?|lists?|contains?|is|are|we|in|see)\b/i.test(captionLead)) return;
      const continuation: string[] = [];
      for (let offset = 1; offset <= 2; offset += 1) {
        const next = compact(page.lines[index + offset] ?? '');
        if (!next || looksLikeHeading(next) || pattern.test(next) || /^(?:fig(?:ure)?|table)\s*\d+/i.test(next)) break;
        if (next.length <= 500) continuation.push(next);
        if (/[.!?]$/.test(next)) break;
      }
      const caption = bounded([captionLead, ...continuation].filter(Boolean).join(' '), 1_600);
      result.push({ label: bounded(match[1], 200), title: bounded(captionLead || match[1], 1_000), page: page.page, caption: caption || bounded(line, 1_600) });
    });
  });
  return dedupe(result, (item) => `${normalizedKey(item.label)}:${normalizedKey(item.caption)}`).slice(0, 60);
}

function equationCandidates(pages: readonly CleanPage[]) {
  const results: Array<{ line: string; page: number; label: string | null; nearby: string }> = [];
  pages.forEach((page) => {
    let unlabeledOnPage = 0;
    page.lines.forEach((raw, index) => {
      const line = compact(raw);
      if (line.length < 8 || line.length > 700) return;
      if (/^(?:fig(?:ure)?|table|algorithm)\s*\d+/i.test(line)) return;
      const labelMatch = line.match(/\(\s*(\d{1,3}[a-z]?)\s*\)\s*$/i);
      const operators = (line.match(/[=≈≃≤≥∑∏∫√∞∂∇±×÷→←∈∝]|\b(?:argmax|argmin|softmax|log|exp)\b/gi) ?? []).length;
      const symbols = (line.match(/\b[A-Za-z](?:_[A-Za-z0-9]+)?\b/g) ?? []).length;
      const proseWords = (line.match(/\b[a-z]{4,}\b/gi) ?? []).length;
      const strongOperators = (line.match(/[=≈≃≤≥∑∏∫√∞∂∇±×÷→←∈∝]/g) ?? []).length;
      if (!labelMatch && (strongOperators < 1 || operators < 2 || symbols < 2 || proseWords > 8 || unlabeledOnPage >= 4)) return;
      if (operators < 1 || symbols < 1 || (proseWords > 16 && operators < 3)) return;
      const nearby = [page.lines[index - 1], page.lines[index + 1]].map((item) => compact(item ?? '')).find((item) => /\b(?:where|denote|defined|equation|compute|given by|represents?)\b/i.test(item)) ?? '';
      results.push({ line: bounded(line, 1_200), page: page.page, label: labelMatch ? `Equation ${labelMatch[1]}` : null, nearby: bounded(nearby, 1_000) });
      if (!labelMatch) unlabeledOnPage += 1;
    });
  });
  return dedupe(results, (item) => compact(item.line.replace(/\(\s*\d{1,3}[a-z]?\s*\)\s*$/i, '')).toLocaleLowerCase().replace(/\s+/g, '')).slice(0, 60);
}

function variablesFromEquation(line: string, nearby: string): Array<{ symbol: string; meaning: string }> {
  const variables: Array<{ symbol: string; meaning: string }> = [];
  const definitions = nearby.matchAll(/\b([A-Za-z](?:_[A-Za-z0-9]+)?)\s+(?:is|denotes?|represents?)\s+([^,;.]{3,100})/g);
  for (const match of definitions) variables.push({ symbol: bounded(match[1], 500), meaning: bounded(match[2], 5_000) });
  if (!variables.length) {
    dedupe(line.match(/\b[A-Za-z](?:_[A-Za-z0-9]+)?\b/g) ?? [], (item) => item)
      .filter((item) => !/^(?:log|exp|max|min|sum)$/i.test(item))
      .slice(0, 8)
      .forEach((symbol) => variables.push({ symbol, meaning: 'Meaning not reliably recoverable from the nearby PDF text.' }));
  }
  return variables.slice(0, 20);
}

function extractGlossary(sentences: readonly SentenceRecord[]) {
  const entries: Array<{ term: string; definition: string; page: number }> = [];
  sentences.forEach((sentence) => {
    for (const match of sentence.text.matchAll(/\b([A-Z][A-Za-z-]+(?:\s+[A-Z][A-Za-z-]+){1,7})\s+\(([A-Z][A-Z0-9-]{1,12})\)/g)) {
      entries.push({ term: match[2], definition: bounded(`${match[1]}; expanded in the paper as “${match[0]}”.`, 10_000), page: sentence.page });
    }
    for (const match of sentence.text.matchAll(/\b([A-Z][A-Z0-9-]{1,12})\s+\(([A-Z][A-Za-z-]+(?:\s+[A-Za-z-]+){1,7})\)/g)) {
      entries.push({ term: match[1], definition: bounded(match[2], 10_000), page: sentence.page });
    }
    const definition = sentence.text.match(/\b(?:we define|defined as|refers to)\s+([^.;]{3,80})/i);
    if (definition) entries.push({ term: bounded(definition[1].split(/\s+(?:as|to)\s+/)[0], 500), definition: bounded(sentence.text, 10_000), page: sentence.page });
  });
  return dedupe(entries.filter((entry) => entry.term.length >= 2), (entry) => normalizedKey(entry.term)).slice(0, 80);
}

function referenceGroups(sections: readonly SectionRecord[], pages: readonly CleanPage[]) {
  const referenceSections = sections.filter((section) => section.kind === 'references');
  const lines = referenceSections.length
    ? referenceSections.flatMap((section) => section.lines)
    : (() => {
      const records = flattenLines(pages);
      const start = records.findIndex((record) => /^(?:references|bibliography|works cited)$/i.test(despaceHeading(record.line)));
      if (start >= 0) return records.slice(start + 1);
      // Conservative fallback for unmarked bibliographies: search only the
      // final 40% for repeated author/year-shaped entry starts.
      const tail = records.slice(Math.floor(records.length * 0.6));
      const firstLikely = tail.findIndex((record) => /^[A-Z][A-Za-z'’.-]+(?:,|\s+[A-Z]\.)/.test(compact(record.line)) && /\b(?:19|20)\d{2}[a-z]?\b/.test(record.line));
      return firstLikely >= 0 ? tail.slice(firstLikely) : [];
    })();
  if (!lines.length) return [];

  const groups: Array<{ page: number; lines: string[] }> = [];
  let current: { page: number; lines: string[] } | undefined;
  lines.forEach((record) => {
    const line = compact(record.line);
    if (!line || /^(?:appendix|supplement)/i.test(line)) return;
    if (current && current.page !== record.page) {
      groups.push(current);
      current = undefined;
    }
    const numbered = /^(?:\[\s*\d{1,4}\s*\]|\d{1,3}[.)]\s+)/.test(line);
    const authorYear = /^[A-Z][A-Za-z'’.-]+(?:,|\s+[A-Z]\.)/.test(line)
      && /\b(?:19|20)\d{2}[a-z]?\b/.test(line.slice(0, 260));
    const fullNameStart = /^(?:[A-Z][A-Za-z'’.-]+\s+){1,3}[A-Z][A-Za-z'’.-]+(?:,|\s+and\s+)/.test(line);
    const surnameFirstStart = /^[A-Z][A-Za-z'’.-]+,\s+[A-Z][A-Za-z'’.-]+(?:[ ,.\-]|$)/.test(line);
    if (numbered || authorYear || fullNameStart || surnameFirstStart) {
      if (current?.lines.length) groups.push(current);
      current = { page: record.page, lines: [line] };
    } else if (current && current.lines.join(' ').length < 2_500) {
      current.lines.push(line);
    }
  });
  if (current?.lines.length) groups.push(current);

  // If line layout hid entry starts, retain DOI/arXiv-bearing lines as conservative references.
  if (groups.length < 3) {
    lines.filter((record) => /\b(?:10\.\d{4,9}\/|arxiv:|https?:\/\/)\S+/i.test(record.line)).forEach((record) => {
      groups.push({ page: record.page, lines: [compact(record.line)] });
    });
  }
  return dedupe(groups, (group) => normalizedKey(group.lines.join(' '))).slice(0, 250);
}

function confidenceFor(sentence: SentenceRecord): 'high' | 'medium' | 'low' {
  if (RESULT_CUES.test(sentence.text) && /\d/.test(sentence.text)) return 'high';
  if (RESULT_CUES.test(sentence.text) || CONTRIBUTION_CUES.test(sentence.text)) return 'medium';
  return 'low';
}

function serializedBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

/** Leave headroom for the surrounding Paper record and future sync metadata. */
function fitAnalysisToSyncBudget(analysis: PaperAnalysis): PaperAnalysis {
  if (serializedBytes(analysis) <= MAX_LOCAL_ANALYSIS_BYTES) return analysis;
  const cap = <T>(items: T[], maximum: number) => {
    if (items.length <= maximum) return false;
    items.splice(maximum);
    return true;
  };
  let trimmed = false;
  trimmed = cap(analysis.references, 160) || trimmed;
  trimmed = cap(analysis.sourceLedger, 180) || trimmed;
  trimmed = cap(analysis.sectionSummaries, 35) || trimmed;
  trimmed = cap(analysis.equations, 50) || trimmed;
  trimmed = cap(analysis.figures, 50) || trimmed;
  trimmed = cap(analysis.tables, 50) || trimmed;
  trimmed = cap(analysis.glossary, 100) || trimmed;

  if (serializedBytes(analysis) > MAX_LOCAL_ANALYSIS_BYTES) {
    analysis.overview = bounded(analysis.overview, 4_000);
    analysis.researchQuestion = bounded(analysis.researchQuestion, 4_000);
    analysis.abstractSummary = bounded(analysis.abstractSummary, 4_000);
    analysis.methods.forEach((item) => {
      item.description = bounded(item.description, 2_000);
      item.evidence.quote = bounded(item.evidence.quote, 700);
      item.evidence.paraphrase = bounded(item.evidence.paraphrase, 700);
      item.evidence.context = bounded(item.evidence.context, 700);
    });
    analysis.keyFindings.forEach((item) => {
      item.claim = bounded(item.claim, 2_400);
      item.importance = bounded(item.importance, 1_000);
      item.evidence.quote = bounded(item.evidence.quote, 700);
      item.evidence.paraphrase = bounded(item.evidence.paraphrase, 700);
      item.evidence.context = bounded(item.evidence.context, 700);
    });
    analysis.sectionSummaries.forEach((item) => {
      item.summary = bounded(item.summary, 2_400);
      cap(item.keyPoints, 3);
      item.keyPoints = item.keyPoints.map((point) => bounded(point, 1_200));
      cap(item.evidence, 2);
      item.evidence.forEach((receipt) => {
        receipt.quote = bounded(receipt.quote, 700);
        receipt.paraphrase = bounded(receipt.paraphrase, 700);
        receipt.context = bounded(receipt.context, 700);
      });
    });
    analysis.references.forEach((item) => { item.citation = bounded(item.citation, 1_800); });
    analysis.sourceLedger.forEach((item) => {
      item.claim = bounded(item.claim, 2_000);
      item.quote = bounded(item.quote, 700);
      item.paraphrase = bounded(item.paraphrase, 700);
      item.context = bounded(item.context, 700);
    });
    trimmed = true;
  }

  const reducible: Array<{ items: unknown[]; minimum: number }> = [
    { items: analysis.references, minimum: 20 },
    { items: analysis.sourceLedger, minimum: 40 },
    { items: analysis.sectionSummaries, minimum: 12 },
    { items: analysis.equations, minimum: 12 },
    { items: analysis.figures, minimum: 12 },
    { items: analysis.tables, minimum: 12 },
    { items: analysis.glossary, minimum: 20 },
    { items: analysis.limitations, minimum: 4 },
    { items: analysis.keyFindings, minimum: 4 },
    { items: analysis.methods, minimum: 3 },
  ];
  while (serializedBytes(analysis) > MAX_LOCAL_ANALYSIS_BYTES) {
    const candidate = reducible
      .filter(({ items, minimum }) => items.length > minimum)
      .sort((left, right) => {
        const leftSize = JSON.stringify(left.items.at(-1)).length;
        const rightSize = JSON.stringify(right.items.at(-1)).length;
        return rightSize - leftSize;
      })[0];
    if (!candidate) break;
    candidate.items.pop();
    trimmed = true;
  }
  if (trimmed) analysis.warnings.push('Local Analysis trimmed lower-ranked items to keep this unusually large brief within the private sync size limit.');
  return analysis;
}

/**
 * Deterministic, offline, extractive paper analysis.
 *
 * This intentionally does not pretend to be a generative model: it ranks and
 * structures author text, detects document conventions, and attaches every
 * factual item to a recoverable page receipt.
 */
export function analyzeExtractedPaper(input: LocalPaperAnalysisInput): PaperAnalysis {
  const pages = cleanInputPages(input.pages);
  const firstPage = pages[0]?.page ?? 1;
  const lastPage = pages.at(-1)?.page ?? firstPage;
  const title = extractTitle(input, pages);
  const authors = extractAuthors(input, title, pages);
  const { sections, lines } = buildSections(pages, input.outline);
  const sentences = scoreSentences(sections.flatMap((section) => splitSentences(section.lines, section)));
  const prose = sentences.filter((sentence) => !['references', 'appendix'].includes(sentence.sectionKind));
  const abstract = abstractText(sections, prose);
  const overviewSentences = (abstract.length ? abstract : selectSentences(prose, 4, () => true, true)).slice(0, 4);
  const overview = bounded(overviewSentences.map((sentence) => sentence.text).join(' '), 8_000);
  const question = selectSentences(prose, 1, (sentence) => QUESTION_CUES.test(sentence.text))[0];

  const methodSections = sections.filter((section) => section.kind === 'methods');
  const methods = methodSections.slice(0, 12).flatMap((section) => {
    const candidates = selectSentences(sentences, 3, (sentence) => sentence.section === section.heading && (METHOD_CUES.test(sentence.text) || sentence.position <= 2));
    const receipt = candidates[0];
    if (!receipt) return [];
    return [{
      name: bounded(section.heading, 500),
      description: bounded(receipt.text, 4_000),
      page: receipt.page,
      evidence: evidence(receipt, `Method text from ${section.heading}. Other ranked details remain visible in the section summary.`),
    }];
  });
  if (!methods.length) {
    const fallback = selectSentences(prose, 3, (sentence) => METHOD_CUES.test(sentence.text));
    fallback.slice(0, 3).forEach((sentence, index) => methods.push({
      name: `Detected method ${index + 1}`,
      description: bounded(sentence.text, 4_000),
      page: sentence.page,
      evidence: evidence(sentence, 'Method-like wording detected outside a clearly labeled methods section.'),
    }));
  }

  const findingCandidates = selectSentences(
    prose,
    10,
    (sentence) => ['results', 'discussion', 'conclusion', 'abstract'].includes(sentence.sectionKind) && RESULT_CUES.test(sentence.text),
    true,
  );
  if (findingCandidates.length < 3) {
    selectSentences(prose, 6, (sentence) => RESULT_CUES.test(sentence.text), true).forEach((sentence) => {
      if (!findingCandidates.some((item) => normalizedKey(item.text) === normalizedKey(sentence.text))) findingCandidates.push(sentence);
    });
  }
  const keyFindings = findingCandidates.slice(0, 10).map((sentence) => {
    const confidence = confidenceFor(sentence);
    return {
      claim: bounded(sentence.text, 6_000),
      importance: bounded(`Extracted as a ${/\d/.test(sentence.text) ? 'quantitative or comparative' : 'result-oriented'} statement from ${sentence.section}.`, 2_000),
      certainty: confidence === 'high' ? 'High extractive confidence: result cues and quantitative evidence are present.'
        : confidence === 'medium' ? 'Moderate extractive confidence: result-oriented wording is present; inspect the receipt for scope.'
          : 'Low extractive confidence: selected by document relevance and should be checked in context.',
      page: sentence.page,
      evidence: evidence(sentence),
    };
  });

  const sectionSummaries = sections
    .filter((section) => section.kind !== 'references' && section.lines.length)
    .slice(0, 40)
    .flatMap((section) => {
      const selected = selectSentences(sentences, 4, (sentence) => sentence.section === section.heading)
        .sort((left, right) => left.sourceIndex - right.sourceIndex);
      if (!selected.length) return [];
      return [{
        heading: bounded(section.heading, 500),
        summary: bounded(selected.slice(0, 3).map((sentence) => sentence.text).join(' '), 5_000),
        startPage: Math.max(firstPage, Math.min(lastPage, section.startPage)),
        endPage: Math.max(section.startPage, Math.min(lastPage, section.endPage)),
        keyPoints: selected.slice(0, 4).map((sentence) => bounded(sentence.text, 2_000)),
        evidence: selected.slice(0, 3).map((sentence) => ({ page: sentence.page, ...evidence(sentence) })),
      }];
    });

  const figures = extractCaptions(pages, 'figure').map((caption) => ({
    label: caption.label || null,
    title: caption.title || null,
    page: caption.page,
    description: caption.caption,
    interpretation: 'Caption detected from the PDF text layer. Local Analysis does not infer unseen visual marks or trends.',
    keyTakeaway: caption.caption,
    evidence: { quote: bounded(`${caption.label}: ${caption.caption}`, 1_000), paraphrase: 'The caption was retained without visual inference.', context: 'Detected figure caption.' },
    limitations: ['Open the page to inspect axes, legends, panels, and graphical details that text extraction cannot verify.'],
  }));
  const tables = extractCaptions(pages, 'table').map((caption) => ({
    label: caption.label || null,
    title: caption.title || null,
    page: caption.page,
    description: caption.caption,
    interpretation: 'Caption detected from the PDF text layer; cell values and layout may not survive extraction in reading order.',
    keyTakeaway: caption.caption,
    evidence: { quote: bounded(`${caption.label}: ${caption.caption}`, 1_000), paraphrase: 'The caption was retained without inferring table values.', context: 'Detected table caption.' },
    limitations: ['Open the page to confirm columns, row labels, footnotes, and numeric alignment.'],
    columns: [],
  }));
  const equations = equationCandidates(pages).map((candidate, index) => ({
    label: candidate.label ?? `Detected expression ${index + 1}`,
    page: candidate.page,
    latex: candidate.line,
    plainLanguage: candidate.nearby || 'Equation-like text detected; the PDF text layer did not provide a reliable prose definition.',
    role: 'Mathematical expression detected from operators, symbols, or equation numbering. Verify notation on the original page.',
    variables: variablesFromEquation(candidate.line, candidate.nearby),
    evidence: { quote: bounded(candidate.line, 1_000), paraphrase: candidate.nearby || 'Expression retained from the source text.', context: 'Local equation detection; notation order may be affected by PDF extraction.' },
  }));

  const limitationSentences = selectSentences(
    prose,
    8,
    (sentence) => ['limitations', 'discussion', 'conclusion'].includes(sentence.sectionKind) && LIMITATION_CUES.test(sentence.text),
    true,
  );
  const limitations = limitationSentences.map((sentence) => ({
    limitation: bounded(sentence.text, 6_000),
    impact: 'The authors’ wording signals a boundary, caveat, or unresolved condition; inspect the cited passage for its exact scope.',
    page: sentence.page,
    evidence: evidence(sentence),
  }));

  const glossary = extractGlossary(prose);
  const references = referenceGroups(sections, pages).map((group) => {
    const citation = bounded(group.lines.join(' '), 10_000);
    const doi = normalizeDoi(citation);
    const rawUrl = citation.match(/https?:\/\/[^\s)>\]}]+/i)?.[0];
    return { citation, doi, url: httpsUrl(rawUrl), page: group.page };
  });

  const ledger: PaperAnalysis['sourceLedger'] = [];
  const addLedger = (entry: Omit<PaperAnalysis['sourceLedger'][number], 'id'>) => {
    if (ledger.length >= 240) return;
    const duplicate = ledger.some((item) => item.type === entry.type && item.page === entry.page && normalizedKey(item.quote) === normalizedKey(entry.quote));
    if (!duplicate) ledger.push({ ...entry, id: `${entry.type}:${String(ledger.length + 1).padStart(3, '0')}` });
  };
  keyFindings.forEach((finding, index) => addLedger({
    type: 'claim', title: bounded(`Finding ${index + 1}`, 1_000), claim: finding.claim, page: finding.page,
    quote: finding.evidence.quote, paraphrase: finding.importance, context: finding.evidence.context,
    confidence: finding.certainty.startsWith('High') ? 'high' : finding.certainty.startsWith('Moderate') ? 'medium' : 'low',
  }));
  methods.forEach((method) => addLedger({ type: 'method', title: method.name, claim: method.description, page: method.page, quote: method.evidence.quote, paraphrase: method.evidence.paraphrase, context: method.evidence.context, confidence: 'medium' }));
  figures.forEach((figure) => addLedger({ type: 'figure', title: figure.label ?? 'Figure', claim: figure.keyTakeaway, page: figure.page, quote: figure.evidence.quote, paraphrase: figure.evidence.paraphrase, context: figure.evidence.context, confidence: 'medium' }));
  tables.forEach((table) => addLedger({ type: 'table', title: table.label ?? 'Table', claim: table.keyTakeaway, page: table.page, quote: table.evidence.quote, paraphrase: table.evidence.paraphrase, context: table.evidence.context, confidence: 'medium' }));
  equations.forEach((equation) => addLedger({ type: 'equation', title: equation.label ?? 'Equation', claim: equation.role, page: equation.page, quote: equation.evidence.quote, paraphrase: equation.plainLanguage, context: equation.evidence.context, confidence: 'low' }));
  limitations.forEach((limitation) => addLedger({ type: 'limitation', title: 'Detected limitation', claim: limitation.limitation, page: limitation.page, quote: limitation.evidence.quote, paraphrase: limitation.impact, context: limitation.evidence.context, confidence: 'medium' }));
  references.slice(0, 80).forEach((reference) => addLedger({ type: 'reference', title: 'Reference', claim: reference.citation, page: reference.page, quote: bounded(reference.citation, 1_000), paraphrase: 'Reference entry detected in the bibliography.', context: 'Reference-list extraction.', confidence: 'high' }));

  const contribution = selectSentences(prose, 1, (sentence) => CONTRIBUTION_CUES.test(sentence.text))[0];
  const novelty = selectSentences(prose, 1, (sentence) => /\b(?:novel|new|first|unlike|instead of|without requiring)\b/i.test(sentence.text))[0];
  const implicationSentences = selectSentences(prose, 5, (sentence) => ['discussion', 'conclusion'].includes(sentence.sectionKind) && (RESULT_CUES.test(sentence.text) || CONTRIBUTION_CUES.test(sentence.text)));
  const openQuestions = selectSentences(prose, 5, (sentence) => FUTURE_CUES.test(sentence.text));

  const textPages = pages.filter((page) => compact(page.text).length >= 80).length;
  const warnings = [
    'Local Analysis is deterministic and extractive: it organizes text found in the PDF but does not replace expert interpretation or peer review.',
  ];
  if (!pages.length || textPages / Math.max(1, pages.length) < 0.75) warnings.push('Much of this PDF lacks an extractable text layer. Scanned or image-only pages may require OCR or AI Analysis.');
  if (!sections.some((section) => section.kind === 'abstract')) warnings.push('No clearly labeled abstract was detected; the opening pages were used for orientation.');
  if (sections.length && sections.every((section) => section.kind === 'other' && /^(?:Document text|Pages \d+)/.test(section.heading))) warnings.push('No reliable section headings were detected; Local Analysis grouped the complete paper into page ranges instead.');
  if (figures.length || tables.length) warnings.push('Figure and table entries are caption-based in Local Analysis. Inspect the original visual for axes, cells, legends, and statistical details.');
  if (equations.length) warnings.push('Equation detection preserves text-layer notation, which can reorder superscripts, subscripts, fractions, or symbols. Confirm each expression on its page.');
  if (!sectionSummaries.length) warnings.push('Section boundaries were not reliably detected, so the local brief has limited structural coverage.');

  const allText = lines.map((line) => line.line).join(' ');
  const frontMatter = pages.slice(0, 2).map((page) => page.text).join(' ');
  const labeledFrontMatterDoi = frontMatter.match(/(?:\bdoi\s*[:=]?\s*|https?:\/\/(?:dx\.)?doi\.org\/)(10\.\d{4,9}\/[-._;()/:A-Z0-9]+)/i)?.[1];
  const detectedDoi = normalizeDoi(input.metadata?.doi) ?? normalizeDoi(labeledFrontMatterDoi);
  const result: PaperAnalysis = {
    title,
    authors,
    paperType: paperType(title, sections, allText),
    publication: {
      venue: input.metadata?.venue ? bounded(input.metadata.venue, 1_000) : null,
      year: extractYear(input, pages),
      doi: detectedDoi,
      url: httpsUrl(input.metadata?.url),
    },
    overview: overview || 'The PDF did not yield enough continuous text for a reliable local overview.',
    researchQuestion: question ? bounded(question.text, 8_000) : '',
    abstractSummary: bounded(abstract.map((sentence) => sentence.text).join(' '), 8_000),
    methods: methods.slice(0, 12),
    keyFindings,
    sectionSummaries,
    figures,
    tables,
    equations,
    limitations,
    glossary,
    references,
    sourceLedger: ledger,
    synthesis: {
      contribution: contribution ? bounded(contribution.text, 8_000) : '',
      novelty: novelty ? bounded(novelty.text, 8_000) : '',
      implications: implicationSentences.map((sentence) => bounded(sentence.text, 5_000)),
      openQuestions: openQuestions.map((sentence) => bounded(sentence.text, 5_000)),
    },
    warnings,
  };
  return PaperAnalysisSchema.parse(fitAnalysisToSyncBudget(result));
}
