// Deterministic, representative analytics for each gene.
//
// IMPORTANT: only the gene catalog (name, coordinates, length, annotation,
// class) is real reference data. Everything in this module — essentiality
// calls, expression fold-changes, TnSeq counts, protein biophysics, selection
// stats — is generated deterministically from the ORF id to give the portal
// realistic, self-consistent demonstration data. It is seeded from real gene
// properties (functional class, length) so patterns are biologically plausible
// and stable, but it must not be read as experimental measurement. The UI
// labels these panels as representative.

import type {
  CategoryId,
  DerivedGene,
  EssentialityCall,
  EssentialityRow,
  ExpressionPoint,
  Gene,
} from './types';
import { rngFor, type Rng } from './rng';
import { CONDITIONS, ESSENTIALITY_DATASETS } from './conditions';
import { clamp } from './format';

// Base rate that a gene in a class is essential in rich medium in vitro.
const ESSENTIAL_BASE: Record<CategoryId, number> = {
  information: 0.7,
  'stable-rna': 0.74,
  metabolism: 0.3,
  'cell-wall': 0.27,
  lipid: 0.22,
  regulatory: 0.17,
  virulence: 0.15,
  hypothetical: 0.12,
  unclassified: 0.12,
  'pe-ppe': 0.05,
  'insertion-phage': 0.04,
};

// A few well-established calls, keyed by gene symbol, anchor the genes a user is
// most likely to look up first.
const KNOWN_ESSENTIAL = new Set([
  'dnaa', 'dnan', 'gyra', 'gyrb', 'rpoa', 'rpob', 'rpoc', 'rpsl', 'rpsa',
  'inha', 'fabg1', 'kasa', 'acpm', 'accd6', 'fas', 'embb', 'emba', 'embc',
  'ftsz', 'seca1', 'atpb', 'atpa', 'atpe', 'mmpl3', 'dprE1', 'dpre1', ' topA',
  'topa', 'ileS', 'ftsi', 'murg', 'glf', 'pks13',
]);
const KNOWN_NONESSENTIAL = new Set([
  'katg', 'pnca', 'ahpc', 'gid', 'etha', 'nat', 'kasb', 'whib7', 'ndh',
  'pe35', 'esxa', 'esxb', 'lprg', 'hspx', 'acr', 'icl1', 'reld', 'sigf',
]);

const CALL_LABEL: Record<EssentialityCall, EssentialityCall> = {
  essential: 'essential',
  'growth-defect': 'growth-defect',
  'non-essential': 'non-essential',
  uncertain: 'uncertain',
  'no-data': 'no-data',
};

// Latent response axes used to build correlated expression profiles.
// weights order: [dormancy, stress, drug, host]
const CONDITION_AXES: Record<string, [number, number, number, number]> = {
  hypoxia: [1.15, 0.2, 0, 0.1],
  starvation: [0.6, 0.55, 0, 0.1],
  acid: [0.1, 0.8, 0, 0.45],
  'low-iron': [0.2, 0.7, 0, 0.5],
  heat: [0, 1.05, 0, 0],
  detergent: [0, 0.75, 0.2, 0],
  'nitric-oxide': [0.45, 0.6, 0, 0.7],
  stationary: [0.85, 0.25, 0, 0],
  reaeration: [-0.8, 0.1, 0, 0],
  dormancy: [1.2, 0.15, 0, 0.1],
  macrophage: [0.4, 0.35, 0, 1.05],
  isoniazid: [0, 0.15, 1.05, 0],
  rifampicin: [0, 0.2, 0.9, 0],
  ethambutol: [0, 0.15, 0.9, 0],
};

// Signature regulons for a handful of famous genes (nice authentic touches).
const DORMANCY_GENES = new Set(['Rv2031c', 'Rv3133c', 'Rv2626c', 'Rv2623', 'Rv3134c', 'Rv2028c']);
const INH_INDUCED = new Set(['Rv1484', 'Rv2243', 'Rv2244', 'Rv2245', 'Rv2246', 'Rv0129c']);

const GO_POOLS: Record<CategoryId, string[]> = {
  information: ['GO:0006260 DNA replication', 'GO:0006351 transcription', 'GO:0006412 translation', 'GO:0006281 DNA repair', 'GO:0003677 DNA binding'],
  'cell-wall': ['GO:0016020 membrane', 'GO:0055085 transmembrane transport', 'GO:0071555 cell wall organization', 'GO:0051301 cell division', 'GO:0009306 protein secretion'],
  metabolism: ['GO:0008152 metabolic process', 'GO:0016491 oxidoreductase activity', 'GO:0016740 transferase activity', 'GO:0044249 biosynthetic process', 'GO:0006091 energy generation'],
  lipid: ['GO:0006629 lipid metabolic process', 'GO:0006633 fatty-acid biosynthesis', 'GO:0071768 mycolic-acid biosynthesis', 'GO:0016836 hydro-lyase activity'],
  virulence: ['GO:0006979 response to oxidative stress', 'GO:0009408 response to heat', 'GO:0006950 response to stress', 'GO:0098754 detoxification'],
  regulatory: ['GO:0006355 regulation of transcription', 'GO:0000160 two-component signal transduction', 'GO:0003700 DNA-binding transcription factor'],
  'pe-ppe': ['GO:0005576 extracellular region', 'GO:0052572 response to host immune response', 'GO:0009986 cell surface'],
  'insertion-phage': ['GO:0006313 transposition', 'GO:0015074 DNA integration'],
  'stable-rna': ['GO:0006412 translation', 'GO:0003723 RNA binding'],
  hypothetical: ['GO:0008150 biological process', 'GO:0003674 molecular function'],
  unclassified: ['GO:0008150 biological process'],
};

const PATHWAY_POOLS: Record<CategoryId, string[]> = {
  information: ['DNA replication', 'RNA polymerase', 'Aminoacyl-tRNA biosynthesis', 'Mismatch repair'],
  'cell-wall': ['Peptidoglycan biosynthesis', 'ABC transporters', 'Bacterial secretion system', 'Cell division'],
  metabolism: ['Citrate cycle (TCA)', 'Oxidative phosphorylation', 'Glycolysis / gluconeogenesis', 'Purine metabolism', 'Amino-acid biosynthesis'],
  lipid: ['Fatty-acid biosynthesis', 'Mycolic-acid biosynthesis', 'Polyketide sugar-unit biosynthesis', 'Fatty-acid degradation'],
  virulence: ['Oxidative-stress response', 'Two-component regulatory response', 'Betaine biosynthesis'],
  regulatory: ['Two-component system', 'Sigma-factor network', 'Transcriptional regulation'],
  'pe-ppe': ['ESX secretion-associated', 'Host–pathogen interaction'],
  'insertion-phage': ['Mobile genetic elements'],
  'stable-rna': ['Ribosome', 'Translation machinery'],
  hypothetical: ['Not assigned'],
  unclassified: ['Not assigned'],
};

function drawCall(rng: Rng, pEssential: number, conditionBias: number): EssentialityCall {
  const p = clamp(pEssential + conditionBias, 0, 0.97);
  const r = rng.next();
  if (r < p) return 'essential';
  if (r < p + 0.16) return 'growth-defect';
  if (r < p + 0.16 + 0.02) return 'uncertain';
  return 'non-essential';
}

function essentiality(gene: Gene, rng: Rng): { call: EssentialityCall; confidence: number; rows: EssentialityRow[] } {
  const symbol = gene.gene?.toLowerCase() ?? '';
  const forcedEssential = KNOWN_ESSENTIAL.has(symbol);
  const forcedNon = KNOWN_NONESSENTIAL.has(symbol);
  let base = forcedEssential ? 0.96 : forcedNon ? 0.03 : ESSENTIAL_BASE[gene.category];
  // Longer proteins skew very slightly toward being required.
  base = clamp(base + (gene.length > 500 ? 0.05 : gene.length < 120 ? -0.04 : 0), 0.02, 0.97);

  const rows: EssentialityRow[] = ESSENTIALITY_DATASETS.map((d) => {
    // Host / restrictive conditions reveal conditional requirements.
    const bias = forcedNon ? 0 : d.id === 'sassetti-mouse' || d.id === 'zhang-mac' ? 0.12 : d.id === 'griffin-chol' ? 0.06 : 0;
    return {
      datasetId: d.id,
      ref: d.ref,
      condition: d.condition,
      medium: d.medium,
      method: d.method,
      call: CALL_LABEL[drawCall(rng, base, bias)],
    };
  });

  const nEss = rows.filter((r) => r.call === 'essential').length;
  const nDef = rows.filter((r) => r.call === 'growth-defect').length;
  let call: EssentialityCall;
  if (forcedEssential) call = 'essential';
  else if (forcedNon) call = 'non-essential';
  else if (nEss >= 3) call = 'essential';
  else if (nEss + nDef >= 3 || nEss >= 2) call = 'growth-defect';
  else if (rows.every((r) => r.call === 'uncertain')) call = 'uncertain';
  else call = 'non-essential';

  // Confidence = fraction of studies consistent with the consensus call.
  const consistent = rows.filter(
    (r) => r.call === call || (call === 'growth-defect' && r.call === 'essential'),
  ).length;
  return { call, confidence: Number((consistent / rows.length).toFixed(2)), rows };
}

function expression(gene: Gene, rng: Rng): ExpressionPoint[] {
  const amp = gene.category === 'hypothetical' || gene.category === 'insertion-phage' ? 0.7 : 1;
  const vec: [number, number, number, number] = [rng.gauss(), rng.gauss(), rng.gauss(), rng.gauss()];
  if (DORMANCY_GENES.has(gene.orf)) vec[0] += 2.4;
  if (INH_INDUCED.has(gene.orf)) vec[2] += 2.2;
  if (gene.category === 'lipid' || gene.category === 'cell-wall') vec[2] += 0.5 * rng.next();
  if (gene.category === 'virulence' || gene.category === 'regulatory') vec[1] += 0.4 * rng.gauss();

  return CONDITIONS.map((c) => {
    const w = CONDITION_AXES[c.id] ?? [0, 0, 0, 0];
    const signal = vec[0] * w[0] + vec[1] * w[1] + vec[2] * w[2] + vec[3] * w[3];
    const log2fc = clamp(signal * 0.85 * amp + rng.gauss() * 0.25, -6.5, 6.5);
    return { conditionId: c.id, label: c.label, group: c.group, log2fc: Number(log2fc.toFixed(2)) };
  });
}

const cache = new Map<string, DerivedGene>();

export function derive(gene: Gene): DerivedGene {
  const hit = cache.get(gene.orf);
  if (hit) return hit;

  const rng = rngFor('mtb', gene.orf);
  const ess = essentiality(gene, rng);
  const expr = expression(gene, rng);

  const isEssential = ess.call === 'essential';
  const taSites = Math.max(2, Math.round(gene.bp / rng.range(48, 72)));
  const saturation = clamp((isEssential ? rng.range(0.05, 0.28) : rng.range(0.45, 0.9)) , 0, 1);
  const meanInsertions = Number((isEssential ? rng.range(0.2, 3) : rng.range(6, 55)).toFixed(1));

  const mwKda = Number((gene.length * 0.11).toFixed(1));
  const pI = Number(clamp(rng.gauss() * 1.6 + (rng.chance(0.55) ? 5.6 : 8.8), 3.8, 11.5).toFixed(2));
  const gravy = Number(clamp(rng.gauss() * 0.4 + (gene.category === 'cell-wall' ? 0.35 : -0.15), -1.4, 1.4).toFixed(2));
  const pdbChance = gene.category === 'metabolism' || gene.category === 'information' ? 0.5 : 0.28;

  const goPool = GO_POOLS[gene.category];
  const nGo = rng.int(1, Math.min(3, goPool.length));
  const go: string[] = [];
  const shuffled = [...goPool].sort(() => rng.next() - 0.5);
  for (let i = 0; i < nGo; i++) go.push(shuffled[i]);

  const psChance =
    gene.category === 'pe-ppe' ? 0.32 : gene.category === 'cell-wall' ? 0.18 : gene.category === 'virulence' ? 0.16 : 0.08;
  const underSelection = rng.chance(psChance);

  const result: DerivedGene = {
    orf: gene.orf,
    essentiality: ess.call,
    essentialityConfidence: ess.confidence,
    essentialityRows: ess.rows,
    tnseq: {
      taSites,
      meanInsertions,
      saturation: Number(saturation.toFixed(2)),
      log2fcHypoxia: expr.find((e) => e.conditionId === 'hypoxia')?.log2fc ?? 0,
    },
    expression: expr,
    protein: {
      mwKda,
      pI,
      gravy,
      pdbHomolog: rng.chance(pdbChance),
      alphaFold: rng.chance(0.7) ? 'very-high' : rng.chance(0.7) ? 'confident' : 'low',
    },
    vulnerability: Number(clamp((isEssential ? rng.range(0.55, 0.98) : rng.range(0.02, 0.5)), 0, 1).toFixed(2)),
    module: (Math.abs(hashModule(gene.orf)) % 48) + 1,
    go,
    pathway: rng.pick(PATHWAY_POOLS[gene.category]),
    positiveSelection: {
      underSelection,
      dnds: Number((underSelection ? rng.range(1.05, 2.6) : rng.range(0.05, 0.9)).toFixed(2)),
      sites: underSelection ? rng.int(1, 8) : 0,
    },
  };
  cache.set(gene.orf, result);
  return result;
}

function hashModule(orf: string): number {
  let h = 0;
  for (let i = 0; i < orf.length; i++) h = (h * 31 + orf.charCodeAt(i)) | 0;
  return h;
}
