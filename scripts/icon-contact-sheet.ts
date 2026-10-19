import { EVOLUTION_PATHS } from '../src/content/evolutions';
import { evolutionIcon } from '../src/ui/evolution-icons';
/** Rebuild the bundled review sheet from the same SVGs used by the game. */
import { writeFileSync } from 'node:fs';
import { CARDS, FUSIONS, EXPANSION_CARD_IDS, EXPANSION_FUSION_IDS } from '../src/content/catalog';
import { cardIcon } from '../src/ui/icons';
const esc = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
const row = (id: string, name: string) =>
  `<article><h3>${esc(name)}</h3><div class="marks">${[24, 40, 64].map((size) => `<figure>${cardIcon(id, size)}<figcaption>${size}px</figcaption></figure>`).join('')}</div><small>${esc(id)}</small></article>`;
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Last Spire · Original relic marks</title><style>
:root{color-scheme:dark;color:#e9e1cc;background:#101916;font:18px/1.5 system-ui,sans-serif}*{box-sizing:border-box}body{max-width:1600px;margin:auto;padding:24px}h1,h2{color:#d6be88;font-family:Georgia,serif}h3{font-size:18px;margin:0 0 12px}p{max-width:72ch}section{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px;margin:24px 0 48px}article{border:1px solid #776c4b;background:linear-gradient(135deg,#26342a,#15231e);padding:18px;border-radius:6px}.marks{display:flex;align-items:end;gap:22px}figure{margin:0;display:flex;flex-direction:column;align-items:center;gap:10px}figcaption,small{font-size:14px;color:#c2bea9}small{display:block;margin-top:12px;overflow-wrap:anywhere}.rarities{display:flex;flex-wrap:wrap;gap:16px}.rarity{padding:16px;border:2px solid var(--tier);border-radius:8px;box-shadow:inset 0 0 20px #0008}.rarity span{display:block;margin-top:8px}.rarity:last-child{animation:awaken 3s ease-in-out infinite}@keyframes awaken{50%{box-shadow:0 0 20px #e7c99255}}@media(prefers-reduced-motion:reduce){*{animation:none!important}}
</style></head><body><h1>Last Spire · The engraved arsenal</h1><p>Original arcane machinery silhouettes. Review actual gameplay sizes: 24, 40, and 64 pixels. Family geometry stays recognizable across rarity frames.</p><h2>Twelve new support families</h2><section>${CARDS.filter(
  (c) => EXPANSION_CARD_IDS.includes(c.id),
)
  .map((c) => row(c.iconId, c.name))
  .join('')}</section><h2>Eight alternative fusion engines</h2><section>${FUSIONS.filter((f) =>
  EXPANSION_FUSION_IDS.includes(f.id),
)
  .map((f) => row(f.iconId, f.name))
  .join(
    '',
  )}</section><h2>Fourteen tower evolution lineages</h2><section>${EVOLUTION_PATHS.map((path) => `<article><h3>${esc(path.name)}</h3><div class="marks">${[24, 40, 64].map((size) => `<figure>${evolutionIcon(path.id, size)}<figcaption>${size}px</figcaption></figure>`).join('')}</div><small>${path.tiers.map((tier) => esc(tier.name)).join(' → ')}</small></article>`).join('')}</section><h2>Rarity frames</h2><div class="rarities">${[
  ['Normal', '#c2c4ad'],
  ['Rare', '#77c7c0'],
  ['Epic', '#b39bd4'],
  ['Legendary', '#e2bc73'],
  ['Mythic', '#ec9cb8'],
]
  .map(
    ([name, color]) =>
      `<div class="rarity" style="--tier:${color}">${cardIcon('modifier-growth', 40)}<span>${name}</span></div>`,
  )
  .join(
    '',
  )}</div><h2>All ${CARDS.length} card families</h2><section>${CARDS.map((c) => row(c.iconId, c.name)).join('')}</section><h2>All ${FUSIONS.length} fusions</h2><section>${FUSIONS.map((f) => row(f.iconId, f.name)).join('')}</section></body></html>`;
for (const target of ['public/icon-contact-sheet.html', 'docs/icon-contact-sheet.html'])
  writeFileSync(target, html + '\n');
console.log(`Generated ${CARDS.length} families and ${FUSIONS.length} fusions at three sizes.`);
