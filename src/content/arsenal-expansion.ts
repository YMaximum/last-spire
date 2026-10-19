import type { CardDefinition } from '../model/arsenal';
import type { FusionDefinition } from './catalog';

/** Stable IDs also delimit the offer pool of recovered expeditions. */
export const EXPANSION_FUSIONS: FusionDefinition[] = [
  {
    id: 'fusion-pyroclasm',
    kind: 'fused-pyroclasm',
    name: 'Pyroclasm Engine',
    ingredients: ['flame', 'singularity'],
    color: '#f6a778',
    mechanic: 'burning-vortex',
    description:
      'Flame and gravity share their inherited budget. Traveling wells leave burning territory every 0.8s per core; bosses resist the pull. Fields last 2s and cannot create more fields.',
  },
  {
    id: 'fusion-tempest',
    kind: 'fused-tempest',
    name: 'Tempest Bell',
    ingredients: ['pulse', 'tesla'],
    color: '#d1e9ab',
    mechanic: 'pulse-network',
    description:
      'Expanding pulses link up to three nearby enemies with electrical bridges, once per second per core. Bridges deal 12% pulse damage, cannot chain, and retain one shared infusion budget.',
  },
  {
    id: 'fusion-reliquary',
    kind: 'fused-reliquary',
    name: 'Reprisal Reliquary',
    ingredients: ['rail', 'core-mirror'],
    color: '#dfdbbf',
    mechanic: 'pressure-lance',
    description:
      'Reflected incoming pressure charges the next piercing railshot, up to +60% damage. Charge is consumed once per rail volley; reflection keeps its cooldown and cannot recursively charge itself.',
  },
  {
    id: 'fusion-impact-well',
    kind: 'fused-impact-well',
    name: 'Impact Sepulcher',
    ingredients: ['meteor', 'core-gravitic'],
    color: '#deb2e8',
    mechanic: 'impact-implosion',
    description:
      'Each warned meteor leaves its burning scar, then opens a delayed 1.5s implosion field at 8% impact damage per tick. Pull is resisted by bosses; implosions cannot create additional meteors.',
  },
  {
    id: 'fusion-sanctuary',
    kind: 'fused-sanctuary',
    name: 'Sanctuary Carriers',
    ingredients: ['drone', 'core-mending'],
    color: '#a8e6c7',
    mechanic: 'recovery-carriers',
    description:
      'Effective healing stores up to 80 recovery. Carriers spend it on solar discharges against at most three nearby foes, once per 0.75s per core. Overhealing and discharge damage do not replenish recovery.',
  },
  {
    id: 'fusion-hoarfrost',
    kind: 'fused-hoarfrost',
    name: 'Hoarfrost Foundry',
    ingredients: ['ricochet', 'core-frost'],
    color: '#afe7f1',
    mechanic: 'frost-ricochet',
    description:
      'Discs engrave frost tracks every 0.4s per core. A ricochet releases a 20% damage shatter within 80 range, at most once per 0.6s. Frost tracks last 1.5s; shards never ricochet again.',
  },
  {
    id: 'fusion-parallax',
    kind: 'fused-parallax',
    name: 'Parallax Bastion',
    ingredients: ['core-mirror', 'core-gravitic'],
    color: '#c7bde9',
    mechanic: 'gravity-mirror',
    description:
      'Reflection redirects to up to two nearby threats with 35% return strikes, pulling them toward the original attacker. Shares the Mirror cooldown; secondary strikes cannot reflect or redirect again.',
  },
  {
    id: 'fusion-rimechoir',
    kind: 'fused-rimechoir',
    name: 'Rime Choir',
    ingredients: ['core-echo', 'core-frost'],
    color: '#c2d7f5',
    mechanic: 'frost-echo',
    description:
      'A Frost retaliation schedules one 35% frost refrain after 0.4s. One refrain per core may wait at a time. Echoes cannot repeat; chill shares the normal 65% limit and 30% boss limit.',
  },
].map((fusion) => ({ ...fusion, iconId: fusion.id })) as FusionDefinition[];

type Entry = [
  string,
  string,
  CardDefinition['group'],
  CardDefinition['scope'],
  string,
  number,
  string,
  string[],
];
const entries: Entry[] = [
  [
    'modifier-growth',
    'Accretion Shell',
    'modifier',
    'projectiles',
    'projectile-growth',
    0.22,
    'Traveling primary projectiles grow 22% in radius per simulation second, up to +150% and 75 radius. Growth adds collision coverage, not free damage. Beams, pulses, mines and carriers are ineligible.',
    ['size', 'lifetime'],
  ],
  [
    'modifier-rebound-charge',
    'Rebound Dynamo',
    'modifier',
    'projectiles',
    'rebound-charge',
    0.12,
    'A successful ricochet converts motion into +12% damage for later hits, capped at +60% per projectile. Requires bouncing projectiles; conversion does not add bounces or secondary triggers.',
    ['bounce', 'damage'],
  ],
  [
    'modifier-return-pulse',
    'Homeward Resonator',
    'modifier',
    'projectiles',
    'return-pulse',
    0.16,
    'Returning primary projectiles pulse for 16% launch damage within 80 range. Shared 0.7s cooldown per core; pulses cannot emit pulses. Requires a returning core or Return modifier.',
    ['return', 'pulse'],
  ],
  [
    'modifier-expiry-shards',
    'Sundering Fuse',
    'modifier',
    'projectiles',
    'expiry-shards',
    0.3,
    'Natural expiry of a traveling primary projectile releases three fragments sharing 30% of its damage. Fragments last 0.8s, cannot split, pulse or shatter. Shared 0.6s cooldown per core; collisions do not activate it.',
    ['expiry', 'split'],
  ],
  [
    'modifier-armor-erosion',
    'Siegebreaker Etching',
    'modifier',
    'tower',
    'armor-erosion',
    0.025,
    'Primary strikes erode 2.5 percentage points of armor every 0.4s per target. Lasts 3s after the last application; cap is six applications or 30 points. All sources benefit; armor never becomes negative.',
    ['armor', 'sustained'],
  ],
  [
    'trigger-crossfire',
    'Concordance Relay',
    'trigger',
    'tower',
    'crossfire',
    0.18,
    'Alternating primary hits from different equipped cores gain 18% damage, capped at +60%. The previous hit must be within 2s; one activation per target per 0.8s. Infusions of one hit count as one core.',
    ['coordination', 'hit'],
  ],
  [
    'defense-absorption-charge',
    'Aegis Reservoir',
    'defense',
    'defense',
    'absorption-charge',
    0.35,
    'Absorbed shield damage stores up to 25% of maximum HP. The next primary or root defensive strike converts 35% of the reservoir into bonus damage, at most once per 0.4s. Multi-element hits share that bonus; secondary damage cannot consume charge.',
    ['shield', 'charge', 'retaliation'],
  ],
  [
    'defense-healing-barrier',
    'Living Rampart',
    'defense',
    'defense',
    'healing-barrier',
    0.25,
    'Effective healing generates shield equal to 25% of HP actually restored, capped at 60% conversion and normal shield capacity. Overhealing grants none; shield gains cannot heal or trigger another conversion.',
    ['healing', 'shield'],
  ],
  [
    'defense-critical-mirror',
    'Flawless Facets',
    'defense',
    'defense',
    'critical-mirror',
    0.15,
    'Root reflections can critically strike for 1.7× damage: 15% chance, capped at 60%. One roll per reflected strike shared by its infusions. Bounced returns and echoes cannot roll again.',
    ['reflection', 'crit'],
  ],
  [
    'defense-briar-wounds',
    'Briar Inscription',
    'defense',
    'defense',
    'briar-wounds',
    0.2,
    'Root Thorn retaliation leaves a 3s physical wound dealing 20% strike damage per second, capped at 80 DPS per target. Refreshes rather than stacking; wounds cannot retaliate, leech or leave new wounds.',
    ['thorns', 'dot'],
  ],
  [
    'modifier-field-resonance',
    'Leyline Intersection',
    'modifier',
    'tower',
    'field-resonance',
    0.15,
    'A field tick gains 15% damage per different active elemental field overlapping its target, capped at +45%. Same-element fields add no resonance. Delayed warnings do not count; resonance creates no fields.',
    ['field', 'elements'],
  ],
  [
    'trigger-control-release',
    'Unbinding Seal',
    'trigger',
    'tower',
    'control-release',
    18,
    'When a stun ends or chill falls below 15%, release an 18-damage frost discharge within 70 range. Once per target per 3s, capped at 80 damage. The discharge applies no control and cannot trigger itself.',
    ['control', 'expiry'],
  ],
];
export const EXPANSION_CARDS: CardDefinition[] = entries.map(
  ([id, name, group, scope, effect, value, description, tags]) => ({
    id,
    name,
    group,
    scope,
    effect,
    value,
    description,
    tags,
    iconId: id,
    maxStacks: 12,
  }),
);
export const EXPANSION_CARD_IDS = EXPANSION_CARDS.map((card) => card.id);
export const EXPANSION_FUSION_IDS = EXPANSION_FUSIONS.map((fusion) => fusion.id);

/** Effective previews use post-rarity, post-stacking power and the real combat caps. */
export function expansionEffectPreview(
  effect: string,
  before: number,
  after: number,
): string | undefined {
  const percent = (value: number) => `${+(value * 100).toFixed(1)}%`;
  const change = (cap: number, label: string, suffix: string) =>
    `${label} ${percent(Math.min(cap, before))} → ${percent(Math.min(cap, after))} · ${suffix}`;
  switch (effect) {
    case 'projectile-growth':
      return change(Infinity, 'Radius growth/sec', '+150% maximum; radius ≤75');
    case 'rebound-charge':
      return change(0.6, 'Gain per ricochet', '+60% per projectile maximum');
    case 'return-pulse':
      return change(0.65, 'Returning pulse damage', '80 range; one pulse/0.7s/core');
    case 'expiry-shards':
      return change(0.8, 'Shared fragment budget', '3 fragments; one expiry/0.6s/core');
    case 'armor-erosion':
      return change(
        0.3,
        'Armor reduction/application',
        'six applications, ≤30 points; 3s duration',
      );
    case 'crossfire':
      return change(0.6, 'Alternating-core bonus', '2s coordination window; 0.8s/target');
    case 'absorption-charge':
      return change(0.8, 'Stored absorption converted', 'reservoir ≤25% max HP; one target/root');
    case 'healing-barrier':
      return change(
        0.6,
        'Effective healing → shield',
        'overhealing excluded; shield capacity applies',
      );
    case 'critical-mirror':
      return change(0.6, 'Reflection crit chance', '1.7× critical damage; root strikes only');
    case 'briar-wounds':
      return change(Infinity, 'Thorn wound DPS', '3s, ≤80 DPS per target; refreshes');
    case 'field-resonance':
      return change(0.45, 'Bonus per overlapping element', '+45% total maximum');
    case 'control-release':
      return `Control-release damage ${Math.min(80, before).toFixed(1)} → ${Math.min(80, after).toFixed(1)} · 70 range; 3s/target`;
  }
}
