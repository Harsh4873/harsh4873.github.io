import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { MobileNav } from './MobileNav';

function buttons(markup: string) {
  return markup.match(/<button[\s\S]*?<\/button>/g) ?? [];
}

describe('MobileNav context destinations', () => {
  it('marks Notes, rather than Brief, active on the notes tab', () => {
    const markup = renderToStaticMarkup(<MobileNav
      view="context"
      activeTab="notes"
      hasPaper
      onLibrary={vi.fn()}
      onReader={vi.fn()}
      onBrief={vi.fn()}
      onNotes={vi.fn()}
    />);
    const brief = buttons(markup).find((button) => button.includes('<span>Brief</span>'))!;
    const notes = buttons(markup).find((button) => button.includes('<span>Notes</span>'))!;

    expect(brief).not.toContain('is-active');
    expect(brief).not.toContain('aria-current');
    expect(notes).toContain('is-active');
    expect(notes).toContain('aria-current="page"');
  });

  it('marks Brief active for non-note context tabs', () => {
    const markup = renderToStaticMarkup(<MobileNav
      view="context"
      activeTab="sections"
      hasPaper
      onLibrary={vi.fn()}
      onReader={vi.fn()}
      onBrief={vi.fn()}
      onNotes={vi.fn()}
    />);
    const brief = buttons(markup).find((button) => button.includes('<span>Brief</span>'))!;
    const notes = buttons(markup).find((button) => button.includes('<span>Notes</span>'))!;

    expect(brief).toContain('is-active');
    expect(brief).toContain('aria-current="page"');
    expect(notes).not.toContain('is-active');
  });
});
