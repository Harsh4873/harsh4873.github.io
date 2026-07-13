// Real, resolvable links to public databases, keyed by ORF id. These point at
// live third-party resources for the actual H37Rv gene.

export interface ExternalLink {
  id: string;
  label: string;
  desc: string;
  href: (orf: string, gene: string | null) => string;
}

export const EXTERNAL_LINKS: ExternalLink[] = [
  {
    id: 'mycobrowser',
    label: 'Mycobrowser',
    desc: 'Curated H37Rv annotation (EPFL)',
    href: (orf) => `https://mycobrowser.epfl.ch/genes/${orf}`,
  },
  {
    id: 'tbportal',
    label: 'TB Genome Portal',
    desc: 'Original U19 annotation portal',
    href: (orf) => `https://orca2.tamu.edu/U19/genes/detail/${orf}/`,
  },
  {
    id: 'kegg',
    label: 'KEGG',
    desc: 'Pathways & orthology (mtu)',
    href: (orf) => `https://www.genome.jp/dbget-bin/www_bget?mtu:${orf}`,
  },
  {
    id: 'uniprot',
    label: 'UniProt',
    desc: 'Protein sequence & features',
    href: (orf) => `https://www.uniprot.org/uniprotkb?query=${orf}+AND+organism_id:83332`,
  },
  {
    id: 'string',
    label: 'STRING',
    desc: 'Protein interaction network',
    href: (orf) => `https://string-db.org/cgi/network?identifiers=${orf}&species=83332`,
  },
  {
    id: 'alphafold',
    label: 'AlphaFold DB',
    desc: 'Predicted 3D structure',
    href: (orf) => `https://alphafold.ebi.ac.uk/search/text/${orf}`,
  },
  {
    id: 'ncbi',
    label: 'NCBI Gene',
    desc: 'Reference record & literature',
    href: (orf) => `https://www.ncbi.nlm.nih.gov/gene/?term=${orf}+Mycobacterium+tuberculosis`,
  },
];
