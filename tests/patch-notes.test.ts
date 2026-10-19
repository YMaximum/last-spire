// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PATCH_NOTES } from '../src/content/patch-notes';
import { openPatchNotes, patchNotesMarkup } from '../src/ui/patch-notes';

afterEach(() => document.body.replaceChildren());

describe('player patch notes', () => {
  it('shows the latest update expanded and keeps the complete earlier history accessible', () => {
    document.body.innerHTML = patchNotesMarkup();
    const entries = [...document.querySelectorAll<HTMLDetailsElement>('.patch-entry')];
    expect(entries).toHaveLength(PATCH_NOTES.length);
    expect(entries.filter((entry) => entry.open)).toHaveLength(1);
    expect(entries[0].open).toBe(true);
    for (const [index, note] of PATCH_NOTES.entries()) {
      expect(entries[index].querySelector('summary')?.textContent).toContain(note.title);
      expect(entries[index].querySelectorAll('li')).toHaveLength(note.changes.length);
      expect(entries[index].querySelector('.patch-compatibility')?.textContent).toContain(
        note.compatibility,
      );
      expect(entries[index].querySelectorAll('a, script, iframe, img')).toHaveLength(0);
    }
    entries[1].querySelector('summary')!.click();
    expect(entries[1].open).toBe(true);
  });

  it('opens an information window rather than a blocking run decision', () => {
    const open = vi.fn();
    openPatchNotes({ open });
    const [id, spec, markup] = open.mock.calls[0];
    expect(id).toBe('patch-notes');
    expect(spec.title).toBe('What’s new');
    expect(spec.choice).not.toBe(true);
    expect(markup).toBe(patchNotesMarkup());
  });

  it('keeps stable unique entries and explains save compatibility for every update', () => {
    expect(new Set(PATCH_NOTES.map((note) => note.id)).size).toBe(PATCH_NOTES.length);
    for (const note of PATCH_NOTES) {
      expect(note.id).toMatch(/^[a-z][a-z-]+$/);
      expect(note.title.length).toBeGreaterThan(0);
      expect(note.changes.length).toBeGreaterThan(0);
      expect(note.compatibility.length).toBeGreaterThan(0);
    }
  });
});
