import { cardIcon as legacyCardIcon } from './base-icons';
import { NEW_CARDS, FUSIONS } from '../content/catalog';

/** Original engraved machinery silhouettes. Geometry, not recoloring, identifies each family. */
const SHAPES: Record<string, string> = {
  'weapon-core-mirror': '<path d="m24 4 15 9-3 23-12 9-12-9-3-23Z"/><path class="jade" d="m24 11 9 6-2 15-7 6-7-6-2-15Z"/><path fill="none" d="M4 15h12M11 10l5 5-5 5M32 31h12M39 26l5 5-5 5M24 11v27M15 17l18 15M33 17 15 32"/>',
  'weapon-core-thorn': '<path d="m7 18 3 19h28l3-19-10 8-7-19-7 19Z"/><path class="jade" d="m16 32 8-8 8 8-8 7Z"/><path d="m7 18-4-7 10 3M41 18l4-7-10 3M24 7V2M10 37l-4 7 10-4M38 37l4 7-10-4"/>',
  'weapon-core-capacitor': '<path d="M15 5h18v6l5 5v24H10V16l5-5ZM14 44h20"/><path fill="none" d="M10 20h28M10 34h28M19 16v20M29 16v20"/><path class="jade" d="m26 14-10 14h8l-2 9 11-15h-8Z"/>',
  'weapon-core-cinder': '<path d="M9 12h30l-3 23-12 10-12-10ZM13 5h22v7H13Z"/><path class="jade" d="M24 36c-13-1-10-11-4-15-2 6 4 6 3 1l4-8c-1 7 11 15 1 21l-2-8Z"/><path fill="none" d="M4 18h8M36 18h8M3 25h10M35 25h10"/>',
  'weapon-core-frost': '<path d="m24 3 15 10-3 22-12 10-12-10-3-22Z"/><path fill="none" class="jade" d="M24 12v24M14 18l20 12M14 30l20-12M20 14l4 4 4-4M20 34l4-4 4 4M14 22l6-1-1-6M29 33l-1-6 6-1M14 26l6 1-1 6M29 15l-1 6 6 1"/>',
  'weapon-core-mending': '<path d="M8 11 24 4l16 7-3 22-13 12-13-12Z"/><path class="jade" d="M20 14h8v8h8v8h-8v8h-8v-8h-8v-8h8Z"/><path fill="none" d="M4 4v7M1 7h7M40 38v8M36 42h8"/>',
  'weapon-core-gravitic': '<path d="m24 3 15 9-3 24-12 9-12-9-3-24Z"/><ellipse fill="none" cx="24" cy="25" rx="19" ry="7" transform="rotate(-28 24 25)"/><circle cx="24" cy="25" r="9"/><circle class="jade" cx="24" cy="25" r="4"/><path d="m5 31 8-1-5 7M41 12l-7 5 8 2"/>',
  'weapon-core-echo': '<path fill="none" d="m15 5 14 7-2 22-12 10L4 34 2 12ZM30 5l14 7-2 22-12 10-4-4"/><path class="jade" d="m15 14 6 3-1 13-5 5-5-5-1-13ZM31 14l6 3-1 13-5 5-3-3 3-3Z"/><path fill="none" d="M19 3h7M23 41h5"/>',
  'mod-insight': '<path d="M5 31 18 27l6 3 6-3 13 4v12l-13-4-6 4-6-4-13 4Z"/><path fill="none" d="M24 30v13M10 33l8-2M30 31l8 2"/><circle cx="23" cy="14" r="10"/><circle class="jade" cx="23" cy="14" r="5"/><path d="m30 20 10 4-4 5-8-7Z"/>',
  'mod-trophy-lore': '<path d="M14 5h20v13l-6 7v8h8v7H12v-7h8v-8l-6-7ZM8 44h32"/><path fill="none" d="M14 8H6v10l9 5M34 8h8v10l-9 5"/><path class="jade" d="m24 8 3 6 7 1-5 4 1 7-6-4-6 4 1-7-5-4 7-1Z"/>',
  'on-learning-chain': '<path d="M4 31h12v12H4ZM18 18h12v12H18ZM32 4h12v12H32Z"/><path fill="none" d="m11 28 6-11 12-7M16 36h9l13-13v-5"/><path class="jade" d="m8 34 5 3-5 3ZM22 21l5 3-5 3ZM36 7l5 3-5 3Z"/>',
  'on-last-lesson': '<path d="m9 6 23-3 8 8-1 31-29 3-3-24Z"/><path fill="none" d="m22 4-5 14 10 3-7 8 5 15M29 11h7M29 16h7"/><path class="jade" d="M13 32c-7-9 2-15 7-9 5-6 13 0 7 7l-7 7Z"/><path fill="none" d="M11 40h6M28 35h7M29 39h6"/>',
  'utility-apprenticeship': '<path d="m22 3-8 7 3 4L5 42l5-2 13-24h3l12 24 5 2-12-28 3-4-8-7Z"/><circle class="jade" cx="24" cy="10" r="4"/><path fill="none" d="M13 30q11 10 22 0M17 23h14M24 35v10M20 41h8"/>',
  'utility-shared-study': '<path d="M3 10h16l5 4 5-4h16v27H29l-5 4-5-4H3Z"/><path fill="none" d="M24 14v27M7 16h11M7 21h11M30 16h11M30 21h11"/><path class="jade" d="m7 27 6-4 5 4h-3v5h-5v-5ZM41 27l-6-4-5 4h3v5h5v-5Z"/>',
  'mod-rebound-coating': '<path d="m29 5 14 7-3 25-13 8-7-9 6-11-6-11Z"/><path class="jade" d="m29 12 8 4-2 17-8 5 5-13-6-6Z"/><path fill="none" d="M3 7 24 24 4 39M4 31v8h8M13 21l5 4-5 4"/>',
  'on-serrated-refraction': '<path d="m24 5 16 18-16 20L8 23Z"/><path class="jade" d="m24 12 10 11-10 13-10-13Z"/><path d="m6 11 8 1-6 6ZM40 11l-6 1 6 6ZM6 35l8-1-6-6ZM40 35l-6-1 6-6Z"/><path fill="none" d="M24 12v24M14 23h20"/>',
  'def-mending-conversion': '<path d="M11 6h23v13l-6 8v10h9v7H9v-7h10V27l-8-8Z"/><path fill="none" d="M8 14h29M3 6v16l6 5M37 6h7v16l-6 5"/><path class="jade" d="m26 10-8 12h7l-2 9 10-14h-8Z"/><path fill="none" d="m41 30-4 4 4 4M6 33l-3 4 3 4"/>',
  'on-aegis-siphon': '<path d="M24 5 42 13l-3 21-15 10-10-7 9-14-9-9Z"/><path class="jade" d="M28 14h6v6h5v6h-5v6h-6v-6h-5v-6h5Z"/><path d="m3 13 17 10-17 9 4-9Z"/><path fill="none" d="m5 7 8 4M5 38l8-5"/>',
  'on-pain-reserve': '<path d="m24 3 15 13v18L24 45 9 34V16Z"/><path fill="none" d="m14 16 18 4-16 5 16 5-17 5M18 9v6M30 35v6"/><path class="jade" d="m2 21 6 3-6 3ZM46 21l-6 3 6 3Z"/><path d="m23 15-2 10h6l-2 10 8-13h-7l3-7Z"/>',
  'mod-ward-reach': '<path d="m24 14 9 4-1 13-8 7-8-7-1-13Z"/><path class="jade" d="m24 20 4 2v7l-4 4-4-4v-7Z"/><path fill="none" d="M11 10Q-3 24 11 38M37 10q14 14 0 28M6 4q-21 20 0 40M42 4q21 20 0 40M15 6q9-5 18 0M15 42q9 5 18 0"/>',
  'mod-mass-driver': '<path d="M2 14h12v20H2ZM14 19h10v10H14Z"/><circle cx="34" cy="24" r="12"/><circle class="jade" cx="34" cy="24" r="7"/><path fill="none" d="M5 9h18M5 39h18M8 19v10M33 5l5 4M33 43l5-4"/>',
  'mod-long-flight': '<path d="M5 4h20v5L11 23l14 14v6H5v-6l14-14L5 9Z"/><path class="jade" d="m10 10 5 6 5-6ZM10 37l5-6 5 6Z"/><path d="m27 20 14 3-14 4 5-4Z"/><path fill="none" d="M25 14h13M26 32h12M32 9l4-4M32 39l4 4"/>',
  'mod-accelerant': '<path d="m6 11 13 13L6 37V28l4-4-4-4ZM19 11l13 13-13 13V28l4-4-4-4Z"/><path class="jade" d="m32 11 13 13-13 13V28l4-4-4-4Z"/><path fill="none" d="M2 6h22M2 42h22M5 16H1M5 32H1"/>',
  'mod-wake-condenser': '<ellipse fill="none" cx="14" cy="24" rx="10" ry="19"/><ellipse fill="none" class="jade" cx="27" cy="24" rx="6" ry="15"/><path d="m12 20 25-4 9 8-9 8-25-4 9-4Z"/><path class="jade" d="m32 21 7-1 4 4-4 4-7-1 4-3Z"/><path fill="none" d="M4 24H1M8 8 4 4M8 40l-4 4"/>',
  'fusion-lance': '<path d="m5 42 18-24-2-6L42 3l-9 21-6-2L5 42Z"/><path class="jade" d="m12 35 21-23-4 12Z"/><path d="m4 12 10 1-1 10-3-6ZM27 35l10-1 4 10-7-6ZM3 30l8-1-3 6Z"/><path fill="none" d="M18 31l-4-4M25 24l-4-4M35 12l-4 4"/>',
  'fusion-prism': '<path d="M7 27h34v16H7ZM12 22V12l12-9 12 9v10l-12 9Z"/><path class="jade" d="m24 9 7 5-7 11-7-11Z"/><path fill="none" d="M24 9v16M17 14h14M13 35h22M12 40h24"/><path d="m2 6 11 7-2 4-8-4ZM46 6l-11 7 2 4 8-4ZM20 1h8l-4 6Z"/>',
  'fusion-orrery': '<ellipse fill="none" cx="24" cy="24" rx="22" ry="10" transform="rotate(-34 24 24)"/><path d="M24 8a16 16 0 1 1-16 16c4 8 17 10 23 1 4-6 1-13-7-17Z"/><path class="jade" d="M20 16a9 9 0 1 1-5 13c6 3 13-5 5-13Z"/><path d="m5 28 8-2-2 9-3-4-6 1ZM36 10l9-1-3 8-2-4-6 1Z"/><path fill="none" d="m17 5 4-3M32 41l-4 4"/>',
  'fusion-conduit': '<path d="M5 7h10v34H5ZM33 7h10v34H33Z"/><path fill="none" d="M2 13h16M2 20h16M2 28h16M2 35h16M30 13h16M30 20h16M30 28h16M30 35h16"/><path class="jade" d="m15 15 10 6-3-9 12 13-10-4 3 14-12-10 6 1Z"/><path fill="none" d="m23 3 3 5M23 40l3 5"/>',
  'fusion-citadel': '<path d="M10 11h28v9l7 9-4 13H7L3 29l7-9ZM13 3h6v8h-6ZM29 3h6v8h-6Z"/><path d="M19 7h10v9H19Z"/><path class="jade" d="m24 17 8 7-2 13H18l-2-13Z"/><path fill="none" d="M24 17v20M16 26h16M9 26l-5 3M9 34H3M39 26l5 3M39 34h6"/><circle cx="13" cy="19" r="3"/><circle cx="35" cy="19" r="3"/>',
  'fusion-cataclysm': '<path d="M4 29h40l-7 7-7 1-1 5h7v4H12v-4h7l-1-5-7-1Z"/><path class="jade" d="m25 8 7 8-4 10-10-2-3-8Z"/><path d="m26 2 8 7-4 1ZM10 3l7 10-4 1-6-7ZM39 3l-5 10 4 1 6-8Z"/><path fill="none" d="m9 22 4 4M36 22l-4 4M21 30l4 3 4-3"/>',
  'fusion-cathedral': '<path d="m24 2 6 11h-3v8l7-12 6 12h-3v20H11V21H8l6-12 7 12v-8h-3Z"/><path class="jade" d="m24 19 7 8-2 10H19l-2-10Z"/><path fill="none" d="M24 19v18M17 27h14M2 23v15l5 4M46 23v15l-5 4M2 23l5 4M46 23l-5 4"/>',
  'fusion-briar': '<path d="M24 43C-5 25 4 5 17 11l7 8 7-8C44 5 53 25 24 43Z"/><path class="jade" d="M20 23h8v6h6v6h-6v6h-8v-6h-6v-6h6Z"/><path d="m5 15 1-9 8 4ZM42 15l-1-9-8 4ZM9 31l-8 2 6 5ZM39 31l8 2-6 5ZM20 8l4-7 4 7Z"/><path fill="none" d="m9 20 8 2M39 20l-8 2"/>',
  'fusion-dynamo': '<path d="m24 3 7 7h9v9l7 5-7 5v9h-9l-7 7-7-7H8v-9l-7-5 7-5v-9h9Z"/><circle cx="24" cy="24" r="13"/><path fill="none" class="jade" d="M24 14v20M15 19l18 10M15 29l18-10M21 15l3 4 3-4M21 33l3-4 3 4M15 23l5-1-1-5M29 31l-1-5 5-1M15 25l5 1-1 5M29 17l-1 5 5 1"/>',
  'fusion-crucible': '<path d="M5 21h38l-6 17H11ZM12 38h6l-3 7H9ZM30 38h6l3 7h-6Z"/><ellipse fill="none" cx="24" cy="15" rx="19" ry="6" transform="rotate(-22 24 15)"/><circle cx="24" cy="15" r="9"/><path class="jade" d="M24 6c-7 8 6 6 1 13 11-6 0-8-1-13ZM17 26l5 6-4 2 6 2 6-3-4-7 1 5Z"/><path fill="none" d="M9 25h5M34 25h5"/>',
  'fusion-barbed': '<ellipse fill="none" cx="24" cy="24" rx="21" ry="9" transform="rotate(-30 24 24)"/><path d="m24 10 11 6-2 17-9 9-9-9-2-17Z"/><path class="jade" d="m24 17 5 4-1 10-4 4-4-4-1-10Z"/><path d="m2 24 13-3-4 12-2-5-5 3ZM35 4l-1 13 12-4-5-2 3-5ZM35 35l9-1-3 10-2-5-5 2Z"/><path fill="none" d="M8 9l6 7M32 36l3 8"/>',
  'fusion-thunder': '<path d="M24 4 37 17v18L24 45 11 35V17Z"/><path fill="none" d="M7 12 2 20v12l5 8M41 12l5 8v12l-5 8M12 8l-5 6M36 8l5 6"/><path class="jade" d="m26 11-10 16h8l-2 12 12-19h-9Z"/><path fill="none" d="M15 36h18M17 40h14M20 3h8"/>',
};
const ICON_CACHE = new Map<string, string>();

export function cardIcon(iconId: string, size = 40): string {
  if (!Object.prototype.hasOwnProperty.call(SHAPES, iconId)) return legacyCardIcon(iconId, size);
  const pixels = Number.isFinite(size) ? Math.max(12, Math.min(256, Math.round(size))) : 40;
  const cacheKey = `${iconId}:${pixels}`;
  const cached = ICON_CACHE.get(cacheKey);
  if (cached) return cached;
  const title = NEW_CARDS.find(card => card.iconId === iconId)?.name || FUSIONS.find(fusion => fusion.iconId === iconId)?.name || 'Arcane inscription';
  const shape = SHAPES[iconId].replaceAll('fill="none" class="jade"', 'fill="none" stroke="#a1dcc0"').replace(/fill="none"(?! stroke=)/g, 'fill="none" stroke="#c9ad7c"').replaceAll('class="jade"', 'fill="#a1dcc0" stroke="#5d927c"');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${pixels}" height="${pixels}" viewBox="0 0 48 48" role="img" aria-label="${title.replaceAll("'", '&#39;')}"><title>${title}</title><g fill="#c9ad7c" stroke="#8e805f" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${shape}</g></svg>`;
  ICON_CACHE.set(cacheKey, svg);
  if (ICON_CACHE.size > 256) ICON_CACHE.delete(ICON_CACHE.keys().next().value!);
  return svg;
}
export const iconMarkup = cardIcon;
