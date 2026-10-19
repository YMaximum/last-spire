import { CatchupStatus } from './catchup-status';
import './style.css';
import './interface.css';
import './expedition.css';
import './bestiary.css';
import { bestiaryMarkup, type BestiaryOptions } from './bestiary';
import {
  ENEMY_BY_ID,
  nextEncounter,
  formationName,
  type EnemyArchetypeId,
} from '../content/enemies';
import { mergeDiscoveries } from '../game/bestiary';
import { BuildInspector, entityMarkup, type EntityRef } from './inspector';
import {
  defaultAutocastConfig,
  normalizeAutocastConfig,
  snapshotRunes,
  RUNE_CAPS,
  runePrice,
  getTowerStats,
  recordDamageSample,
  tickAutocast,
  type RuneId,
  type AutocastRules,
} from '../game/controls';
import type { SaveV3, SaveScope } from '../persistence/storage';
import { AccountSync } from '../account/sync';
import { AccountPanel } from '../account/panel';
import { EntryScreen } from '../account/entry';
import { archiveSave, rememberedPlayer } from '../account/cache';
import { STAGES, ELEMENT_COLORS, PATTERNS } from '../content/world';
import {
  TOWERS,
  isDefensiveKind,
  FUSIONS,
  FUSION_BY_ID,
  EXPANSION_FUSION_IDS,
} from '../content/catalog';
import type { RunV3, RunMode } from '../game/types';
import { LocalTelemetry } from '../telemetry/local';
import { FrameMeter } from '../render/performance';
import {
  step as legacyStep,
  selectDraft,
  reroll as legacyReroll,
  buyUpgrade,
  continueRun,
  useSkill as legacySkill,
  retire as legacyRetire,
  creditReward,
} from '../legacy/classic/engine';
import {
  CARDS,
  CARD_BY_ID,
  WEAPONS,
  WEAPON_BY_ID,
  SYNERGIES,
  RARITIES,
  RARITY_COLORS,
  rarityLabel,
} from '../content/catalog';
import { cardIcon } from './icons';
import {
  createRun,
  hasEncounters,
  step,
  TICK,
  getWeaponStats,
  chooseReward,
  buyOffer,
  rerollReward,
  closeShop,
  repair,
  repairOptions,
  useSkill,
  continueEndless,
  retire,
  rewardForRun,
  previewCard,
  describeNextThreat,
  rewardRerollCost,
  availableFusions,
  previewFusion,
  fuseCores,
} from '../game/engine';
import { BattleRenderer } from '../render/battle';
import { WindowManager } from './windows';
import { launchMarkup } from './launch';
import { fusionHintMarkup } from './fusion-hints';
import { repairPanelMarkup, updateRepairPanel } from './shop-repairs';
import { recordStageClear, difficultyName } from '../game/stage-progress';
import { SimulationClock, resolveDecisionPause } from '../game/clock';
import { PageLoop } from './page-loop';
import {
  acknowledgeFusions,
  pendingFusionOffer,
  recordFusionBoundary,
  unseenFusions,
  nextRunDecision,
} from '../game/fusion-offers';
import {
  emptySave,
  loadGame,
  loadDeviceSettings,
  saveGame,
  settleGame,
  settleInMemory,
  exportGame,
  parseGame,
  readLegacyBackup,
  readRawSave,
  SaveError,
} from '../persistence/storage';
import type {
  RunV2,
  CardDefinition,
  CardOffer,
  PendingReward,
  SettingsV2,
  WeaponInstance,
  TowerId,
} from '../model/arsenal';
import type { RunState, Upgrade } from '../model/shared';
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (v: unknown) =>
  String(v).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
const equipmentIcon = (kind: string) =>
  CARDS.find((c) => c.weapon === kind)?.iconId ??
  FUSIONS.find((f) => f.kind === kind)?.iconId ??
  'unknown';
const glyph = (kind: string) => {
  const paths: Record<string, string> = {
    tower: 'M12 2 7 9v11h10V9L12 2ZM5 20h14M10 13h4',
    book: 'M3 4h6l3 3 3-3h6v15h-6l-3 2-3-2H3V4Zm9 3v14',
    gear: 'm9 3-1 3-3 1-2 3 2 2v3l3 1 1 3h6l1-3 3-1v-3l2-2-2-3-3-1-1-3H9Zm3 6a3 3 0 1 0 0 6 3 3 0 0 0 0-6',
    play: 'm8 4 12 8-12 8V4Z',
    pause: 'M7 4v16M17 4v16',
    beast: 'm4 3 3 5h10l3-5-1 13-7 5-7-5Z M8 12h1 M15 12h1 M10 17h4',
    shield: 'M12 3 3 7v6c0 5 9 9 9 9s9-4 9-9V7l-9-4Z',
    bolt: 'm14 2-9 12h7l-2 8 9-13h-7l2-7Z',
    diamond: 'm12 3 9 9-9 9-9-9 9-9Z',
    arrow: 'M4 12h16m-6-6 6 6-6 6',
    target: 'M12 2v5m0 10v5M2 12h5m10 0h5M12 6a6 6 0 1 0 0 12 6 6 0 0 0 0-12',
    heart: 'M20 5c-3-3-6-1-8 1-2-2-5-4-8-1-5 5 8 16 8 16S25 10 20 5Z',
    stats: 'M4 21h17M7 17V9m5 8V3m5 14v-6',
    menu: 'M4 6h16M4 12h16M4 18h16',
    close: 'm6 6 12 12M18 6 6 18',
  };
  return `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[kind] ?? paths.diamond}"/></svg>`;
};
let data: SaveV3 = emptySave(),
  playing = false,
  paused = false,
  loading = true,
  blocked = false,
  storageFailed = false,
  saveBusy = false,
  saveQueued = false,
  settlePromise: Promise<void> | null = null;
let saveScope: SaveScope = 'guest';
let contextChanging = false,
  contextEpoch = 0;
let chosenMode: RunMode = 'normal';
let chosenTower: TowerId = 'bastion',
  chosenStage = 0,
  chosenDifficulty = 0,
  preview: RunV2,
  rewardSelection = '',
  lastSignature = '',
  lastRewardId = '',
  lastWave = 0,
  lastPhase = '',
  persistTimer = 0;
const observedOffers = new Set<string>();
let selectedOffer: { rewardId: string; offerId: string; purchase: boolean } | null = null;
const telemetry = new LocalTelemetry();
const app = $('app');
app.innerHTML = `<main id="battlefield"><canvas id="arena" aria-label="Last Spire battlefield"></canvas><div class="arena-shade"></div><header class="battle-hud"><button class="brand-button" id="menu-btn" aria-label="Expedition menu">${glyph('tower')}<span>LAST SPIRE<small>THE RUNEFORGED AGE</small></span>${glyph('menu')}</button><div class="wave-hud"><span id="stage-label">VERDANT WILDS</span><strong id="wave-label">Wave 01 <em>/ 100</em></strong><div id="wave-progress"><i></i></div></div><div class="resource-hud"><span title="Scrap is spent during this expedition">${glyph('diamond')}<b id="scrap-value">0</b><small>SCRAP</small></span><span title="Credits unlock towers between expeditions">${glyph('diamond')}<b id="credit-value">0</b><small>CREDITS</small></span><button id="settings-btn" class="square-button" aria-label="Settings">${glyph('gear')}</button></div></header><div class="threat-strip"><button id="threat-text" class="threat-reference" title="Inspect upcoming enemies in the bestiary">One spire. A thousand ways to fight.</button><button id="pause-indicator" class="hidden">PAUSED · RESUME</button></div><nav class="field-tools" aria-label="Battlefield panels"><button id="expedition-btn" class="launch-tool">${glyph('play')}<span>Start expedition</span></button><button id="fusion-btn" class="fusion-tool" title="Fusion forge (F)">${glyph('diamond')}<span id="fusion-count">Fusions</span></button><button id="arsenal-btn" title="Arsenal (A)">${glyph('tower')}<span>Arsenal</span></button><button id="codex-btn" title="Codex (C)">${glyph('book')}<span>Codex</span></button><button id="bestiary-btn" title="Bestiary (B)">${glyph('beast')}<span>Bestiary</span></button><button id="stats-btn" title="Combat statistics">${glyph('stats')}<span>Ledger</span></button><button id="autocast-btn" title="Conditional skill autocast">${glyph('bolt')}<span>Autocast</span></button><button id="account-btn" title="Account and cloud saves">${glyph('shield')}<span>Guest · Local</span></button><button id="rewards-btn" class="reward-tool hidden">${glyph('diamond')}<span id="reward-count">Choose upgrade</span></button></nav><div id="buff-strip" aria-label="Active buffs"></div><div id="event-toast" role="status" aria-live="polite"></div><div id="boss-warning" class="hidden"></div><footer class="combat-controls"><div class="integrity"><div><span>${glyph('heart')} SPIRE INTEGRITY</span><strong id="hp-value">—</strong></div><div class="hp-track"><i id="hp-fill"></i><i id="shield-fill"></i></div><span id="barrier-value">Barrier dormant</span></div><div class="ability-tray"><button class="ability" id="signature-btn"><span>${glyph('shield')}</span><div><small>SIGNATURE <kbd>Q</kbd></small><b id="signature-name">Bulwark</b></div><em id="signature-cd"></em><span id="signature-auto" class="auto-indicator" hidden>AUTO</span></button><button class="ability" id="secondary-btn"><span>${glyph('bolt')}</span><div><small>SECONDARY <kbd>E</kbd></small><b id="secondary-name">Mend</b></div><em id="secondary-cd"></em><span id="secondary-auto" class="auto-indicator" hidden>AUTO</span></button></div><div class="playback"><button class="square-button" id="pause-btn" aria-label="Pause combat">${glyph('pause')}</button><button id="speed-btn" title="Speed (1, 2, 3)">1×</button><button id="target-btn" title="Target priority">${glyph('target')}<span id="target-label">Nearest</span></button></div></footer><div id="xp-hud" hidden><span id="xp-label"></span><div class="xp-track"><i id="xp-fill"></i></div></div><div id="window-host"></div><div id="window-dock"></div><div id="catchup-notice" class="catchup-notice hidden" role="status" aria-live="polite">${glyph('tower')}<span id="catchup-message"></span></div><div id="loading-screen"><div class="loading-rune">${glyph('tower')}</div><h1>LAST SPIRE</h1><p>Waking the ancient machines…</p></div></main>`;
const manager = new WindowManager(
  $('window-host'),
  $('window-dock'),
  () => data.settings,
  () => scheduleSave(),
);
const accountSync = new AccountSync({
  save: () => data,
  scope: () => saveScope,
  persist: async () => {
    await persist();
    if (storageFailed || blocked)
      throw new Error(
        'Local progress could not be secured. Export it before switching checkpoints.',
      );
  },
  activate: activateSave,
  changed: () => accountPanel.update(),
});
const accountPanel = new AccountPanel(accountSync, manager, download, () => {
  paused = true;
  updateHud();
});
const entryScreen = new EntryScreen({
  session: () => accountSync.api.bootstrap(),
  remembered: rememberedPlayer,
  guest: () => {},
  signIn: async (code) => {
    const nonce = accountSync.api.session?.nonce;
    await accountSync.signIn(code, 'code');
    if (!accountSync.view.player || accountSync.api.session?.nonce === nonce)
      throw new Error('Sign-in failed.');
    accountPanel.open();
  },
  continueAccount: async () => {
    await accountSync.initialize();
    if (!accountSync.active && !accountSync.view.player) throw new Error('Account unavailable.');
    if (
      !accountSync.active ||
      ['choice', 'conflict', 'lease', 'reauth', 'error'].includes(accountSync.view.phase)
    )
      accountPanel.open();
  },
});
const inspector = new BuildInspector({
  host: $('battlefield'),
  getRun: () => (playing && isV2(current()) ? (current() as RunV2) : null),
  onOpen: openEntity,
});
const renderer = new BattleRenderer($<HTMLCanvasElement>('arena'));
new ResizeObserver(() => renderer.resize()).observe($('arena'));
function isV2(s: RunV2 | RunState): s is RunV2 {
  return s.version === 2;
}
function current(): RunV2 | RunState {
  return playing && data.run ? data.run : preview;
}
function openEntity(ref: EntityRef) {
  const s = current();
  if (!isV2(s)) return;
  manager.open(
    'entity',
    { title: 'Runeforged detail', subtitle: 'LIVE BUILD INSPECTION', width: 560, height: 590 },
    entityMarkup(s, ref),
  );
}
$('battlefield').addEventListener('click', (event) => {
  const fuse = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-fuse-recipe]');
  if (fuse && !fuse.disabled) {
    openFusionPreview(
      fuse.dataset.fuseRecipe!,
      fuse.dataset.ingredientA!,
      fuse.dataset.ingredientB!,
    );
    return;
  }
  const link = (event.target as HTMLElement).closest<HTMLElement>(
    '[data-entity-kind][data-entity-id]',
  );
  if (link)
    openEntity({ kind: link.dataset.entityKind as EntityRef['kind'], id: link.dataset.entityId! });
});
function modern(s: RunV2 | RunState): RunV3 | null {
  return isV2(s) && (s as RunV3).rulesVersion === 3 ? (s as RunV3) : null;
}
function tower() {
  return TOWERS.find((t) => t.id === current().tower)!;
}
function applySettings() {
  document.documentElement.style.setProperty('--ui-scale', String(data.settings.uiScale / 100));
  document.documentElement.classList.toggle('reduced-motion', data.settings.reducedMotion);
  document.documentElement.dataset.intensity = data.settings.intensity;
  renderer.resize();
}
function effectiveProfile() {
  const levels = snapshotRunes(data.progression.runes);
  return {
    ...data.profile,
    upgrades: { power: levels.power, vitality: levels.vitality, fortune: levels.fortune },
  };
}
function makePreview() {
  preview = createRun(effectiveProfile(), chosenTower, chosenStage, chosenDifficulty, 831251, {
    mode: chosenMode,
    runes: snapshotRunes(data.progression.runes),
  });
  preview.time = 12;
}
function scheduleSave() {
  clearTimeout(persistTimer);
  persistTimer = window.setTimeout(() => void persist(), 300);
}
let saveCompletion: Promise<void> = Promise.resolve();
async function persist() {
  if (loading || blocked || contextChanging) return;
  if (saveBusy || settlePromise) {
    saveQueued = true;
    await (settlePromise || saveCompletion);
    return persist();
  }
  saveBusy = true;
  let completeSave!: () => void;
  saveCompletion = new Promise<void>((resolve) => {
    completeSave = resolve;
  });
  try {
    const scope = saveScope;
    await saveGame(data, false, scope);
    storageFailed = false;
    accountSync.onLocalSave(scope);
  } catch (e) {
    storageFailed = true;
    if (e instanceof SaveError && e.code === 'invalid') blocked = true;
    notify(
      `Save unavailable. ${e instanceof Error ? e.message : 'Storage could not be reached'}. Export a backup in Settings.`,
      'warning',
    );
  } finally {
    saveBusy = false;
    completeSave();
    if (saveQueued) {
      saveQueued = false;
      scheduleSave();
    }
  }
}
async function settle() {
  if (data.run && isV2(data.run) && data.run.phase === 'ended') void telemetry.finish(data.run);
  if (settlePromise) return settlePromise;
  if (!data.run || data.run.settled) return;
  const task = async () => {
    try {
      data = await settleGame(data, saveScope);
      accountSync.onLocalSave(saveScope);
    } catch {
      data = settleInMemory(data);
      storageFailed = true;
      notify('Rewards are safe in this tab. Export a backup before closing it.', 'warning');
    } finally {
      updateHud();
    }
  };
  settlePromise = task();
  try {
    await settlePromise;
  } finally {
    settlePromise = null;
    if (saveQueued) {
      saveQueued = false;
      scheduleSave();
    }
  }
}
async function activateSave(incoming: SaveV3, target: SaveScope, explicitImport = false) {
  if (contextChanging) throw new Error('Another checkpoint is being opened. Please wait.');
  contextChanging = true;
  paused = true;
  document.documentElement.dataset.accountSwitching = 'true';
  clearTimeout(persistTimer);
  try {
    if (settlePromise) await settlePromise;
    await saveCompletion;
    if (!explicitImport) {
      if (blocked)
        throw new Error(
          'Recover or export the protected local checkpoint before switching accounts.',
        );
      await saveGame(data, false, saveScope);
    }
    const next = parseGame({ ...incoming, settings: data.settings });
    await saveGame(next, true, target);
    ++contextEpoch;
    saveScope = target;
    data = next;
    blocked = false;
    storageFailed = false;
    saveQueued = false;
    playing = !!data.run;
    paused = playing && data.run?.phase === 'combat';
    chosenMode = data.run && modern(data.run) ? modern(data.run)!.mode : 'normal';
    chosenTower = data.run?.tower ?? data.profile.unlocked[0] ?? 'bastion';
    chosenStage = data.run?.stage ?? 0;
    chosenDifficulty = data.run?.difficulty ?? 0;
    lastPhase = '';
    lastSignature = '';
    lastRewardId = '';
    lastWave = 0;
    manager.closeAll();
    clearTimeout(persistTimer);
    applySettings();
    makePreview();
    updateHud();
    if (!playing || data.run?.phase === 'combat') openLaunch();
    else if (data.run?.phase === 'victory') openVictory();
    else if (data.run?.phase === 'ended') openResults();
    else if (data.run?.version === 1 && ['draft', 'shop'].includes(data.run.phase))
      showLegacyRewards(data.run);
  } finally {
    contextChanging = false;
    delete document.documentElement.dataset.accountSwitching;
  }
}
let toastTimer = 0,
  nextNoticeAt = 0;
function notify(message: string, tone = 'normal') {
  const el = $('event-toast');
  el.textContent = message;
  el.dataset.tone = tone;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove('show'), 5000);
}
let audio: AudioContext | undefined;
function sound(note = 440) {
  if (!data.settings.sound || document.hidden) return;
  try {
    audio ??= new AudioContext();
    void audio.resume();
    const o = audio.createOscillator(),
      g = audio.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(note, audio.currentTime);
    o.frequency.exponentialRampToValueAtTime(note * 0.6, audio.currentTime + 0.18);
    g.gain.setValueAtTime(0.035, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.22);
    o.connect(g).connect(audio.destination);
    o.start();
    o.stop(audio.currentTime + 0.24);
  } catch {}
}
function updateHud() {
  const shopRun = current();
  if (isV2(shopRun) && manager.has('rewards')) {
    const panel = manager.element('rewards')!;
    updateRepairPanel(panel, repairOptions(shopRun, lastRewardId), shopRun.hp, shopRun.maxHp);
  }
  if (!preview) return;
  const s = current(),
    legacy = !isV2(s);
  $('stage-label').textContent =
    STAGES[s.stage].name.toUpperCase() +
    (legacy ? ' · RECOVERED RUN' : s.difficulty ? ` · ASCENSION ${s.difficulty}` : '');
  $('wave-label').innerHTML =
    `Wave ${String(s.wave).padStart(2, '0')} <em>/ ${s.endless ? '∞' : modern(s)?.mode === 'quick' ? '50' : '100'}</em>`;
  $('wave-progress').querySelector<HTMLElement>('i')!.style.width =
    `${s.endless ? 100 : Math.min(100, (s.wave / (modern(s)?.mode === 'quick' ? 50 : 100)) * 100)}%`;
  const progress = modern(s);
  $('xp-hud').hidden = !playing || !progress;
  if (progress) {
    $('xp-label').textContent =
      `LEVEL ${progress.level}${progress.level >= 200 ? ' · MAX' : ` · ${progress.xp.toFixed(1)} / ${progress.xpRequired} XP`} · ${progress.pendingRewards.filter((r) => r.kind === 'draft').length} choices`;
    $('xp-fill').style.width = `${Math.min(100, (progress.xp / progress.xpRequired) * 100)}%`;
  }
  $('scrap-value').textContent = Math.floor(s.scrap).toLocaleString();
  $('credit-value').textContent = data.profile.credits.toLocaleString();
  $('hp-value').textContent = `${Math.max(0, Math.ceil(s.hp))} / ${Math.ceil(s.maxHp)}`;
  $('hp-fill').style.width = `${Math.max(0, (s.hp / s.maxHp) * 100)}%`;
  $('hp-fill').classList.toggle('low', s.hp / s.maxHp < 0.3);
  $('shield-fill').style.width = `${Math.min(100, (s.shield / s.maxHp) * 100)}%`;
  $('barrier-value').textContent =
    s.shield > 1 ? `${Math.ceil(s.shield)} barrier` : 'Barrier dormant';
  $('signature-name').textContent = tower().skill;
  $('secondary-name').textContent =
    s.secondary === 'repair'
      ? 'Mend'
      : s.secondary === 'nova'
        ? 'Solar nova'
        : s.secondary === 'stasis'
          ? 'Time fracture'
          : (CARD_BY_ID[s.secondary]?.name ?? s.secondary);
  $('signature-cd').textContent = s.skillCd > 0 ? `${Math.ceil(s.skillCd)}s` : '';
  $('secondary-cd').textContent = s.secondaryCd > 0 ? `${Math.ceil(s.secondaryCd)}s` : '';
  $<HTMLButtonElement>('signature-btn').disabled =
    !playing || s.phase !== 'combat' || s.skillCd > 0;
  $<HTMLButtonElement>('secondary-btn').disabled =
    !playing || s.phase !== 'combat' || s.secondaryCd > 0;
  $('signature-btn').title = tower().skillDescription;
  const auto =
    data.progression.active?.runId === s.id
      ? data.progression.active.autocast
      : defaultAutocastConfig();
  for (const slot of ['signature', 'secondary'] as const) {
    $(`${slot}-btn`).classList.toggle('auto-enabled', auto[slot].enabled);
    $(`${slot}-auto`).hidden = !auto[slot].enabled;
    $(`${slot}-btn`).setAttribute(
      'aria-description',
      auto[slot].enabled ? `Autocast enabled: ${auto[slot].preset}` : 'Manual skill',
    );
  }

  $('speed-btn').textContent = `${data.settings.speed}×`;
  $('target-label').textContent = s.targeting[0].toUpperCase() + s.targeting.slice(1);
  $('pause-btn').innerHTML = glyph(paused ? 'play' : 'pause');
  $('pause-btn').setAttribute('aria-label', paused ? 'Resume combat' : 'Pause combat');
  $('pause-indicator').classList.toggle(
    'hidden',
    !playing || !(paused || decisionPaused(s)) || s.phase !== 'combat',
  );
  $('pause-indicator').textContent = paused
    ? 'PAUSED · RESUME'
    : awayDecisionHold
      ? 'PAUSED FOR A DECISION'
      : 'CHOOSING · AUTO-PAUSED';
  $('expedition-btn').querySelector('span')!.textContent = !playing
    ? 'Start expedition'
    : paused
      ? 'Resume expedition'
      : 'Expedition setup';
  const readyFusions = playing && modern(s) ? availableFusions(s as RunV2).length : 0;
  $('fusion-count').textContent = readyFusions ? `Fusions · ${readyFusions}` : 'Fusions';
  $('fusion-btn').classList.toggle('fusion-ready', readyFusions > 0);
  $('fusion-btn').setAttribute('aria-label', `Fusion forge, ${readyFusions} ready`);
  $('arena').dataset.catchingUp = String(clock.catchingUp);
  const count = isV2(s)
    ? s.phase === 'combat'
      ? s.pendingRewards.length
      : 0
    : s.phase === 'draft' || s.phase === 'shop'
      ? 1
      : 0;
  $('rewards-btn').classList.toggle('hidden', !playing || count === 0);
  $('reward-count').textContent = count === 1 ? 'Choose upgrade' : `${count} choices waiting`;
  $('threat-text').textContent = !playing
    ? 'One spire. A thousand ways to fight.'
    : isV2(s)
      ? describeNextThreat(s)
      : `${s.enemies.length} enemies · recovered expedition continues with its original rules`;
  if (isV2(s) && hasEncounters(s) && playing) {
    const { wave, roster } = nextEncounter(s);
    const priority = roster.filter(
      (id) => ENEMY_BY_ID[id].mechanic !== 'shared' || ENEMY_BY_ID[id].role === 'boss',
    );
    const names = (priority.length ? priority : roster)
      .slice(0, 2)
      .map((id) => ENEMY_BY_ID[id].name);
    $('threat-text').textContent =
      `Upcoming ${wave} · ${formationName(wave)} · ${names.join(' + ')} · Bestiary ↗`;
  }
  if (isV2(s)) {
    const groups = new Map<
      string,
      { count: number; value: number; first: number; last: number; sources: Set<string> }
    >();
    for (const buff of s.buffs) {
      if (buff.expires <= s.time) continue;
      const group = groups.get(buff.stat) ?? {
        count: 0,
        value: 0,
        first: Infinity,
        last: 0,
        sources: new Set<string>(),
      };
      group.count += buff.stacks;
      group.value += buff.value;
      group.first = Math.min(group.first, buff.expires - s.time);
      group.last = Math.max(group.last, buff.expires - s.time);
      group.sources.add(buff.source);
      groups.set(buff.stat, group);
    }
    $('buff-strip').innerHTML = [...groups]
      .map(([stat, g]) => {
        const source = CARDS.find((c) => g.sources.has(c.effect)),
          icon = source ? cardIcon(source.iconId, 20) : glyph('bolt');
        const limit = stat === 'crit' ? Math.max(0, 0.8 - getWeaponStats(s, s.weapons[0]).crit) : 2;
        const value = Math.round(Math.min(limit, g.value) * 100),
          first = Math.ceil(g.first),
          last = Math.ceil(g.last);
        const names = [...g.sources].map(
          (id) =>
            CARDS.find((c) => c.effect === id)?.name ?? (id === 'signature' ? tower().skill : id),
        );
        const detail = `${names.join(', ')}. ${g.count} active stacks; ${stat === 'crit' ? 'total critical chance caps at 80%' : 'temporary bonuses cap at +200%'}. Each stack expires independently.`;
        return `<span class="buff-chip" title="${esc(detail)}" aria-label="${esc(detail)}">${icon}<b>${esc(stat)} +${value}%</b> ×${g.count} · ${first === last ? last : `${first}–${last}`}s</span>`;
      })
      .join('');
  } else $('buff-strip').innerHTML = '';
}
function openLaunch() {
  const scrollTop = manager.element('expedition')?.querySelector('.launch-scroll')?.scrollTop ?? 0;
  manager.close('menu');
  manager.close('rewards');
  selectedOffer = null;
  manager.close('attune');
  manager.close('fusion-offer');
  manager.close('fusion-preview');
  if (playing && data.run) {
    paused = true;
    chosenTower = data.run.tower;
    chosenStage = data.run.stage;
    chosenDifficulty = data.run.difficulty;
    chosenMode = modern(data.run)?.mode ?? 'normal';
  }
  if (!playing) {
    const allowed = data.progression.stages[chosenStage].unlockedDifficulty;
    if (chosenDifficulty > allowed) {
      chosenDifficulty = allowed;
      makePreview();
    }
  }
  const expanded =
    manager.element('expedition')?.querySelector<HTMLDetailsElement>('.launch-runes')?.open ??
    false;
  manager.open(
    'expedition',
    {
      title: playing ? 'Your expedition awaits.' : 'Forge your next expedition.',
      subtitle: 'LAST SPIRE · EXPEDITION SETUP',
      width: 1100,
      height: 820,
    },
    launchMarkup(
      {
        save: data,
        tower: chosenTower,
        stage: chosenStage,
        difficulty: chosenDifficulty,
        mode: chosenMode,
        playing,
      },
      runeMarkup(),
      RUNE_NAMES,
    ),
  );
  const panel = manager.element('expedition')!;
  panel.querySelector('.launch-scroll')!.scrollTop = scrollTop;
  panel.querySelector<HTMLDetailsElement>('.launch-runes')!.open = expanded;
  panel.querySelectorAll<HTMLButtonElement>('[data-launch-tower]').forEach((button) => {
    button.onclick = () => {
      if (playing || contextChanging || blocked) return;
      const selected = TOWERS.find((t) => t.id === button.dataset.launchTower);
      if (!selected) return;
      if (!data.profile.unlocked.includes(selected.id)) {
        if (data.profile.credits < selected.cost) return;
        data.profile.credits -= selected.cost;
        data.profile.unlocked.push(selected.id);
        notify(`${selected.name} awakened.`);
      }
      chosenTower = selected.id;
      makePreview();
      scheduleSave();
      openLaunch();
      updateHud();
    };
  });
  $('mode-select').onchange = () => {
    if (playing) return;
    chosenMode = $<HTMLSelectElement>('mode-select').value as RunMode;
    makePreview();
    openLaunch();
    updateHud();
  };
  $('stage-select').onchange = () => {
    if (playing) return;
    chosenStage = Number($<HTMLSelectElement>('stage-select').value);
    makePreview();
    openLaunch();
    updateHud();
  };
  $('difficulty-select').onchange = () => {
    if (playing) return;
    chosenDifficulty = Number($<HTMLSelectElement>('difficulty-select').value);
    makePreview();
    openLaunch();
    updateHud();
  };
  bindRunes();
  $('launch-retire')?.addEventListener('click', () => {
    manager.close('expedition');
    openRetire(true);
  });
  $('resume-btn')?.addEventListener('click', () => {
    manager.close('expedition');
    if (data.run?.phase === 'ended') return openResults();
    if (data.run?.phase === 'victory') return openVictory();
    paused = false;
    presentDecisions();
    updateHud();
  });
  $('begin-btn')?.addEventListener('click', () => {
    if (playing || contextChanging || blocked || entryScreen.visible) return;
    if (
      chosenStage >= data.profile.stageUnlocked ||
      chosenDifficulty > data.progression.stages[chosenStage].unlockedDifficulty ||
      !data.profile.unlocked.includes(chosenTower)
    ) {
      notify('Choose an unlocked tower, stage and difficulty.');
      return;
    }
    data.run = createRun(
      effectiveProfile(),
      chosenTower,
      chosenStage,
      chosenDifficulty,
      undefined,
      { mode: chosenMode, runes: snapshotRunes(data.progression.runes) },
    );
    data.progression.active = {
      runId: data.run.id,
      rulesVersion: 3,
      runes: snapshotRunes(data.progression.runes),
      autocast: structuredClone(data.progression.autocast),
    };
    data.progression.active.autocast.signature.enabled &&=
      data.progression.active.runes.autoSignature > 0;
    data.progression.active.autocast.secondary.enabled &&=
      data.progression.active.runes.autoSecondary > 0;
    recordDamageSample(data.run);
    void telemetry.begin(data.run, {
      build: '3.0.0',
      mode: chosenMode,
      runes: data.progression.active.runes,
    });
    playing = true;
    paused = false;
    awayDecisionHold = false;
    lastRewardId = '';
    lastSignature = '';
    lastPhase = '';
    lastWave = 0;
    manager.closeAll();
    clock.reset();
    scheduleSave();
    updateHud();
    if (!data.profile.tutorialDone) openHelp();
  });
  updateHud();
}
function openMenu() {
  manager.open(
    'menu',
    {
      title: playing ? 'Keep the light alive.' : 'Last Spire',
      subtitle: 'THE RUNEFORGED AGE',
      width: 410,
      height: 500,
    },
    `<div class="menu-list">${!playing ? '<button id="menu-launch">Prepare expedition</button>' : ''}<button id="menu-arsenal">${glyph('tower')} Arsenal & synergies</button><button id="menu-codex">${glyph('book')} Field codex</button><button id="menu-hangar">${glyph('shield')} Tower hangar</button><button id="menu-settings">${glyph('gear')} Settings & saves</button><button id="menu-account">${glyph('shield')} Account & cloud saves</button><button id="menu-help">How to play</button>${playing ? '<button id="menu-retire" class="danger-text">Retire & collect rewards</button>' : ''}</div><p class="quiet">${playing ? 'Combat continues behind information windows. Use Space to pause.' : 'Original arcane machines. Endless possibilities.'}</p>`,
  );
  $('menu-launch')?.addEventListener('click', () => {
    manager.close('menu');
    openLaunch();
  });
  $('menu-arsenal').onclick = openArsenal;
  $('menu-codex').onclick = () => openCodex();
  $('menu-hangar').onclick = openHangar;
  $('menu-settings').onclick = openSettings;
  $('menu-account').onclick = () => accountPanel.open();
  $('menu-help').onclick = openHelp;
  $('menu-retire')?.addEventListener('click', () => openRetire());
}
function scopeLabel(c: CardDefinition) {
  if (c.group === 'weapon')
    return isDefensiveKind(c.weapon!) ? 'Arsenal core · defensive engine' : 'Arsenal core · weapon';
  return c.scope === 'projectiles'
    ? ['damage', 'range', 'rate'].includes(c.effect)
      ? 'All eligible arsenal cores'
      : 'All eligible projectiles'
    : c.scope === 'defense'
      ? 'Tower defense'
      : c.scope === 'weapon'
        ? 'Choose a core'
        : c.scope === 'skill'
          ? 'Skill system'
          : 'Entire tower';
}
function cardRules(c: CardDefinition) {
  if (c.effect === 'crossfire' || c.effect === 'control-release') return '';
  if (c.group === 'skill')
    return 'Every skill cast activates this card. Equip it as your secondary to increase this card’s damage, healing, or shielding by 50%.';
  if (c.group === 'infusion')
    return 'Direct damage is shared across infusions. Bosses receive 35% of normal control.';
  if (c.effect === 'retaliation')
    return '0.6s internal cooldown. Retaliation does not trigger primary-hit effects.';
  if (c.effect === 'shield-break')
    return '2s internal cooldown. Boss stun duration is reduced to 35%.';
  if (c.effect === 'reflect' || c.effect === 'thorns')
    return 'Retaliation cannot start another retaliation or primary-hit chain.';
  if (c.group === 'trigger') {
    if (c.effect.startsWith('hurt-'))
      return '0.6s internal cooldown. Stacked temporary stat bonuses cap at +200%.';
    if (/^(crit-haste|burn-|freeze-|poison-|boss-)/.test(c.effect))
      return '0.25s internal cooldown. Stacked temporary stat bonuses cap at +200%.';
    return 'Temporary stat bonuses stack to +200%; each stack expires independently.';
  }
  if (['split', 'blast', 'pulse', 'trail'].includes(c.effect))
    return 'Secondary damage is capped at two proc generations; it cannot recursively generate primary effects.';
  return '';
}
function offerMarkup(offer: CardOffer, shop: boolean) {
  const c = CARD_BY_ID[offer.cardId];
  if (!c) return '';
  const s = current();
  let info = { summary: '', awaken: [] as string[], lost: [] as string[] };
  if (isV2(s)) {
    try {
      info = previewCard(s, offer, c.scope === 'weapon' ? s.weapons[0]?.id : undefined);
    } catch {}
  }
  let ownership = 'NEW',
    ownedText = '';
  if (isV2(s)) {
    const ownedWeapon = c.weapon && s.weapons.find((w) => w.kind === c.weapon);
    const ownedCards = s.cards.filter((x) => x.cardId === c.id);
    if (ownedWeapon) {
      ownership = (modern(s) ? (ownedWeapon.masteryRank ?? 1) >= 6 : ownedWeapon.mastery >= 24)
        ? 'MAX MASTERY · INVESTMENT UPGRADE'
        : 'UPGRADE';
      ownedText = modern(s)
        ? `Owned · mastery ${ownedWeapon.masteryRank ?? 1}/6 · ${(ownedWeapon.masteryRank ?? 1) < 6 ? 'training +150s' : 'mastery complete'} · investment ${ownedWeapon.mastery} → ${Math.min(24, ownedWeapon.mastery + 1)} · ${rarityLabel(ownedWeapon.rarity)} · drop ${rarityLabel(offer.rarity)}`
        : `Owned · ${getWeaponStats(s, ownedWeapon).damage.toFixed(1)} current damage · investment ${ownedWeapon.mastery} → ${Math.min(24, ownedWeapon.mastery + 1)}`;
    } else if (ownedCards.length) {
      ownership = 'UPGRADE';
      ownedText = ownedCards
        .map(
          (x) =>
            `${x.targetId ? (s.weapons.find((w) => w.id === x.targetId)?.kind ?? 'chosen weapon') + ': ' : ''}${x.stacks} → ${x.stacks + 1} picks · promotion ${x.mastery % 3}/3`,
        )
        .join(' · ');
    }
    if (c.scope === 'weapon' && s.weapons.length > 1)
      info.summary = 'Choose a target to compare exact changes. ' + info.summary;
  }
  return `<button class="card rarity-${offer.rarity}" data-offer="${esc(offer.id)}" style="--rarity:${RARITY_COLORS[offer.rarity]}" ${shop && s.scrap < offer.price ? 'disabled' : ''}><span class="card-top"><span>${rarityLabel(offer.rarity)}</span><span>${c.weapon && isDefensiveKind(c.weapon) ? 'DEFENSIVE CORE' : c.group.toUpperCase()}</span></span><span class="ownership-badge">${ownership}</span>${ownedText ? `<span class="owned-comparison">${esc(ownedText)}</span>` : ''}<span class="card-art">${cardIcon(c.iconId, 72)}</span><h3>${esc(c.name)}</h3><span class="card-scope">${esc(scopeLabel(c))}</span><p>${esc(c.description)}</p>${cardRules(c) ? `<small class="card-rules">${esc(cardRules(c))}</small>` : ''}${info.summary ? `<span class="card-change">${esc(info.summary)}</span>` : ''}${info.awaken.length ? `<span class="card-synergy">✦ ${esc(info.awaken.join(' · '))}</span>` : ''}${c.weapon && modern(s) ? fusionHintMarkup(c.weapon, s.version === 2 ? s.weapons : [], modern(s)?.arsenalVersion === 2) : ''}${info.lost.length ? `<span class="card-loss">Releases ${esc(info.lost.join(', '))}</span>` : ''}<span class="card-action">${shop ? `${offer.price} scrap` : 'Choose upgrade'} ${glyph('arrow')}</span></button>`;
}
function showRewards(id?: string) {
  const s = current();
  if (!playing) return;
  if (manager.has('attune')) return;
  manager.close('fusion-offer');
  manager.close('fusion-preview');
  if (!isV2(s)) {
    showLegacyRewards(s);
    return;
  }
  if (s.phase !== 'combat' || !s.pendingRewards.length) {
    manager.close('rewards');
    return;
  }
  const reward =
    s.pendingRewards.find((p) => p.id === (id ?? rewardSelection)) ?? s.pendingRewards[0];
  rewardSelection = reward.id;
  lastRewardId = reward.id;
  const shop = reward.kind === 'shop';
  const offerKey = `${s.id}:${reward.id}:${reward.offers.map((o) => o.id).join(',')}`;
  if (!observedOffers.has(offerKey)) {
    observedOffers.add(offerKey);
    telemetry.event(s.id, s.time, 'offers', {
      rewardId: reward.id,
      kind: reward.kind,
      level: reward.level ?? 0,
      wave: reward.wave,
      offers: reward.offers.map((o) => ({
        id: o.id,
        cardId: o.cardId,
        rarity: o.rarity,
        price: o.price,
      })),
    });
  }

  manager.open(
    'rewards',
    {
      title: shop ? 'The wandering artificer.' : 'Shape what comes next.',
      subtitle: `${shop ? `WAVE ${reward.wave}` : reward.level ? `LEVEL ${reward.level}` : `WAVE ${reward.wave}`} · ${shop ? `${Math.floor(s.scrap)} SCRAP` : 'SELECT ONE CARD'}`,
      width: shop ? 1120 : 1060,
      height: 690,
      choice: true,
    },
    `<div class="reward-toolbar"><label><input type="checkbox" id="choice-pause" ${data.settings.autoPauseChoices ? 'checked' : ''}> Pause while choosing</label>${s.pendingRewards.length > 1 ? `<select id="reward-queue" aria-label="Pending rewards">${s.pendingRewards.map((p) => `<option value="${esc(p.id)}" ${p.id === reward.id ? 'selected' : ''}>${p.kind === 'shop' ? `Wave ${p.wave} · Artificer` : p.level ? `Level ${p.level} · Upgrade` : `Wave ${p.wave} · Upgrade`}</option>`).join('')}</select>` : '<span>Upgrades accumulate. Your existing effects stay.</span>'}</div>${shop ? repairPanelMarkup(repairOptions(s, reward.id), s.hp, s.maxHp) : ''}<div class="card-grid ${shop ? 'shop-cards' : ''}">${reward.offers.map((o) => offerMarkup(o, shop)).join('')}</div><div class="reward-footer"><button id="reward-reroll" class="outline-button">Reroll · ${rewardRerollCost(s, reward.id)} scrap · ${reward.rerolls} used</button>${shop ? `<button id="leave-shop" class="gold-button">Continue ${glyph('arrow')}</button>` : '<span class="quiet">Six shared sockets · support cards accumulate</span>'}</div>`,
  );
  $('choice-pause').onchange = () => {
    data.settings.autoPauseChoices = $<HTMLInputElement>('choice-pause').checked;
    if (!data.settings.autoPauseChoices) awayDecisionHold = false;
    updateHud();
    scheduleSave();
    updateHud();
  };
  $('reward-queue')?.addEventListener('change', () =>
    showRewards($<HTMLSelectElement>('reward-queue').value),
  );
  manager
    .element('rewards')!
    .querySelectorAll<HTMLButtonElement>('[data-offer]')
    .forEach(
      (b) =>
        (b.onclick = () => {
          const offer = reward.offers.find((o) => o.id === b.dataset.offer)!;
          const c = CARD_BY_ID[offer.cardId];
          if (
            (c.scope === 'weapon' && c.group !== 'weapon') ||
            (c.group === 'weapon' &&
              s.weapons.length >= 6 &&
              !s.weapons.some((w) => w.kind === c.weapon))
          ) {
            selectedOffer = { rewardId: reward.id, offerId: offer.id, purchase: shop };
            showTargetPicker(offer);
            return;
          }
          applyOffer(reward.id, offer.id, shop);
        }),
    );
  $('reward-reroll').onclick = async () => {
    if (rerollReward(s, reward.id)) {
      clearTimeout(persistTimer);
      await persist();
      showRewards(reward.id);
    } else notify('Not enough scrap or rerolls available.');
  };
  manager
    .element('rewards')!
    .querySelectorAll<HTMLButtonElement>('[data-repair-percent]')
    .forEach((button) => {
      button.onclick = async () => {
        const percent = Number(button.dataset.repairPercent);
        const hpBefore = s.hp;
        const scrapBefore = s.scrap;
        if (repair(s, reward.id, percent)) {
          telemetry.event(s.id, s.time, 'shop-repair', {
            percent,
            health: s.hp - hpBefore,
            scrap: scrapBefore - s.scrap,
            wave: reward.wave,
          });
          clearTimeout(persistTimer);
          await persist();
          showRewards(reward.id);
          updateHud();
        } else notify('Repair unavailable. Check scrap, health and remaining stock.');
      };
    });
  $('leave-shop')?.addEventListener('click', () => {
    closeShop(s, reward.id);
    scheduleSave();
    showRewards();
    updateHud();
  });
}
async function applyOffer(rewardId: string, offerId: string, purchase: boolean, targetId?: string) {
  const s = current();
  if (!isV2(s)) return;
  const offer = s.pendingRewards
    .find((r) => r.id === rewardId)
    ?.offers.find((o) => o.id === offerId);
  const scrapBefore = s.scrap;
  const ok = purchase
    ? buyOffer(s, rewardId, offerId, targetId)
    : chooseReward(s, rewardId, offerId, targetId);
  if (!ok) {
    notify('That upgrade cannot be applied to this weapon or cannot be afforded.');
    return;
  }
  if (!data.profile.tutorialDone) {
    data.profile.tutorialDone = true;
    s.tutorialStep = 4;
  }
  telemetry.event(s.id, s.time, purchase ? 'shop-purchase' : 'level-choice', {
    rewardId,
    offerId,
    cardId: offer?.cardId ?? '',
    rarity: offer?.rarity ?? '',
    targetId: targetId ?? '',
    scrapBefore,
    scrapAfter: s.scrap,
    equipment: s.weapons.map((w) => ({
      id: w.id,
      kind: w.kind,
      rank: w.masteryRank ?? 0,
      investment: w.mastery,
    })),
  });
  sound(620);
  clearTimeout(persistTimer);
  await persist();
  showRewards(rewardId);
  if (manager.has('arsenal')) openArsenal();
  updateHud();
}
function showTargetPicker(offer: CardOffer) {
  const s = current();
  if (!isV2(s)) return;
  const c = CARD_BY_ID[offer.cardId];
  const replacing = c.group === 'weapon';
  manager.close('rewards');
  manager.open(
    'attune',
    {
      title: `Attune ${c.name}`,
      subtitle: 'CHOOSE THE WEAPON TO STRENGTHEN',
      width: 500,
      height: 550,
      choice: true,
      onClose: () => {
        const target = selectedOffer;
        selectedOffer = null;
        if (target && !contextChanging) showRewards(target.rewardId);
      },
    },
    `<p class="lead">${replacing ? 'All global cards stay. This explicitly replaces one weapon; its infusions and weapon mastery are released.' : 'Your other weapons keep their current effects. This infusion adds to the selected weapon.'}</p><div class="target-weapons">${s.weapons
      .map(
        (w) =>
          `<button data-target="${esc(w.id)}" ${previewCard(s, offer, w.id).canApply === false ? 'disabled' : ''}>${cardIcon(equipmentIcon(w.kind), 44)}<span><b>${WEAPON_BY_ID[w.kind].name}</b><small>${w.infusions.length ? w.infusions.join(' + ') : 'Uninfused'} · ${rarityLabel(w.rarity)}</small><small>${esc(previewCard(s, offer, w.id).summary)}</small>${previewCard(
            s,
            offer,
            w.id,
          )
            .awaken.map((name) => `<small>✦ ${esc(name)}</small>`)
            .join('')}${previewCard(s, offer, w.id)
            .lost.map((name) => `<small>Releases: ${esc(name)}</small>`)
            .join('')}</span>${glyph('arrow')}</button>`,
      )
      .join('')}</div>`,
  );
  manager
    .element('attune')!
    .querySelectorAll<HTMLButtonElement>('[data-target]')
    .forEach(
      (b) =>
        (b.onclick = () => {
          if (!selectedOffer) return;
          applyOffer(
            selectedOffer.rewardId,
            selectedOffer.offerId,
            selectedOffer.purchase,
            b.dataset.target,
          );
          selectedOffer = null;
          manager.close('attune');
        }),
    );
}
function legacyIcon(u: Upgrade) {
  return cardIcon(
    CARDS.find((c) =>
      u.kind === 'pattern'
        ? c.weapon === u.value
        : u.kind === 'element'
          ? c.element === u.value
          : c.effect === u.value,
    )?.iconId ?? CARDS.find((c) => c.group === 'modifier')!.iconId,
    64,
  );
}
function showLegacyRewards(s: RunState) {
  if (s.phase !== 'draft' && s.phase !== 'shop') {
    manager.close('rewards');
    return;
  }
  lastRewardId = `legacy-${s.wave}-${s.phase}`;
  const shop = s.phase === 'shop';
  manager.open(
    'rewards',
    {
      title: shop ? 'The wandering artificer.' : 'Continue your recovered build.',
      subtitle: `RECOVERED EXPEDITION · WAVE ${s.wave}`,
      width: 1030,
      height: 670,
      choice: true,
    },
    `<p class="notice">This saved expedition keeps its original combat rules. New expeditions use the expanded arsenal.</p><div class="card-grid ${shop ? 'shop-cards' : ''}">${s.choices.map((u, i) => `<button class="card rarity-normal" data-legacy-offer="${i}" ${shop && s.scrap < u.price ? 'disabled' : ''}><span class="card-top"><span>Recovered card</span><span>${esc(u.kind)}</span></span><span class="card-art">${legacyIcon(u)}</span><h3>${esc(u.name)}</h3><p>${esc(u.description)}</p><span class="card-action">${shop ? `${u.price} scrap` : 'Choose upgrade'} ${glyph('arrow')}</span></button>`).join('')}</div><div class="reward-footer">${!shop ? `<button id="legacy-reroll" class="outline-button" ${s.rerolls <= 0 ? 'disabled' : ''}>Reroll · ${s.rerolls} remaining</button>` : `<button id="legacy-heal" class="outline-button" ${s.scrap < 35 || s.hp >= s.maxHp ? 'disabled' : ''}>Repair 30% · 35 scrap</button><button id="legacy-leave" class="gold-button">Continue expedition</button>`}</div>`,
  );
  manager
    .element('rewards')!
    .querySelectorAll<HTMLButtonElement>('[data-legacy-offer]')
    .forEach(
      (b) =>
        (b.onclick = () => {
          const i = Number(b.dataset.legacyOffer);
          if (shop) buyUpgrade(s, s.choices[i].id);
          else selectDraft(s, i);
          scheduleSave();
          showLegacyRewards(s);
          updateHud();
        }),
    );
  $('legacy-reroll')?.addEventListener('click', () => {
    legacyReroll(s);
    scheduleSave();
    showLegacyRewards(s);
  });
  $('legacy-heal')?.addEventListener('click', () => {
    if (s.scrap >= 35) {
      s.scrap -= 35;
      s.hp = Math.min(s.maxHp, s.hp + s.maxHp * 0.3);
      scheduleSave();
      showLegacyRewards(s);
      updateHud();
    }
  });
  $('legacy-leave')?.addEventListener('click', () => {
    continueRun(s);
    scheduleSave();
    showLegacyRewards(s);
  });
}
let arsenalTab = 'weapons';
let awayDecisionHold = false;
function queuedDecision(s: RunV2 | RunState) {
  return isV2(s)
    ? s.pendingRewards.length > 0 || pendingFusionOffer(s)
    : s.phase === 'draft' || s.phase === 'shop';
}
function decisionPaused(s: RunV2 | RunState, background = false, update = false) {
  const state = resolveDecisionPause({
    queued: queuedDecision(s),
    fusion: isV2(s) && pendingFusionOffer(s),
    choiceWindow: manager.pendingChoice(),
    windowPaused: manager.choicesPause(),
    autoPause: data.settings.autoPauseChoices,
    background,
    held: awayDecisionHold,
  });
  if (update) awayDecisionHold = state.held;
  return state.paused;
}
function canSimulate(backgroundProgress: boolean) {
  const s = current();
  const decision = decisionPaused(s, backgroundProgress, true);
  return (
    playing &&
    !paused &&
    !contextChanging &&
    !entryScreen.visible &&
    s.phase === 'combat' &&
    !decision
  );
}
function presentDecisions() {
  const s = current();
  if (
    !playing ||
    contextChanging ||
    entryScreen.visible ||
    manager.has('expedition') ||
    manager.has('attune') ||
    manager.has('retire') ||
    manager.has('fusion-preview')
  )
    return;
  if (manager.pendingChoice() && !manager.has('rewards') && !manager.has('fusion-offer')) return;
  if (!isV2(s)) {
    if (['draft', 'shop'].includes(s.phase) && !manager.has('rewards')) showLegacyRewards(s);
    return;
  }
  if (s.phase !== 'combat') return;
  if (nextRunDecision(s) === 'reward') {
    const id = s.pendingRewards[0].id;
    if (!manager.has('rewards') || !s.pendingRewards.some((r) => r.id === lastRewardId)) {
      manager.close('fusion-offer');
      showRewards(id);
      sound(680);
    }
    return;
  }
  manager.close('rewards');
  lastRewardId = '';
  const currentRules = modern(s);
  if (currentRules && pendingFusionOffer(s) && !manager.has('fusion-offer'))
    openFusionOffer(currentRules);
}
function openFusionOffer(s: RunV3) {
  const offers = unseenFusions(s);
  if (!offers.length) return;
  manager.close('fusions');
  manager.open(
    'fusion-offer',
    {
      title: 'Your cores are ready to fuse.',
      subtitle: 'MASTERY COMPLETE · COMBAT PAUSED',
      width: 760,
      height: 640,
      choice: true,
      onClose: () => {
        if (current() !== s || contextChanging) return;
        acknowledgeFusions(s, offers);
        scheduleSave();
        updateHud();
      },
    },
    `<p class="lead">Two mastered cores can become one. Preview what carries over before committing.</p>
    <div class="fusion-offers">${offers
      .map((offer) => {
        const recipe = FUSION_BY_ID[offer.recipeId];
        return `<article class="fusion-offer-card">${cardIcon(recipe.iconId, 64)}<div><h3>${recipe.name}</h3><p>${recipe.description}</p><small>${recipe.ingredients.map((kind) => WEAPON_BY_ID[kind].name).join(' + ')} · mastery 6 each</small></div><button class="gold-button" data-fuse-recipe="${recipe.id}" data-ingredient-a="${esc(offer.ingredientIds[0])}" data-ingredient-b="${esc(offer.ingredientIds[1])}">Preview fusion · free</button></article>`;
      })
      .join(
        '',
      )}</div><button id="fusion-later" class="outline-button full">Later · keep both cores</button><p class="quiet">The Fusion forge button keeps every eligible recipe available. Choosing Later will not repeat this offer for the same cores.</p>`,
  );
  $('fusion-later').onclick = () => manager.close('fusion-offer');
  scheduleSave();
}
function openFusions() {
  const s = current();
  if (playing && isV2(s) && s.pendingRewards.length) {
    showRewards();
    notify('Resolve your pending upgrades before choosing a fusion.');
    return;
  }
  manager.close('fusion-offer');
  manager.close('fusion-preview');
  manager.open(
    'fusions',
    {
      title: 'The fusion forge.',
      subtitle: 'MASTER TWO CORES · FORGE ONE',
      width: 900,
      height: 760,
    },
    fusionPanel(s),
  );
}
function fusionPanel(input: RunV2 | RunState, query = '') {
  const s = modern(input);
  if (!s)
    return '<p>Mastered fusions are available in new XP expeditions. This recovered run keeps its original rules.</p>';
  const ready = availableFusions(s as RunV2);
  const recipes = FUSIONS.filter(
    (recipe) => s.arsenalVersion === 2 || !EXPANSION_FUSION_IDS.includes(recipe.id),
  )
    .filter((recipe) => fusionMatchesQuery(recipe, query))
    .sort(
      (a, b) =>
        Number(ready.some((r) => r.recipeId === b.id)) -
        Number(ready.some((r) => r.recipeId === a.id)),
    );
  return `${query ? `<p class="result-count">${recipes.length} matching fusion recipes</p>` : ''}<p class="notice">${ready.length ? `${ready.length} fusion${ready.length === 1 ? '' : 's'} ready to forge. Eligible recipes appear first.` : 'Master two compatible cores to unlock a fusion.'}</p><p>Two equipped ingredients at mastery 6 become one fused core, freeing a socket. Fusion is free. Compatible investments carry over; a fused core cannot fuse again.</p><div class="fusion-list">${recipes
    .map((recipe) => {
      const match = ready.find((f) => f.recipeId === recipe.id);
      return `<article class="fusion-recipe"><div class="fusion-heading">${cardIcon(recipe.iconId, 56)}<div><h3><button class="build-reference" data-entity-kind="fusion" data-entity-id="${recipe.id}">${recipe.name}</button></h3><p>${recipe.description}</p></div></div><div class="fusion-ingredients">${recipe.ingredients
        .map((kind) => {
          const w = s.weapons.find((w) => w.kind === kind && !w.fusion);
          return `<span>${cardIcon(equipmentIcon(kind), 32)} ${WEAPON_BY_ID[kind].name} · ${w ? `mastery ${w.masteryRank ?? 1}/6` : 'not equipped'}</span>`;
        })
        .join(
          '',
        )}</div><button class="${match ? 'gold-button' : 'outline-button'} full" data-fuse-recipe="${recipe.id}" data-ingredient-a="${match?.ingredientIds[0] ?? ''}" data-ingredient-b="${match?.ingredientIds[1] ?? ''}" ${match ? '' : 'disabled'}>${match ? 'Preview fusion' : 'Both ingredients must reach mastery 6'}</button></article>`;
    })
    .join(
      '',
    )}</div><p class="quiet">Alternative recipes compete for their shared ingredients. All twenty recipes are available in new expeditions; recovered runs keep their original twelve.</p>`;
}
function fusionMatchesQuery(recipe: (typeof FUSIONS)[number], query: string) {
  return `${recipe.name} ${recipe.description} ${recipe.ingredients.map((kind) => WEAPON_BY_ID[kind].name).join(' ')}`
    .toLowerCase()
    .includes(query.trim().toLowerCase());
}
function openFusionPreview(recipeId: string, a: string, b: string) {
  const s = modern(current());
  if (!s) return;
  if (s.pendingRewards.length) {
    showRewards();
    return;
  }
  const info = previewFusion(s as RunV2, recipeId, a, b);
  if (!info) {
    notify('Those ingredients are no longer ready.');
    return;
  }
  const recipe = FUSION_BY_ID[recipeId];
  manager.close('fusion-offer');
  manager.close('fusions');
  manager.open(
    'fusion-preview',
    {
      title: info.name,
      subtitle: 'FUSION PREVIEW · TWO CORES BECOME ONE',
      width: 650,
      height: 700,
      choice: true,
    },
    `${cardIcon(recipe.iconId, 88)}<p class="lead">${esc(info.description)}</p><p>${esc(info.summary)}</p><h3>Consumed equipment</h3><p>${info.ingredients.map(esc).join(' + ')}</p><h3>Inherited investments</h3><ul>${info.inherited.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>${info.conversions.length ? `<h3>Conversions and limits</h3><ul>${info.conversions.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}<p>${info.awaken.length ? `Awakens: ${info.awaken.map(esc).join(', ')}. ` : ''}${info.lost.length ? `Releases: ${info.lost.map(esc).join(', ')}.` : 'Compatible passive synergies are preserved.'}</p><button id="confirm-fusion" class="gold-button full">Forge ${esc(info.name)} · free</button><button id="cancel-fusion" class="outline-button full">Keep ingredients</button>`,
  );
  $('cancel-fusion').onclick = () => manager.close('fusion-preview');
  $('confirm-fusion').onclick = async () => {
    if (current() !== s || contextChanging) return;
    if (!fuseCores(s as RunV2, recipeId, a, b)) {
      notify('Fusion requirements changed; inspect the arsenal again.');
      return;
    }
    telemetry.event(s.id, s.time, 'fusion', {
      recipeId,
      ingredients: [a, b],
      equipment: s.weapons.map((w) => ({ id: w.id, kind: w.kind, rank: w.masteryRank ?? 0 })),
    });
    $<HTMLButtonElement>('confirm-fusion').disabled = true;
    clearTimeout(persistTimer);
    await persist();
    manager.close('fusion-preview');
    manager.close('arsenal');
    inspector.update();
    updateHud();
    notify(`${info.name} awakened. A socket is free.`);
    const base = 430 + FUSIONS.findIndex((f) => f.id === recipeId) * 23;
    [0, 100, 200].forEach((delay, i) => window.setTimeout(() => sound(base + i * 140), delay));
  };
}
function openArsenal() {
  const s = current(),
    modern = isV2(s);
  const weapons = modern ? s.weapons : [];
  const active = modern ? s.synergies : [];
  let body = `<div class="panel-tabs"><button data-arsenal-tab="weapons" class="${arsenalTab === 'weapons' ? 'active' : ''}">Arsenal ${modern ? weapons.length : s.attacks.length}/6</button><button data-arsenal-tab="cards" class="${arsenalTab === 'cards' ? 'active' : ''}">Collected cards</button><button data-arsenal-tab="fusions" class="${arsenalTab === 'fusions' ? 'active' : ''}">Mastered fusions</button><button data-arsenal-tab="synergies" class="${arsenalTab === 'synergies' ? 'active' : ''}">Synergies ${active.length}</button></div>`;
  if (!modern) {
    body += `<p class="notice">Recovered expedition: original weapons and upgrades are preserved until this run ends.</p>${s.attacks.map((a) => `<article class="weapon-inspector"><h3>${PATTERNS.find((p) => p.id === a.pattern)?.name}</h3><p>${a.element} + ${a.modifier} · rank ${a.rank}</p><p>Lifetime attacks: ${a.shots.toLocaleString()}</p></article>`).join('')}`;
  } else if (arsenalTab === 'weapons') {
    body += `<p class="panel-note">Global cards affect every eligible weapon. Infusions combine on the weapon you choose.</p><div class="weapon-list">${weapons
      .map((w) => {
        const d = WEAPON_BY_ID[w.kind],
          stats = getWeaponStats(s, w);
        return `<article class="weapon-inspector" style="--rarity:${RARITY_COLORS[w.rarity]}"><div class="weapon-heading">${cardIcon(equipmentIcon(w.kind), 52)}<div><small>${rarityLabel(w.rarity)}</small><h3>${d.name}</h3></div><span class="weapon-mastery">${w.masteryRank ? `Mastery ${w.masteryRank}/6` : `Investment ${w.mastery}`}</span></div><p>${esc(d.description)}</p><div class="infusions">${stats.elements.length ? stats.elements.map((e) => `<span style="--element:${ELEMENT_COLORS[e]}">${e}</span>`).join('') : '<span>Uninfused</span>'}</div><dl class="weapon-stats"><div><dt>Damage</dt><dd>${stats.damage.toFixed(1)}</dd></div><div><dt>Interval</dt><dd>${stats.cooldown.toFixed(2)}s</dd></div><div><dt>Projectiles</dt><dd>${stats.count}</dd></div><div><dt>Size</dt><dd>${stats.size.toFixed(1)}</dd></div><div><dt>Speed</dt><dd>${Math.round(stats.speed)}</dd></div><div><dt>Range</dt><dd>${Math.round(stats.range)}</dd></div><div><dt>Pulse</dt><dd>${stats.pulse > 0 ? `0.80s` : '—'}</dd></div><div><dt>Pierce / bounce</dt><dd>${stats.pierce} / ${stats.bounces}</dd></div></dl><p class="quiet">${stats.trail > 0 ? 'Damaging trail · ' : ''}${stats.homing > 0 ? 'Homing · ' : ''}${stats.returning ? 'Returns to spire · ' : ''}${stats.split > 0 ? `Splits ×${stats.split} · ` : ''}${w.lifetimeShots.toLocaleString()} lifetime attacks</p></article>`;
      })
      .join(
        '',
      )}${Array.from({ length: 6 - weapons.length }, () => '<article class="empty-weapon">＋<span>Open arsenal socket</span><small>Acquire a weapon or defensive core.</small></article>').join('')}</div>`;
  } else if (arsenalTab === 'cards') {
    body += `<p class="panel-note">Duplicates strengthen a family. Rarity promotions arrive at 3, 6, 9, and 12 investment picks. Equipment mastery is a separate combat progression.</p><div class="owned-list">${
      s.cards.length
        ? s.cards
            .map((stack) => {
              const c = CARD_BY_ID[stack.cardId];
              return `<article class="owned-card" style="--rarity:${RARITY_COLORS[stack.rarity]}">${cardIcon(c.iconId, 44)}<div><small>${rarityLabel(stack.rarity)} · ${scopeLabel(c)}</small><h3>${esc(c.name)} <span>×${stack.stacks}</span></h3><p>${esc(c.description)}</p>${cardRules(c) ? `<small class="card-rules">${esc(cardRules(c))}</small>` : ''}<div class="mastery-track"><i style="width:${Math.min(100, (stack.mastery / 12) * 100)}%"></i></div><small>Investment ${stack.mastery} · next promotion ${Math.min(12, (Math.floor(stack.mastery / 3) + 1) * 3)}${stack.targetId ? ` · ${WEAPON_BY_ID[s.weapons.find((w) => w.id === stack.targetId)!.kind].name}` : ''}</small>${c.group === 'skill' ? `<button class="outline-button compact" data-equip="${esc(c.id)}">${s.secondary === c.id ? 'Equipped' : 'Equip secondary skill'}</button>` : ''}</div></article>`;
            })
            .join('')
        : '<p>Your first cards arrive when the tower levels up. Every family has its own icon and effect.</p>'
    }</div>`;
  } else if (arsenalTab === 'fusions') {
    body += fusionPanel(s);
  } else
    body += `<p class="panel-note">Recipes require specific cards and interactions. Adding elements alone does not awaken every recipe.</p><div class="synergy-list">${SYNERGIES.map((y) => `<article class="synergy ${s.synergies.includes(y.id) ? 'awakened' : ''}" style="--element:${y.color}"><span class="synergy-sigil">${s.synergies.includes(y.id) ? '✦' : '◇'}</span><div><small>${s.synergies.includes(y.id) ? 'AWAKENED' : 'DORMANT'}</small><h3>${esc(y.name)}</h3><p>${esc(y.description)}</p><div class="requirements">${y.requires.map((id) => `<span class="${s.cards.some((c) => c.cardId === id) || (id.startsWith('infusion-') && s.weapons.some((w) => w.infusions.some((e) => e === id.slice(9)))) || (id.startsWith('weapon-') && s.weapons.some((w) => w.kind === id.slice(7))) ? 'met' : ''}">${esc(CARD_BY_ID[id]?.name ?? id)}</span>`).join('')}</div></div></article>`).join('')}</div>`;
  if (isV2(s) && arsenalTab !== 'fusions')
    body += `<section class="secondary-picker"><h3>Secondary ritual</h3><p>Choose Mend for survival, Stasis for control, or Solar Nova for offense. Collected skill cards can become an empowered secondary ritual.</p><label>Equipped secondary<select id="secondary-select"><option value="repair" ${s.secondary === 'repair' ? 'selected' : ''}>Mend · restore 25% integrity</option><option value="stasis" ${s.secondary === 'stasis' ? 'selected' : ''}>Stasis · 3 second crowd control</option><option value="nova" ${s.secondary === 'nova' ? 'selected' : ''}>Solar Nova · strike all enemies</option>${s.cards
      .filter((stack) => CARD_BY_ID[stack.cardId].group === 'skill')
      .map(
        (stack) =>
          `<option value="${stack.cardId}" ${s.secondary === stack.cardId ? 'selected' : ''}>${esc(CARD_BY_ID[stack.cardId].name)} · empowered</option>`,
      )
      .join('')}</select></label></section>`;
  manager.open(
    'arsenal',
    {
      title: 'The runeforged arsenal.',
      subtitle: 'YOUR MACHINE · YOUR COMBINATIONS',
      width: 580,
      height: 760,
    },
    body,
  );
  $('secondary-select')?.addEventListener('change', () => {
    if (isV2(s)) {
      s.secondary = $<HTMLSelectElement>('secondary-select').value;
      scheduleSave();
      updateHud();
    }
  });
  manager
    .element('arsenal')!
    .querySelectorAll<HTMLButtonElement>('[data-arsenal-tab]')
    .forEach(
      (b) =>
        (b.onclick = () => {
          arsenalTab = b.dataset.arsenalTab!;
          openArsenal();
        }),
    );
  manager
    .element('arsenal')!
    .querySelectorAll<HTMLButtonElement>('[data-equip]')
    .forEach(
      (b) =>
        (b.onclick = () => {
          if (isV2(s)) {
            s.secondary = b.dataset.equip!;
            scheduleSave();
            openArsenal();
            updateHud();
          }
        }),
    );
}
let bestiaryState: BestiaryOptions | undefined;
function openBestiary(id?: EnemyArchetypeId, previewWave?: number) {
  const run = current();
  const stage = run.stage;
  bestiaryState = {
    stage,
    wave: previewWave ?? Math.max(1, run.wave),
    difficulty: run.difficulty,
    mode: modern(run)?.mode ?? 'normal',
    records: mergeDiscoveries(
      data.progression.bestiary,
      isV2(run) && hasEncounters(run) && !data.profile.settledRuns.includes(run.id)
        ? run.discoveries
        : {},
    ),
    filter: stage as 0 | 1 | 2,
    selected: id,
    legacy: !isV2(run) || !hasEncounters(run),
  };
  renderBestiary();
}
function renderBestiary() {
  const state = bestiaryState!;
  manager.open(
    'bestiary',
    {
      title: 'The adversary archive.',
      subtitle: 'TACTICS · SCALED STATS · DISCOVERY',
      width: 850,
      height: 750,
    },
    bestiaryMarkup(state),
  );
  document.querySelectorAll<HTMLButtonElement>('[data-enemy-id]').forEach((button) => {
    button.onclick = () => {
      state.selected = button.dataset.enemyId as EnemyArchetypeId;
      const enemy = ENEMY_BY_ID[state.selected];
      state.stage = enemy.stage ?? state.stage;
      const firstWave =
        enemy.id === 'guardian'
          ? state.mode === 'quick'
            ? 12
            : 25
          : enemy.mechanic === 'shared'
            ? enemy.firstWave
            : state.mode === 'quick'
              ? Math.ceil(enemy.firstWave / 2)
              : enemy.firstWave;
      state.wave = Math.max(state.wave, firstWave);
      renderBestiary();
      if (document.querySelector('.bestiary')!.clientWidth < 700)
        document.querySelector('.bestiary-inspect')!.scrollIntoView({ block: 'start' });
    };
  });
  $('bestiary-back').onclick = () => $('bestiary-search').scrollIntoView({ block: 'start' });
  $('bestiary-search').oninput = () => {
    const input = $<HTMLInputElement>('bestiary-search');
    state.query = input.value;
    const caret = input.selectionStart;
    renderBestiary();
    const replacement = $<HTMLInputElement>('bestiary-search');
    replacement.focus();
    replacement.setSelectionRange(caret, caret);
  };
  $('bestiary-stage').onchange = () => {
    const value = $<HTMLSelectElement>('bestiary-stage').value;
    state.filter = value === 'all' ? 'all' : (Number(value) as 0 | 1 | 2);
    if (state.filter !== 'all') state.stage = state.filter;
    renderBestiary();
  };
  $('bestiary-wave').onchange = () => {
    state.wave = Math.max(
      1,
      Math.min(100000, Number($<HTMLInputElement>('bestiary-wave').value) || 1),
    );
    renderBestiary();
  };
  $('bestiary-difficulty').onchange = () => {
    state.difficulty = Number($<HTMLSelectElement>('bestiary-difficulty').value);
    renderBestiary();
  };
  $('bestiary-mode').onchange = () => {
    state.mode = $<HTMLSelectElement>('bestiary-mode').value as BestiaryOptions['mode'];
    renderBestiary();
  };
}
let codexQuery = '',
  codexGroup = 'all';
function openCodex() {
  manager.open(
    'codex',
    {
      title: 'The field codex.',
      subtitle: `${CARDS.length} CARDS · 40 PASSIVE SYNERGIES · ${FUSIONS.length} FUSIONS`,
      width: 650,
      height: 760,
    },
    `<div class="codex-search"><input id="codex-query" type="search" placeholder="Search names, effects, or mechanics…" aria-label="Search cards" value="${esc(codexQuery)}"><select id="codex-group" aria-label="Card category"><option value="all">All card families</option>${['weapon', 'infusion', 'modifier', 'defense', 'trigger', 'skill', 'utility', 'synergy', 'fusion', 'rules'].map((g) => `<option value="${g}" ${g === codexGroup ? 'selected' : ''}>${g[0].toUpperCase() + g.slice(1)}</option>`).join('')}</select></div><div id="codex-results"></div>`,
  );
  $('codex-query').oninput = () => {
    codexQuery = $<HTMLInputElement>('codex-query').value;
    renderCodexResults();
  };
  $('codex-group').onchange = () => {
    codexGroup = $<HTMLSelectElement>('codex-group').value;
    renderCodexResults();
  };
  renderCodexResults();
}
function renderCodexResults() {
  const q = codexQuery.toLowerCase();
  if (codexGroup === 'rules') {
    $('codex-results').innerHTML =
      `<article class="rules"><h3>Build something that works together.</h3><p>Six shared sockets accept weapons or defensive cores. Duplicates strengthen investment and accelerate six-rank combat mastery. Global projectile cards modify every eligible weapon. Infusions add effects to the weapon you choose.</p><h3>Rarity is earned as well as found.</h3><p>Normal → Rare → Epic → Legendary → Mythic. Repeated investment at 3, 6, 9, and 12 picks promotes a family. Equipment combat mastery is a separate rank from 1–6, earned through use. A higher-tier drop never downgrades what you own. Legendary weapon cores gain one pierce; Mythic cores emit traveling damage pulses. Higher card tiers increase family strength by 20% per tier.</p><h3>Power has shape.</h3><p>Damage, speed, size, count, range, and lifetime interact. Additional infusions split direct damage across their elements. Diminishing returns, trigger cooldowns, and bounded proc chains prevent infinite loops. Effective values are shown in your arsenal. Infusion damage is divided equally; status and movement caps remain visible there. Enemy formations cap at 96. At 4,096 active shots, primary attacks wait; bounded split children and existing damaging shots finish. Cosmetic quality never changes combat.</p><h3>Defense can become offense.</h3><p>Thorns and reflected hits are retaliation damage. Shield breaks, incoming damage, and kills can trigger other effects, within each card’s cooldown and chain limit. Some cards leave persistent damage zones.</p><h3>Time is yours to manage.</h3><p>Information windows never pause combat. Drafts and shops pause by default, with a switch to keep combat live. Closing or minimizing the choice window banks it for later; rewards remain queued.</p><h3>The economy asks you to choose.</h3><p>Scrap is temporary. Credits unlock towers and permanent runes after the run. Repairs have limited stock, rerolls grow more expensive, and split enemies cannot generate extra bounty.</p></article>`;
    return;
  }
  if (codexGroup === 'fusion') {
    const s = current();
    $('codex-results').innerHTML = modern(s)
      ? fusionPanel(s, q)
      : `<p>${FUSIONS.length} authored fusion recipes, each requiring two fully mastered equipped ingredients.</p>${FUSIONS.filter(
          (f) => fusionMatchesQuery(f, q),
        )
          .map(
            (f) =>
              `<article class="fusion-recipe">${cardIcon(f.iconId, 56)}<h3>${f.name}</h3><p>${f.description}</p><p>${f.ingredients.map((k) => WEAPON_BY_ID[k].name).join(' + ')} · mastery 6 each</p></article>`,
          )
          .join('')}`;
    return;
  }
  if (codexGroup === 'synergy') {
    const list = SYNERGIES.filter((y) =>
      `${y.name} ${y.description} ${y.requires.join(' ')}`.toLowerCase().includes(q),
    );
    $('codex-results').innerHTML =
      `<p class="result-count">${list.length} authored interactions</p><div class="synergy-list">${list.map((y) => `<article class="synergy" style="--element:${y.color}"><span class="synergy-sigil">✦</span><div><h3>${esc(y.name)}</h3><p>${esc(y.description)}</p><div class="requirements">${y.requires.map((id) => `<span>${esc(CARD_BY_ID[id]?.name ?? id)}</span>`).join('')}</div></div></article>`).join('')}</div>`;
    return;
  }
  const list = CARDS.filter(
    (c) =>
      (codexGroup === 'all' || c.group === codexGroup) &&
      `${c.name} ${c.description} ${c.effect} ${c.tags.join(' ')}`.toLowerCase().includes(q),
  );
  $('codex-results').innerHTML =
    `<p class="result-count">${list.length} card families · tiers and ranks are not counted as extra cards</p><div class="codex-card-list">${list.map((c) => `<article class="codex-card">${cardIcon(c.iconId, 54)}<div><small>${c.group.toUpperCase()} · ${scopeLabel(c)}</small><h3>${esc(c.name)}</h3><p>${esc(c.description)}</p>${cardRules(c) ? `<small class="card-rules">${esc(cardRules(c))}</small>` : ''}</div></article>`).join('')}</div>`;
}
function statsBody() {
  const s = current();
  const total = Object.values(isV2(s) ? s.damageByWeapon : s.damageByElement).reduce(
    (a, b) => a + b,
    0,
  );
  const line = (label: string, value: string) =>
    `<div class="stat-line"><span>${label}</span><b>${value}</b></div>`;
  let towerStats = line('Health', `${Math.ceil(s.hp)} / ${Math.ceil(s.maxHp)}`);
  if (isV2(s)) {
    const st = getTowerStats(s);
    towerStats +=
      line('Shield', `${st.shield.toFixed(0)} / ${st.maxShield.toFixed(0)}`) +
      line('Health regeneration', `${st.healthRegen.toFixed(2)} / combat second`) +
      line('Shield regeneration', `${st.shieldRegen.toFixed(2)} / combat second`) +
      line('Physical mitigation', `${(st.mitigation.physical * 100).toFixed(1)}%`) +
      line('Reflection', `${(st.reflectMultiplier * 100).toFixed(1)}%`) +
      line('Retaliation damage', st.retaliationDamage.toFixed(1)) +
      line('Signature cooldown', `${s.skillCd.toFixed(1)}s remaining`) +
      line('Secondary cooldown', `${s.secondaryCd.toFixed(1)}s remaining`) +
      line('XP gain', `${st.xpMultiplier.toFixed(2)}×`) +
      line('Mastery gain', `${st.masteryMultiplier.toFixed(2)}×`) +
      `<h3>Equipment</h3>` +
      st.equipment
        .map(
          (w) =>
            `<article class="rules"><b>${esc(WEAPONS.find((d) => d.id === w.kind)?.name ?? w.kind)}</b><p>${w.damage.toFixed(1)} damage · ${w.cooldown.toFixed(2)}s interval · ${w.count} projectiles · ${w.range.toFixed(0)} range · ${w.life.toFixed(1)}s lifetime</p></article>`,
        )
        .join('');
  }
  const dps = isV2(s) ? getTowerStats(s).recentDps : 0;
  const results =
    line('Recent DPS · last 10 combat seconds', dps.toFixed(1)) +
    line('Run-average DPS', (total / Math.max(1, s.time)).toFixed(1)) +
    line('Total damage', Math.round(total).toLocaleString()) +
    line(
      'Rendering · recent wall-clock sample',
      $('arena').dataset.frameContext === 'foreground'
        ? `${$('arena').dataset.fps || '—'} FPS · ${$('arena').dataset.renderMs || '—'} ms draw`
        : $('arena').dataset.frameContext === 'warming-up'
          ? 'Warming up · keep this tab focused for 3 seconds'
          : 'Background or unfocused · frame rate is not benchmarked',
    ) +
    line('Simulation · average per frame', `${$('arena').dataset.simulationMs || '—'} ms`) +
    line('Frame interval · 95th percentile', `${$('arena').dataset.frameP95Ms || '—'} ms`) +
    line('Defeated', s.kills.toLocaleString()) +
    line(
      'Combat time',
      `${Math.floor(s.time / 60)}:${String(Math.floor(s.time % 60)).padStart(2, '0')}`,
    ) +
    line('Projected credits', String(Math.floor(isV2(s) ? rewardForRun(s) : creditReward(s)))) +
    Object.entries(isV2(s) ? s.damageByWeapon : s.damageByElement)
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([id, v]) =>
        line(
          esc(
            isV2(s)
              ? (WEAPON_BY_ID[s.weapons.find((w) => w.id === id)?.kind as keyof typeof WEAPON_BY_ID]
                  ?.name ??
                  WEAPONS.find((w) => w.id === id)?.name ??
                  (id.startsWith('weapon-') ? 'Replaced core' : id))
              : id,
          ),
          Math.round(v).toLocaleString(),
        ),
      )
      .join('');
  return { towerStats, results };
}
function refreshStatsView() {
  const body = statsBody();
  if ($('live-tower-stats')) $('live-tower-stats').innerHTML = body.towerStats;
  if ($('live-combat-stats')) $('live-combat-stats').innerHTML = body.results;
}
function openStats() {
  manager.open(
    'stats',
    {
      title: 'The spire, measured.',
      subtitle: 'LIVE STATS · UPDATES EACH SECOND',
      width: 610,
      height: 690,
    },
    `<div class="stats-tabs"><button id="stats-tower-tab" class="outline-button">Tower stats</button><button id="stats-combat-tab" class="outline-button">Combat results</button></div><div id="live-tower-stats"></div><div id="live-combat-stats" hidden></div><p class="quiet">Recent DPS uses actual recorded combat damage, excluding paused time. A resumed session starts a new ten-second measurement.</p>`,
  );
  $('stats-tower-tab').onclick = () => {
    $('live-tower-stats').hidden = false;
    $('live-combat-stats').hidden = true;
  };
  $('stats-combat-tab').onclick = () => {
    $('live-tower-stats').hidden = true;
    $('live-combat-stats').hidden = false;
  };
  refreshStatsView();
}
const RUNE_NAMES: Record<RuneId, string> = {
  power: 'Power',
  vitality: 'Vitality',
  fortune: 'Fortune',
  experience: 'Scholarship',
  choices: 'Wider choices',
  autoSignature: 'Signature autocast',
  autoSecondary: 'Secondary autocast',
};
const visibleRunes: RuneId[] = [
  'power',
  'vitality',
  'fortune',
  'experience',
  'choices',
  'autoSignature',
  'autoSecondary',
];
function runeBenefit(id: RuneId, level: number) {
  return id === 'power'
    ? `+${(level * 2.5).toFixed(1)}% damage`
    : id === 'vitality'
      ? `+${(level * 3.5).toFixed(1)}% maximum health`
      : id === 'fortune'
        ? `+${(level * 0.8).toFixed(1)}% rarity roll`
        : id === 'experience'
          ? `+${(level * 2.5).toFixed(1)}% XP gain`
          : id === 'choices'
            ? `${3 + level} level-up choices`
            : `${level ? 'Autocast available' : 'Manual only'}`;
}
function runeMarkup() {
  const r = data.progression.runes;
  return (
    visibleRunes
      .map(
        (id) =>
          `<article class="rune-row"><b>${RUNE_NAMES[id]}</b><span id="rune-benefit-${id}">${runeBenefit(id, r.selected[id])}</span><span>Purchased ${r.owned[id]}/${Math.max(r.owned[id], RUNE_CAPS[id])} · selected <strong id="rune-value-${id}">${r.selected[id]}</strong></span><label>Selected level<input data-rune-select="${id}" type="range" min="0" max="${r.owned[id]}" value="${r.selected[id]}" ${playing ? 'disabled' : ''}></label><button data-rune-buy="${id}" class="outline-button" ${playing || r.owned[id] >= RUNE_CAPS[id] || data.profile.credits < runePrice(id, r.owned[id] + 1) ? 'disabled' : ''}>${r.owned[id] >= RUNE_CAPS[id] ? 'Fully purchased' : `Buy level ${r.owned[id] + 1} · ${runePrice(id, r.owned[id] + 1)} credits`}</button></article>`,
      )
      .join('') +
    '<button id="configure-autocast" class="outline-button full">Configure conditional autocast</button>'
  );
}
function bindRunes() {
  manager
    .element('expedition')!
    .querySelectorAll<HTMLInputElement>('[data-rune-select]')
    .forEach((el) => {
      el.oninput = () => {
        manager
          .element('expedition')!
          .querySelector<HTMLElement>(`#rune-value-${el.dataset.runeSelect}`)!.textContent =
          el.value;
        manager
          .element('expedition')!
          .querySelector<HTMLElement>(`#rune-benefit-${el.dataset.runeSelect}`)!.textContent =
          runeBenefit(el.dataset.runeSelect as RuneId, Number(el.value));
      };
      el.onchange = () => {
        if (playing) return;
        const id = el.dataset.runeSelect as RuneId;
        data.progression.runes.selected[id] = Math.min(
          data.progression.runes.owned[id],
          Number(el.value),
        );
        makePreview();
        scheduleSave();
        updateHud();
        openLaunch();
      };
    });
  manager
    .element('expedition')!
    .querySelectorAll<HTMLButtonElement>('[data-rune-buy]')
    .forEach(
      (el) =>
        (el.onclick = () => {
          if (playing) return;
          const id = el.dataset.runeBuy as RuneId,
            r = data.progression.runes,
            next = r.owned[id] + 1,
            price = runePrice(id, next);
          if (next > RUNE_CAPS[id] || data.profile.credits < price) return;
          data.profile.credits -= price;
          r.owned[id] = next;
          r.selected[id] = next;
          if (id === 'power' || id === 'vitality' || id === 'fortune')
            data.profile.upgrades[id] = next;
          makePreview();
          scheduleSave();
          openHangar();
          updateHud();
        }),
    );
  $('configure-autocast').onclick = openAutocast;
}
function openAutocast() {
  const active = playing ? data.progression.active : null;
  const rules =
    active && active.runId === data.run?.id ? active!.autocast : data.progression.autocast;
  const runes =
    active && active.runId === data.run?.id ? active!.runes : snapshotRunes(data.progression.runes);
  manager.open(
    'autocast',
    {
      title: 'The machine obeys.',
      subtitle: 'CONDITIONAL SKILL AUTOMATION',
      width: 650,
      height: 740,
    },
    `<p>Purchased runes unlock each skill's autocast. Rules respect cooldowns and only cast when the skill can help. Manual Q/E remains available.</p>${(
      ['signature', 'secondary'] as const
    )
      .map((slot) => {
        const c = rules[slot],
          unlocked = runes[slot === 'signature' ? 'autoSignature' : 'autoSecondary'] > 0;
        return `<section class="autocast-slot"><h3>${slot === 'signature' ? 'Signature' : 'Secondary'} ${unlocked ? '' : '· Rune not selected'}</h3><label>Enable autocast<input type="checkbox" id="auto-${slot}-enabled" ${c.enabled ? 'checked' : ''} ${!unlocked ? 'disabled' : ''}></label><label>Strategy<select id="auto-${slot}-preset">${[
          ['always', 'Every time'],
          ['boss', 'Boss present'],
          ['emergency', 'Emergency · health ≤35%'],
          ['advanced', 'Advanced rule'],
        ]
          .map(([v, t]) => `<option value="${v}" ${c.preset === v ? 'selected' : ''}>${t}</option>`)
          .join(
            '',
          )}</select></label><label>Advanced conditions<select id="auto-${slot}-match"><option value="all" ${c.match === 'all' ? 'selected' : ''}>ALL conditions</option><option value="any" ${c.match === 'any' ? 'selected' : ''}>ANY condition</option></select></label>${(
          ['health', 'shield', 'nearby', 'boss'] as const
        )
          .map((kind) => {
            const condition = c.conditions.find((x) => x.kind === kind);
            return `<div class="autocast-condition"><label><input type="checkbox" id="auto-${slot}-${kind}-use" ${condition ? 'checked' : ''}> ${kind === 'health' ? 'Health ≤ %' : kind === 'shield' ? 'Shield ≤ %' : kind === 'nearby' ? 'Nearby enemies ≥' : 'Boss present'}</label>${kind !== 'boss' ? `<input aria-label="${slot} ${kind} threshold" id="auto-${slot}-${kind}-value" type="number" min="${kind === 'nearby' ? 1 : 0}" max="${kind === 'nearby' ? 96 : 100}" value="${condition?.value ?? (kind === 'nearby' ? 5 : 40)}">` : ''}${kind === 'nearby' ? `<label>Radius<input id="auto-${slot}-radius" type="number" min="50" max="500" value="${condition?.radius ?? 200}"></label>` : ''}</div>`;
          })
          .join('')}</section>`;
      })
      .join('')}<button id="save-autocast" class="gold-button full">Save autocast rules</button>`,
  );
  $('save-autocast').onclick = async () => {
    const next = structuredClone(rules);
    for (const slot of ['signature', 'secondary'] as const) {
      next[slot] = {
        enabled:
          $<HTMLInputElement>(`auto-${slot}-enabled`).checked &&
          runes[slot === 'signature' ? 'autoSignature' : 'autoSecondary'] > 0,
        preset: $<HTMLSelectElement>(`auto-${slot}-preset`).value as typeof next.signature.preset,
        match: $<HTMLSelectElement>(`auto-${slot}-match`).value as 'all' | 'any',
        conditions: (['health', 'shield', 'nearby', 'boss'] as const)
          .filter((kind) => $<HTMLInputElement>(`auto-${slot}-${kind}-use`).checked)
          .map((kind) => ({
            kind,
            value:
              kind === 'boss' ? 1 : Number($<HTMLInputElement>(`auto-${slot}-${kind}-value`).value),
            ...(kind === 'nearby'
              ? { radius: Number($<HTMLInputElement>(`auto-${slot}-radius`).value) }
              : {}),
          })),
      };
    }
    const normalized = normalizeAutocastConfig(next);
    if (active && active.runId === data.run?.id) active!.autocast = normalized;
    else data.progression.autocast = normalized;
    $<HTMLButtonElement>('save-autocast').disabled = true;
    clearTimeout(persistTimer);
    await persist();
    updateHud();
    manager.close('autocast');
    if (data.run)
      telemetry.event(data.run.id, data.run.time, 'autocast-strategy', { rules: normalized });
    if (!storageFailed) notify('Autocast strategy saved.');
  };
}
function openHangar() {
  openLaunch();
}
function download(text: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' })),
    a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function downloadCurrent() {
  try {
    download(exportGame(data), `last-spire-${new Date().toISOString().slice(0, 10)}.json`);
  } catch (e) {
    notify(
      `Export could not be created: ${e instanceof Error ? e.message : 'Invalid state'}`,
      'warning',
    );
  }
}
function openTelemetry() {
  const state = telemetry.status();
  manager.open(
    'telemetry',
    {
      title: 'Observations stay here.',
      subtitle: 'PRIVATE LOCAL GAMEPLAY DATA',
      width: 600,
      height: 600,
    },
    `<p>Balance observations are stored only in this browser, separately from your saved progress. Nothing is uploaded.</p><p>Up to 30 runs or 30 MB are retained; oldest records are removed automatically. Offers, decisions, mastery, fusions, combat outcomes and sampled performance help diagnose balance.</p><div class="stat-line"><span>Stored runs</span><b>${state.runs}</b></div><div class="stat-line"><span>Storage</span><b>${(state.bytes / 1024 / 1024).toFixed(2)} MB</b></div><p class="quiet">${state.available ? 'Local logging available.' : 'Logging unavailable. Combat and progress saving continue independently.'}</p><label>Record local gameplay<input id="analytics-enabled" type="checkbox" ${state.enabled ? 'checked' : ''}></label><div class="save-actions"><button id="analytics-export" class="outline-button">Export local logs</button><button id="analytics-clear" class="outline-button">Delete local logs</button></div><p id="analytics-message" role="status"></p><p class="quiet">Disable stops new observations. Deleting logs keeps your credits, purchases and saved expedition.</p>`,
  );
  $('analytics-enabled').onchange = async () => {
    await telemetry.setEnabled($<HTMLInputElement>('analytics-enabled').checked);
    $('analytics-message').textContent = telemetry.status().enabled
      ? 'Local recording enabled.'
      : 'Local recording disabled.';
  };
  $('analytics-export').onclick = async () => {
    try {
      download(await telemetry.exportLogs(), 'last-spire-local-gameplay.json');
      $('analytics-message').textContent = 'Local export prepared.';
    } catch {
      $('analytics-message').textContent =
        'Logs could not be exported; your game save is unaffected.';
    }
  };
  $('analytics-clear').onclick = async () => {
    await telemetry.clear();
    $('analytics-message').textContent = 'Local logs deleted. Your game save is unchanged.';
  };
}
function openSettings() {
  manager.open(
    'settings',
    {
      title: 'Find your rhythm.',
      subtitle: 'PRESENTATION · CONTROLS · SAVES',
      width: 610,
      height: 760,
    },
    `<div class="settings-list"><label>Sound effects<input id="setting-sound" type="checkbox" ${data.settings.sound ? 'checked' : ''}></label><label>Floating damage numbers<input id="setting-damage-numbers" type="checkbox" ${data.settings.damageNumbers ? 'checked' : ''}></label><label>Reduced motion<input id="setting-motion" type="checkbox" ${data.settings.reducedMotion ? 'checked' : ''}></label><label>Camera shake<input id="setting-shake" type="checkbox" ${data.settings.shake ? 'checked' : ''}></label><label>Pause draft & shop windows<input id="setting-pause" type="checkbox" ${data.settings.autoPauseChoices ? 'checked' : ''}></label><label>Text & interface scale<select id="setting-scale">${[100, 115, 130, 150].map((v) => `<option value="${v}" ${data.settings.uiScale === v ? 'selected' : ''}>${v}%</option>`).join('')}</select></label><label>Weapon spectacle<select id="setting-intensity">${['subtle', 'balanced', 'spectacular'].map((v) => `<option value="${v}" ${v === data.settings.intensity ? 'selected' : ''}>${v[0].toUpperCase() + v.slice(1)}</option>`).join('')}</select></label><label>Effects quality<select id="setting-quality"><option value="high" ${data.settings.effects === 'high' ? 'selected' : ''}>High detail</option><option value="low" ${data.settings.effects === 'low' ? 'selected' : ''}>Battery friendly</option></select></label></div><div class="save-status ${storageFailed || blocked ? 'warning' : ''}">${blocked ? 'A saved checkpoint needs recovery. Automatic writes are stopped to protect it.' : storageFailed ? 'Storage is unavailable. Progress is kept in this tab: export before closing.' : 'Local saves are active. Combat checkpoints and queued choices are autosaved.'}</div><div class="save-actions"><button id="settings-account" class="outline-button">Account & cloud saves</button><button id="local-analytics" class="outline-button">Local gameplay data</button><button id="export-save" class="outline-button">Export current save</button><label class="file-button outline-button">Import save<input id="import-save" type="file" accept="application/json,.json"></label><button id="paste-import" class="outline-button">Paste a save</button><button id="export-backup" class="outline-button">Download migration backup</button></div><p class="quiet">Guest saves stay on your device. Optional account sync is managed in Account & cloud saves. Import reviews and replaces only the active save context. A recovered original expedition keeps its old rules until it ends.</p><div class="controls-reference"><h3>At your command</h3><p><kbd>Space</kbd> pause · <kbd>Q</kbd> signature · <kbd>E</kbd> secondary<br><kbd>A</kbd> arsenal · <kbd>C</kbd> codex · <kbd>1 / 2 / 3</kbd> speed<br><kbd>Esc</kbd> close the top window, then pause<br>Drag window headers, or focus a header and use <kbd>Alt + arrows</kbd>.</p></div><a class="outline-button full" href="/icon-contact-sheet.html" target="_blank" rel="noopener">Inspect the original card icon collection ↗</a>`,
  );
  const bindCheck = (
    id: string,
    key: 'sound' | 'reducedMotion' | 'shake' | 'autoPauseChoices' | 'damageNumbers',
  ) => {
    $(id).onchange = () => {
      data.settings[key] = $<HTMLInputElement>(id).checked;
      applySettings();
      scheduleSave();
    };
  };
  bindCheck('setting-sound', 'sound');
  bindCheck('setting-motion', 'reducedMotion');
  bindCheck('setting-damage-numbers', 'damageNumbers');
  bindCheck('setting-shake', 'shake');
  bindCheck('setting-pause', 'autoPauseChoices');
  $('setting-scale').onchange = () => {
    data.settings.uiScale = Number($<HTMLSelectElement>('setting-scale').value);
    applySettings();
    scheduleSave();
  };
  $('setting-intensity').onchange = () => {
    data.settings.intensity = $<HTMLSelectElement>('setting-intensity')
      .value as SettingsV2['intensity'];
    applySettings();
    scheduleSave();
  };
  $('setting-quality').onchange = () => {
    data.settings.effects = $<HTMLSelectElement>('setting-quality').value as SettingsV2['effects'];
    applySettings();
    scheduleSave();
  };
  $('export-save').onclick = downloadCurrent;
  $('settings-account').onclick = () => accountPanel.open();
  $('local-analytics').onclick = openTelemetry;
  $('export-backup').onclick = async () => {
    try {
      const raw = await readLegacyBackup(saveScope);
      if (!raw) {
        notify('No migration backup was found. Your current save can still be exported.');
        return;
      }
      download(JSON.stringify(raw, null, 2), 'last-spire-before-v2.json');
    } catch {
      notify('Backup storage could not be reached.', 'warning');
    }
  };
  $('paste-import').onclick = () => {
    manager.open(
      'paste',
      {
        title: 'Restore from save text.',
        subtitle: 'LOCAL SAVE RECOVERY',
        width: 570,
        height: 520,
        choice: true,
      },
      '<p>Paste your exported JSON. The next step validates it and previews the progress before any replacement.</p><label>Save JSON<textarea id="paste-save-json" rows="9" spellcheck="false" aria-label="Save JSON"></textarea></label><button id="review-paste" class="gold-button full">Validate & review</button><p id="paste-error" role="alert"></p>',
    );
    $('review-paste').onclick = () => {
      try {
        const incoming = parseGame($<HTMLTextAreaElement>('paste-save-json').value);
        showImportReview(incoming, 'Pasted save');
        manager.close('paste');
      } catch (e) {
        $('paste-error').textContent =
          `Import rejected: ${e instanceof Error ? e.message : 'Invalid JSON'}`;
      }
    };
  };
  $<HTMLInputElement>('import-save').onchange = async () => {
    const epoch = contextEpoch;
    const input = $<HTMLInputElement>('import-save'),
      file = input.files?.[0];
    if (!file) return;
    try {
      if (file.size > 8 * 1024 * 1024) throw new Error('File exceeds 8 MB');
      const incoming = parseGame(await file.text());
      if (epoch !== contextEpoch)
        throw new Error('The active account changed. Choose the import again.');
      showImportReview(incoming, file.name);
    } catch (e) {
      notify(`Import rejected: ${e instanceof Error ? e.message : 'Invalid save'}`, 'warning');
    } finally {
      input.value = '';
    }
  };
}
function showImportReview(incoming: SaveV3, name: string) {
  const importEpoch = contextEpoch;
  manager.open(
    'import',
    {
      title: 'Restore this expedition?',
      subtitle: 'REVIEW SAVE IMPORT',
      width: 500,
      height: 450,
      choice: true,
    },
    `<p class="lead">${esc(name)}</p><div class="ledger-grid"><div><small>Credits</small><b>${incoming.profile.credits}</b></div><div><small>Towers</small><b>${incoming.profile.unlocked.length}/${TOWERS.length}</b></div><div><small>Best wave</small><b>${incoming.profile.bestWave}</b></div><div><small>Active run</small><b>${incoming.run ? `Wave ${incoming.run.wave}` : 'None'}</b></div></div><p>This replaces only the active ${saveScope === 'guest' ? 'guest' : 'account'} progress. Export your current save first if you want to keep both. Account imports are reviewed against the cloud before upload.</p><div class="result-actions"><button id="cancel-import" class="outline-button">Cancel</button><button id="confirm-import" class="gold-button">Restore this save</button></div>`,
  );
  $('cancel-import').onclick = () => manager.close('import');
  $('confirm-import').onclick = async () => {
    const button = $<HTMLButtonElement>('confirm-import');
    button.disabled = true;
    try {
      if (importEpoch !== contextEpoch)
        throw new Error('The active account changed. Review the import again.');
      if (saveScope !== 'guest')
        await archiveSave(saveScope.slice(8), data, 'Before manual import');
      await activateSave(incoming, saveScope, true);
      accountSync.onLocalSave(saveScope);
      notify('Save restored.');
    } catch (e) {
      button.disabled = false;
      notify(
        `Restore failed: ${e instanceof Error ? e.message : 'Storage unavailable'}`,
        'warning',
      );
    }
  };
}
function openHelp() {
  manager.open(
    'help',
    { title: 'Forge your own answer.', subtitle: 'A SHORT FIELD GUIDE', width: 540, height: 700 },
    `<div class="help-steps"><section><span>01</span><div><h3>The spire fights automatically.</h3><p>Use Q and E for your two active skills. Change targeting when a dangerous enemy needs attention.</p></div></section><section><span>02</span><div><h3>Build six different engines.</h3><p>All six sockets are available for weapons or defensive cores. Duplicates strengthen investment and accelerate mastery. Global cards affect all eligible weapons. Infusions combine on the weapon you choose.</p></div></section><section><span>03</span><div><h3>Choose, don’t collect everything.</h3><p>Defeat enemies to gain XP and choose a card each level. Shops appear every ten waves. Scarce scrap makes repair, power, and a future purchase compete with one another.</p></div></section><section><span>04</span><div><h3>Defense is part of your arsenal.</h3><p>Thorns, reflected damage, barrier breaks, and retaliation can fuel a build. The codex explains every card and the requirements for 40 special interactions.</p></div></section><section><span>05</span><div><h3>Keep the field in view.</h3><p>Drag, resize, dock, or minimize windows. Information windows leave combat live. Choices pause by default; toggle that off to keep playing while you decide.</p></div></section></div><button id="finish-help" class="gold-button full">Keep the light alive ${glyph('arrow')}</button>`,
  );
  $('finish-help').onclick = () => {
    data.profile.tutorialDone = true;
    scheduleSave();
    manager.close('help');
  };
}
function recordClear() {
  const s = data.run;
  if (!s?.cleared) return;
  recordStageClear(data.profile, data.progression.stages, s);
}
function openVictory() {
  const s = data.run;
  if (!s) return;
  recordClear();
  manager.open(
    'victory',
    {
      title: 'The light endures.',
      subtitle: `${STAGES[s.stage].name.toUpperCase()} · ${modern(s)?.mode === 'quick' ? 50 : 100} WAVES CLEARED`,
      width: 590,
      height: 590,
      choice: true,
    },
    `<div class="victory-mark">${glyph('tower')}</div><p class="lead">The guardian has fallen. Your ${difficultyName(s.difficulty)} clear in ${STAGES[s.stage].name} is secured. ${s.difficulty < 5 ? `${difficultyName(s.difficulty + 1)} is unlocked for this stage.` : 'All Ascensions for this stage are unlocked.'} Extract with your rewards, or carry this machine into the endless dark.</p><div class="result-stats"><div><b>${s.kills.toLocaleString()}</b><span>Enemies defeated</span></div><div><b>${Math.floor(isV2(s) ? rewardForRun(s) : creditReward(s))}</b><span>Projected credits</span></div></div><div class="result-actions"><button id="extract-btn" class="outline-button">Extract & collect</button><button id="endless-btn" class="gold-button">Enter endless ${glyph('arrow')}</button></div>`,
  );
  $('extract-btn').onclick = () => {
    if (isV2(s)) retire(s);
    else legacyRetire(s);
    manager.close('victory');
    openResults();
    scheduleSave();
  };
  $('endless-btn').onclick = () => {
    if (isV2(s)) continueEndless(s);
    else continueRun(s);
    manager.close('victory');
    paused = false;
    lastPhase = '';
    scheduleSave();
    updateHud();
  };
}
function openRetire(returnToSetup = false) {
  const s = data.run;
  if (!s) return;
  if (s.phase === 'ended') {
    openResults();
    return;
  }
  manager.open(
    'retire',
    {
      title: 'Leave with what you’ve earned.',
      subtitle: 'RETIRE THIS EXPEDITION',
      width: 500,
      height: 400,
      choice: true,
    },
    `<p class="lead">Retire at wave ${s.wave} and collect ${Math.floor(isV2(s) ? rewardForRun(s) : creditReward(s))} credits. Your permanent progress stays with you; this run’s build is released.</p><div class="result-actions"><button id="cancel-retire" class="outline-button">Keep defending</button><button id="confirm-retire" class="gold-button">Retire & collect</button></div>`,
  );
  $('cancel-retire').onclick = () => {
    manager.close('retire');
    if (returnToSetup) openLaunch();
  };
  $('confirm-retire').onclick = () => {
    if (isV2(s)) retire(s);
    else legacyRetire(s);
    manager.close('retire');
    manager.close('rewards');
    openResults();
    scheduleSave();
  };
}
function openResults(startSettlement = true) {
  const s = data.run;
  if (!s) return;
  recordClear();
  const nextTower = TOWERS.find((t) => !data.profile.unlocked.includes(t.id));
  const availableCredits =
    data.profile.credits + (s.settled ? 0 : isV2(s) ? rewardForRun(s) : s.earned);
  const modernRun = modern(s);
  const forged = modernRun
    ? modernRun.weapons.flatMap((w) =>
        w.fusion ? [FUSION_BY_ID[w.fusion.recipeId]?.name || w.fusion.recipeId] : [],
      )
    : [];
  const passiveSynergies = isV2(s)
    ? SYNERGIES.filter((y) => s.synergies.includes(y.id)).map((y) => y.name)
    : s.synergies;
  const synergies = [...passiveSynergies, ...forged];
  manager.open(
    'results',
    {
      title: s.cleared ? 'A legend, forged.' : 'Every ending leaves a spark.',
      subtitle: `EXPEDITION COMPLETE · WAVE ${s.wave}${s.endless ? ' · ENDLESS' : modern(s)?.mode === 'quick' ? ' · QUICK' : ''}`,
      width: 660,
      height: 650,
      choice: true,
    },
    `<div class="result-stats"><div><b>${s.wave}</b><span>Wave reached</span></div><div><b>${s.kills.toLocaleString()}</b><span>Defeated</span></div><div><b>+${isV2(s) ? rewardForRun(s) : s.earned}</b><span>${s.settled ? (storageFailed ? 'Credits kept in memory' : 'Credits secured') : 'Securing credits…'}</span></div></div><p class="lead">${synergies.length ? `Your awakened machinery: ${esc(synergies.join(' · '))}.` : 'A focused build, a defensive reaction, or a different weapon may change the next expedition.'}</p>${isV2(s) ? `<div class="ledger-grid"><div><small>Shop purchases</small><b>${s.stats.shopPurchases}</b></div><div><small>Scrap spent</small><b>${s.stats.spent}</b></div><div><small>Combat time</small><b>${Math.floor(s.time / 60)}m ${Math.floor(s.time % 60)}s</b></div><div><small>Passive synergies</small><b>${s.synergies.length}</b></div>${modern(s) ? `<div><small>Mastered fusions</small><b>${forged.length}</b></div><div><small>Tower level</small><b>${s.level}</b></div>` : ''}</div>` : ''}<p class="notice">${s.cleared ? `${STAGES[s.stage].name} · ${difficultyName(s.difficulty)} clear secured. Other stages keep their own difficulty access.` : 'Credits can awaken another tower or improve your permanent runes.'}${storageFailed ? ' Export a backup before closing this tab.' : ''}</p>${nextTower ? `<p class="notice">Next awakening: ${nextTower.name} · ${nextTower.cost} credits. ${availableCredits >= nextTower.cost ? 'You can awaken it in the hangar.' : `${nextTower.cost - availableCredits} credits to go.`}</p>` : ''}<div class="result-actions"><button id="result-ledger" class="outline-button">Damage ledger</button><button id="result-export" class="outline-button">Export save</button><button id="return-spire" class="gold-button">Return to the spire ${glyph('arrow')}</button></div>`,
  );
  $('result-export').onclick = downloadCurrent;
  $('result-ledger').onclick = openStats;
  $('return-spire').onclick = async () => {
    const epoch = contextEpoch;
    const button = $<HTMLButtonElement>('return-spire');
    button.disabled = true;
    button.textContent = 'Securing rewards…';
    try {
      await settle();
      if (epoch !== contextEpoch || contextChanging) return;
      const finished = data.run;
      if (!finished?.settled) {
        button.disabled = false;
        notify('Rewards are not secured yet. Export a backup and retry.', 'warning');
        return;
      }
      chosenTower = finished.tower;
      chosenStage = finished.stage;
      chosenDifficulty = finished.difficulty;
      data.run = null;
      data.progression.active = null;
      playing = false;
      paused = false;
      lastPhase = '';
      lastRewardId = '';
      manager.closeAll();
      makePreview();
      updateHud();
      openLaunch();
      await persist();
    } catch (e) {
      button.disabled = false;
      notify(
        `Could not leave safely: ${e instanceof Error ? e.message : 'Unexpected save error'}`,
        'warning',
      );
    }
  };
  if (startSettlement && !s.settled)
    void settle()
      .then(() => {
        if (manager.has('results')) openResults(false);
      })
      .catch((e) => notify(`Rewards require recovery: ${String(e)}`, 'warning'));
}
function openRecovery(error: string) {
  manager.open(
    'recovery',
    {
      title: 'Your checkpoint is protected.',
      subtitle: 'SAVE RECOVERY',
      width: 590,
      height: 490,
      choice: true,
    },
    `<p class="lead">${esc(error)}</p><p>Automatic writes are stopped so this checkpoint is not overwritten. Download the raw backup or import a repaired save through Settings.</p><div class="result-actions"><button id="raw-backup" class="outline-button">Download raw checkpoint</button><button id="recover-settings" class="gold-button">Open save settings</button></div>`,
  );
  $('raw-backup').onclick = async () => {
    try {
      download(JSON.stringify(await readRawSave(saveScope), null, 2), 'last-spire-recovery.json');
    } catch {
      notify('The saved checkpoint could not be read.', 'warning');
    }
  };
  $('recover-settings').onclick = openSettings;
}
function togglePause() {
  if (!playing) return;
  paused = !paused;
  updateHud();
  if (paused) scheduleSave();
}
function activate(which: 'signature' | 'secondary') {
  const s = data.run;
  if (!s || paused || decisionPaused(s) || s.phase !== 'combat') return;
  const success = isV2(s) ? useSkill(s, which) : legacySkill(s, which);
  if (success) {
    telemetry.event(s.id, s.time, 'skill', { slot: which, automatic: false });
    sound(which === 'signature' ? 590 : 440);
    updateHud();
  }
}
$('menu-btn').onclick = openMenu;
$('expedition-btn').onclick = openLaunch;
$('fusion-btn').onclick = openFusions;
$('settings-btn').onclick = openSettings;
$('account-btn').onclick = () => accountPanel.open();
$('arsenal-btn').onclick = openArsenal;
$('codex-btn').onclick = () => openCodex();
$('stats-btn').onclick = openStats;
$('bestiary-btn').onclick = () => openBestiary();
$('threat-text').onclick = () => {
  const run = current();
  const preview = isV2(run) && hasEncounters(run) ? nextEncounter(run) : null;
  const roster = preview?.roster ?? [];
  openBestiary(
    roster.find((id) => ENEMY_BY_ID[id].mechanic !== 'shared' || ENEMY_BY_ID[id].role === 'boss') ??
      roster[0],
    preview?.wave,
  );
};
$('autocast-btn').onclick = openAutocast;
$('rewards-btn').onclick = () => showRewards();
$('pause-btn').onclick = togglePause;
$('pause-indicator').onclick = () => {
  if (paused) togglePause();
  else presentDecisions();
};
$('signature-btn').onclick = () => activate('signature');
$('secondary-btn').onclick = () => activate('secondary');
$('speed-btn').onclick = () => {
  data.settings.speed = ((data.settings.speed % 3) + 1) as 1 | 2 | 3;
  scheduleSave();
  updateHud();
};
$('target-btn').onclick = () => {
  const s = current(),
    modes = ['nearest', 'strongest', 'weakest'] as const;
  s.targeting = modes[(modes.indexOf(s.targeting) + 1) % 3];
  scheduleSave();
  updateHud();
};
document.addEventListener('keydown', (e) => {
  if (contextChanging || entryScreen.visible) return;
  const input = e.target as HTMLElement;
  if (input.matches('input,select,textarea') || e.altKey || e.ctrlKey || e.metaKey) return;
  const key = e.key.toLowerCase();
  if (e.code === 'Space') {
    if (input.closest('.spire-window button')) return;
    e.preventDefault();
    togglePause();
  }
  if (key === 'q') activate('signature');
  if (key === 'e') activate('secondary');
  if (key === 'a') manager.visible('arsenal') ? manager.close('arsenal') : openArsenal();
  if (key === 'f') manager.visible('fusions') ? manager.close('fusions') : openFusions();
  if (key === 'c') manager.visible('codex') ? manager.close('codex') : openCodex();
  if (key === 'b') manager.visible('bestiary') ? manager.close('bestiary') : openBestiary();
  if (['1', '2', '3'].includes(key)) {
    data.settings.speed = Number(key) as 1 | 2 | 3;
    scheduleSave();
    updateHud();
  }
  if (e.key === 'Escape') {
    const panels = Array.from(
      document.querySelectorAll<HTMLElement>('.spire-window:not([hidden])'),
    ).sort((a, b) => Number(b.style.zIndex) - Number(a.style.zIndex));
    if (panels.length) manager.close(panels[0].dataset.window!);
    else togglePause();
  }
});
const clock = new SimulationClock(TICK);
const catchupStatus = new CatchupStatus();
let last = 0,
  hudTimer = 0,
  saveTimer = 0,
  perfTime = 0,
  statsTimer = 0;
const frameMeter = new FrameMeter();
function frame(now: number) {
  const frameElapsed = last ? Math.max(0, (now - last) / 1000) : 0;
  last = now;
  const s = current();
  const simulationStarted = performance.now();
  clock.advance(now, {
    speed: data.settings.speed,
    background: document.hidden || !document.hasFocus(),
    canStep: canSimulate,
    step: () => {
      const waveBefore = s.wave;
      if (isV2(s)) {
        const active = data.progression.active;
        if (active?.runId === s.id) {
          const casts = tickAutocast(s, active.autocast);
          for (const slot of ['signature', 'secondary'] as const)
            if (casts[slot]) telemetry.event(s.id, s.time, 'skill', { slot, automatic: true });
        }
        step(s, TICK);
        recordFusionBoundary(s, waveBefore);
        recordDamageSample(s);
      } else legacyStep(s, TICK);
    },
  });
  presentDecisions();
  const catchupMessage = catchupStatus.update(now, clock.pendingSeconds, clock.backgroundCatchup);
  $('catchup-notice').classList.toggle('hidden', !catchupMessage);
  if ($('catchup-message').textContent !== catchupMessage)
    $('catchup-message').textContent = catchupMessage;
  const before = performance.now();
  if (!document.hidden) renderer.draw(s, data.settings);
  frameMeter.record({
    seconds: frameElapsed,
    simulationMs: before - simulationStarted,
    renderMs: performance.now() - before,
    foreground: !document.hidden && document.hasFocus(),
  });
  perfTime += frameElapsed;
  if (perfTime >= 1) {
    const reading = frameMeter.read();
    $('arena').dataset.fps = String(Math.round(reading.fps));
    $('arena').dataset.renderMs = reading.renderMs.toFixed(2);
    $('arena').dataset.frameContext = reading.status;
    $('arena').dataset.simulationMs = reading.simulationMs.toFixed(2);
    $('arena').dataset.frameP95Ms = reading.frameP95Ms.toFixed(2);
    $('arena').dataset.enemies = String(s.enemies.length);
    $('arena').dataset.projectiles = String(s.projectiles.length);
    perfTime = 0;
    if (playing && isV2(s))
      telemetry.sample(
        s,
        reading.status === 'foreground'
          ? {
              fps: reading.fps,
              renderMs: reading.renderMs,
            }
          : undefined,
      );
  }
  hudTimer += frameElapsed;
  saveTimer += frameElapsed;
  if (hudTimer > 0.16) {
    hudTimer = 0;
    if (!document.hidden) {
      updateHud();
      inspector.update();
    }
    if (playing) {
      const signature = isV2(s)
        ? `${s.cards.map((c) => c.cardId + c.mastery + c.targetId).join(',')}|${s.weapons.length}|${s.synergies.join(',')}`
        : s.attacks.map((a) => a.pattern + a.element + a.modifier + a.rank).join(',');
      if (signature !== lastSignature && manager.visible('arsenal')) {
        lastSignature = signature;
        openArsenal();
      }
      if (s.wave !== lastWave || s.phase !== lastPhase) {
        lastWave = s.wave;
        lastPhase = s.phase;
        if (s.cleared) recordClear();
        if (s.phase === 'victory') {
          selectedOffer = null;
          for (const id of ['rewards', 'attune', 'fusion-offer', 'fusion-preview', 'retire'])
            manager.close(id);
          openVictory();
        }
        if (s.phase === 'ended') {
          selectedOffer = null;
          for (const id of ['rewards', 'attune', 'fusion-offer', 'fusion-preview', 'retire'])
            manager.close(id);
          manager.close('victory');
          if (isV2(s)) void telemetry.finish(s);
          openResults();
        }
        scheduleSave();
      }
      presentDecisions();
      if (s.notices.length && now >= nextNoticeAt) {
        nextNoticeAt = now + 2400;
        const message = s.notices.shift()!;
        notify(message);
        if (/evol|synerg|awaken/i.test(message)) sound(780);
      }
    }
  }
  statsTimer += frameElapsed;
  if (statsTimer >= 1) {
    statsTimer = 0;
    if (!document.hidden && manager.visible('stats')) refreshStatsView();
  }
  if (saveTimer > 5) {
    saveTimer = 0;
    if (playing && !settlePromise) void persist();
  }
}
const pageLoop = new PageLoop(frame, {
  hidden: () => document.hidden,
  catchingUp: () => clock.catchingUp,
  now: () => performance.now(),
  frame: (callback) => requestAnimationFrame(callback),
  cancelFrame: (id) => cancelAnimationFrame(id),
  timer: (callback, ms) => window.setTimeout(callback, ms),
  cancelTimer: (id) => clearTimeout(id),
});
document.addEventListener('visibilitychange', () => {
  pageLoop.refresh();
  if (document.hidden && playing) void persist();
});
window.addEventListener('focus', () => pageLoop.refresh());
window.addEventListener('blur', () => pageLoop.refresh());
window.addEventListener('pagehide', () => {
  pageLoop.stop();
  clock.reset();
  last = 0;
  void persist();
});
window.addEventListener('pageshow', (event) => {
  if (event.persisted) {
    clock.reset();
    last = 0;
    pageLoop.start();
  }
});
async function init() {
  let recovery = '';
  await telemetry.init();
  try {
    data = await loadGame();
    data.settings = (await loadDeviceSettings()) ?? data.settings;
  } catch (e) {
    if (e instanceof SaveError && e.code === 'invalid') {
      blocked = true;
      recovery = e.message;
    } else {
      storageFailed = true;
      notify(
        'Local storage is unavailable. Export your progress before closing the tab.',
        'warning',
      );
    }
  }
  chosenMode = data.run && modern(data.run) ? modern(data.run)!.mode : 'normal';
  chosenTower = data.run?.tower ?? data.profile.unlocked[0] ?? 'bastion';
  chosenStage = data.run?.stage ?? 0;
  chosenDifficulty = data.run?.difficulty ?? 0;
  playing = !!data.run;
  paused = playing && data.run?.phase === 'combat';
  makePreview();
  if (isV2(current())) {
    recordDamageSample(current() as RunV2);
    if (playing && data.run)
      void telemetry.begin(data.run as RunV2, {
        build: '3.0.0',
        mode: modern(data.run)?.mode ?? 'legacy',
        runes: data.progression.active?.runes ?? {},
      });
  }
  applySettings();
  loading = false;
  $('loading-screen').remove();
  updateHud();
  if (recovery) openRecovery(recovery);
  else if (!playing || data.run?.phase === 'combat') openLaunch();
  else if (data.run?.phase === 'victory') openVictory();
  else if (data.run?.phase === 'ended') openResults();
  else if (data.run?.version === 1 && ['draft', 'shop'].includes(data.run.phase)) {
    paused = false;
    showLegacyRewards(data.run);
  } else notify('Expedition restored. Press Space or tap play when you’re ready.');
  if (!recovery) entryScreen.open();
  pageLoop.start();
}
window.addEventListener('online', () => void accountSync.refresh());
void init();
