// Shared domain types for the TB genome portal.

export type CategoryId =
  | 'information'
  | 'cell-wall'
  | 'metabolism'
  | 'lipid'
  | 'virulence'
  | 'regulatory'
  | 'pe-ppe'
  | 'insertion-phage'
  | 'stable-rna'
  | 'hypothetical'
  | 'unclassified';

export type Strand = '+' | '-';

/** Compact record as stored in genes.json. */
export interface RawGene {
  o: string; // ORF id (Rv number)
  g: string | null; // gene name
  s: number; // start coord
  e: number; // end coord
  d: Strand; // strand
  l: number; // protein length (aa)
  a: string; // annotation
  c: CategoryId;
}

/** Expanded gene record used throughout the app. */
export interface Gene {
  orf: string;
  gene: string | null;
  /** Best display name: gene symbol when present, else ORF id. */
  name: string;
  start: number;
  end: number;
  strand: Strand;
  length: number; // aa
  bp: number; // nucleotides
  annotation: string;
  category: CategoryId;
}

export interface Dataset {
  organism: string;
  source: string;
  note: string;
  count: number;
  categories: Record<string, number>;
  genes: Gene[];
  byOrf: Map<string, Gene>;
}

export type EssentialityCall =
  | 'essential'
  | 'growth-defect'
  | 'non-essential'
  | 'uncertain'
  | 'no-data';

export interface EssentialityRow {
  datasetId: string;
  ref: string;
  condition: string;
  medium: string;
  method: string;
  call: EssentialityCall;
}

export interface ExpressionPoint {
  conditionId: string;
  label: string;
  group: string;
  /** log2 fold-change vs exponential-phase reference. */
  log2fc: number;
}

export interface DerivedGene {
  orf: string;
  /** Consensus essentiality across datasets. */
  essentiality: EssentialityCall;
  essentialityConfidence: number; // 0..1
  essentialityRows: EssentialityRow[];
  tnseq: {
    taSites: number;
    meanInsertions: number;
    saturation: number; // 0..1 fraction of TA sites with insertions
    log2fcHypoxia: number;
  };
  expression: ExpressionPoint[];
  protein: {
    mwKda: number;
    pI: number;
    gravy: number; // grand average of hydropathy
    pdbHomolog: boolean;
    alphaFold: 'very-high' | 'confident' | 'low';
  };
  vulnerability: number; // 0..1 chemical-genetic vulnerability index
  module: number; // co-expression module id
  go: string[];
  pathway: string;
  positiveSelection: {
    underSelection: boolean;
    dnds: number;
    sites: number;
  };
}
