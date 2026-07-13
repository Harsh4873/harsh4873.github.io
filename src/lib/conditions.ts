// The stress / drug / infection panel used for the representative expression
// profiles. Names mirror classic H37Rv transcriptional-response studies
// (Boshoff-style stress panel; Voskuil dormancy; Schnappinger macrophage).

export interface ConditionMeta {
  id: string;
  label: string;
  group: 'Stress' | 'Growth state' | 'Host' | 'Drug';
}

export const CONDITIONS: ConditionMeta[] = [
  { id: 'hypoxia', label: 'Hypoxia (Wayne)', group: 'Stress' },
  { id: 'starvation', label: 'Nutrient starvation', group: 'Stress' },
  { id: 'acid', label: 'Acidic pH 4.5', group: 'Stress' },
  { id: 'low-iron', label: 'Iron limitation', group: 'Stress' },
  { id: 'heat', label: 'Heat shock 45°C', group: 'Stress' },
  { id: 'detergent', label: 'SDS surface stress', group: 'Stress' },
  { id: 'nitric-oxide', label: 'Nitric oxide', group: 'Stress' },
  { id: 'stationary', label: 'Stationary phase', group: 'Growth state' },
  { id: 'reaeration', label: 'Reaeration', group: 'Growth state' },
  { id: 'dormancy', label: 'Non-replicating (NRP)', group: 'Growth state' },
  { id: 'macrophage', label: 'Intracellular (macrophage)', group: 'Host' },
  { id: 'isoniazid', label: 'Isoniazid (INH)', group: 'Drug' },
  { id: 'rifampicin', label: 'Rifampicin (RIF)', group: 'Drug' },
  { id: 'ethambutol', label: 'Ethambutol (EMB)', group: 'Drug' },
];

export interface EssentialityDatasetMeta {
  id: string;
  ref: string;
  condition: string;
  medium: string;
  method: string;
}

export const ESSENTIALITY_DATASETS: EssentialityDatasetMeta[] = [
  { id: 'dejesus2017', ref: 'DeJesus 2017, mBio', condition: 'in vitro', medium: '7H9 (rich)', method: 'HMM' },
  { id: 'griffin-gly', ref: 'Griffin 2011, PLoS Pathog', condition: 'in vitro (glycerol)', medium: 'M9 + glycerol', method: 'Gumbel' },
  { id: 'griffin-chol', ref: 'Griffin 2011, PLoS Pathog', condition: 'in vitro (cholesterol)', medium: 'M9 + cholesterol', method: 'Gumbel' },
  { id: 'sassetti-mouse', ref: 'Sassetti 2003, PNAS', condition: 'in vivo (mouse)', medium: 'C57BL/6 spleen', method: 'TraSH' },
  { id: 'zhang-mac', ref: 'Zhang 2013, Cell Host Microbe', condition: 'ex vivo (macrophage)', medium: 'BMDM', method: 'TnSeq' },
];
