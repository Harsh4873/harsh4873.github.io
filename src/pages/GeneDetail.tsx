import { useMemo, useState } from 'react';
import { ArrowLeft, Columns3, Check, Plus, ExternalLink, Link2, TriangleAlert } from 'lucide-react';
import type { Dataset, Gene } from '../lib/types';
import { category } from '../lib/categories';
import { derive } from '../lib/derive';
import { EXTERNAL_LINKS } from '../lib/external';
import { href, navigate } from '../lib/router';
import { fmtCoord, fmtInt, fmtSigned } from '../lib/format';
import { compareStore, useCompare } from '../lib/compareStore';
import { CategoryTag, EssentialityBadge, Provenance, SectionTitle, StrandBadge } from '../components/common';
import { ExpressionBars, GenomeContext, Meter, EssentialityDots } from '../components/Charts';

const ESS_CALL_CLASS: Record<string, string> = {
  essential: 'ess-essential', 'growth-defect': 'ess-growth-defect', 'non-essential': 'ess-non-essential', uncertain: 'ess-uncertain', 'no-data': 'ess-no-data',
};

export function GeneDetail({ dataset, orf }: { dataset: Dataset; orf: string }) {
  const gene = dataset.byOrf.get(orf);
  const compare = useCompare();
  const [copied, setCopied] = useState(false);

  const neighbors = useMemo(() => {
    if (!gene) return [];
    const idx = dataset.genes.findIndex((g) => g.orf === gene.orf);
    return dataset.genes.slice(Math.max(0, idx - 4), idx + 5);
  }, [dataset, gene]);

  if (!gene) {
    return (
      <div className="container">
        <div className="empty-state">
          <TriangleAlert size={30} />
          <h2>No gene “{orf}”</h2>
          <p className="dim">That identifier isn't in the H37Rv catalog. Try a search from the top bar.</p>
          <a className="btn" href={href('browse')} style={{ marginTop: 12 }}><ArrowLeft size={15} /> Back to browser</a>
        </div>
      </div>
    );
  }

  const d = derive(gene);
  const inCompare = compareStore.has(gene.orf);
  const c = category(gene.category);

  const copyLink = () => {
    navigator.clipboard?.writeText(`${location.origin}${location.pathname}#/gene/${gene.orf}`).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    }).catch(() => {});
  };

  return (
    <div className="container">
      <a className="btn btn-ghost btn-sm" href={href('browse')} style={{ marginBottom: 14 }}><ArrowLeft size={15} /> All genes</a>

      <div className="detail-head">
        <div className="titleblock">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <CategoryTag id={gene.category} />
            <span className="faint">·</span>
            <EssentialityBadge call={d.essentiality} />
          </div>
          <h1 className="mono"><span>{gene.orf}</span>{gene.gene ? <span className="sym">{gene.gene}</span> : null}</h1>
          <p className="dim" style={{ fontSize: 16, margin: '8px 0 0', maxWidth: '60ch' }}>{gene.annotation}</p>
        </div>
        <div className="detail-actions">
          <button className={inCompare ? 'btn btn-primary' : 'btn'} onClick={() => compareStore.toggle(gene.orf)}>
            {inCompare ? <><Check size={16} /> In comparison</> : <><Plus size={16} /> Add to compare</>}
          </button>
          {compare.length ? <a className="btn" href={href('compare')}><Columns3 size={16} /> {compare.length}</a> : null}
          <button className="btn btn-ghost" onClick={copyLink} title="Copy link">{copied ? <Check size={16} /> : <Link2 size={16} />}</button>
        </div>
      </div>

      <div className="divider" />

      <div className="detail-grid">
        <div style={{ display: 'grid', gap: 18 }}>
          <div>
            <SectionTitle>Genomic neighbourhood</SectionTitle>
            <div className="card card-pad" style={{ overflowX: 'auto' }}>
              <GenomeContext neighbors={neighbors} focusOrf={gene.orf} onPick={(o) => navigate(`gene/${o}`)} />
              <div className="legend-row" style={{ marginTop: 8 }}>
                <span className="faint" style={{ fontSize: 12 }}>Arrows show strand · click a neighbour to open it · coloured by functional class.</span>
              </div>
            </div>
          </div>

          <div>
            <SectionTitle aside={<EssentialityDots rows={d.essentialityRows} />}>Essentiality</SectionTitle>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr><th className="no-sort">Study</th><th className="no-sort">Condition</th><th className="no-sort">Medium</th><th className="no-sort">Method</th><th className="no-sort">Call</th></tr>
                </thead>
                <tbody>
                  {d.essentialityRows.map((r) => (
                    <tr key={r.datasetId} style={{ cursor: 'default' }}>
                      <td style={{ fontWeight: 600 }}>{r.ref}</td>
                      <td className="dim">{r.condition}</td>
                      <td className="dim">{r.medium}</td>
                      <td className="mono dim" style={{ fontSize: 12.5 }}>{r.method}</td>
                      <td><span className={`ess ${ESS_CALL_CLASS[r.call]}`} style={{ gap: 5 }}><span className="dot dot-round" style={{ background: 'currentColor', width: 8, height: 8 }} />{r.call}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="dim" style={{ fontSize: 12.5, marginTop: 6 }}>Consensus: <b className={`ess ${ESS_CALL_CLASS[d.essentiality]}`}>{d.essentiality}</b> · {Math.round(d.essentialityConfidence * 100)}% dataset agreement</div>
          </div>

          <div>
            <SectionTitle aside={<span className="heat-legend"><span>down</span><span className="heat-bar" /><span>up</span></span>}>Transcriptional response (log₂ fold-change)</SectionTitle>
            <div className="card card-pad">
              <ExpressionBars points={d.expression} />
            </div>
          </div>
        </div>

        <div style={{ display: 'grid', gap: 18, alignContent: 'start' }}>
          <div className="card card-pad">
            <dl className="kv">
              <dt>Locus</dt><dd className="mono">{gene.orf}</dd>
              <dt>Symbol</dt><dd>{gene.gene ?? <span className="faint">unnamed</span>}</dd>
              <dt>Class</dt><dd>{c.label}</dd>
              <dt>Location</dt><dd className="mono">{fmtCoord(gene.start)}–{fmtCoord(gene.end)} <StrandBadge strand={gene.strand} /></dd>
              <dt>Length</dt><dd>{fmtInt(gene.length)} aa · {fmtInt(gene.bp)} bp</dd>
              <dt>Pathway</dt><dd>{d.pathway}</dd>
              <dt>Co-expr. module</dt><dd>#{d.module}</dd>
            </dl>
          </div>

          <div className="card card-pad">
            <h4 style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-dim)', marginBottom: 12 }}>Fitness & protein</h4>
            <div className="metric-grid">
              <div className="metric"><div className="m-num tabnum">{d.tnseq.taSites}</div><div className="m-lab">TA sites</div></div>
              <div className="metric"><div className="m-num tabnum">{d.tnseq.meanInsertions}</div><div className="m-lab">mean insertions</div></div>
              <div className="metric"><div className="m-num tabnum">≈{d.protein.mwKda}</div><div className="m-lab">kDa</div></div>
              <div className="metric"><div className="m-num tabnum">{d.protein.pI}</div><div className="m-lab">pI</div></div>
            </div>
            <div style={{ marginTop: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}><span className="dim">TnSeq saturation</span><span className="tabnum">{Math.round(d.tnseq.saturation * 100)}%</span></div>
              <Meter value={d.tnseq.saturation} />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginTop: 10 }}><span className="dim">Vulnerability index</span><span className="tabnum">{d.vulnerability}</span></div>
              <Meter value={d.vulnerability} color="var(--danger)" />
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
              <span className="badge" style={{ background: 'var(--panel-2)', color: 'var(--text-dim)' }}>AlphaFold: {d.protein.alphaFold}</span>
              <span className="badge" style={{ background: 'var(--panel-2)', color: 'var(--text-dim)' }}>{d.protein.pdbHomolog ? 'PDB homolog available' : 'No close PDB homolog'}</span>
              {d.positiveSelection.underSelection ? <span className="badge" style={{ background: 'var(--accent-soft)', color: 'var(--accent-strong)' }}>Positive selection · dN/dS {d.positiveSelection.dnds}</span> : null}
            </div>
          </div>

          <div className="card card-pad">
            <h4 style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-dim)', marginBottom: 10 }}>GO terms</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {d.go.map((g) => <span key={g} className="mono dim" style={{ fontSize: 12.5 }}>{g}</span>)}
            </div>
          </div>

          <div className="card card-pad">
            <h4 style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-dim)', marginBottom: 10 }}>External resources</h4>
            <div className="ext-links">
              {EXTERNAL_LINKS.map((l) => (
                <a key={l.id} className="ext-link" href={l.href(gene.orf, gene.gene)} target="_blank" rel="noopener noreferrer">
                  <span className="el-name">{l.label} <ExternalLink size={11} style={{ opacity: 0.6 }} /></span>
                  <span className="el-desc">{l.desc}</span>
                </a>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="section">
        <Provenance>
          The catalog record above (locus, symbol, coordinates, length, product) is from the H37Rv reference annotation. The
          essentiality calls, transcriptional response, TnSeq fitness, and protein biophysics are <b>representative demonstration
          data</b> generated deterministically from this gene — realistic and stable, but not experimental measurements. Follow the
          external links for curated primary data.
        </Provenance>
      </div>
    </div>
  );
}
