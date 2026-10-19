import { EVOLUTION_BY_ID } from '../content/evolutions';
import type { EvolutionPathId } from '../model/evolution';

// Original brass mechanisms. Geometry is static: callers can supply an ID, never SVG.
const SILHOUETTES: Record<EvolutionPathId, string> = {
  citadel:
    '<path d="M17 17h30v21L32 51 17 38ZM23 23h18v12l-9 8-9-8Z"/><path d="M27 28h10v8H27zM32 24v16"/>',
  vanguard:
    '<path d="m32 12 12 18-12 22-12-22ZM12 30h13m14 0h13M32 18v8m0 10v10"/><path d="m13 19 6 6m26 12 6 6m-38 0 6-6m26-12 6-6"/>',
  furnace:
    '<path d="M18 24h28v25H18ZM23 16h18v8M14 49h36M24 43v-9l5-7 3 7 5-5 3 7v7Z"/><path d="M23 12v4m9-7v7m9-4v4"/>',
  crownflare:
    '<path d="m14 21 9 5 9-14 9 14 9-5-5 24H19ZM19 45h26v6H19Z"/><path d="m25 37 7-12 7 12-7 6Z"/>',
  stormweaver:
    '<path d="m18 18 14 12 14-12M18 46l14-16 14 16M18 18v28m28-28v28"/><path d="m34 15-9 19h8l-3 16 11-22h-9Z"/><circle cx="18" cy="18" r="4"/><circle cx="46" cy="18" r="4"/><circle cx="18" cy="46" r="4"/><circle cx="46" cy="46" r="4"/>',
  thunderhead:
    '<path d="M13 28h38l-6-13H19ZM20 28v7h24v-7M27 35l-6 11h10l-2 9 15-15H33l5-5"/><path d="M18 22h28M25 11v4m14-4v4"/>',
  winterhold:
    '<path d="M13 26 23 16v32H13ZM27 12h10v40H27ZM41 16l10 10v22H41Z"/><path d="m16 30 4-5m10-3 4-5m10 13 4-5M13 42h38"/>',
  shatterspire:
    '<path d="m32 10 8 15-7 9 6 20-15-14 5-11-6-8ZM12 26l10 9-6 13Zm32 4 8-8-5 24Z"/><path d="m30 18 3 9-4 7 5 10M16 53l7-7m21 5-4-8"/>',
  rootwarden:
    '<path d="M27 45V25l5-12 5 12v20M15 49l12-7m22 7-12-7M15 24c12 0 12 11 12 11C15 35 15 24 15 24Zm34-4c-12 0-12 11-12 11 12 0 12-11 12-11Z"/><path d="M32 31v10m-5-5h10M12 53h40"/>',
  blightbloom:
    '<path d="M32 49V30M18 21c-5-13 12-12 14 0 2-12 19-13 14 0 13-2 12 15 0 13 5 13-12 12-14 0-2 12-19 13-14 0-12 2-13-15 0-13Z"/><circle cx="32" cy="27" r="6"/><path d="M20 51h24m-19-9 7 5 7-5"/>',
  'event-horizon':
    '<path d="M14 18 24 10h16l10 8v28l-10 8H24l-10-8ZM20 23l8-7h8l8 7v18l-8 7h-8l-8-7Z"/><circle cx="32" cy="32" r="9"/><path d="M10 32h13m18 0h13M32 10v13m0 18v13"/>',
  'rift-engine':
    '<path d="M12 23h14l6-12 6 12h14v18H38l-6 12-6-12H12ZM18 28h28v8H18Z"/><path d="m20 19 24 26M24 17l24 26M16 47l9-9m14-12 9-9"/>',
  'mirror-regent':
    '<path d="m32 9 10 13-10 14-10-14ZM14 31l9 11-9 12-9-12Zm36 0 9 11-9 12-9-12Z"/><path d="m27 29-9 6m19-6 9 6M22 45h20M27 14l7 7m13 15 5 6m-41-6 5 6"/>',
  ironbriar:
    '<path d="M22 15h20l7 17-7 17H22l-7-17ZM27 23h10l4 9-4 9H27l-4-9Z"/><path d="m22 15-8-5 3 14m25-9 8-5-3 14M15 32l-7 6 13 2m28-8 7 6-13 2M24 49l-3 7 11-7 11 7-3-7"/>',
};

const xml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!,
  );

/** Safe, self-contained markup for menus. Unknown IDs never enter the markup. */
export function evolutionIcon(pathId: string, size = 40): string {
  const known = Object.hasOwn(SILHOUETTES, pathId);
  const path = known ? EVOLUTION_BY_ID[pathId as EvolutionPathId] : undefined;
  const label = xml(path?.name ?? 'Tower evolution');
  const color = path && /^#[0-9a-f]{6}$/i.test(path.color) ? path.color : '#d9c58e';
  const geometry = known
    ? SILHOUETTES[pathId as EvolutionPathId]
    : '<path d="M23 17h18v29H23ZM18 46h28M28 12h8v5M28 24h8v15h-8Z"/>';
  const pixels = Number.isFinite(size) ? Math.round(Math.min(128, Math.max(12, size))) : 40;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${pixels}" height="${pixels}" viewBox="0 0 64 64" role="img" aria-label="${label}"><title>${label}</title><path d="M14 57h36l5-5H9Z" fill="#10282c" stroke="#a68b57"/><path d="M19 54h4m5 0h8m5 0h4" stroke="#d9c58e" stroke-width="1"/><g fill="none" stroke="${color}" stroke-width="6" opacity=".12" stroke-linejoin="round">${geometry}</g><g fill="#10282c" stroke="#b89c63" stroke-width="2" stroke-linejoin="round" stroke-linecap="round">${geometry}</g><g fill="none" stroke="${color}" stroke-width=".8" opacity=".85">${geometry}</g></svg>`;
}
