import { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import type { Gene } from '../lib/types';
import { searchGenes } from '../lib/search';
import { highlight } from '../lib/format';
import { navigate } from '../lib/router';
import { CategoryTag } from './common';

interface Props {
  genes: Gene[];
  variant?: 'nav' | 'hero';
  placeholder?: string;
  autoFocus?: boolean;
  onPick?: (gene: Gene) => void;
  focusRef?: React.RefObject<HTMLInputElement>;
}

function Hl({ text, query }: { text: string; query: string }) {
  return (
    <>
      {highlight(text, query).map((seg, i) => (seg.hit ? <span key={i} className="mark">{seg.text}</span> : <span key={i}>{seg.text}</span>))}
    </>
  );
}

export function GeneSearch({ genes, variant = 'nav', placeholder, autoFocus, onPick, focusRef }: Props) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const localRef = useRef<HTMLInputElement>(null);
  const inputRef = focusRef ?? localRef;

  const hits = useMemo(() => (query.trim() ? searchGenes(genes, query, 8) : []), [genes, query]);

  useEffect(() => setActive(0), [query]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const pick = (gene: Gene) => {
    setOpen(false);
    setQuery('');
    if (onPick) onPick(gene);
    else navigate(`gene/${gene.orf}`);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter')) setOpen(true);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, hits.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      if (hits[active]) pick(hits[active].gene);
    } else if (e.key === 'Escape') {
      setOpen(false);
      inputRef.current?.blur();
    }
  };

  return (
    <div className="search" ref={boxRef} style={variant === 'hero' ? { maxWidth: 620 } : undefined}>
      <div className="search-input-wrap">
        <Search size={17} style={{ color: 'var(--text-faint)', flex: 'none' }} />
        <input
          ref={inputRef}
          value={query}
          autoFocus={autoFocus}
          placeholder={placeholder ?? 'Search genes — Rv number, symbol, or function…'}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => query.trim() && setOpen(true)}
          onKeyDown={onKey}
          aria-label="Search genes"
          spellCheck={false}
        />
        {variant === 'nav' ? <span className="kbd">/</span> : null}
      </div>
      {open && query.trim() ? (
        <div className="search-results" role="listbox">
          {hits.length ? (
            hits.map((h, i) => (
              <div
                key={h.gene.orf}
                className={`search-row${i === active ? ' active' : ''}`}
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(h.gene);
                }}
              >
                <span className="sr-orf mono"><Hl text={h.gene.orf} query={query} /></span>
                <span className="sr-gene">{h.gene.gene ? <Hl text={h.gene.gene} query={query} /> : <span className="faint">—</span>}</span>
                <span className="sr-ann"><Hl text={h.gene.annotation} query={query} /></span>
                <CategoryTag id={h.gene.category} withLabel={false} />
              </div>
            ))
          ) : (
            <div className="search-empty">No genes match “{query}”.</div>
          )}
        </div>
      ) : null}
    </div>
  );
}
