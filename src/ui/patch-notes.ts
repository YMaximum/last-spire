import { PATCH_NOTES } from '../content/patch-notes';
import type { WindowManager } from './windows';

const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

export function patchNotesMarkup(): string {
  return `<div class="patch-notes"><p class="lead">From the spire’s workshop</p><p class="quiet">Gameplay changes included in this build, newest first. Older expeditions can retain earlier combat rules.</p>${PATCH_NOTES.map((note, index) => `<details class="patch-entry" ${index === 0 ? 'open' : ''}><summary><span class="patch-kicker">${index === 0 ? 'LATEST GAMEPLAY UPDATE' : 'EARLIER UPDATE'}</span><strong>${escape(note.title)}</strong><span>${escape(note.summary)}</span></summary><ul>${note.changes.map((change) => `<li>${escape(change)}</li>`).join('')}</ul><p class="patch-compatibility"><strong>Your save</strong> ${escape(note.compatibility)}</p></details>`).join('')}<p class="quiet">These notes describe included features, not planned updates. Reading them does not pause combat.</p></div>`;
}

export function openPatchNotes(manager: Pick<WindowManager, 'open'>): void {
  manager.open(
    'patch-notes',
    {
      title: 'What’s new',
      subtitle: 'LAST SPIRE · WORKSHOP JOURNAL',
      width: 700,
      height: 740,
    },
    patchNotesMarkup(),
  );
}
