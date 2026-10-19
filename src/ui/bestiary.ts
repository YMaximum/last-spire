import {
  ENEMIES,
  ENEMY_BY_ID,
  FINAL_BOSSES,
  enemyStats,
  enemyDamageType,
  formationName,
  waveRoster,
  type BestiaryRecords,
  type EnemyArchetypeId,
  type EnemyDefinition,
} from '../content/enemies';

export interface BestiaryOptions {
  stage: number;
  wave: number;
  difficulty: number;
  mode: 'quick' | 'normal' | 'endless';
  records: BestiaryRecords;
  selected?: EnemyArchetypeId;
  query?: string;
  /** List filter; defaults to the active run stage. */
  filter?: 'all' | 0 | 1 | 2;
  /** Indicates that this preview is being shown beside a recovered legacy run. */
  legacy?: boolean;
}

const esc = (value: unknown): string =>
  String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[char]!,
  );

const titleCase = (value: string): string =>
  value.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
const modeWaveMax = (mode: BestiaryOptions['mode']): number => 100000;
const effectiveFirstWave = (enemy: EnemyDefinition, mode: BestiaryOptions['mode']): number =>
  enemy.id === 'guardian'
    ? mode === 'quick'
      ? 12
      : 25
    : enemy.mechanic === 'shared'
      ? enemy.firstWave
      : mode === 'quick'
        ? Math.max(1, Math.ceil(enemy.firstWave / 2))
        : enemy.firstWave;
const finalBossWave = (mode: BestiaryOptions['mode']): number => (mode === 'quick' ? 50 : 100);
const formatNumber = (value: number): string =>
  Number.isInteger(value) ? String(value) : value.toFixed(1);

/** Small original silhouette glyphs; no external artwork or image requests. */
export function enemyEmblem(id: EnemyArchetypeId, size = 42): string {
  const enemy = ENEMY_BY_ID[id];
  const color = enemy.color;
  const common: Partial<Record<EnemyArchetypeId, string>> = {
    swarmer:
      '<path d="M32 12 39 23 52 20 47 33 53 44 39 42 32 54 25 42 11 44 17 33 12 20 25 23Z"/><circle cx="26" cy="31" r="2" fill="#282923"/><circle cx="38" cy="31" r="2" fill="#282923"/>',
    runner:
      '<path d="m12 37 18-19 22 7-10 12 10 8-23 3-17-5Z"/><path d="m23 42-9 10m24-7 8 7" fill="none" stroke="currentColor" stroke-width="4"/>',
    armored:
      '<path d="m32 9 19 10v16L32 55 13 35V19Z"/><path d="m21 23 11-6 11 6-2 13-9 10-9-10Z" fill="#282923" opacity=".42"/>',
    ranged:
      '<path d="M32 10 45 25 41 46 32 53 23 46 19 25Z"/><path d="m29 21 19 9-19 2m-4 2 19 8" fill="none" stroke="#282923" stroke-width="3"/>',
    support:
      '<path d="M32 11 50 21v20L32 53 14 41V21Z"/><path d="M32 19v27M21 32h22M24 24l16 16m0-16L24 40" fill="none" stroke="#282923" stroke-width="3"/>',
    splitter:
      '<path d="M32 11 47 22 43 38 32 53 21 38 17 22Z"/><path d="m31 18 3 13-6 5 7 4-3 8" fill="none" stroke="#282923" stroke-width="3"/>',
    elite:
      '<path d="m12 18 12 8 8-15 8 15 12-8-5 27-15 11-15-11Z"/><path d="M22 34h20" stroke="#282923" stroke-width="4"/>',
    guardian:
      '<path d="M32 8 52 17v17c0 12-9 20-20 23-11-3-20-11-20-23V17Z"/><path d="M32 17v29m-10-14h20" stroke="#282923" stroke-width="4"/>',
    'thorn-retaliator':
      '<path d="m32 8 7 13 14-5-6 15 11 9-16 2-3 15-9-12-13 8 4-16-13-9 16-2Z"/><circle cx="32" cy="33" r="7" fill="#282923"/>',
    'spore-shepherd':
      '<path d="M32 28c-10-1-15-8-12-15 7-5 15 0 12 15Zm3 0c-1-10 5-16 12-14 5 7 0 14-12 14ZM29 31c-9-6-17-3-18 5 4 7 12 7 18-5Zm6 2c7-8 15-7 18-1-1 8-9 11-18 1ZM31 34h3v19h-3z"/>',
    burrower:
      '<path d="M11 42 22 25l8 7 9-17 14 27-10 8H20Z"/><path d="m19 44 13-10 14 10" fill="none" stroke="#282923" stroke-width="3"/>',
    'plated-crawler':
      '<path d="M11 37c2-14 10-21 21-21s19 7 21 21l-8 12H19Z"/><path d="M18 35h28M22 25l10-8 10 8m-19 13-3 8m17-8 3 8" fill="none" stroke="#282923" stroke-width="3"/>',
    'furnace-artillery':
      '<path d="M12 35h26l7-13 7 4-4 15H19Z"/><path d="M17 41v10m27-10v10M25 30h11" stroke="#282923" stroke-width="4"/>',
    'forge-carrier':
      '<path d="M12 42 18 22l14-9 14 9 6 20-20 11Z"/><path d="M22 30h20m-10-9v25m-8-4h16" fill="none" stroke="#282923" stroke-width="3"/>',
    'rift-skirmisher':
      '<path d="M16 44 33 12l15 12-17 9 17 8-16 11-3-16Z"/><path d="m15 18 8 4m25 22 5 5" stroke="#282923" stroke-width="3"/>',
    'pulse-caster':
      '<path d="M32 9 44 18 42 42 32 54 22 42 20 18Z"/><circle cx="32" cy="31" r="10" fill="none" stroke="#282923" stroke-width="3"/><circle cx="32" cy="31" r="3" fill="#282923"/>',
    'echo-attacker':
      '<path d="M19 18 38 13 47 28 39 46 21 48 14 33Z"/><path d="m26 18 18 4-8 13 10 8M15 26l10 7-8 10" fill="none" stroke="#282923" stroke-width="3"/>',
    'elder-root':
      '<path d="M32 53V25m0 12L13 20m19 10 18-18M31 27l-4-15m6 41 17-11M32 39 14 48" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round"/><circle cx="32" cy="20" r="8"/>',
    'forge-colossus':
      '<path d="M17 51V25L23 12h18l6 13v26l-8-5H25Z"/><path d="M24 24h16m-8-8v28m-8 3h16" stroke="#282923" stroke-width="4"/>',
    'last-eclipse':
      '<circle cx="32" cy="32" r="21"/><circle cx="39" cy="25" r="17" fill="#282923" opacity=".72"/><path d="m13 45 8-6 8 7 9-4 10 5" fill="none" stroke="#282923" stroke-width="3"/>',
  };
  const art = common[id] ?? common.swarmer!;
  return `<svg class="bestiary-emblem" width="${size}" height="${size}" viewBox="0 0 64 64" role="img" aria-label="${esc(enemy.name)} silhouette" style="color:${esc(color)}"><g fill="${esc(color)}" stroke="${esc(color)}" stroke-linejoin="round">${art}</g></svg>`;
}

const filteredEnemies = (options: BestiaryOptions): EnemyDefinition[] => {
  const filter = options.filter ?? options.stage;
  const query = options.query?.trim().toLocaleLowerCase() ?? '';
  return ENEMIES.filter((enemy) => {
    if (filter !== 'all' && enemy.stage !== undefined && enemy.stage !== filter) return false;
    if (!query) return true;
    return [
      enemy.name,
      enemy.id,
      enemy.role,
      enemy.mechanic,
      enemy.attack,
      enemy.telegraph,
      enemy.strength,
      enemy.weakness,
      enemy.limits,
    ].some((field) => field.toLocaleLowerCase().includes(query));
  });
};

const spawnLabel = (enemy: EnemyDefinition, mode: BestiaryOptions['mode']): string => {
  if (enemy.id === FINAL_BOSSES[enemy.stage ?? 0]) return `Final boss · ${finalBossWave(mode)}`;
  return `First spawn · ${effectiveFirstWave(enemy, mode)}`;
};

const resistanceMarkup = (enemy: EnemyDefinition): string => {
  const entries = Object.entries(enemy.resistance ?? {});
  if (!entries.length) return '<p><b>Resistances</b> None listed.</p>';
  return `<p><b>Resistances and vulnerabilities</b> ${entries
    .map(([element, value]) => {
      const amount = Math.round(Math.abs(value) * 100);
      return `${titleCase(element)} ${value < 0 ? `${amount}% extra damage` : `${amount}% resistance`}`;
    })
    .join(' · ')}</p>`;
};

const detailsMarkup = (enemy: EnemyDefinition, options: BestiaryOptions): string => {
  const context = {
    stage: options.stage,
    wave: options.wave,
    difficulty: options.difficulty,
    mode: options.mode,
    endless: options.mode === 'endless' || options.wave > (options.mode === 'quick' ? 50 : 100),
  };
  const stats = enemyStats(enemy.id, context);
  const roster = waveRoster(context);
  const formation = formationName(options.wave);
  const record = options.records[enemy.id];
  return `<article class="bestiary-detail" aria-labelledby="bestiary-detail-title">
    <header class="bestiary-detail-heading">${enemyEmblem(enemy.id, 58)}<div><p class="bestiary-kicker">${esc(titleCase(enemy.role))} · ${esc(titleCase(enemy.mechanic))}</p><h3 id="bestiary-detail-title">${esc(enemy.name)}</h3><p>${esc(spawnLabel(enemy, options.mode))}</p></div></header>
    <p class="bestiary-formation"><b>${['Verdant Wilds', 'Ember Foundry', 'Void Ruins'][options.stage]} · wave ${options.wave}</b> · ${esc(formation)}</p><details class="bestiary-roster"><summary>Formation roster · ${roster.length} enemy ${roster.length === 1 ? 'type' : 'types'}</summary><p>${roster.map((id) => esc(ENEMY_BY_ID[id].name)).join(', ')}</p></details>
    <section class="bestiary-preview" aria-label="Scaled preview stats"><h4>Preview stats</h4><dl><div><dt>Health</dt><dd>${formatNumber(stats.hp)}</dd></div><div><dt>Damage</dt><dd>${formatNumber(stats.damage)}</dd></div><div><dt>Attack element</dt><dd>${titleCase(enemyDamageType(enemy.id, context))}</dd></div><div><dt>Base speed</dt><dd>${formatNumber(stats.speed)}</dd></div><div><dt>Armor</dt><dd>${Math.round(stats.armor * 100)}%</dd></div><div><dt>Control taken</dt><dd>${Math.round(stats.control * 100)}%</dd></div></dl><small>Scales with wave, stage, and Ascension. Preview uses the new enemy rules.</small></section>
    <section class="bestiary-facts"><p><b>Attack</b> ${esc(enemy.attack)}</p><p><b>Telegraph</b> ${esc(enemy.telegraph)}</p><p><b>Strength</b> ${esc(enemy.strength)}</p><p><b>Weakness</b> ${esc(enemy.weakness)}</p>${resistanceMarkup(enemy)}<p><b>Bounded rules</b> ${esc(enemy.limits)}</p></section>
    <p class="bestiary-discovery"><b>Discovery record</b> · Encountered ${record?.encountered ?? 0} · Defeated ${record?.defeated ?? 0}</p>
  </article>`;
};

/** Returns a self-contained, safe-to-insert bestiary panel. */
export function bestiaryMarkup(options: BestiaryOptions): string {
  const enemies = filteredEnemies(options);
  const chosen = enemies.find((enemy) => enemy.id === options.selected) ?? enemies[0];
  const filter = options.filter ?? options.stage;
  const waveMax = modeWaveMax(options.mode);
  const firstWave = chosen ? effectiveFirstWave(chosen, options.mode) : 1;
  const wave = Math.min(waveMax, Math.max(firstWave, Math.round(options.wave)));
  const stage = chosen?.stage ?? Math.max(0, Math.min(2, Math.round(options.stage)));
  const difficulty = Math.max(0, Math.min(5, Math.round(options.difficulty)));
  const optionsMarkup = (value: string, label: string, current: string): string =>
    `<option value="${esc(value)}"${value === current ? ' selected' : ''}>${esc(label)}</option>`;
  const filterOptions = [
    optionsMarkup('all', 'All stages', String(filter)),
    ...[0, 1, 2].map((s) =>
      optionsMarkup(String(s), ['Verdant Wilds', 'Ember Foundry', 'Void Ruins'][s], String(filter)),
    ),
  ].join('');
  const itemMarkup = enemies
    .map((enemy) => {
      const record = options.records[enemy.id];
      return `<button class="bestiary-entry${enemy.id === chosen?.id ? ' selected' : ''}" type="button" data-enemy-id="${esc(enemy.id)}" aria-pressed="${enemy.id === chosen?.id}">${enemyEmblem(enemy.id, 34)}<span><strong>${esc(enemy.name)}</strong><small>${esc(titleCase(enemy.role))} · ${esc(spawnLabel(enemy, options.mode))}</small></span><span class="bestiary-count" aria-label="${record?.encountered ?? 0} encounters, ${record?.defeated ?? 0} defeats">${record?.encountered ?? 0}/${record?.defeated ?? 0}</span></button>`;
    })
    .join('');
  const detail = chosen
    ? detailsMarkup(chosen, { ...options, stage, wave, difficulty })
    : '<p class="bestiary-empty">No enemies match that search.</p>';
  return `<section class="bestiary${options.legacy ? ' bestiary-legacy' : ''}" aria-label="Enemy bestiary">
    <p class="bestiary-notice">Tactics and new enemy rules are available before discovery. ${options.legacy ? 'This preview explains the new rules; recovered legacy runs continue with their original rules.' : 'Preview stats describe the selected stage and wave.'}</p>
    <div class="bestiary-layout">
      <aside class="bestiary-index"><label class="bestiary-control">Search enemies<input id="bestiary-search" type="search" value="${esc(options.query ?? '')}" placeholder="Name, role, or tactic"></label><label class="bestiary-control">Stage filter<select id="bestiary-stage">${filterOptions}</select></label><div class="bestiary-results" role="list" aria-label="Enemies">${itemMarkup || '<p class="bestiary-empty">No enemies match that search.</p>'}</div><p class="bestiary-legend">Encountered / defeated · tactics are available before first contact.</p></aside>
      <div class="bestiary-inspect"><button id="bestiary-back" class="bestiary-back outline-button" type="button">← Enemy list</button><div class="bestiary-controls"><label class="bestiary-control">Preview wave<input id="bestiary-wave" type="number" min="${firstWave}" max="${waveMax}" value="${wave}"></label><label class="bestiary-control">Difficulty<select id="bestiary-difficulty">${Array.from({ length: 6 }, (_, value) => optionsMarkup(String(value), value === 0 ? 'Normal' : `Ascension ${value}`, String(difficulty))).join('')}</select></label><label class="bestiary-control">Mode<select id="bestiary-mode">${(['quick', 'normal', 'endless'] as const).map((mode) => optionsMarkup(mode, titleCase(mode), options.mode)).join('')}</select></label></div>${detail}</div>
    </div>
  </section>`;
}
