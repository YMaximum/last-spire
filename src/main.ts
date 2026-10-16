import './style.css';
import {
  ELEMENTS,
  ELEMENT_COLORS,
  MODIFIERS,
  PATTERNS,
  RECIPES,
  STAGES,
  SYNERGIES,
  TOWERS,
} from './content';
import {
  applyUpgrade,
  buyUpgrade,
  continueRun,
  createRun,
  creditReward,
  perks,
  reroll,
  retire,
  selectDraft,
  step,
  syncSynergies,
  TICK,
  useSkill,
} from './engine';
import { ArenaRenderer } from './render';
import {
  defaultProfile,
  defaultSettings,
  exportSave,
  loadSave,
  parseSave,
  replaceSave,
  saveGame,
  settleInMemory,
  settleRun,
} from './storage';
import type { Element, Profile, RunState, SaveData, Settings, TowerId } from './types';
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const icons: Record<string, string> = {
  spire: 'M12 2 7 9v11h10V9L12 2ZM5 20h14M10 13h4M12 8v2',
  book: 'M3 4h6l3 3 3-3h6v15h-6l-3 2-3-2H3V4Zm9 3v14',
  gear: 'm9 3-1 3-3 1-2 3 2 2v3l3 1 1 3h6l1-3 3-1v-3l2-2-2-3-3-1-1-3H9Zm3 6a3 3 0 1 0 0 6 3 3 0 0 0 0-6',
  play: 'm8 4 12 8-12 8V4Z',
  pause: 'M7 4v16M17 4v16',
  bolt: 'm14 2-9 12h7l-2 8 9-13h-7l2-7Z',
  shield: 'M12 3 3 7v6c0 5 9 9 9 9s9-4 9-9V7l-9-4Z',
  heart: 'M20 5c-3-3-6-1-8 1-2-2-5-4-8-1-5 5 8 16 8 16S25 10 20 5Z',
  diamond: 'm12 3 9 9-9 9-9-9 9-9Z',
  arrow: 'M4 12h16m-6-6 6 6-6 6',
  close: 'm6 6 12 12M18 6 6 18',
  target: 'M12 2v5m0 10v5M2 12h5m10 0h5M12 6a6 6 0 1 0 0 12 6 6 0 0 0 0-12',
  leaf: 'M20 3C8 2 2 8 6 15s16 3 14-12ZM5 20 17 7',
  lock: 'M7 10V7a5 5 0 0 1 10 0v3M5 10h14v11H5V10Z',
  star: 'm12 2 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1 3-6Z',
  sound: 'M4 9h4l5-5v16l-5-5H4V9Zm13-2q7 5 0 10',
  refresh: 'M20 8a8 8 0 1 0 0 8M20 3v5h-5',
  download: 'M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4',
  upload: 'M12 16V4m-5 5 5-5 5 5M4 17v4h16v-4',
};
const icon = (name: string, cls = '') =>
  `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${icons[name] ?? icons.diamond}"/></svg>`;
const esc = (text: unknown) =>
  String(text).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
let data: SaveData = {
  version: 1,
  profile: defaultProfile(),
  run: null,
  settings: defaultSettings(),
};
let chosenTower: TowerId = 'bastion',
  chosenStage = 0,
  chosenDifficulty = 0,
  playing = false,
  paused = false,
  dialog = '',
  tab = 'arsenal',
  lastPhase = '',
  lastWave = 0,
  lastSynergies = '',
  saving = false,
  saveAgain = false,
  settling = false,
  tutorialVisible = false;
let preview: RunState;
const app = $('app');
app.innerHTML = `<header class="masthead"><a class="brand" href="#" aria-label="Last Spire home"><span class="brand-mark">${icon('spire')}</span><span>LAST SPIRE<small>AN ARCANE SURVIVAL</small></span></a><div class="header-center"><span class="live-dot"></span> ONE TOWER. ENDLESS POSSIBILITIES.</div><nav><button class="text-button" id="codex-btn">${icon('book')}<span>Build codex</span><kbd>C</kbd></button><span class="credits">${icon('diamond')}<b id="credits">0</b><small>CREDITS</small></span><button class="icon-button" id="settings-btn" aria-label="Settings">${icon('gear')}</button></nav></header>
<main class="game-layout"><aside class="rail"><button class="rail-button active" id="arena-btn" title="Arena" aria-label="Arena">${icon('spire')}</button><button class="rail-button" id="hangar-btn" title="Tower hangar" aria-label="Tower hangar">${icon('shield')}</button><button class="rail-button" id="rail-codex" title="Build codex" aria-label="Build codex">${icon('book')}</button><div class="rail-bottom"><span class="vertical-label">EST. THE LAST AGE</span><span class="rail-rune">✧</span></div></aside>
<section class="battle-column"><div class="stage-heading"><div><div class="eyebrow" id="stage-eyebrow">EXPEDITION 01 <span>/</span> THE OUTER REALMS</div><h1 id="stage-name">Verdant Wilds</h1><p id="stage-description">Ancient roots. Restless machines. Hold your ground.</p></div><button class="outlined-button" id="stage-btn">${icon('leaf')}<span>Change stage</span><span>⌄</span></button></div>
<div class="arena-frame"><div class="arena-top"><div><span class="eyebrow" id="wave-label">YOUR NEXT EXPEDITION</span><div class="wave-number" id="wave-number">Wave <strong>01</strong><span> / 100</span></div></div><div class="arena-top-right"><span id="mode-tag" class="tag">NORMAL</span><span class="seed" id="seed-label">THE WILDS AWAIT</span></div></div><div class="wave-track" id="wave-track"></div><canvas id="arena" aria-label="Tower defense battlefield"></canvas><div class="arena-vignette"></div><div class="arena-bottom"><div class="tower-health"><div><span>${icon('heart')} SPIRE INTEGRITY</span><strong id="health-value">300 / 300</strong></div><div class="health-track"><i id="health-fill"></i><i class="shield-fill" id="shield-fill"></i></div><small id="shield-value">${icon('shield')} Barrier ready</small></div><div class="arena-coordinates"><span id="enemy-count">RADIAL DEFENSE</span><span>50° N · 40° E</span></div></div><div id="launch-card" class="launch-card"><div class="eyebrow">THE LAST LIGHT IS YOURS TO KEEP</div><h2>Make your stand.</h2><p>Shape your arsenal. Discover powerful synergies.<br>Survive one hundred waves.</p><button id="launch-btn" class="gold-button">Begin expedition ${icon('arrow')}</button><small>30–45 MIN · AUTOSAVED · PLAY AT YOUR PACE</small></div><div id="pause-screen" class="pause-screen hidden"><span class="eyebrow">TAKE A BREATH</span><h2>Time stands still.</h2><button class="gold-button" id="resume-pause">Resume ${icon('play')}</button></div><div id="toast" role="status"></div></div>
<div class="command-bar"><div class="speed-controls"><button class="icon-button" id="pause-btn" title="Pause (Space)" aria-label="Pause">${icon('pause')}</button><span class="divider"></span><button id="speed-btn" class="speed-button">1× <small>SPEED</small></button></div><div class="skills"><button id="signature-btn" class="skill-button"><span class="skill-icon">${icon('shield')}</span><span><small>SIGNATURE</small><b id="signature-name">Aegis protocol</b></span><kbd>Q</kbd><span class="cooldown" id="signature-cd"></span></button><button id="secondary-btn" class="skill-button"><span class="skill-icon green">${icon('heart')}</span><span><small>SECONDARY</small><b id="secondary-name">Mend</b></span><kbd>E</kbd><span class="cooldown" id="secondary-cd"></span></button></div><button id="target-btn" class="target-button" title="Change targeting priority">${icon('target')}<span><small>TARGETING</small><b id="target-name">Nearest</b></span></button></div>
<div class="field-notes"><span>${icon('star')} <span id="field-tip">Every element tells a different story. Combine them to write yours.</span></span><button class="text-button" id="help-btn">How to play ↗</button></div></section>
<aside class="right-panel"><div id="sidebar"></div><div class="sidebar-bottom"><span class="live-dot"></span><span id="save-status">LOCAL SAVE · READY</span><span>v1.0</span></div></aside></main><footer class="page-footer"><span>BUILT FOR THE NEXT “ONE MORE RUN.”</span><span>8 PATTERNS <i>·</i> 6 ELEMENTS <i>·</i> 192 POSSIBILITIES</span><button id="retire-btn" class="text-button hidden">End expedition ↗</button></footer><div id="modal-root"></div><input type="file" accept="application/json,.json" id="import-file" hidden>`;
const renderer = new ArenaRenderer($<HTMLCanvasElement>('arena'));
new ResizeObserver(() => renderer.resize()).observe($('arena'));
function current() {
  return playing && data.run ? data.run : preview;
}
function createPreview() {
  preview = createRun(data.profile, chosenTower, chosenStage, chosenDifficulty, 83491);
  preview.tutorialStep = 4;
  for (let i = 0; i < 260; i++) step(preview);
  preview.hp = preview.maxHp;
  preview.visuals = [];
  preview.wave = 1;
}
function tower() {
  return TOWERS.find((t) => t.id === (playing && data.run ? data.run.tower : chosenTower))!;
}
function renderSidebar() {
  const s = current(),
    t = tower();
  $('sidebar').innerHTML =
    `<div class="panel-section tower-section"><div class="section-label">${playing ? 'YOUR SPIRE' : 'SELECT YOUR SPIRE'}<span>0${TOWERS.indexOf(t) + 1} / 06</span></div><div class="tower-title"><div class="mini-spire" style="--tower-color:${t.color}"><i></i><i></i><i></i><i></i></div><div><h2>${t.name}</h2><span>${t.subtitle}</span></div>${!playing ? `<button class="icon-button small" id="change-tower" title="Change tower">⌄</button>` : ''}</div><p class="tower-desc">${t.description}</p><div class="passive"><span class="passive-symbol">✧</span><span><b>${t.passive.split(':')[0]}</b><small>${t.passive.includes(':') ? t.passive.split(':').slice(1).join(':') : t.skillDescription}</small></span></div></div><div class="panel-tabs"><button class="${tab === 'arsenal' ? 'selected' : ''}" data-tab="arsenal">Arsenal <span>${playing ? s.attacks.length : 1}</span></button><button class="${tab === 'synergies' ? 'selected' : ''}" data-tab="synergies">Synergies <span>${playing ? s.synergies.length : 0}</span></button></div><div class="panel-section loadout">${tab === 'arsenal' ? renderAttacks(s) : renderSynergies(s)}</div><div class="panel-section run-stats"><div class="section-label">${playing ? 'EXPEDITION LEDGER' : 'THE PATH AHEAD'}</div><div class="stat-row"><span>${icon('diamond')} ${playing ? 'Salvaged scrap' : 'Stage length'}</span><strong id="scrap-stat">${playing ? s.scrap : '100 waves'}</strong></div><div class="stat-row"><span>${icon('target')} ${playing ? 'Enemies defeated' : 'Boss encounters'}</span><strong id="kill-stat">${playing ? s.kills : '4 guardians'}</strong></div><div class="stat-row"><span>${icon('star')} ${playing ? 'Projected credits' : 'Your record'}</span><strong id="earned-stat">${playing ? Math.floor(creditReward(s)) : `Wave ${data.profile.bestWave}`}</strong></div></div><div class="discovery-card"><span>✦</span><div><small>THE ART OF COMBINATION</small><p>${playing ? 'Try a second element to awaken a new synergy.' : 'A single spark can change everything.'}</p><button class="text-button" id="discover-btn">Explore the codex ${icon('arrow')}</button></div></div>`;
  $('change-tower')?.addEventListener('click', () => openDialog('hangar'));
  document.querySelectorAll<HTMLElement>('[data-tab]').forEach(
    (b) =>
      (b.onclick = () => {
        tab = b.dataset.tab!;
        renderSidebar();
      }),
  );
  $('discover-btn')?.addEventListener('click', () => openDialog('codex'));
}
function renderAttacks(s: RunState) {
  return (
    Array.from({ length: 3 }, (_, i) => {
      const a = s.attacks[i];
      if (!a || (!playing && i > 0))
        return `<div class="attack-slot locked"><span class="slot-number">0${i + 1}</span><div class="lock-glyph">${icon('lock')}</div><div><b>Untapped potential</b><small>Attack slot unlocks at wave ${i === 1 ? 10 : 25}</small></div></div>`;
      return `<div class="attack-slot" style="--element:${ELEMENT_COLORS[a.element]}"><div class="attack-slot-top"><span class="slot-number">0${i + 1}</span><span class="element-label">${a.element.toUpperCase()}</span><span class="rank">${'◆'.repeat(a.rank)}${'◇'.repeat(5 - a.rank)}</span></div><div class="attack-name"><span class="attack-glyph">${icon(a.pattern === 'bolt' ? 'bolt' : a.pattern === 'orbit' ? 'star' : a.pattern === 'swarm' ? 'leaf' : 'target')}</span><div><b>${PATTERNS.find((p) => p.id === a.pattern)!.name}</b><small>${MODIFIERS.find((m) => m.id === a.modifier)!.name} <span>·</span> Rank ${a.rank}</small></div></div></div>`;
    }).join('') + `<div class="slot-hint">${icon('book')} Choose upgrades every 5 waves.</div>`
  );
}
function renderSynergies(s: RunState) {
  const active = SYNERGIES.filter((y) => s.synergies.includes(y.id));
  const possible = SYNERGIES.filter(
    (y) =>
      !s.synergies.includes(y.id) &&
      y.elements?.some((e) => s.attacks.some((a) => a.element === e)),
  ).slice(0, 3);
  return `${active.length ? active.map((y) => `<div class="synergy-entry" style="--element:${y.color}"><span>✦</span><div><b>${y.name}</b><small>${y.description}</small><em>ACTIVE</em></div></div>`).join('') : '<div class="synergy-empty">✧<h3>Something greater awaits.</h3><p>Combine different elements across your attacks to awaken synergies.</p></div>'}${possible.length ? '<div class="section-label">ONE STEP AWAY</div>' : ''}${possible.map((y) => `<div class="synergy-entry dormant"><span>◇</span><div><b>${y.name}</b><small>Requires ${y.elements!.join(' + ')}</small></div></div>`).join('')}`;
}
function refresh() {
  const s = current(),
    stage = STAGES[s.stage];
  $('stage-name').textContent = stage.name;
  $('stage-description').textContent = stage.description;
  $('stage-eyebrow').innerHTML =
    `EXPEDITION 0${s.stage + 1} <span>/</span> ${stage.subtitle.toUpperCase()}`;
  $('credits').textContent = data.profile.credits.toLocaleString();
  $('launch-card').classList.toggle('hidden', playing);
  $('retire-btn').classList.toggle('hidden', !playing);
  $('stage-btn').classList.toggle('hidden', playing);
  $('mode-tag').textContent = s.endless
    ? 'ENDLESS'
    : s.difficulty
      ? `ASCENSION ${s.difficulty}`
      : 'NORMAL';
  $('seed-label').textContent = playing
    ? `SEED ${s.seed.toString(16).toUpperCase()}`
    : 'THE WILDS AWAIT';
  $('wave-label').textContent = playing ? 'EXPEDITION IN PROGRESS' : 'YOUR NEXT EXPEDITION';
  $('signature-name').textContent = tower().skill;
  $('secondary-name').textContent = { repair: 'Mend', nova: 'Solar nova', stasis: 'Time fracture' }[
    s.secondary
  ];
  $('speed-btn').innerHTML = `${data.settings.speed}× <small>SPEED</small>`;
  $('signature-btn').title = tower().skillDescription;
  $('secondary-btn').title = 'Secondary ability (E)';
  $('wave-track').innerHTML = Array.from(
    { length: 20 },
    (_, i) =>
      `<i class="${s.wave >= i * 5 + 1 ? 'filled' : ''} ${[4, 9, 14, 19].includes(i) ? 'boss-tick' : ''}"></i>`,
  ).join('');
  renderSidebar();
  updateHud();
}
function updateHud() {
  const s = current();
  $('wave-number').innerHTML =
    `Wave <strong>${String(playing ? s.wave : 1).padStart(2, '0')}</strong><span> / ${s.endless ? '∞' : '100'}</span>`;
  $('health-value').textContent = `${Math.ceil(s.hp)} / ${Math.ceil(s.maxHp)}`;
  $('health-fill').style.width = `${(s.hp / s.maxHp) * 100}%`;
  $('health-fill').classList.toggle('danger', s.hp / s.maxHp < 0.3);
  $('shield-fill').style.width = `${Math.min(100, (s.shield / s.maxHp) * 100)}%`;
  $('shield-value').innerHTML =
    `${icon('shield')} ${s.shield > 1 ? `${Math.ceil(s.shield)} barrier` : 'Barrier ' + (s.skillCd > 0 ? 'recharging' : 'ready')}`;
  $('enemy-count').textContent = playing
    ? `${s.enemies.length} HOSTILES · ${Math.max(0, s.spawnTotal - s.spawned)} INCOMING`
    : 'RADIAL DEFENSE';
  $('pause-screen').classList.toggle(
    'hidden',
    !paused || !!dialog || !playing || s.phase !== 'combat',
  );
  $('signature-cd').textContent = s.skillCd > 0 ? `${Math.ceil(s.skillCd)}s` : '';
  $('secondary-cd').textContent = s.secondaryCd > 0 ? `${Math.ceil(s.secondaryCd)}s` : '';
  $<HTMLButtonElement>('signature-btn').disabled =
    !playing || s.phase !== 'combat' || s.skillCd > 0;
  $<HTMLButtonElement>('secondary-btn').disabled =
    !playing || s.phase !== 'combat' || s.secondaryCd > 0;
  $('scrap-stat') &&
    ($('scrap-stat').textContent = playing ? s.scrap.toLocaleString() : '100 waves');
  $('kill-stat') &&
    ($('kill-stat').textContent = playing ? s.kills.toLocaleString() : '4 guardians');
  $('earned-stat') &&
    ($('earned-stat').textContent = playing
      ? String(Math.floor(creditReward(s)))
      : `Wave ${data.profile.bestWave}`);
  $('target-name').textContent = s.targeting[0].toUpperCase() + s.targeting.slice(1);
  $('pause-btn').innerHTML = icon(paused ? 'play' : 'pause');
}
function toast(message: string) {
  $('toast').textContent = message;
  $('toast').classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => $('toast').classList.remove('visible'), 4000);
}
let toastTimer = 0;
async function persist() {
  if (saving || settling) {
    saveAgain = true;
    return;
  }
  saving = true;
  $('save-status').textContent = 'SAVING…';
  try {
    await saveGame(data);
    $('save-status').textContent = 'LOCAL SAVE · SAVED';
  } catch (e) {
    $('save-status').textContent = 'SAVE UNAVAILABLE';
    toast(
      `Could not save: ${e instanceof Error ? e.message : 'storage unavailable'}. Export your progress in Settings.`,
    );
  } finally {
    saving = false;
    if (saveAgain) {
      saveAgain = false;
      void persist();
    }
  }
}
async function settle() {
  if (settling || !data.run || data.run.settled) return;
  settling = true;
  try {
    data = await settleRun(data);
    $('credits').textContent = data.profile.credits.toLocaleString();
  } catch (e) {
    data = settleInMemory(data);
    $('credits').textContent = data.profile.credits.toLocaleString();
    toast('Rewards kept in memory only. Export a backup before closing this tab.');
  } finally {
    settling = false;
    if (saveAgain) {
      saveAgain = false;
      void persist();
    }
  }
}
function modal(title: string, eyebrow: string, body: string, wide = false, closable = true) {
  $('modal-root').innerHTML =
    `<div class="modal-backdrop"><section role="dialog" aria-modal="true" aria-label="${esc(title)}" class="modal ${wide ? 'wide' : ''}" tabindex="-1"><div class="modal-header"><div><div class="eyebrow">${eyebrow}</div><h2>${title}</h2></div>${closable ? `<button id="close-modal" class="icon-button" aria-label="Close">${icon('close')}</button>` : ''}</div>${body}</section></div>`;
  $('close-modal')?.addEventListener('click', closeDialog);
  document
    .querySelector<HTMLElement>('.modal button:not(:disabled),.modal input,.modal select')
    ?.focus();
}
function closeDialog() {
  dialog = '';
  $('modal-root').innerHTML = '';
  if (playing && data.run && data.run.phase !== 'combat') phaseDialog();
}
function openDialog(kind: string) {
  dialog = kind;
  if (kind === 'codex') codexDialog();
  if (kind === 'settings') settingsDialog();
  if (kind === 'hangar') hangarDialog();
  if (kind === 'stages') stagesDialog();
  if (kind === 'help') helpDialog();
  if (kind === 'retire') retireDialog();
}
function upgradeCard(u: RunState['choices'][number], i: number, shop = false) {
  const before = current();
  const shadow = {
    ...before,
    attacks: before.attacks.map((a) => ({ ...a })),
    perks: { ...before.perks },
    visuals: [],
    notices: [],
    synergies: [...before.synergies],
  };
  applyUpgrade(shadow, u);
  const awaken = shadow.synergies
    .filter((id) => !before.synergies.includes(id))
    .map((id) => SYNERGIES.find((y) => y.id === id)!.name);
  const lost = before.synergies
    .filter((id) => !shadow.synergies.includes(id))
    .map((id) => SYNERGIES.find((y) => y.id === id)!.name);
  const preview = awaken.length
    ? `<em class="upgrade-synergy">✦ Awakens ${awaken.join(', ')}</em>`
    : '';
  const warning = lost.length ? `<em class="upgrade-loss">Releases ${lost.join(', ')}</em>` : '';
  return `<button class="upgrade-card" style="--element:${esc(u.color)}" data-${shop ? 'buy' : 'choice'}="${shop ? esc(u.id) : i}" ${shop && current().scrap < u.price ? 'disabled' : ''}><span class="card-category">${u.kind === 'rank' ? 'EMPOWER' : u.kind === 'pattern' ? 'ATTACK PATTERN' : u.kind === 'element' ? 'ELEMENTAL INFUSION' : u.kind === 'modifier' ? 'BEHAVIOR MODIFIER' : u.kind === 'perk' ? 'PASSIVE UPGRADE' : 'ACTIVE SKILL'}</span><span class="card-emblem">${icon(u.kind === 'perk' ? 'shield' : u.kind === 'element' ? 'bolt' : 'star')}</span><h3>${esc(u.name)}</h3><p>${esc(u.description)}</p>${preview}${warning}<span class="card-footer">${shop ? `${u.price} SCRAP` : 'SELECT UPGRADE'} ${icon('arrow')}</span></button>`;
}
function phaseDialog() {
  if (!playing || !data.run) return;
  const s = data.run;
  if (s.phase === 'combat') {
    if (['draft', 'shop', 'victory', 'ended'].includes(dialog)) {
      dialog = '';
      $('modal-root').innerHTML = '';
    }
    return;
  }
  if (s.phase === 'draft') {
    dialog = 'draft';
    modal(
      'A little more extraordinary.',
      `WAVE ${s.wave} CLEARED · CHOOSE YOUR UPGRADE`,
      `<p class="modal-intro">Shape the machine you want to become. Your other attacks keep their current upgrades.</p><div class="upgrade-grid">${s.choices.map((u, i) => upgradeCard(u, i)).join('')}</div><div class="modal-footer"><span>✧ Three attack slots · New slots at waves 10 and 25</span><button class="outlined-button" id="reroll-btn" ${s.rerolls <= 0 ? 'disabled' : ''}>${icon('refresh')} Reroll (${s.rerolls})</button></div>`,
      true,
      false,
    );
    document.querySelectorAll<HTMLElement>('[data-choice]').forEach(
      (b) =>
        (b.onclick = () => {
          selectDraft(s, Number(b.dataset.choice));
          if (s.tutorialStep < 4) {
            s.tutorialStep = 4;
            data.profile.tutorialDone = true;
            toast('First upgrade chosen. New attack slots arrive at waves 10 and 25.');
          }
          void persist();
          refresh();
          phaseDialog();
        }),
    );
    $('reroll-btn').onclick = () => {
      reroll(s);
      void persist();
      phaseDialog();
    };
  }
  if (s.phase === 'shop') {
    dialog = 'shop';
    modal(
      'The wandering artificer.',
      `WAVE ${s.wave} · ${s.scrap} SCRAP AVAILABLE`,
      `<p class="modal-intro">Spend salvaged scrap on your current expedition. Permanent credits are kept separately.</p><div class="upgrade-grid shop-grid">${s.choices.map((u, i) => upgradeCard(u, i, true)).join('')}</div><div class="modal-footer"><button class="outlined-button" id="shop-heal" ${s.scrap < 35 || s.hp >= s.maxHp ? 'disabled' : ''}>${icon('heart')} Repair 30% · 35 scrap</button><button class="gold-button" id="leave-shop">Continue expedition ${icon('arrow')}</button></div>`,
      true,
      false,
    );
    document.querySelectorAll<HTMLElement>('[data-buy]').forEach(
      (b) =>
        (b.onclick = () => {
          buyUpgrade(s, b.dataset.buy!);
          void persist();
          refresh();
          phaseDialog();
        }),
    );
    $('shop-heal').onclick = () => {
      if (s.scrap >= 35) {
        s.scrap -= 35;
        s.hp = Math.min(s.maxHp, s.hp + s.maxHp * 0.3);
        void persist();
        phaseDialog();
        refresh();
      }
    };
    $('leave-shop').onclick = () => {
      continueRun(s);
      void persist();
      refresh();
      phaseDialog();
    };
  }
  if (s.phase === 'victory') {
    dialog = 'victory';
    modal(
      'The light endures.',
      `${STAGES[s.stage].name.toUpperCase()} · 100 WAVES CONQUERED`,
      `<div class="victory-emblem">${icon('spire')}</div><p class="modal-intro centered">The guardian has fallen. Extract with your rewards, or carry this build into the endless dark. Your stage clear is secured.</p><div class="result-stats"><div><strong>${s.kills}</strong><small>ENEMIES DEFEATED</small></div><div><strong>${s.earned}</strong><small>PROJECTED CREDITS</small></div></div><div class="modal-actions"><button id="extract-btn" class="outlined-button">Extract & collect</button><button id="endless-btn" class="gold-button">Enter endless ${icon('arrow')}</button></div>`,
      false,
      false,
    );
    $('extract-btn').onclick = () => {
      retire(s);
      phaseDialog();
    };
    $('endless-btn').onclick = () => {
      continueRun(s);
      void persist();
      refresh();
      phaseDialog();
    };
  }
  if (s.phase === 'ended') {
    dialog = 'ended';
    void settle().then(() => {
      if (dialog === 'ended') renderResults();
    });
    renderResults();
  }
}
function renderResults() {
  const s = data.run!;
  const damage = Object.entries(s.damageByElement).sort((a, b) => b[1] - a[1]);
  const max = damage[0]?.[1] || 1;
  modal(
    s.cleared ? 'A legend, forged.' : 'Every ending is a beginning.',
    `EXPEDITION COMPLETE · WAVE ${s.wave}${s.endless ? ' · ENDLESS' : ''}`,
    `<div class="result-stats"><div><strong>${s.wave}</strong><small>WAVE REACHED</small></div><div><strong>${s.kills}</strong><small>DEFEATED</small></div><div><strong>+${s.earned}</strong><small>CREDITS ${s.settled ? 'SAVED' : 'PENDING'}</small></div></div><div class="section-label">YOUR ELEMENTAL SIGNATURE</div><div class="damage-chart">${damage
      .filter(([, d]) => d > 0)
      .map(
        ([e, d]) =>
          `<div><span>${e}</span><i style="width:${Math.max(2, (d / max) * 65)}%;background:${ELEMENT_COLORS[e as Element]}"></i><b>${Math.round(d).toLocaleString()}</b></div>`,
      )
      .join(
        '',
      )}</div><p class="modal-intro">${s.synergies.length ? `Awakened: ${s.synergies.map((id) => SYNERGIES.find((y) => y.id === id)?.name).join(', ')}.` : 'Try combining different elements in your next expedition to awaken a synergy.'}</p><div class="modal-actions"><button id="results-export" class="outlined-button">${icon('download')} Export save</button><button id="new-run" class="gold-button">Return to the spire ${icon('arrow')}</button></div>`,
    false,
    false,
  );
  $('results-export').onclick = downloadSave;
  $('new-run').onclick = async () => {
    await settle();
    if (!data.run?.settled) {
      toast('Save rewards or export before leaving this result.');
      return;
    }
    playing = false;
    data.run = null;
    dialog = '';
    $('modal-root').innerHTML = '';
    chosenTower = s.tower;
    chosenStage = s.stage;
    createPreview();
    refresh();
    void persist();
  };
}
function codexDialog() {
  modal(
    'The art of combination.',
    'FIELD CODEX · 192 RECIPES · 18 SYNERGIES',
    `<div class="codex-tools"><input id="codex-search" type="search" placeholder="Search elements, attacks, or synergies…" aria-label="Search codex"><select id="codex-kind" aria-label="Codex category"><option value="synergies">Named synergies</option><option value="recipes">192 attack recipes</option><option value="rules">Combat rules</option></select></div><div id="codex-results" class="codex-results"></div>`,
    true,
  );
  const update = () => {
    const query = $<HTMLInputElement>('codex-search').value.toLowerCase(),
      kind = $<HTMLSelectElement>('codex-kind').value;
    if (kind === 'rules') {
      $('codex-results').innerHTML =
        `<div class="rules"><h3>Power with boundaries</h3><p>Elemental statuses stack by intensity or duration. Fire and poison decay over time; armor reduces direct damage. Solar marks amplify incoming damage by 22%.</p><p>Frost reduces movement by 45%; bosses resist slows, stun, and pulls. Time skills stack multiplicatively with a minimum movement floor; no permanent full stun.</p><p>Secondary explosions and lightning chains deal direct damage. They never trigger further on-hit effects. Lightning normally chains to two additional enemies.</p><p>Echo repeats an attack at 56% damage (68% for Tempest). Surge doubles every fourth attack. Rank caps at 5; run damage at +150%, attack speed at +80%, armor at 40%, regeneration at 2 HP/s.</p><p>Maximum 220 active enemies and 450 projectiles. Waves queue spawns under the enemy limit. Endless increases wave pressure without unbounded entity growth. Cosmetic quality does not affect combat.</p><p>Three rerolls per run. Attack slots open at waves 10 and 25. Shops use temporary scrap. Defeat and retirement both award permanent credits.</p></div>`;
      return;
    }
    if (kind === 'recipes') {
      const items = RECIPES.filter((r) =>
        `${r.pattern} ${r.element} ${r.modifier}`.includes(query),
      );
      $('codex-results').innerHTML =
        `<p class="search-count">${items.length} supported recipes · all towers share this catalog</p><div class="recipe-grid">${items.map((r) => `<div class="recipe" style="--element:${ELEMENT_COLORS[r.element]}"><span>${icon('bolt')}</span><b>${PATTERNS.find((p) => p.id === r.pattern)!.name}</b><small>${r.element} · ${r.modifier}</small></div>`).join('')}</div>`;
    } else {
      $('codex-results').innerHTML = `<div class="codex-grid">${SYNERGIES.filter((y) =>
        `${y.name} ${y.description} ${y.elements?.join(' ')} ${y.modifiers?.join(' ')} ${y.tower}`
          .toLowerCase()
          .includes(query),
      )
        .map(
          (y) =>
            `<article class="codex-synergy" style="--element:${y.color}"><span>✦</span><div><small>${(y.elements ?? []).join(' + ')}${y.tower ? `${y.tower} + ${y.modifiers?.join(' + ')}` : ''}</small><h3>${y.name}</h3><p>${y.description}</p><em>${current().synergies.includes(y.id) ? 'ACTIVE IN THIS BUILD' : data.profile.seenSynergies.includes(y.id) ? 'DISCOVERED' : 'UNDISCOVERED'}</em></div></article>`,
        )
        .join('')}</div>`;
    }
  };
  $('codex-search').oninput = update;
  $('codex-kind').onchange = update;
  update();
}
function hangarDialog() {
  modal(
    'Six hearts. One last light.',
    'TOWER HANGAR · PERMANENT UNLOCKS',
    `<p class="modal-intro">${playing ? 'Your current tower stays with you until this expedition ends.' : 'Choose a spire. Every tower can use all 192 attack recipes.'} Credits: <b>${data.profile.credits}</b></p><div class="tower-grid">${TOWERS.map(
      (t) => {
        const unlocked = data.profile.unlocked.includes(t.id);
        return `<article class="tower-card ${t.id === chosenTower ? 'chosen' : ''}" style="--element:${t.color}"><span class="tower-card-icon">${icon('spire')}</span><small>${t.subtitle}</small><h3>${t.name}</h3><p>${t.description}</p><div class="tower-detail"><b>${t.passive}</b><span>${t.skill}: ${t.skillDescription}</span></div><button class="${unlocked ? 'outlined-button' : 'gold-button'}" data-tower="${t.id}" ${playing || (!unlocked && data.profile.credits < t.cost) ? 'disabled' : ''}>${unlocked ? (t.id === chosenTower ? 'Selected' : 'Select tower') : `${icon('lock')} Unlock · ${t.cost} credits`}</button></article>`;
      },
    ).join(
      '',
    )}</div><div class="meta-upgrades"><div><div class="section-label">PERMANENT RUNES · CAPPED AT 5 RANKS</div><p>Small advantages. Your decisions still make the difference.</p></div>${(['power', 'vitality', 'fortune'] as const).map((k) => `<button class="outlined-button" data-meta="${k}" ${playing || data.profile.upgrades[k] >= 5 || data.profile.credits < 50 * (data.profile.upgrades[k] + 1) ? 'disabled' : ''}>${k} ${data.profile.upgrades[k]}/5<br><small>${k === 'power' ? '+4% damage' : k === 'vitality' ? '+4% integrity' : '+4% scrap'} · ${50 * (data.profile.upgrades[k] + 1)} cr</small></button>`).join('')}</div>`,
    true,
  );
  document.querySelectorAll<HTMLElement>('[data-tower]').forEach(
    (b) =>
      (b.onclick = () => {
        const t = TOWERS.find((t) => t.id === b.dataset.tower)!;
        if (playing) return;
        if (!data.profile.unlocked.includes(t.id)) {
          if (data.profile.credits < t.cost) return;
          data.profile.credits -= t.cost;
          data.profile.unlocked.push(t.id);
          toast(`${t.name} awakened.`);
        }
        chosenTower = t.id;
        createPreview();
        refresh();
        void persist();
        hangarDialog();
      }),
  );
  document.querySelectorAll<HTMLElement>('[data-meta]').forEach(
    (b) =>
      (b.onclick = () => {
        const k = b.dataset.meta as keyof Profile['upgrades'];
        const price = 50 * (data.profile.upgrades[k] + 1);
        if (playing || data.profile.upgrades[k] >= 5 || data.profile.credits < price) return;
        data.profile.credits -= price;
        data.profile.upgrades[k]++;
        createPreview();
        refresh();
        void persist();
        hangarDialog();
      }),
  );
}
function stagesDialog() {
  modal(
    'Beyond the treeline.',
    'SELECT EXPEDITION',
    `<div class="stage-list">${STAGES.map((st) => `<button class="stage-card ${st.id === chosenStage ? 'chosen' : ''}" data-stage="${st.id}" style="--element:${st.color}" ${st.id >= data.profile.stageUnlocked ? 'disabled' : ''}><span class="stage-index">0${st.id + 1}</span><div><small>${st.subtitle}</small><h3>${st.name}</h3><p>${st.description}</p><em>${st.id >= data.profile.stageUnlocked ? 'Clear the previous stage to unlock' : st.hazard}</em></div>${icon(st.id >= data.profile.stageUnlocked ? 'lock' : 'arrow')}</button>`).join('')}</div><div class="difficulty-picker"><label for="difficulty">Ascension <small>Unlock by clearing your highest tier. Enemy health and wave density scale with each tier.</small></label><select id="difficulty">${Array.from({ length: 6 }, (_, i) => `<option value="${i}" ${i > data.profile.difficultyUnlocked ? 'disabled' : ''} ${i === chosenDifficulty ? 'selected' : ''}>${i === 0 ? 'Normal' : `Ascension ${i}`}${i > data.profile.difficultyUnlocked ? ' · Locked' : ''}</option>`).join('')}</select></div>`,
    true,
  );
  document.querySelectorAll<HTMLElement>('[data-stage]').forEach(
    (b) =>
      (b.onclick = () => {
        chosenStage = Number(b.dataset.stage);
        createPreview();
        refresh();
        stagesDialog();
      }),
  );
  $('difficulty').onchange = () => {
    chosenDifficulty = Number($<HTMLSelectElement>('difficulty').value);
    createPreview();
    refresh();
  };
}
function settingsDialog() {
  modal(
    'Find your rhythm.',
    'SETTINGS & LOCAL PROGRESS',
    `<div class="settings-list"><label>Sound effects <input id="sound-setting" type="checkbox" ${data.settings.sound ? 'checked' : ''}></label><label>Reduced motion <input id="motion-setting" type="checkbox" ${data.settings.reducedMotion ? 'checked' : ''}></label><label>Visual effects <select id="effects-setting"><option value="high" ${data.settings.effects === 'high' ? 'selected' : ''}>High detail</option><option value="low" ${data.settings.effects === 'low' ? 'selected' : ''}>Low · battery friendly</option></select></label></div><div class="save-panel"><h3>Your progress, in your hands.</h3><p>Progress is stored in this browser. Export a backup to transfer it to another device. Import replaces the current save.</p><div class="modal-actions"><button id="export-btn" class="outlined-button">${icon('download')} Export save</button><button id="import-btn" class="outlined-button">${icon('upload')} Import save</button></div></div><p class="fine-print">Space: pause · Q / E: skills · 1 / 2 / 3: speed · C: codex · Esc: close<br>Combat pauses while this menu is open.</p>`,
  );
  $('sound-setting').onchange = () => {
    data.settings.sound = $<HTMLInputElement>('sound-setting').checked;
    void persist();
  };
  $('motion-setting').onchange = () => {
    data.settings.reducedMotion = $<HTMLInputElement>('motion-setting').checked;
    void persist();
  };
  $('effects-setting').onchange = () => {
    data.settings.effects = $<HTMLSelectElement>('effects-setting').value as Settings['effects'];
    void persist();
  };
  $('export-btn').onclick = downloadSave;
  $('import-btn').onclick = () => $<HTMLInputElement>('import-file').click();
}
function helpDialog() {
  modal(
    'Keep the last light alive.',
    'A SHORT FIELD GUIDE',
    `<div class="help-steps"><div><span>01</span><section><h3>The spire fights for you.</h3><p>Enemies approach from every direction. Your tower automatically targets them. Change targeting to prioritize nearby, weak, or strong enemies.</p></section></div><div><span>02</span><section><h3>Build something unexpected.</h3><p>Pick an upgrade every five waves. Add attack slots at waves 10 and 25, then combine elements and modifiers. Open the codex to find 18 special synergies.</p></section></div><div><span>03</span><section><h3>Know when to intervene.</h3><p>Activate your signature skill with Q and your secondary with E, or tap their buttons. Spend scrap in milestone shops. Bosses arrive every 25 waves.</p></section></div><div><span>04</span><section><h3>Every run leaves a mark.</h3><p>Earn credits even when you fall. Unlock five new towers and three stages. Clear wave 100 to extract or continue into endless. Pause, change speed, and return to an autosaved run whenever you like.</p></section></div></div><button id="help-done" class="gold-button">I’m ready ${icon('arrow')}</button>`,
  );
  $('help-done').onclick = () => {
    if (playing && data.run && data.run.tutorialStep < 4) {
      data.run.tutorialStep = 1;
      toast(
        'Your tower aims automatically. Tap your signature skill or press Q to raise a barrier.',
      );
    } else data.profile.tutorialDone = true;
    void persist();
    closeDialog();
  };
}
function retireDialog() {
  modal(
    'Leave with what you’ve earned.',
    'END EXPEDITION',
    `<p class="modal-intro">Retire at wave ${current().wave} and collect your earned credits. Your current build will be released.</p><div class="modal-actions"><button class="outlined-button" id="keep-playing">Keep defending</button><button class="gold-button" id="confirm-retire">Retire & collect</button></div>`,
  );
  $('keep-playing').onclick = closeDialog;
  $('confirm-retire').onclick = () => {
    retire(data.run!);
    phaseDialog();
  };
}
function downloadSave() {
  const blob = new Blob([exportSave(data)], { type: 'application/json' });
  const url = URL.createObjectURL(blob),
    a = document.createElement('a');
  a.href = url;
  a.download = `last-spire-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$<HTMLInputElement>('import-file').onchange = async () => {
  const input = $<HTMLInputElement>('import-file'),
    file = input.files?.[0];
  if (!file) return;
  try {
    const imported = parseSave(await file.text());
    if (
      !confirm(
        'Replace your current progress with this save? Export a backup first if you want to keep it.',
      )
    )
      return;
    await replaceSave(imported);
    data = imported;
    if (data.run) syncSynergies(data.run);
    playing = !!data.run;
    chosenTower = data.run?.tower ?? 'bastion';
    chosenStage = data.run?.stage ?? 0;
    chosenDifficulty = data.run?.difficulty ?? 0;
    paused = data.run?.phase === 'combat';
    dialog = '';
    $('modal-root').innerHTML = '';
    createPreview();
    refresh();
    phaseDialog();
    toast('Save imported.');
  } catch (e) {
    toast(`Import rejected: ${e instanceof Error ? e.message : 'invalid save'}`);
  } finally {
    input.value = '';
  }
};
function launch() {
  if (data.run && !data.run.settled) {
    playing = true;
    paused = false;
    refresh();
    phaseDialog();
    return;
  }
  data.run = createRun(data.profile, chosenTower, chosenStage, chosenDifficulty);
  syncSynergies(data.run);
  playing = true;
  paused = false;
  lastPhase = '';
  lastWave = 0;
  refresh();
  void persist();
  if (!data.profile.tutorialDone) openDialog('help');
}
function togglePause() {
  if (!playing || dialog) return;
  paused = !paused;
  updateHud();
}
let audio: AudioContext | undefined;
function sound(frequency = 440) {
  if (!data.settings.sound) return;
  try {
    audio ??= new AudioContext();
    void audio.resume();
    const oscillator = audio.createOscillator(),
      gain = audio.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, audio.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(frequency * 0.5, audio.currentTime + 0.12);
    gain.gain.setValueAtTime(0.035, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.18);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start();
    oscillator.stop(audio.currentTime + 0.2);
  } catch {}
}
function activate(which: 'signature' | 'secondary') {
  if (!playing || paused || dialog) return;
  if (useSkill(data.run!, which)) {
    if (data.run!.tutorialStep < 3) {
      data.run!.tutorialStep = 3;
      toast(
        'Well timed. Choose your first upgrade after wave 5. You can change targeting below the arena.',
      );
    }
    sound(which === 'signature' ? 660 : 440);
    refresh();
  }
}
$('launch-btn').onclick = launch;
$('pause-btn').onclick = togglePause;
$('resume-pause').onclick = togglePause;
$('speed-btn').onclick = () => {
  data.settings.speed = ((data.settings.speed % 3) + 1) as 1 | 2 | 3;
  refresh();
  void persist();
};
$('signature-btn').onclick = () => activate('signature');
$('secondary-btn').onclick = () => activate('secondary');
$('target-btn').onclick = () => {
  const s = current(),
    modes = ['nearest', 'strongest', 'weakest'] as const;
  s.targeting = modes[(modes.indexOf(s.targeting) + 1) % 3];
  updateHud();
};
$('codex-btn').onclick = () => openDialog('codex');
$('rail-codex').onclick = () => openDialog('codex');
$('settings-btn').onclick = () => openDialog('settings');
$('hangar-btn').onclick = () => openDialog('hangar');
$('stage-btn').onclick = () => openDialog('stages');
$('help-btn').onclick = () => openDialog('help');
$('retire-btn').onclick = () => openDialog('retire');
$('arena-btn').onclick = closeDialog;
document.querySelector('.brand')!.addEventListener('click', (e) => {
  e.preventDefault();
  closeDialog();
});
document.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement)?.matches('input,select,textarea')) return;
  if (e.key === 'Escape') {
    if (['draft', 'shop', 'victory', 'ended'].includes(dialog)) return;
    if (dialog) closeDialog();
    else togglePause();
    return;
  }
  if (e.code === 'Space') {
    e.preventDefault();
    togglePause();
  }
  if (e.key.toLowerCase() === 'c') {
    if (dialog === 'codex') closeDialog();
    else if (!['draft', 'shop', 'victory', 'ended'].includes(dialog)) openDialog('codex');
  }
  if (e.key.toLowerCase() === 'q') activate('signature');
  if (e.key.toLowerCase() === 'e') activate('secondary');
  if (['1', '2', '3'].includes(e.key)) {
    data.settings.speed = Number(e.key) as 1 | 2 | 3;
    refresh();
    void persist();
  }
  if (e.key === 'Tab' && dialog) {
    const nodes = Array.from(
      document.querySelectorAll<HTMLElement>(
        '.modal button:not(:disabled),.modal input,.modal select',
      ),
    );
    const first = nodes[0],
      last = nodes.at(-1);
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last?.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first?.focus();
    }
  }
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && playing) {
    paused = true;
    void persist();
    updateHud();
  }
});
window.addEventListener('pagehide', () => {
  void persist();
});
let last = 0,
  accumulator = 0,
  hudTime = 0,
  autosaveTime = 0,
  perfTime = 0,
  perfFrames = 0,
  renderCost = 0;
function frame(now: number) {
  const delta = Math.min(0.15, (now - last) / 1000 || 0);
  last = now;
  const s = current();
  if (playing && !paused && !dialog && s.phase === 'combat') {
    accumulator += delta * data.settings.speed;
    while (accumulator >= TICK) {
      step(s);
      accumulator -= TICK;
      if (s.phase !== 'combat') break;
    }
  } else accumulator = 0;
  const renderStart = performance.now();
  renderer.draw(s, data.settings);
  renderCost += performance.now() - renderStart;
  perfTime += delta;
  perfFrames++;
  if (perfTime >= 1) {
    $('arena').dataset.fps = String(Math.round(perfFrames / perfTime));
    $('arena').dataset.renderMs = (renderCost / perfFrames).toFixed(2);
    $('arena').dataset.enemies = String(s.enemies.length);
    perfTime = 0;
    perfFrames = 0;
    renderCost = 0;
  }
  hudTime += delta;
  autosaveTime += delta;
  if (hudTime > 0.12) {
    hudTime = 0;
    updateHud();
    if (playing) {
      if (s.wave !== lastWave || s.phase !== lastPhase || s.synergies.join() !== lastSynergies) {
        lastWave = s.wave;
        lastPhase = s.phase;
        lastSynergies = s.synergies.join();
        refresh();
        if (!dialog || ['draft', 'shop', 'victory', 'ended'].includes(dialog)) phaseDialog();
        if (s.cleared && !data.profile.clears.includes(s.stage)) {
          data.profile.clears.push(s.stage);
          data.profile.stageUnlocked = Math.max(
            data.profile.stageUnlocked,
            Math.min(3, s.stage + 2),
          );
          data.profile.difficultyUnlocked = Math.max(
            data.profile.difficultyUnlocked,
            Math.min(5, s.difficulty + 1),
          );
        }
        void persist();
      }
      if (s.notices.length) {
        toast(s.notices.shift()!);
        sound(520);
      }
    }
  }
  if (autosaveTime > 5) {
    autosaveTime = 0;
    if (playing && !settling) void persist();
  }
  requestAnimationFrame(frame);
}
async function init() {
  try {
    data = await loadSave();
  } catch {
    toast('Browser storage is unavailable. You can play and export progress in Settings.');
  }
  chosenTower = data.run?.tower ?? 'bastion';
  chosenStage = data.run?.stage ?? 0;
  chosenDifficulty = data.run?.difficulty ?? 0;
  if (data.run) syncSynergies(data.run);
  createPreview();
  if (data.run) {
    playing = true;
    paused = data.run?.phase === 'combat';
  }
  refresh();
  if (playing) {
    phaseDialog();
    if (data.run?.phase === 'combat')
      toast('Expedition restored. Press Space or tap play to resume.');
  }
  requestAnimationFrame(frame);
}
void init();
