import { useEffect, useMemo, useState } from 'react';
import { Search, ArrowUpDown, ArrowUp, ArrowDown, Columns3, X, Plus, Check } from 'lucide-react';
import type { Dataset, EssentialityCall, Gene } from '../lib/types';
import { CATEGORIES, category } from '../lib/categories';
import { derive } from '../lib/derive';
import { href, navigate, useRoute } from '../lib/router';
import { fmtInt } from '../lib/format';
import { compareStore, useCompare } from '../lib/compareStore';
import { CategoryTag, EssentialityBadge } from '../components/common';

type SortKey = 'position' | 'orf' | 'gene' | 'length' | 'category' | 'essentiality';
const ESS_RANK: Record<EssentialityCall, number> = { essential: 0, 'growth-defect': 1, 'non-essential': 2, uncertain: 3, 'no-data': 4 };
const ESS_FILTERS: EssentialityCall[] = ['essential', 'growth-defect', 'non-essential'];
const PAGE = 50;

export function Browser({ dataset }: { dataset: Dataset }) {
  const route = useRoute();
  const compare = useCompare();
  const [q, setQ] = useState('');
  const [cats, setCats] = useState<Set<string>>(new Set());
  const [strand, setStrand] = useState<'all' | '+' | '-'>('all');
  const [ess, setEss] = useState<Set<EssentialityCall>>(new Set());
  const [sort, setSort] = useState<SortKey>('position');
  const [dir, setDir] = useState<1 | -1>(1);
  const [page, setPage] = useState(0);

  // Essentiality is derived once for the whole genome, then reused for filter + sort.
  const essMap = useMemo(() => {
    const m = new Map<string, EssentialityCall>();
    for (const g of dataset.genes) m.set(g.orf, derive(g).essentiality);
    return m;
  }, [dataset]);

  // Preselect a class from ?cat= (e.g. from the Overview donut).
  useEffect(() => {
    if (route.params.cat) setCats(new Set([route.params.cat]));
  }, [route.params.cat]);

  const filtered = useMemo(() => {
    const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    let list = dataset.genes.filter((g) => {
      if (cats.size && !cats.has(g.category)) return false;
      if (strand !== 'all' && g.strand !== strand) return false;
      if (ess.size && !ess.has(essMap.get(g.orf)!)) return false;
      if (terms.length) {
        const hay = `${g.orf} ${g.gene ?? ''} ${g.annotation}`.toLowerCase();
        if (!terms.every((t) => hay.includes(t))) return false;
      }
      return true;
    });
    const cmp: Record<SortKey, (a: Gene, b: Gene) => number> = {
      position: (a, b) => a.start - b.start,
      orf: (a, b) => a.orf.localeCompare(b.orf, undefined, { numeric: true }),
      gene: (a, b) => (a.gene ?? 'zzz').localeCompare(b.gene ?? 'zzz'),
      length: (a, b) => a.length - b.length,
      category: (a, b) => category(a.category).label.localeCompare(category(b.category).label),
      essentiality: (a, b) => ESS_RANK[essMap.get(a.orf)!] - ESS_RANK[essMap.get(b.orf)!],
    };
    list = [...list].sort((a, b) => cmp[sort](a, b) * dir || a.start - b.start);
    return list;
  }, [dataset, q, cats, strand, ess, essMap, sort, dir]);

  useEffect(() => setPage(0), [q, cats, strand, ess, sort, dir]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const pageItems = filtered.slice(page * PAGE, page * PAGE + PAGE);

  const setSortKey = (key: SortKey) => {
    if (sort === key) setDir((d) => (d === 1 ? -1 : 1));
    else {
      setSort(key);
      setDir(key === 'length' ? -1 : 1);
    }
  };

  const toggleCat = (id: string) => setCats((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleEss = (c: EssentialityCall) => setEss((s) => { const n = new Set(s); n.has(c) ? n.delete(c) : n.add(c); return n; });
  const clearAll = () => { setCats(new Set()); setStrand('all'); setEss(new Set()); setQ(''); };
  const hasFilters = cats.size || strand !== 'all' || ess.size || q.trim();

  const sortIcon = (key: SortKey) => sort !== key ? <ArrowUpDown size={12} style={{ opacity: 0.4 }} /> : dir === 1 ? <ArrowUp size={12} className="arrow" /> : <ArrowDown size={12} className="arrow" />;

  return (
    <div className="container wide">
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
        <h1 style={{ fontSize: 24 }}>Gene browser</h1>
        {compare.length ? (
          <a className="btn btn-primary btn-sm" href={href('compare')}><Columns3 size={15} /> Compare {compare.length} gene{compare.length > 1 ? 's' : ''}</a>
        ) : null}
      </div>

      <div className="toolbar" style={{ marginTop: 14 }}>
        <div className="search" style={{ maxWidth: 380, flex: 1 }}>
          <div className="search-input-wrap">
            <Search size={16} style={{ color: 'var(--text-faint)' }} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by Rv id, symbol or function…" spellCheck={false} aria-label="Filter genes" />
            {q ? <X size={15} style={{ cursor: 'pointer', color: 'var(--text-faint)' }} onClick={() => setQ('')} /> : null}
          </div>
        </div>
        <div style={{ display: 'inline-flex', border: '1px solid var(--border-strong)', borderRadius: 9, overflow: 'hidden' }}>
          {(['all', '+', '-'] as const).map((s) => (
            <button key={s} className="btn btn-sm" style={{ borderRadius: 0, border: 'none', background: strand === s ? 'var(--accent-soft)' : 'transparent', color: strand === s ? 'var(--accent-strong)' : 'var(--text-dim)' }} onClick={() => setStrand(s)}>
              {s === 'all' ? 'Both strands' : s === '+' ? 'Forward +' : 'Reverse −'}
            </button>
          ))}
        </div>
        {hasFilters ? <button className="btn btn-ghost btn-sm" onClick={clearAll}><X size={14} /> Clear</button> : null}
      </div>

      <div className="filter-scroll" style={{ marginBottom: 8 }}>
        {CATEGORIES.filter((c) => dataset.categories[c.id]).map((c) => (
          <button key={c.id} className={`chip${cats.has(c.id) ? ' on' : ''}`} onClick={() => toggleCat(c.id)}>
            <span className="dot" style={{ background: c.color }} /> {c.short}
            <span className="faint tabnum" style={{ fontSize: 11 }}>{fmtInt(dataset.categories[c.id])}</span>
          </button>
        ))}
      </div>
      <div className="filter-scroll" style={{ marginBottom: 12 }}>
        <span className="faint" style={{ fontSize: 12.5, alignSelf: 'center', fontWeight: 600 }}>Essentiality:</span>
        {ESS_FILTERS.map((c) => (
          <button key={c} className={`chip${ess.has(c) ? ' on' : ''}`} onClick={() => toggleEss(c)}>
            <span className={`ess ess-${c}`} style={{ gap: 5 }}><span className="dot dot-round" style={{ background: 'currentColor', width: 8, height: 8 }} />{c === 'growth-defect' ? 'Growth-defect' : c === 'non-essential' ? 'Non-essential' : 'Essential'}</span>
          </button>
        ))}
      </div>

      <div className="result-meta">
        Showing <b className="tabnum">{filtered.length ? page * PAGE + 1 : 0}–{Math.min((page + 1) * PAGE, filtered.length)}</b> of <b className="tabnum">{fmtInt(filtered.length)}</b> genes
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th className="no-sort" style={{ width: 40 }} title="Add to comparison" />
              <th onClick={() => setSortKey('orf')} style={{ minWidth: 92 }}>ORF {sortIcon('orf')}</th>
              <th onClick={() => setSortKey('gene')} style={{ minWidth: 70 }}>Gene {sortIcon('gene')}</th>
              <th className="no-sort">Product</th>
              <th onClick={() => setSortKey('category')}>Class {sortIcon('category')}</th>
              <th onClick={() => setSortKey('essentiality')}>Essentiality {sortIcon('essentiality')}</th>
              <th onClick={() => setSortKey('length')} style={{ textAlign: 'right' }}>Length {sortIcon('length')}</th>
              <th onClick={() => setSortKey('position')} style={{ minWidth: 74 }}>Position {sortIcon('position')}</th>
            </tr>
          </thead>
          <tbody>
            {pageItems.map((g) => {
              const selected = compareStore.has(g.orf);
              return (
                <tr key={g.orf} onClick={() => navigate(`gene/${g.orf}`)}>
                  <td onClick={(e) => { e.stopPropagation(); compareStore.toggle(g.orf); }}>
                    <span className="icon-btn" style={{ width: 26, height: 26, borderRadius: 7, background: selected ? 'var(--accent)' : 'var(--panel)', color: selected ? 'var(--accent-contrast)' : 'var(--text-faint)', borderColor: selected ? 'transparent' : 'var(--border)' }} title={selected ? 'Remove from comparison' : 'Add to comparison'}>
                      {selected ? <Check size={14} /> : <Plus size={14} />}
                    </span>
                  </td>
                  <td className="mono" style={{ fontWeight: 650 }}>{g.orf}</td>
                  <td style={{ fontWeight: 650, color: g.gene ? 'var(--accent-strong)' : 'var(--text-faint)' }}>{g.gene ?? '—'}</td>
                  <td className="dim" style={{ maxWidth: 460, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.annotation}</td>
                  <td><CategoryTag id={g.category} /></td>
                  <td><EssentialityBadge call={essMap.get(g.orf)!} /></td>
                  <td className="tabnum dim" style={{ textAlign: 'right' }}>{fmtInt(g.length)} aa</td>
                  <td className="mono dim" style={{ fontSize: 12.5 }}>{g.strand}{(g.start / 1000).toFixed(0)}k</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!pageItems.length ? <div className="empty-state">No genes match these filters.</div> : null}
      </div>

      {pages > 1 ? (
        <div className="pagerow">
          <button className="btn btn-sm" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>Previous</button>
          <span className="dim tabnum" style={{ fontSize: 13.5 }}>Page {page + 1} of {pages}</span>
          <button className="btn btn-sm" disabled={page >= pages - 1} onClick={() => setPage((p) => Math.min(pages - 1, p + 1))}>Next</button>
        </div>
      ) : null}
    </div>
  );
}
