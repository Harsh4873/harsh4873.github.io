import { useEffect, useMemo, useRef, useState } from 'react';
import { X, Share2, Trash2, Plus, Check, Columns3, ExternalLink } from 'lucide-react';
import type { Dataset, Gene, DerivedGene } from '../lib/types';
import { category } from '../lib/categories';
import { CONDITIONS } from '../lib/conditions';
import { derive } from '../lib/derive';
import { href, navigate } from '../lib/router';
import { fmtCoord, fmtInt, fmtSigned } from '../lib/format';
import { compareStore, useCompare } from '../lib/compareStore';
import { GeneSearch } from '../components/GeneSearch';
import { CategoryTag, EssentialityBadge } from '../components/common';
import { EssentialityDots, Meter, exprOverlay } from '../components/Charts';

const PRESETS: { name: string; desc: string; orfs: string[] }[] = [
  { name: 'First-line drug targets', desc: 'rpoB · katG · inhA · gyrA · embB', orfs: ['Rv0667', 'Rv1908c', 'Rv1484', 'Rv0006', 'Rv3795'] },
  { name: 'DosR dormancy regulon', desc: 'dosR · hspX · Rv2626c · Rv2623 · Rv2028c', orfs: ['Rv3133c', 'Rv2031c', 'Rv2626c', 'Rv2623', 'Rv2028c'] },
  { name: 'ESX-1 secretion system', desc: 'esxA · esxB · eccD1 · espI · Rv3870', orfs: ['Rv3875', 'Rv3874', 'Rv3877', 'Rv3876', 'Rv3870'] },
];

function HeatBox({ v }: { v: number }) {
  const o = exprOverlay(v);
  return (
    <div title={`${fmtSigned(v)} log₂FC`} style={{ position: 'relative', height: 30, borderRadius: 6, background: 'var(--panel-2)', border: '1px solid var(--border)', display: 'grid', placeItems: 'center', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', inset: 0, background: o.color, opacity: o.opacity }} />
      <span style={{ position: 'relative', fontSize: 11.5, fontWeight: 650, fontVariantNumeric: 'tabular-nums', color: Math.abs(v) > 2.4 ? '#fff' : 'var(--text)' }}>{fmtSigned(v)}</span>
    </div>
  );
}

export function Compare({ dataset }: { dataset: Dataset }) {
  const compare = useCompare();
  const [copied, setCopied] = useState(false);
  const imported = useRef(false);

  // Import a shared set from the URL once, on first mount.
  useEffect(() => {
    if (imported.current) return;
    imported.current = true;
    const m = /[?&]genes=([^&]+)/.exec(window.location.hash);
    if (m) {
      const wanted = decodeURIComponent(m[1]).split(',').map((s) => s.trim()).filter((o) => dataset.byOrf.has(o));
      if (wanted.length) compareStore.set(wanted);
    }
  }, [dataset]);

  // Keep the URL in sync (shareable) without triggering a route change.
  useEffect(() => {
    const base = '#/compare';
    const next = compare.length ? `${base}?genes=${compare.join(',')}` : base;
    if (window.location.hash !== next) history.replaceState(null, '', next);
  }, [compare]);

  const genes = useMemo(
    () => compare.map((o) => dataset.byOrf.get(o)).filter((g): g is Gene => Boolean(g)),
    [compare, dataset],
  );
  const derived = useMemo(() => new Map<string, DerivedGene>(genes.map((g) => [g.orf, derive(g)])), [genes]);

  const share = () => {
    const url = `${location.origin}${location.pathname}#/compare?genes=${compare.join(',')}`;
    navigator.clipboard?.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1600); }).catch(() => {});
  };

  if (!genes.length) {
    return (
      <div className="container">
        <h1 style={{ fontSize: 26, display: 'flex', alignItems: 'center', gap: 10 }}><Columns3 size={24} style={{ color: 'var(--accent)' }} /> Comparison panel</h1>
        <p className="dim" style={{ maxWidth: '62ch', marginTop: 6 }}>
          Pin up to {compareStore.max} genes to read their essentiality, transcriptional response, fitness and protein data in
          aligned columns. Search below, or start from a curated set.
        </p>
        <div className="card card-pad" style={{ maxWidth: 560, marginTop: 16 }}>
          <GeneSearch genes={dataset.genes} variant="hero" placeholder="Add a gene — katG, Rv0667, gyrase…" onPick={(g) => compareStore.add(g.orf)} />
        </div>
        <div className="section">
          <h3 style={{ fontSize: 14, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-dim)', marginBottom: 10 }}>Start from a set</h3>
          <div className="grid-3">
            {PRESETS.map((p) => (
              <button key={p.name} className="link-card" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => compareStore.set(p.orfs.filter((o) => dataset.byOrf.has(o)))}>
                <h3 style={{ fontSize: 15 }}>{p.name}</h3>
                <p className="mono" style={{ fontSize: 12.5 }}>{p.desc}</p>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const cols = `170px repeat(${genes.length}, minmax(240px, 1fr))`;

  // A labelled row: sticky label cell + one rendered cell per gene.
  const Row = ({ label, render, tall }: { label: string; render: (g: Gene, d: DerivedGene) => React.ReactNode; tall?: boolean }) => (
    <>
      <div className="cmp-rowlabel">{label}</div>
      {genes.map((g) => (
        <div key={g.orf} className="cmp-cell" style={tall ? { minHeight: 46 } : undefined}>{render(g, derived.get(g.orf)!)}</div>
      ))}
    </>
  );

  return (
    <div className="container wide">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <h1 style={{ fontSize: 24, display: 'flex', alignItems: 'center', gap: 10 }}>
          <Columns3 size={22} style={{ color: 'var(--accent)' }} /> Comparing {genes.length} gene{genes.length > 1 ? 's' : ''}
        </h1>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ width: 260 }}>
            <GeneSearch genes={dataset.genes} placeholder="Add a gene…" onPick={(g) => compareStore.add(g.orf)} />
          </div>
          <button className="btn btn-sm" onClick={share} disabled={!compare.length}>{copied ? <><Check size={15} /> Copied</> : <><Share2 size={15} /> Share</>}</button>
          <button className="btn btn-ghost btn-sm" onClick={() => compareStore.clear()}><Trash2 size={15} /> Clear</button>
        </div>
      </div>

      {compare.length >= compareStore.max ? (
        <p className="dim" style={{ fontSize: 12.5, marginTop: 8 }}>Maximum of {compareStore.max} genes reached — remove one to add another.</p>
      ) : null}

      <div className="heat-legend" style={{ marginTop: 12 }}>
        <span>Transcription: down</span><span className="heat-bar" /><span>up (log₂ fold-change)</span>
      </div>

      <div className="compare-board card" style={{ marginTop: 10 }}>
        <div className="compare-grid" style={{ gridTemplateColumns: cols }}>
          {/* Header */}
          <div className="cmp-rowlabel" style={{ background: 'var(--panel)', position: 'sticky', top: 56, left: 0, zIndex: 6 }} />
          {genes.map((g) => (
            <div key={g.orf} className="cmp-header" style={{ position: 'sticky', top: 56, zIndex: 5 }}>
              <button className="icon-btn cmp-remove" style={{ width: 26, height: 26 }} onClick={() => compareStore.remove(g.orf)} title="Remove"><X size={14} /></button>
              <a className="cmp-orf" href={href(`gene/${g.orf}`)} style={{ display: 'block' }}>{g.orf}</a>
              {g.gene ? <a className="cmp-sym" href={href(`gene/${g.orf}`)}>{g.gene}</a> : <span className="faint">unnamed</span>}
              <div style={{ marginTop: 6 }}><CategoryTag id={g.category} /></div>
            </div>
          ))}

          <Row label="Product" render={(g) => <span style={{ fontSize: 13, lineHeight: 1.4 }}>{g.annotation}</span>} tall />
          <Row label="Essentiality" render={(_, d) => <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}><EssentialityBadge call={d.essentiality} /><EssentialityDots rows={d.essentialityRows} /></div>} />
          <Row label="Location" render={(g) => <span className="mono" style={{ fontSize: 12.5 }}>{fmtCoord(g.start)}–{fmtCoord(g.end)} {g.strand}</span>} />
          <Row label="Length" render={(g) => <span className="tabnum">{fmtInt(g.length)} aa</span>} />
          <Row label="Protein" render={(_, d) => <span className="tabnum dim" style={{ fontSize: 13 }}>≈{d.protein.mwKda} kDa · pI {d.protein.pI}</span>} />
          <Row label="TnSeq saturation" render={(_, d) => <div><Meter value={d.tnseq.saturation} /><span className="faint tabnum" style={{ fontSize: 11.5 }}>{Math.round(d.tnseq.saturation * 100)}% · {d.tnseq.taSites} TA</span></div>} />
          <Row label="Vulnerability" render={(_, d) => <div><Meter value={d.vulnerability} color="var(--danger)" /><span className="faint tabnum" style={{ fontSize: 11.5 }}>{d.vulnerability}</span></div>} />
          <Row label="Pathway" render={(_, d) => <span className="dim" style={{ fontSize: 12.5 }}>{d.pathway}</span>} />
          <Row label="Module" render={(_, d) => <span className="dim">#{d.module}</span>} />

          {/* Expression matrix: one row per condition, one cell per gene. */}
          <div className="cmp-rowlabel" style={{ background: 'var(--panel-3)', textTransform: 'none', letterSpacing: 0, fontWeight: 700, color: 'var(--text)' }}>Transcriptional response</div>
          {genes.map((g) => <div key={g.orf} className="cmp-cell" style={{ background: 'var(--panel-3)', fontSize: 11.5 }} />)}

          {CONDITIONS.map((c) => (
            <div className="cmp-row" key={c.id}>
              <div className="cmp-rowlabel" style={{ fontWeight: 550, textTransform: 'none', letterSpacing: 0, fontSize: 12 }}>{c.label}</div>
              {genes.map((g) => {
                const pt = derived.get(g.orf)!.expression.find((e) => e.conditionId === c.id)!;
                return <div key={g.orf} className="cmp-cell" style={{ paddingTop: 8, paddingBottom: 8 }}><HeatBox v={pt.log2fc} /></div>;
              })}
            </div>
          ))}

          <Row label="Resources" render={(g) => (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <a className="chip" href={`https://mycobrowser.epfl.ch/genes/${g.orf}`} target="_blank" rel="noopener noreferrer">Mycobrowser <ExternalLink size={11} /></a>
              <a className="chip" href={href(`gene/${g.orf}`)}>Full page</a>
            </div>
          )} />
        </div>
      </div>

      <p className="dim" style={{ fontSize: 12.5, marginTop: 12, maxWidth: '70ch' }}>
        The catalog rows (product, location, length) are reference annotation. Essentiality, expression, fitness and protein
        rows are representative demonstration data — see <a href={href('about')} style={{ textDecoration: 'underline' }}>About</a>.
      </p>
    </div>
  );
}
