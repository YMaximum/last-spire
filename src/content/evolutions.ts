import type { EvolutionPath } from '../model/evolution';
import type { TowerId } from '../model/shared';

/** The two brass lineages available to each tower. Tier bonuses are incremental. */
export const EVOLUTION_PATHS: EvolutionPath[] = [
  {
    id: 'citadel',
    tower: 'bastion',
    name: 'Citadel',
    color: '#e8c879',
    coreName: 'Aegis Dynamo',
    signatureName: 'Bulwark Sigil',
    identity: 'A defensive core that stores shield energy and releases it through lineage hits.',
    tiers: [
      {
        name: 'Aegis Dynamo',
        description:
          'Transforms the core into an Aegis Dynamo: +8% core damage and +10% shield capacity. Shield absorption stores charge up to 20% of max HP. The next lineage hit adds min(stored charge, 20% of full hit damage); one shared 1-second cooldown applies per core, and charge is consumed once.',
        bonuses: { coreDamage: 0.08, shieldCapacity: 0.1 },
      },
      {
        name: 'Bulwark Sigil',
        description:
          'Evolves the signature into a Bulwark Sigil, granting an additional shield equal to 10% of max HP.',
        bonuses: { shieldCapacity: 0.1, coreRange: 0.04 },
      },
      {
        name: 'Citadel Ascendant',
        description:
          'Completes the shield-charge cycle: shielded primary attacks gain 10% damage, while shield absorption continues to charge the next lineage hit.',
        bonuses: { coreDamage: 0.08, shieldCapacity: 0.1 },
      },
    ],
  },
  {
    id: 'vanguard',
    tower: 'bastion',
    name: 'Vanguard',
    color: '#f2c76b',
    coreName: 'Sunforged Lens',
    signatureName: 'Marching Standard',
    identity: 'A solar targeting core marks priority enemies for nearby Bulwark strikes.',
    tiers: [
      {
        name: 'Sunforged Lens',
        description:
          'Transforms the core into a Sunforged Lens: +10% core damage and +5% core range. Core hits mark their target for 4 seconds.',
        bonuses: { coreDamage: 0.1, coreRange: 0.05 },
      },
      {
        name: 'Marching Standard',
        description:
          'Evolves the signature into a Marching Standard: +8% core attack rate. Bulwark strikes deal 40 damage to and apply 4-second solar marks to up to 5 nearest enemies.',
        bonuses: { coreRate: 0.08, coreDamage: 0.04 },
      },
      {
        name: 'Vanguard Cohort',
        description:
          'Completes the marked-target assault: the core deals 20% more damage to solar-marked enemies, while Bulwark strikes continue to mark up to 5 nearest enemies for 4 seconds.',
        bonuses: { coreDamage: 0.08, coreRate: 0.04 },
      },
    ],
  },
  {
    id: 'furnace',
    tower: 'pyre',
    name: 'Furnace',
    color: '#ff7048',
    coreName: 'Cinderheart Crucible',
    signatureName: 'Smelter Array',
    identity: 'A fire core seeds persistent burn fields, then enlarges and empowers them.',
    tiers: [
      {
        name: 'Cinderheart Crucible',
        description:
          'Transforms the core into a Cinderheart Crucible: +10% core damage. Core hits create a fire field dealing 12% of the hit as damage per tick for 2 seconds; field creation has a 1.5-second cooldown.',
        bonuses: { coreDamage: 0.1 },
      },
      {
        name: 'Smelter Array',
        description:
          'Evolves the signature into a Smelter Array: +8% core attack rate. Casting the signature creates one fire field at the tower, dealing 40 damage per tick for 6 seconds.',
        bonuses: { coreRate: 0.08, coreRange: 0.04 },
      },
      {
        name: 'Living Furnace',
        description:
          'Completes the field cycle: all fire fields deal 25% more damage per tick, including the core-seeded and signature-seeded fields.',
        bonuses: { coreDamage: 0.08, coreRange: 0.03 },
      },
    ],
  },
  {
    id: 'crownflare',
    tower: 'pyre',
    name: 'Crownflare',
    color: '#ffc65b',
    coreName: 'Corona Flywheel',
    signatureName: 'Solar Crown',
    identity:
      'A heat-storing core fuels mult-target signature blasts and a charged lineage finisher.',
    tiers: [
      {
        name: 'Corona Flywheel',
        description:
          'Transforms the core into a Corona Flywheel: +8% core attack rate. Successive core hits store heat, up to 10 charges.',
        bonuses: { coreRate: 0.08, coreDamage: 0.04 },
      },
      {
        name: 'Solar Crown',
        description:
          'Evolves the signature into a Solar Crown: +8% core damage. Signature attacks spend stored heat for 5 damage per heat against up to 5 targets.',
        bonuses: { coreDamage: 0.08, coreRange: 0.04 },
      },
      {
        name: 'Crown of Embers',
        description:
          'Completes the heat circuit: the next lineage attack consumes 10 stored heat to gain 40% bonus damage; signature attacks still spend heat for 5 damage per heat against up to 5 targets.',
        bonuses: { coreDamage: 0.08, coreRate: 0.04 },
      },
    ],
  },
  {
    id: 'stormweaver',
    tower: 'tempest',
    name: 'Stormweaver',
    color: '#8bd8e8',
    coreName: 'Chaincoil Loom',
    signatureName: 'Arc Conductor',
    identity:
      'A lightning core threads strikes through nearby enemies and strengthens signature chains.',
    tiers: [
      {
        name: 'Chaincoil Loom',
        description:
          'Transforms the core into a Chaincoil Loom: +8% core attack rate. Core hits link lightning to 1 nearby enemy for 20% of the hit damage; chain creation has a 0.6-second cooldown.',
        bonuses: { coreRate: 0.08, coreRange: 0.04 },
      },
      {
        name: 'Arc Conductor',
        description:
          'Evolves the signature into an Arc Conductor: +8% core damage. Signature chains hit up to 5 nearest enemies for 50 damage each.',
        bonuses: { coreDamage: 0.08, coreRange: 0.03 },
      },
      {
        name: 'Stormweaver Array',
        description:
          'Completes the evolution chain pattern: evolution-generated lightning chain damage is increased by 20%; unrelated chain effects are unchanged.',
        bonuses: { coreDamage: 0.08, coreRate: 0.04 },
      },
    ],
  },
  {
    id: 'thunderhead',
    tower: 'tempest',
    name: 'Thunderhead',
    color: '#f6d85b',
    coreName: 'Stormclock Escapement',
    signatureName: 'Charged Dynamo',
    identity:
      'A timed core strike sets up a charged target for a stronger signature follow-through.',
    tiers: [
      {
        name: 'Stormclock Escapement',
        description:
          'Transforms the core into a Stormclock Escapement: +10% core damage. Every 5th core hit calls a lightning strike for 30% of core hit damage; strike creation has a 1-second cooldown.',
        bonuses: { coreDamage: 0.1, coreRate: 0.04 },
      },
      {
        name: 'Charged Dynamo',
        description:
          'Evolves the signature into a Charged Dynamo: +8% core attack rate. Signature attacks apply a charged mark for 4 seconds.',
        bonuses: { coreRate: 0.08, coreRange: 0.04 },
      },
      {
        name: 'Thunderhead Convergence',
        description:
          'Completes the charged strike: lineage attacks deal 20% more damage against bosses; every 5th core hit still calls its 30% lightning strike, and signature attacks apply a 4-second charged mark.',
        bonuses: { coreDamage: 0.08, coreRange: 0.03 },
      },
    ],
  },
  {
    id: 'winterhold',
    tower: 'glacier',
    name: 'Winterhold',
    color: '#91d8ef',
    coreName: 'Rime Regulator',
    signatureName: 'Frost Bastion',
    identity:
      'A frost core slows enemies and turns signature power into a stronger protective shield.',
    tiers: [
      {
        name: 'Rime Regulator',
        description:
          'Transforms the core into a Rime Regulator: +8% core range. Core hits add 0.06 slow; the shared slow cap against bosses is unchanged.',
        bonuses: { coreRange: 0.08, coreDamage: 0.04 },
      },
      {
        name: 'Frost Bastion',
        description:
          'Evolves the signature into a Frost Bastion: +10% shield capacity. Signature activation grants an additional shield equal to 15% of max HP.',
        bonuses: { shieldCapacity: 0.1, shieldRegen: 0.08 },
      },
      {
        name: 'Winterhold Keep',
        description:
          'Completes the frost-shield cycle: absorbing shield damage releases frost for 20 damage within 70 radius; release has a 1-second cooldown. The boss slow limit remains unchanged.',
        bonuses: { shieldCapacity: 0.1, coreDamage: 0.08 },
      },
    ],
  },
  {
    id: 'shatterspire',
    tower: 'glacier',
    name: 'Shatterspire',
    color: '#c3eeff',
    coreName: 'Brittle Lens',
    signatureName: 'Glacial Rupture',
    identity:
      'A chilled-target core builds brittle damage and signature blasts respect control resistance.',
    tiers: [
      {
        name: 'Brittle Lens',
        description:
          'Transforms the core into a Brittle Lens: +10% core damage. Core hits against chilled enemies deal 15% bonus damage.',
        bonuses: { coreDamage: 0.1, coreRange: 0.04 },
      },
      {
        name: 'Glacial Rupture',
        description:
          'Evolves the signature into a Glacial Rupture: +8% core attack rate. Signature attacks deal 60 damage within 240 radius, respecting existing control resistance.',
        bonuses: { coreRate: 0.08, coreDamage: 0.04 },
      },
      {
        name: 'Shatterspire Crown',
        description:
          'Completes the brittle cycle: when control expires, the target takes 20 damage; this cannot apply crowd control and has a 3-second cooldown per target.',
        bonuses: { coreDamage: 0.08, coreRange: 0.03 },
      },
    ],
  },
  {
    id: 'rootwarden',
    tower: 'verdant',
    name: 'Rootwarden',
    color: '#79c978',
    coreName: 'Heartroot Engine',
    signatureName: 'Verdant Reservoir',
    identity:
      'A living core sustains health, while its signature converts stored vitality into healing.',
    tiers: [
      {
        name: 'Heartroot Engine',
        description:
          'Transforms the core into a Heartroot Engine: +8% core damage. Core hits heal 0.5 HP, with a 0.5-second cooldown and no overheal.',
        bonuses: { coreDamage: 0.08, healthRegen: 0.3 },
      },
      {
        name: 'Verdant Reservoir',
        description:
          'Evolves the signature into a Verdant Reservoir: +8% core range. Signature activation heals 8% of max HP.',
        bonuses: { coreRange: 0.08, healthRegen: 0.3 },
      },
      {
        name: 'Rootwarden Crown',
        description:
          'Completes the healing cycle: effective healing (actual HP restored) sends barbs for 20 damage to enemies within 180 radius; barb release has a 1-second cooldown.',
        bonuses: { coreDamage: 0.08, healthRegen: 0.3 },
      },
    ],
  },
  {
    id: 'blightbloom',
    tower: 'verdant',
    name: 'Blightbloom',
    color: '#a9c66d',
    coreName: 'Rotbloom Crucible',
    signatureName: 'Miasma Bellows',
    identity:
      'A toxic core lays poison fields and turns enemy deaths into capped, non-chaining bursts.',
    tiers: [
      {
        name: 'Rotbloom Crucible',
        description:
          'Transforms the core into a Rotbloom Crucible: +10% core damage. Core hits create a poison field dealing 10% of the hit as damage per tick for 2 seconds; field creation has a 1.5-second cooldown.',
        bonuses: { coreDamage: 0.1 },
      },
      {
        name: 'Miasma Bellows',
        description:
          'Evolves the signature into Miasma Bellows: +8% core range. Casting the signature creates one poison field at the tower, dealing 35 damage per tick for 6 seconds.',
        bonuses: { coreRange: 0.08, coreRate: 0.04 },
      },
      {
        name: 'Blightbloom Bloom',
        description:
          'Completes the poison cycle: poisoned enemies burst on death for 20% of core hit damage, capped at 80 damage; bursts have a 0.5-second cooldown and cannot chain.',
        bonuses: { coreDamage: 0.08, coreRange: 0.03 },
      },
    ],
  },
  {
    id: 'event-horizon',
    tower: 'null',
    name: 'Event Horizon',
    color: '#bd8cff',
    coreName: 'Gravitic Lens',
    signatureName: 'Singularity Well',
    identity:
      'A void core gathers enemies around its impact point before signatures deepen the gravity well.',
    tiers: [
      {
        name: 'Gravitic Lens',
        description:
          'Transforms the core into a Gravitic Lens: +8% core range. Void hits pull enemies toward the impact point; bosses resist the pull.',
        bonuses: { coreRange: 0.08, coreDamage: 0.04 },
      },
      {
        name: 'Singularity Well',
        description:
          'Evolves the signature into a Singularity Well: +8% core damage. The void field deals 35 damage per tick for 5 seconds.',
        bonuses: { coreDamage: 0.08, skillCooldown: 0.04 },
      },
      {
        name: 'Event Horizon Crown',
        description:
          'Completes the gravity cycle: enemies within 130 range take 15% more damage from lineage attacks while drawn toward the core impact point.',
        bonuses: { globalDamage: 0.04, coreRange: 0.04 },
      },
    ],
  },
  {
    id: 'rift-engine',
    tower: 'null',
    name: 'Rift Engine',
    color: '#a891f2',
    coreName: 'Phase-Shear Driver',
    signatureName: 'Rift Detonator',
    identity:
      'A phase-shearing core pierces targets at a defensive cost, then isolates them for burst damage.',
    tiers: [
      {
        name: 'Phase-Shear Driver',
        description:
          'Transforms the core into a Phase-Shear Driver: +10% core damage and +1 core pierce, but mitigation is reduced by 0.04.',
        bonuses: { coreDamage: 0.1, corePierce: 1, mitigation: -0.04 },
      },
      {
        name: 'Rift Detonator',
        description:
          'Evolves the signature into a Rift Detonator: +8% core range. Signature attacks burst for 100 damage against up to 5 nearest enemies; the burst cannot apply crowd control.',
        bonuses: { coreRange: 0.08, coreDamage: 0.04 },
      },
      {
        name: 'Rift Engine Prime',
        description:
          'Completes the isolation cycle: lineage attacks deal 25% more damage to targets with no nearby enemies.',
        bonuses: { coreDamage: 0.08, coreRate: 0.04 },
      },
    ],
  },
  {
    id: 'mirror-regent',
    tower: 'monolith',
    name: 'Mirror Regent',
    color: '#d6ddcd',
    coreName: 'Regent Mirror',
    signatureName: 'Prismatic Ward',
    identity:
      'A deterministic mirror core branches attacks, then rewards a fixed sequence of reflected critical hits.',
    tiers: [
      {
        name: 'Regent Mirror',
        description:
          'Transforms the core into a Regent Mirror: +8% core damage. Each root attack branches to 1 extra target for 20% of root damage; reflection has a 1.2-second cooldown and cannot trigger another reflection.',
        bonuses: { coreDamage: 0.08, coreRate: 0.04 },
      },
      {
        name: 'Prismatic Ward',
        description:
          'Evolves the signature into a Prismatic Ward: +10% shield capacity. Signature activation grants an additional shield equal to 10% of max HP.',
        bonuses: { shieldCapacity: 0.1, shieldRegen: 0.08 },
      },
      {
        name: 'Mirror Regent Ascendant',
        description:
          'Completes the reflection cycle: every 5th core hit is a deterministic critical hit for 40% bonus damage. It uses no RNG and cannot double through infusion.',
        bonuses: { coreDamage: 0.08, coreRate: 0.04 },
      },
    ],
  },
  {
    id: 'ironbriar',
    tower: 'monolith',
    name: 'Ironbriar',
    color: '#b0c49a',
    coreName: 'Briar Mirror',
    signatureName: 'Thorn Mortar',
    identity:
      'A thorned mirror returns incoming damage and converts shield absorption into stored barbs.',
    tiers: [
      {
        name: 'Briar Mirror',
        description:
          'Transforms the core into a Briar Mirror: +8% core damage. Returns 25% of root damage as barbs, capped at 60 damage, with a 0.8-second cooldown.',
        bonuses: { coreDamage: 0.08, mitigation: 0.02 },
      },
      {
        name: 'Thorn Mortar',
        description:
          'Evolves the signature into a Thorn Mortar: +8% core range. Signature attacks blast for 80 damage within 200 radius.',
        bonuses: { coreRange: 0.08, coreDamage: 0.04 },
      },
      {
        name: 'Ironbriar Heart',
        description:
          'Completes the absorption cycle: shield absorption stores 20% of max HP as barb charge. The next barb hit consumes that charge once, adding bonus damage capped at 40.',
        bonuses: { shieldCapacity: 0.1, coreDamage: 0.08 },
      },
    ],
  },
];

export const EVOLUTION_BY_ID: Record<EvolutionPath['id'], EvolutionPath> = Object.fromEntries(
  EVOLUTION_PATHS.map((path) => [path.id, path]),
) as Record<EvolutionPath['id'], EvolutionPath>;

export function evolutionPathsForTower(tower: TowerId): EvolutionPath[] {
  return EVOLUTION_PATHS.filter((path) => path.tower === tower);
}
