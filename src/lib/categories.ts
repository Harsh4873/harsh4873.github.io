import type { CategoryId } from './types';

export interface CategoryMeta {
  id: CategoryId;
  label: string;
  short: string;
  /** Accent color, tuned to read on both light and dark surfaces. */
  color: string;
  description: string;
}

// Categorical palette: distinct hues at similar luminance so no single class
// dominates the eye. Kept in one place so it can be reskinned wholesale.
export const CATEGORIES: CategoryMeta[] = [
  { id: 'information', label: 'Information pathways', short: 'Information', color: '#5b8def', description: 'DNA replication & repair, transcription, translation.' },
  { id: 'cell-wall', label: 'Cell wall & cell processes', short: 'Cell wall', color: '#22b8a6', description: 'Membrane, transport, secretion, cell division, cell envelope.' },
  { id: 'metabolism', label: 'Intermediary metabolism & respiration', short: 'Metabolism', color: '#f2994a', description: 'Central metabolism, biosynthesis, respiration, enzymes.' },
  { id: 'lipid', label: 'Lipid metabolism', short: 'Lipid', color: '#eab308', description: 'Fatty-acid, mycolic-acid and polyketide metabolism.' },
  { id: 'virulence', label: 'Virulence, detoxification, adaptation', short: 'Virulence', color: '#e0567a', description: 'Stress response, detoxification, host adaptation, toxins.' },
  { id: 'regulatory', label: 'Regulatory proteins', short: 'Regulatory', color: '#a06bd6', description: 'Transcription factors, two-component systems, sigma factors.' },
  { id: 'pe-ppe', label: 'PE/PPE family', short: 'PE/PPE', color: '#c98b5e', description: 'Glycine-rich PE and PPE surface protein families.' },
  { id: 'insertion-phage', label: 'Insertion sequences & phages', short: 'IS/phage', color: '#8d99ae', description: 'Transposases, insertion elements and prophage remnants.' },
  { id: 'stable-rna', label: 'Stable RNAs', short: 'Stable RNA', color: '#4cae6a', description: 'rRNA, tRNA and other non-coding stable RNAs.' },
  { id: 'hypothetical', label: 'Conserved hypotheticals', short: 'Hypothetical', color: '#7f8c9b', description: 'Conserved proteins of unknown function.' },
  { id: 'unclassified', label: 'Unclassified', short: 'Unclassified', color: '#b0b7c0', description: 'Not matched to a functional class by the annotation heuristic.' },
];

const BY_ID = new Map(CATEGORIES.map((c) => [c.id, c]));

export function category(id: CategoryId): CategoryMeta {
  return BY_ID.get(id) ?? CATEGORIES[CATEGORIES.length - 1];
}
