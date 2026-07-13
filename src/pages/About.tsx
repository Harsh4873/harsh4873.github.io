import { ExternalLink } from 'lucide-react';
import { href } from '../lib/router';
import { SectionTitle } from '../components/common';

export function About() {
  return (
    <div className="container" style={{ maxWidth: 820 }}>
      <h1 style={{ fontSize: 26 }}>About MtbScope</h1>
      <p className="dim" style={{ fontSize: 16, marginTop: 8 }}>
        MtbScope is a faster, comparison-first reimagining of the <a href="https://orca2.tamu.edu/U19/" target="_blank" rel="noopener noreferrer">TB Genome
        Portal <ExternalLink size={12} /></a> — an annotation resource for the <i>Mycobacterium tuberculosis</i> H37Rv genome. It
        keeps the portal's core idea (one page per gene, linking essentiality, expression and structural evidence) while adding
        instant search, multi-facet browsing, and a side-by-side panel for four or more genes at once.
      </p>

      <div className="section">
        <SectionTitle>What's real</SectionTitle>
        <ul style={{ lineHeight: 1.75, color: 'var(--text-dim)', paddingLeft: 20 }}>
          <li>The complete catalog of <b>4,018 protein-coding genes</b> — locus (Rv id), gene symbol, genomic coordinates,
            strand, protein length and product description — from the H37Rv reference annotation.</li>
          <li>External links resolve to the live records for each gene at Mycobrowser, KEGG, UniProt, STRING, AlphaFold, NCBI
            and the original TB Genome Portal.</li>
        </ul>
      </div>

      <div className="section">
        <SectionTitle>What's representative</SectionTitle>
        <p className="dim">
          Essentiality calls, transcriptional fold-changes, TnSeq fitness, protein biophysics, vulnerability index and
          selection statistics are <b>generated deterministically</b> from each gene. They are seeded from real properties
          (functional class, protein length, and a few well-established essentiality calls) so patterns are biologically
          plausible and identical every time you load a gene — but they are demonstration data, not experimental measurements.
          Panels that show generated data are labelled as such.
        </p>
        <p className="dim">
          Functional classes are assigned by a transparent keyword heuristic over the annotation, approximating the curated
          TubercuList categories rather than reproducing them exactly.
        </p>
      </div>

      <div className="section">
        <SectionTitle>How it's built</SectionTitle>
        <p className="dim">
          A dependency-light React + TypeScript single-page app. The gene catalog loads once as a static JSON asset and all
          search, filtering, comparison and charts run in the browser — no backend, no tracking. Charts are hand-drawn SVG so
          they stay crisp in light and dark themes. Press <span className="kbd">/</span> anywhere to search; the comparison set
          is saved locally and encoded in the URL so it can be shared.
        </p>
        <a className="btn btn-primary" href={href('compare')} style={{ marginTop: 8 }}>Open the comparison panel</a>
      </div>

      <div className="section">
        <SectionTitle>Credit</SectionTitle>
        <p className="dim">
          Original portal and annotation curation by the TB Genome Portal team (Texas A&amp;M, Harvard, Weill Cornell, UMass,
          Broad Institute; NIH U19 AI107774 / P01 AI143575). H37Rv annotation via Mycobrowser (EPFL). This is an independent
          educational reimplementation of the interface and is not affiliated with those groups.
        </p>
      </div>
    </div>
  );
}
