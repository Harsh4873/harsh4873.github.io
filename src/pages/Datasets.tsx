import type { Dataset } from '../lib/types';
import { CONDITIONS, ESSENTIALITY_DATASETS } from '../lib/conditions';
import { SectionTitle, Provenance } from '../components/common';

const GROUP_COLOR: Record<string, string> = {
  Stress: '#e0567a', 'Growth state': '#5b8def', Host: '#22b8a6', Drug: '#f2994a',
};

export function Datasets(_: { dataset: Dataset }) {
  return (
    <div className="container">
      <h1 style={{ fontSize: 26 }}>Datasets</h1>
      <p className="dim" style={{ maxWidth: '64ch', marginTop: 6 }}>
        The panels across MtbScope are organised around the kinds of functional-genomics experiments that characterise
        <i> M. tuberculosis</i> genes. Below are the study designs each panel is modelled on.
      </p>

      <div className="section">
        <SectionTitle>Essentiality &amp; fitness (TnSeq)</SectionTitle>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th className="no-sort">Study</th><th className="no-sort">Condition</th><th className="no-sort">Medium / host</th><th className="no-sort">Method</th></tr>
            </thead>
            <tbody>
              {ESSENTIALITY_DATASETS.map((d) => (
                <tr key={d.id} style={{ cursor: 'default' }}>
                  <td style={{ fontWeight: 600 }}>{d.ref}</td>
                  <td className="dim">{d.condition}</td>
                  <td className="dim">{d.medium}</td>
                  <td className="mono dim" style={{ fontSize: 12.5 }}>{d.method}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="dim" style={{ fontSize: 13, marginTop: 8 }}>
          Transposon-insertion sequencing (Tn-Seq / TraSH) saturates the genome with insertions; genes that cannot tolerate
          them are inferred to be required for growth in that condition.
        </p>
      </div>

      <div className="section">
        <SectionTitle>Transcriptional response panel</SectionTitle>
        <div className="card card-pad">
          <p className="dim" style={{ marginTop: 0, fontSize: 13.5 }}>
            Expression fold-changes are reported across {CONDITIONS.length} conditions spanning stress, growth state, host and
            drug exposure — the classic axes probed by H37Rv microarray and RNA-seq stress panels.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8, marginTop: 6 }}>
            {CONDITIONS.map((c) => (
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 10px', background: 'var(--panel-2)', borderRadius: 8 }}>
                <span className="dot" style={{ background: GROUP_COLOR[c.group] }} />
                <span style={{ fontWeight: 600, fontSize: 13.5 }}>{c.label}</span>
                <span className="faint" style={{ marginLeft: 'auto', fontSize: 11.5 }}>{c.group}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="section">
        <Provenance>
          These describe the experimental designs the panels emulate. The per-gene values shown throughout MtbScope are
          <b> representative demonstration data</b>, not the primary measurements from these studies. Use the external database
          links on any gene page to reach curated primary data.
        </Provenance>
      </div>
    </div>
  );
}
