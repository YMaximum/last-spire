import './style.css';
import { TOWERS, STAGES, ELEMENT_COLORS, PATTERNS } from '../content';
import {
  step as legacyStep,
  selectDraft,
  reroll as legacyReroll,
  buyUpgrade,
  continueRun,
  useSkill as legacySkill,
  retire as legacyRetire,
  creditReward,
} from '../engine';
import {
  CARDS,
  CARD_BY_ID,
  WEAPONS,
  WEAPON_BY_ID,
  SYNERGIES,
  RARITIES,
  RARITY_COLORS,
  rarityLabel,
} from './catalog';
import { cardIcon } from './icons';
import {
  createRun,
  step,
  TICK,
  getWeaponStats,
  chooseReward,
  buyOffer,
  rerollReward,
  closeShop,
  repair,
  useSkill,
  continueEndless,
  retire,
  rewardForRun,
  previewCard,
  describeNextThreat,
  REPAIR_COST,
  rewardRerollCost,
} from './engine';
import { BattleRenderer } from './render';
import { WindowManager } from './windows';
import {
  emptySave,
  loadGame,
  saveGame,
  settleGame,
  settleInMemory,
  exportGame,
  parseGame,
  readLegacyBackup,
  readRawSave,
  SaveError,
} from './storage';
import type {
  RunV2,
  SaveV2,
  CardDefinition,
  CardOffer,
  PendingReward,
  SettingsV2,
  WeaponInstance,
  TowerId,
} from './types';
import type { RunState, Upgrade } from '../types';
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (v: unknown) =>
  String(v).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
const glyph = (kind: string) => {
  const paths: Record<string, string> = {
    tower: 'M12 2 7 9v11h10V9L12 2ZM5 20h14M10 13h4',
    book: 'M3 4h6l3 3 3-3h6v15h-6l-3 2-3-2H3V4Zm9 3v14',
    gear: 'm9 3-1 3-3 1-2 3 2 2v3l3 1 1 3h6l1-3 3-1v-3l2-2-2-3-3-1-1-3H9Zm3 6a3 3 0 1 0 0 6 3 3 0 0 0 0-6',
    play: 'm8 4 12 8-12 8V4Z',
    pause: 'M7 4v16M17 4v16',
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
let data: SaveV2 = emptySave(),
  playing = false,
  paused = false,
  loading = true,
  blocked = false,
  storageFailed = false,
  saveBusy = false,
  saveQueued = false,
  settlePromise: Promise<void> | null = null;
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
let selectedOffer: { rewardId: string; offerId: string; purchase: boolean } | null = null;
const app = $('app');
app.innerHTML = `<main id="battlefield"><canvas id="arena" aria-label="Last Spire battlefield"></canvas><div class="arena-shade"></div><header class="battle-hud"><button class="brand-button" id="menu-btn" aria-label="Expedition menu">${glyph('tower')}<span>LAST SPIRE<small>THE RUNEFORGED AGE</small></span>${glyph('menu')}</button><div class="wave-hud"><span id="stage-label">VERDANT WILDS</span><strong id="wave-label">Wave 01 <em>/ 100</em></strong><div id="wave-progress"><i></i></div></div><div class="resource-hud"><span title="Scrap is spent during this expedition">${glyph('diamond')}<b id="scrap-value">0</b><small>SCRAP</small></span><span title="Credits unlock towers between expeditions">${glyph('diamond')}<b id="credit-value">0</b><small>CREDITS</small></span><button id="settings-btn" class="square-button" aria-label="Settings">${glyph('gear')}</button></div></header><div class="threat-strip"><span id="threat-text">One spire. A thousand ways to fight.</span><button id="pause-indicator" class="hidden">PAUSED · RESUME</button></div><nav class="field-tools" aria-label="Battlefield panels"><button id="arsenal-btn" title="Arsenal (A)">${glyph('tower')}<span>Arsenal</span></button><button id="codex-btn" title="Codex (C)">${glyph('book')}<span>Codex</span></button><button id="stats-btn" title="Combat statistics">${glyph('stats')}<span>Ledger</span></button><button id="rewards-btn" class="reward-tool hidden">${glyph('diamond')}<span id="reward-count">Choose upgrade</span></button></nav><div id="buff-strip" aria-label="Active buffs"></div><div id="event-toast" role="status" aria-live="polite"></div><div id="boss-warning" class="hidden"></div><footer class="combat-controls"><div class="integrity"><div><span>${glyph('heart')} SPIRE INTEGRITY</span><strong id="hp-value">—</strong></div><div class="hp-track"><i id="hp-fill"></i><i id="shield-fill"></i></div><span id="barrier-value">Barrier dormant</span></div><div class="ability-tray"><button class="ability" id="signature-btn"><span>${glyph('shield')}</span><div><small>SIGNATURE <kbd>Q</kbd></small><b id="signature-name">Bulwark</b></div><em id="signature-cd"></em></button><button class="ability" id="secondary-btn"><span>${glyph('bolt')}</span><div><small>SECONDARY <kbd>E</kbd></small><b id="secondary-name">Mend</b></div><em id="secondary-cd"></em></button></div><div class="playback"><button class="square-button" id="pause-btn" aria-label="Pause combat">${glyph('pause')}</button><button id="speed-btn" title="Speed (1, 2, 3)">1×</button><button id="target-btn" title="Target priority">${glyph('target')}<span id="target-label">Nearest</span></button></div></footer><div id="window-host"></div><div id="window-dock"></div><div id="loading-screen"><div class="loading-rune">${glyph('tower')}</div><h1>LAST SPIRE</h1><p>Waking the ancient machines…</p></div></main>`;
const manager = new WindowManager(
  $('window-host'),
  $('window-dock'),
  () => data.settings,
  () => scheduleSave(),
);
const renderer = new BattleRenderer($<HTMLCanvasElement>('arena'));
new ResizeObserver(() => renderer.resize()).observe($('arena'));
function isV2(s: RunV2 | RunState): s is RunV2 {
  return s.version === 2;
}
function current(): RunV2 | RunState {
  return playing && data.run ? data.run : preview;
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
function makePreview() {
  preview = createRun(data.profile, chosenTower, chosenStage, chosenDifficulty, 831251);
  preview.time = 12;
}
function scheduleSave() {
  clearTimeout(persistTimer);
  persistTimer = window.setTimeout(() => void persist(), 300);
}
async function persist() {
  if (loading || blocked) return;
  if (saveBusy || settlePromise) {
    saveQueued = true;
    return;
  }
  saveBusy = true;
  try {
    await saveGame(data);
    storageFailed = false;
  } catch (e) {
    storageFailed = true;
    if (e instanceof SaveError && e.code === 'invalid') blocked = true;
    notify(
      `Save unavailable. ${e instanceof Error ? e.message : 'Storage could not be reached'}. Export a backup in Settings.`,
      'warning',
    );
  } finally {
    saveBusy = false;
    if (saveQueued) {
      saveQueued = false;
      scheduleSave();
    }
  }
}
async function settle() {
  if (settlePromise) return settlePromise;
  if (!data.run || data.run.settled) return;
  const task = async () => {
    try {
      data = await settleGame(data);
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
  if (!data.settings.sound) return;
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
  if (!preview) return;
  const s = current(),
    legacy = !isV2(s);
  $('stage-label').textContent =
    STAGES[s.stage].name.toUpperCase() +
    (legacy ? ' · RECOVERED RUN' : s.difficulty ? ` · ASCENSION ${s.difficulty}` : '');
  $('wave-label').innerHTML =
    `Wave ${String(s.wave).padStart(2, '0')} <em>/ ${s.endless ? '∞' : '100'}</em>`;
  $('wave-progress').querySelector<HTMLElement>('i')!.style.width =
    `${s.endless ? 100 : Math.min(100, s.wave)}%`;
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
  $('speed-btn').textContent = `${data.settings.speed}×`;
  $('target-label').textContent = s.targeting[0].toUpperCase() + s.targeting.slice(1);
  $('pause-btn').innerHTML = glyph(paused ? 'play' : 'pause');
  $('pause-indicator').classList.toggle(
    'hidden',
    !playing || !(paused || manager.choicesPause()) || s.phase !== 'combat',
  );
  $('pause-indicator').textContent = paused ? 'PAUSED · RESUME' : 'CHOOSING · AUTO-PAUSED';
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
  manager.open(
    'launch',
    {
      title: 'The last light waits.',
      subtitle: 'FORGE YOUR NEXT EXPEDITION',
      width: 490,
      height: 610,
    },
    `<p class="lead">One ancient machine. Six weapons. A build that belongs to you.</p><div class="launch-tower" style="--accent:${TOWERS.find((t) => t.id === chosenTower)!.color}">${glyph('tower')}<div><small>YOUR SPIRE</small><h3>${TOWERS.find((t) => t.id === chosenTower)!.name}</h3><p>${esc(chosenTower === 'tempest' ? 'Lightning chains jump to three nearby enemies.' : TOWERS.find((t) => t.id === chosenTower)!.passive)}</p></div></div><button id="launch-hangar" class="outline-button full">Choose tower & permanent runes ${glyph('arrow')}</button><label class="control-label">Expedition<select id="stage-select">${STAGES.map((st) => `<option value="${st.id}" ${chosenStage === st.id ? 'selected' : ''} ${st.id >= data.profile.stageUnlocked ? 'disabled' : ''}>${st.name}${st.id >= data.profile.stageUnlocked ? ' · Locked' : ''}</option>`).join('')}</select></label><label class="control-label">Difficulty<select id="difficulty-select">${Array.from({ length: 6 }, (_, i) => `<option value="${i}" ${i === chosenDifficulty ? 'selected' : ''} ${i > data.profile.difficultyUnlocked ? 'disabled' : ''}>${i === 0 ? 'Normal' : `Ascension ${i}`}${i > data.profile.difficultyUnlocked ? ' · Locked' : ''}</option>`).join('')}</select></label><div class="expedition-facts"><span>100 waves</span><span>Draft every 2 waves</span><span>Autosaved</span></div><button id="begin-btn" class="gold-button full">Begin expedition ${glyph('arrow')}</button><p class="quiet">Your choices build the power. The waves won’t wait.</p>`,
  );
  $('launch-hangar').onclick = openHangar;
  $('stage-select').onchange = () => {
    chosenStage = Number($<HTMLSelectElement>('stage-select').value);
    makePreview();
    updateHud();
  };
  $('difficulty-select').onchange = () => {
    chosenDifficulty = Number($<HTMLSelectElement>('difficulty-select').value);
    makePreview();
    updateHud();
  };
  $('begin-btn').onclick = () => {
    if (playing) return;
    data.run = createRun(data.profile, chosenTower, chosenStage, chosenDifficulty);
    playing = true;
    paused = false;
    lastRewardId = '';
    lastSignature = '';
    lastPhase = '';
    lastWave = 0;
    manager.closeAll();
    scheduleSave();
    updateHud();
    if (!data.profile.tutorialDone) openHelp();
  };
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
    `<div class="menu-list">${!playing ? '<button id="menu-launch">Prepare expedition</button>' : ''}<button id="menu-arsenal">${glyph('tower')} Arsenal & synergies</button><button id="menu-codex">${glyph('book')} Field codex</button><button id="menu-hangar">${glyph('shield')} Tower hangar</button><button id="menu-settings">${glyph('gear')} Settings & saves</button><button id="menu-help">How to play</button>${playing ? '<button id="menu-retire" class="danger-text">Retire & collect rewards</button>' : ''}</div><p class="quiet">${playing ? 'Combat continues behind information windows. Use Space to pause.' : 'Original arcane machines. Endless possibilities.'}</p>`,
  );
  $('menu-launch')?.addEventListener('click', () => {
    manager.close('menu');
    openLaunch();
  });
  $('menu-arsenal').onclick = openArsenal;
  $('menu-codex').onclick = () => openCodex();
  $('menu-hangar').onclick = openHangar;
  $('menu-settings').onclick = openSettings;
  $('menu-help').onclick = openHelp;
  $('menu-retire')?.addEventListener('click', openRetire);
}
function scopeLabel(c: CardDefinition) {
  if (c.group === 'weapon') return 'New weapon · duplicates strengthen';
  return c.scope === 'projectiles'
    ? 'All eligible projectiles'
    : c.scope === 'defense'
      ? 'Tower defense'
      : c.scope === 'weapon'
        ? 'Choose a weapon'
        : c.scope === 'skill'
          ? 'Skill system'
          : 'Entire tower';
}
function cardRules(c: CardDefinition) {
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
  return `<button class="card rarity-${offer.rarity}" data-offer="${esc(offer.id)}" style="--rarity:${RARITY_COLORS[offer.rarity]}" ${shop && s.scrap < offer.price ? 'disabled' : ''}><span class="card-top"><span>${rarityLabel(offer.rarity)}</span><span>${c.group.toUpperCase()}</span></span><span class="card-art">${cardIcon(c.iconId, 72)}</span><h3>${esc(c.name)}</h3><span class="card-scope">${esc(scopeLabel(c))}</span><p>${esc(c.description)}</p>${cardRules(c) ? `<small class="card-rules">${esc(cardRules(c))}</small>` : ''}${info.summary ? `<span class="card-change">${esc(info.summary)}</span>` : ''}${info.awaken.length ? `<span class="card-synergy">✦ ${esc(info.awaken.join(' · '))}</span>` : ''}${info.lost.length ? `<span class="card-loss">Releases ${esc(info.lost.join(', '))}</span>` : ''}<span class="card-action">${shop ? `${offer.price} scrap` : 'Choose upgrade'} ${glyph('arrow')}</span></button>`;
}
function showRewards(id?: string) {
  const s = current();
  if (!playing) return;
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
  const shop = reward.kind === 'shop';
  manager.open(
    'rewards',
    {
      title: shop ? 'The wandering artificer.' : 'Shape what comes next.',
      subtitle: `WAVE ${reward.wave} · ${shop ? `${Math.floor(s.scrap)} SCRAP` : 'SELECT ONE CARD'}`,
      width: shop ? 1120 : 1060,
      height: 690,
      choice: true,
    },
    `<div class="reward-toolbar"><label><input type="checkbox" id="choice-pause" ${data.settings.autoPauseChoices ? 'checked' : ''}> Pause while choosing</label>${s.pendingRewards.length > 1 ? `<select id="reward-queue" aria-label="Pending rewards">${s.pendingRewards.map((p) => `<option value="${esc(p.id)}" ${p.id === reward.id ? 'selected' : ''}>Wave ${p.wave} · ${p.kind === 'shop' ? 'Artificer' : 'Upgrade'}</option>`).join('')}</select>` : '<span>Upgrades accumulate. Your existing effects stay.</span>'}</div><div class="card-grid ${shop ? 'shop-cards' : ''}">${reward.offers.map((o) => offerMarkup(o, shop)).join('')}</div><div class="reward-footer"><button id="reward-reroll" class="outline-button">Reroll · ${rewardRerollCost(s, reward.id)} scrap · ${reward.rerolls} used</button>${shop ? `<button id="repair-shop" class="outline-button" ${reward.repairStock <= 0 || s.hp >= s.maxHp ? 'disabled' : ''}>Repair integrity · ${REPAIR_COST} scrap</button><button id="leave-shop" class="gold-button">Continue ${glyph('arrow')}</button>` : '<span class="quiet">Six weapons · stackable effects · earned evolution</span>'}</div>`,
  );
  $('choice-pause').onchange = () => {
    data.settings.autoPauseChoices = $<HTMLInputElement>('choice-pause').checked;
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
  $('reward-reroll').onclick = () => {
    if (rerollReward(s, reward.id)) {
      scheduleSave();
      showRewards(reward.id);
    } else notify('Not enough scrap or rerolls available.');
  };
  $('repair-shop')?.addEventListener('click', () => {
    if (repair(s, reward.id)) {
      scheduleSave();
      showRewards(reward.id);
      updateHud();
    } else notify('Repair unavailable. Check scrap and remaining stock.');
  });
  $('leave-shop')?.addEventListener('click', () => {
    closeShop(s, reward.id);
    scheduleSave();
    showRewards();
    updateHud();
  });
}
function applyOffer(rewardId: string, offerId: string, purchase: boolean, targetId?: string) {
  const s = current();
  if (!isV2(s)) return;
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
  sound(620);
  scheduleSave();
  showRewards(rewardId);
  if (manager.has('arsenal')) openArsenal();
  updateHud();
}
function showTargetPicker(offer: CardOffer) {
  const s = current();
  if (!isV2(s)) return;
  const c = CARD_BY_ID[offer.cardId];
  const replacing = c.group === 'weapon';
  manager.open(
    'attune',
    {
      title: `Attune ${c.name}`,
      subtitle: 'CHOOSE THE WEAPON TO STRENGTHEN',
      width: 500,
      height: 550,
      choice: true,
    },
    `<p class="lead">${replacing ? 'All global cards stay. This explicitly replaces one weapon; its infusions and weapon mastery are released.' : 'Your other weapons keep their current effects. This infusion adds to the selected weapon.'}</p><div class="target-weapons">${s.weapons
      .map(
        (w) =>
          `<button data-target="${esc(w.id)}">${cardIcon(CARDS.find((c) => c.weapon === w.kind)!.iconId, 44)}<span><b>${WEAPON_BY_ID[w.kind].name}</b><small>${w.infusions.length ? w.infusions.join(' + ') : 'Uninfused'} · ${rarityLabel(w.rarity)}</small><small>${esc(previewCard(s, offer, w.id).summary)}</small>${previewCard(
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
function openArsenal() {
  const s = current(),
    modern = isV2(s);
  const weapons = modern ? s.weapons : [];
  const active = modern ? s.synergies : [];
  let body = `<div class="panel-tabs"><button data-arsenal-tab="weapons" class="${arsenalTab === 'weapons' ? 'active' : ''}">Weapons ${modern ? weapons.length : s.attacks.length}/6</button><button data-arsenal-tab="cards" class="${arsenalTab === 'cards' ? 'active' : ''}">Collected cards</button><button data-arsenal-tab="synergies" class="${arsenalTab === 'synergies' ? 'active' : ''}">Synergies ${active.length}</button></div>`;
  if (!modern) {
    body += `<p class="notice">Recovered expedition: original weapons and upgrades are preserved until this run ends.</p>${s.attacks.map((a) => `<article class="weapon-inspector"><h3>${PATTERNS.find((p) => p.id === a.pattern)?.name}</h3><p>${a.element} + ${a.modifier} · rank ${a.rank}</p><p>Lifetime attacks: ${a.shots.toLocaleString()}</p></article>`).join('')}`;
  } else if (arsenalTab === 'weapons') {
    body += `<p class="panel-note">Global cards affect every eligible weapon. Infusions combine on the weapon you choose.</p><div class="weapon-list">${weapons
      .map((w) => {
        const d = WEAPON_BY_ID[w.kind],
          stats = getWeaponStats(s, w);
        return `<article class="weapon-inspector" style="--rarity:${RARITY_COLORS[w.rarity]}"><div class="weapon-heading">${cardIcon(CARDS.find((c) => c.weapon === w.kind)!.iconId, 52)}<div><small>${rarityLabel(w.rarity)}</small><h3>${d.name}</h3></div><span class="weapon-mastery">${w.mastery}/12</span></div><p>${esc(d.description)}</p><div class="infusions">${stats.elements.length ? stats.elements.map((e) => `<span style="--element:${ELEMENT_COLORS[e]}">${e}</span>`).join('') : '<span>Uninfused</span>'}</div><dl class="weapon-stats"><div><dt>Damage</dt><dd>${stats.damage.toFixed(1)}</dd></div><div><dt>Interval</dt><dd>${stats.cooldown.toFixed(2)}s</dd></div><div><dt>Projectiles</dt><dd>${stats.count}</dd></div><div><dt>Size</dt><dd>${stats.size.toFixed(1)}</dd></div><div><dt>Speed</dt><dd>${Math.round(stats.speed)}</dd></div><div><dt>Range</dt><dd>${Math.round(stats.range)}</dd></div><div><dt>Pulse</dt><dd>${stats.pulse > 0 ? `0.80s` : '—'}</dd></div><div><dt>Pierce / bounce</dt><dd>${stats.pierce} / ${stats.bounces}</dd></div></dl><p class="quiet">${stats.trail > 0 ? 'Damaging trail · ' : ''}${stats.homing > 0 ? 'Homing · ' : ''}${stats.returning ? 'Returns to spire · ' : ''}${stats.split > 0 ? `Splits ×${stats.split} · ` : ''}${w.lifetimeShots.toLocaleString()} lifetime attacks</p></article>`;
      })
      .join(
        '',
      )}${Array.from({ length: 6 - weapons.length }, () => '<article class="empty-weapon">＋<span>Open weapon socket</span><small>Acquire a weapon card to fill it.</small></article>').join('')}</div>`;
  } else if (arsenalTab === 'cards') {
    body += `<p class="panel-note">Duplicates strengthen a family. Promotions arrive at 3, 6, 9, and 12 mastery.</p><div class="owned-list">${
      s.cards.length
        ? s.cards
            .map((stack) => {
              const c = CARD_BY_ID[stack.cardId];
              return `<article class="owned-card" style="--rarity:${RARITY_COLORS[stack.rarity]}">${cardIcon(c.iconId, 44)}<div><small>${rarityLabel(stack.rarity)} · ${scopeLabel(c)}</small><h3>${esc(c.name)} <span>×${stack.stacks}</span></h3><p>${esc(c.description)}</p>${cardRules(c) ? `<small class="card-rules">${esc(cardRules(c))}</small>` : ''}<div class="mastery-track"><i style="width:${Math.min(100, (stack.mastery / 12) * 100)}%"></i></div><small>Mastery ${stack.mastery}/12${stack.targetId ? ` · ${WEAPON_BY_ID[s.weapons.find((w) => w.id === stack.targetId)!.kind].name}` : ''}</small>${c.group === 'skill' ? `<button class="outline-button compact" data-equip="${esc(c.id)}">${s.secondary === c.id ? 'Equipped' : 'Equip secondary skill'}</button>` : ''}</div></article>`;
            })
            .join('')
        : '<p>Your first cards arrive after wave 2. Every family has its own icon and effect.</p>'
    }</div>`;
  } else
    body += `<p class="panel-note">Recipes require specific cards and interactions. Adding elements alone does not awaken every recipe.</p><div class="synergy-list">${SYNERGIES.map((y) => `<article class="synergy ${s.synergies.includes(y.id) ? 'awakened' : ''}" style="--element:${y.color}"><span class="synergy-sigil">${s.synergies.includes(y.id) ? '✦' : '◇'}</span><div><small>${s.synergies.includes(y.id) ? 'AWAKENED' : 'DORMANT'}</small><h3>${esc(y.name)}</h3><p>${esc(y.description)}</p><div class="requirements">${y.requires.map((id) => `<span class="${s.cards.some((c) => c.cardId === id) || (id.startsWith('infusion-') && s.weapons.some((w) => w.infusions.some((e) => e === id.slice(9)))) || (id.startsWith('weapon-') && s.weapons.some((w) => w.kind === id.slice(7))) ? 'met' : ''}">${esc(CARD_BY_ID[id]?.name ?? id)}</span>`).join('')}</div></div></article>`).join('')}</div>`;
  if (isV2(s))
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
let codexQuery = '',
  codexGroup = 'all';
function openCodex() {
  manager.open(
    'codex',
    {
      title: 'The field codex.',
      subtitle: '100 CARD FAMILIES · 40 SYNERGIES',
      width: 650,
      height: 760,
    },
    `<div class="codex-search"><input id="codex-query" type="search" placeholder="Search names, effects, or mechanics…" aria-label="Search cards" value="${esc(codexQuery)}"><select id="codex-group" aria-label="Card category"><option value="all">All card families</option>${['weapon', 'infusion', 'modifier', 'defense', 'trigger', 'skill', 'utility', 'synergy', 'rules'].map((g) => `<option value="${g}" ${g === codexGroup ? 'selected' : ''}>${g[0].toUpperCase() + g.slice(1)}</option>`).join('')}</select></div><div id="codex-results"></div>`,
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
      `<article class="rules"><h3>Build something that works together.</h3><p>You have six weapon sockets from the beginning. Weapon cards add a weapon; duplicate weapon cards strengthen it. Global projectile cards modify every eligible weapon. Infusions add effects to the weapon you choose.</p><h3>Rarity is earned as well as found.</h3><p>Normal → Rare → Epic → Legendary → Mythic. Repeated picks add mastery; 3, 6, 9, and 12 mastery promote the family. A higher-tier drop never downgrades what you own. Legendary weapon cores gain one pierce; Mythic cores emit traveling damage pulses. Higher card tiers increase family strength by 20% per tier.</p><h3>Power has shape.</h3><p>Damage, speed, size, count, range, and lifetime interact. Additional infusions split direct damage across their elements. Diminishing returns, trigger cooldowns, and bounded proc chains prevent infinite loops. Effective values are shown in your arsenal. Infusion damage is divided equally; status and movement caps remain visible there. Enemy formations cap at 96. At 4,096 active shots, primary attacks wait; bounded split children and existing damaging shots finish. Cosmetic quality never changes combat.</p><h3>Defense can become offense.</h3><p>Thorns and reflected hits are retaliation damage. Shield breaks, incoming damage, and kills can trigger other effects, within each card’s cooldown and chain limit. Some cards leave persistent damage zones.</p><h3>Time is yours to manage.</h3><p>Information windows never pause combat. Drafts and shops pause by default, with a switch to keep combat live. Closing or minimizing the choice window banks it for later; rewards remain queued.</p><h3>The economy asks you to choose.</h3><p>Scrap is temporary. Credits unlock towers and permanent runes after the run. Repairs have limited stock, rerolls grow more expensive, and split enemies cannot generate extra bounty.</p></article>`;
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
function openStats() {
  const s = current();
  const damage = isV2(s) ? Object.entries(s.damageByWeapon) : Object.entries(s.damageByElement);
  const max = Math.max(1, ...damage.map(([, v]) => v));
  manager.open(
    'stats',
    {
      title: 'The expedition ledger.',
      subtitle: 'INFORMATION WINDOW · COMBAT STAYS LIVE',
      width: 530,
      height: 650,
    },
    `<div class="ledger-grid"><div><small>Wave</small><b>${s.wave}${s.endless ? ' ∞' : ''}</b></div><div><small>Defeated</small><b>${s.kills.toLocaleString()}</b></div><div><small>Projected credits</small><b>${Math.floor(isV2(s) ? rewardForRun(s) : creditReward(s))}</b></div><div><small>Combat time</small><b>${Math.floor(s.time / 60)}:${String(Math.floor(s.time % 60)).padStart(2, '0')}</b></div>${isV2(s) ? `<div><small>Spent in shops</small><b>${s.stats.spent}</b></div><div><small>Incoming damage</small><b>${Math.round(s.stats.damageTaken)}</b></div>` : ''}</div><h3>Damage signature</h3><div class="damage-chart">${
      damage
        .filter(([, v]) => v > 0)
        .sort((a, b) => b[1] - a[1])
        .map(
          ([id, v]) =>
            `<div><span>${esc(isV2(s) ? (WEAPONS.find((w) => w.id === id)?.name ?? s.weapons.find((w) => w.id === id)?.kind ?? id) : id)}</span><div><i style="width:${(v / max) * 100}%"></i></div><b>${Math.round(v).toLocaleString()}</b></div>`,
        )
        .join('') || '<p>Damage statistics appear during combat.</p>'
    }</div><p class="quiet">Seed ${s.seed.toString(16).toUpperCase()} · ${storageFailed ? 'Save unavailable: export a backup.' : 'Progress is stored on this device.'}</p><button class="outline-button full" id="refresh-stats">Refresh ledger</button>`,
  );
  $('refresh-stats').onclick = openStats;
}
function openHangar() {
  manager.open(
    'hangar',
    {
      title: 'Six hearts. One last light.',
      subtitle: `TOWER HANGAR · ${data.profile.credits} CREDITS`,
      width: 1080,
      height: 760,
    },
    `<p class="lead">Every spire has a different nature. Every spire can forge a full arsenal.</p><div class="tower-grid">${TOWERS.map(
      (t) => {
        const unlocked = data.profile.unlocked.includes(t.id);
        return `<article class="tower-card" style="--accent:${t.color}"><div class="tower-portrait">${glyph('tower')}<span>${t.name[0]}</span></div><small>${t.subtitle}</small><h3>${t.name}</h3><p>${esc(t.description)}</p><div class="tower-passive">${esc(t.id === 'tempest' ? 'Lightning chains jump to three nearby enemies.' : t.passive)}</div><p><b>${t.skill}</b> · ${esc(t.skillDescription)}</p><button data-tower="${t.id}" class="${unlocked ? 'outline-button' : 'gold-button'} full" ${playing || (!unlocked && data.profile.credits < t.cost) ? 'disabled' : ''}>${unlocked ? (chosenTower === t.id ? 'Selected' : 'Select tower') : `Awaken · ${t.cost} credits`}</button></article>`;
      },
    ).join(
      '',
    )}</div><div class="permanent-runes"><div><h3>Permanent runes</h3><p>Small advantages. Your build still wins the battle.</p></div>${(['power', 'vitality', 'fortune'] as const).map((k) => `<button data-meta="${k}" class="outline-button" ${playing || data.profile.upgrades[k] >= 5 || data.profile.credits < 50 * (data.profile.upgrades[k] + 1) ? 'disabled' : ''}><b>${k} ${data.profile.upgrades[k]}/5</b><span>${k === 'power' ? '+2.5% damage' : k === 'vitality' ? '+3.5% health' : '+0.8% rarity roll'} · ${50 * (data.profile.upgrades[k] + 1)} credits</span></button>`).join('')}</div>`,
  );
  manager
    .element('hangar')!
    .querySelectorAll<HTMLButtonElement>('[data-tower]')
    .forEach(
      (b) =>
        (b.onclick = () => {
          if (playing) return;
          const t = TOWERS.find((t) => t.id === b.dataset.tower)!;
          if (!data.profile.unlocked.includes(t.id)) {
            if (data.profile.credits < t.cost) return;
            data.profile.credits -= t.cost;
            data.profile.unlocked.push(t.id);
            notify(`${t.name} awakened.`);
          }
          chosenTower = t.id;
          makePreview();
          scheduleSave();
          openHangar();
          updateHud();
          if (manager.has('launch')) openLaunch();
        }),
    );
  manager
    .element('hangar')!
    .querySelectorAll<HTMLButtonElement>('[data-meta]')
    .forEach(
      (b) =>
        (b.onclick = () => {
          if (playing) return;
          const k = b.dataset.meta as keyof typeof data.profile.upgrades,
            cost = 50 * (data.profile.upgrades[k] + 1);
          if (data.profile.upgrades[k] >= 5 || data.profile.credits < cost) return;
          data.profile.credits -= cost;
          data.profile.upgrades[k]++;
          makePreview();
          scheduleSave();
          openHangar();
          updateHud();
        }),
    );
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
function openSettings() {
  manager.open(
    'settings',
    {
      title: 'Find your rhythm.',
      subtitle: 'PRESENTATION · CONTROLS · LOCAL SAVES',
      width: 610,
      height: 760,
    },
    `<div class="settings-list"><label>Sound effects<input id="setting-sound" type="checkbox" ${data.settings.sound ? 'checked' : ''}></label><label>Reduced motion<input id="setting-motion" type="checkbox" ${data.settings.reducedMotion ? 'checked' : ''}></label><label>Camera shake<input id="setting-shake" type="checkbox" ${data.settings.shake ? 'checked' : ''}></label><label>Pause draft & shop windows<input id="setting-pause" type="checkbox" ${data.settings.autoPauseChoices ? 'checked' : ''}></label><label>Text & interface scale<select id="setting-scale">${[100, 115, 130, 150].map((v) => `<option value="${v}" ${data.settings.uiScale === v ? 'selected' : ''}>${v}%</option>`).join('')}</select></label><label>Weapon spectacle<select id="setting-intensity">${['subtle', 'balanced', 'spectacular'].map((v) => `<option value="${v}" ${v === data.settings.intensity ? 'selected' : ''}>${v[0].toUpperCase() + v.slice(1)}</option>`).join('')}</select></label><label>Effects quality<select id="setting-quality"><option value="high" ${data.settings.effects === 'high' ? 'selected' : ''}>High detail</option><option value="low" ${data.settings.effects === 'low' ? 'selected' : ''}>Battery friendly</option></select></label></div><div class="save-status ${storageFailed || blocked ? 'warning' : ''}">${blocked ? 'A saved checkpoint needs recovery. Automatic writes are stopped to protect it.' : storageFailed ? 'Storage is unavailable. Progress is kept in this tab: export before closing.' : 'Local saves are active. Combat checkpoints and queued choices are autosaved.'}</div><div class="save-actions"><button id="export-save" class="outline-button">Export current save</button><label class="file-button outline-button">Import save<input id="import-save" type="file" accept="application/json,.json"></label><button id="paste-import" class="outline-button">Paste a save</button><button id="export-backup" class="outline-button">Download pre-v2 backup</button></div><p class="quiet">Save files stay on your device. Import shows a review before replacing progress. A recovered original expedition keeps its old rules until it ends.</p><div class="controls-reference"><h3>At your command</h3><p><kbd>Space</kbd> pause · <kbd>Q</kbd> signature · <kbd>E</kbd> secondary<br><kbd>A</kbd> arsenal · <kbd>C</kbd> codex · <kbd>1 / 2 / 3</kbd> speed<br><kbd>Esc</kbd> close the top window, then pause<br>Drag window headers, or focus a header and use <kbd>Alt + arrows</kbd>.</p></div><a class="outline-button full" href="/icon-contact-sheet.html" target="_blank" rel="noopener">Inspect the original card icon collection ↗</a>`,
  );
  const bindCheck = (id: string, key: 'sound' | 'reducedMotion' | 'shake' | 'autoPauseChoices') => {
    $(id).onchange = () => {
      data.settings[key] = $<HTMLInputElement>(id).checked;
      applySettings();
      scheduleSave();
    };
  };
  bindCheck('setting-sound', 'sound');
  bindCheck('setting-motion', 'reducedMotion');
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
  $('export-backup').onclick = async () => {
    try {
      const raw = await readLegacyBackup();
      if (!raw) {
        notify('No pre-v2 save was found. Your current save can still be exported.');
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
    const input = $<HTMLInputElement>('import-save'),
      file = input.files?.[0];
    if (!file) return;
    try {
      if (file.size > 8 * 1024 * 1024) throw new Error('File exceeds 8 MB');
      const incoming = parseGame(await file.text());
      showImportReview(incoming, file.name);
    } catch (e) {
      notify(`Import rejected: ${e instanceof Error ? e.message : 'Invalid save'}`, 'warning');
    } finally {
      input.value = '';
    }
  };
}
function showImportReview(incoming: SaveV2, name: string) {
  manager.open(
    'import',
    {
      title: 'Restore this expedition?',
      subtitle: 'REVIEW SAVE IMPORT',
      width: 500,
      height: 450,
      choice: true,
    },
    `<p class="lead">${esc(name)}</p><div class="ledger-grid"><div><small>Credits</small><b>${incoming.profile.credits}</b></div><div><small>Towers</small><b>${incoming.profile.unlocked.length}/6</b></div><div><small>Best wave</small><b>${incoming.profile.bestWave}</b></div><div><small>Active run</small><b>${incoming.run ? `Wave ${incoming.run.wave}` : 'None'}</b></div></div><p>This replaces the current local progress. Export your current save first if you want to keep both.</p><div class="result-actions"><button id="cancel-import" class="outline-button">Cancel</button><button id="confirm-import" class="gold-button">Restore this save</button></div>`,
  );
  $('cancel-import').onclick = () => manager.close('import');
  $('confirm-import').onclick = async () => {
    const button = $<HTMLButtonElement>('confirm-import');
    button.disabled = true;
    try {
      await saveGame(incoming, true);
      data = incoming;
      blocked = false;
      storageFailed = false;
      playing = !!data.run;
      paused = playing && data.run?.phase === 'combat';
      chosenTower = data.run?.tower ?? data.profile.unlocked[0];
      chosenStage = data.run?.stage ?? 0;
      chosenDifficulty = data.run?.difficulty ?? 0;
      lastPhase = '';
      lastSignature = '';
      lastRewardId = '';
      lastWave = 0;
      manager.closeAll();
      applySettings();
      makePreview();
      updateHud();
      if (!playing) openLaunch();
      else if (data.run?.phase === 'victory') openVictory();
      else if (data.run?.phase === 'ended') openResults();
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
    `<div class="help-steps"><section><span>01</span><div><h3>The spire fights automatically.</h3><p>Use Q and E for your two active skills. Change targeting when a dangerous enemy needs attention.</p></div></section><section><span>02</span><div><h3>Build six different engines.</h3><p>All six sockets are available. New weapon cards fill them; duplicates strengthen existing weapons. Global cards affect all eligible weapons. Infusions combine on the weapon you choose.</p></div></section><section><span>03</span><div><h3>Choose, don’t collect everything.</h3><p>Choose a card every two waves. Shops appear every ten. Scarce scrap makes repair, power, and a future purchase compete with one another.</p></div></section><section><span>04</span><div><h3>Defense is part of your arsenal.</h3><p>Thorns, reflected damage, barrier breaks, and retaliation can fuel a build. The codex explains every card and the requirements for 40 special interactions.</p></div></section><section><span>05</span><div><h3>Keep the field in view.</h3><p>Drag, resize, dock, or minimize windows. Information windows leave combat live. Choices pause by default; toggle that off to keep playing while you decide.</p></div></section></div><button id="finish-help" class="gold-button full">Keep the light alive ${glyph('arrow')}</button>`,
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
  if (!data.profile.clears.includes(s.stage)) data.profile.clears.push(s.stage);
  data.profile.stageUnlocked = Math.max(data.profile.stageUnlocked, Math.min(3, s.stage + 2));
  data.profile.difficultyUnlocked = Math.max(
    data.profile.difficultyUnlocked,
    Math.min(5, s.difficulty + 1),
  );
}
function openVictory() {
  const s = data.run;
  if (!s) return;
  recordClear();
  manager.open(
    'victory',
    {
      title: 'The light endures.',
      subtitle: `${STAGES[s.stage].name.toUpperCase()} · 100 WAVES CLEARED`,
      width: 590,
      height: 590,
      choice: true,
    },
    `<div class="victory-mark">${glyph('tower')}</div><p class="lead">The guardian has fallen. Your stage clear is secured. Extract with your rewards, or carry this machine into the endless dark.</p><div class="result-stats"><div><b>${s.kills.toLocaleString()}</b><span>Enemies defeated</span></div><div><b>${Math.floor(isV2(s) ? rewardForRun(s) : creditReward(s))}</b><span>Projected credits</span></div></div><div class="result-actions"><button id="extract-btn" class="outline-button">Extract & collect</button><button id="endless-btn" class="gold-button">Enter endless ${glyph('arrow')}</button></div>`,
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
function openRetire() {
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
  $('cancel-retire').onclick = () => manager.close('retire');
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
  const synergies = isV2(s)
    ? SYNERGIES.filter((y) => s.synergies.includes(y.id)).map((y) => y.name)
    : s.synergies;
  manager.open(
    'results',
    {
      title: s.cleared ? 'A legend, forged.' : 'Every ending leaves a spark.',
      subtitle: `EXPEDITION COMPLETE · WAVE ${s.wave}${s.endless ? ' · ENDLESS' : ''}`,
      width: 660,
      height: 650,
      choice: true,
    },
    `<div class="result-stats"><div><b>${s.wave}</b><span>Wave reached</span></div><div><b>${s.kills.toLocaleString()}</b><span>Defeated</span></div><div><b>+${isV2(s) ? rewardForRun(s) : s.earned}</b><span>${s.settled ? (storageFailed ? 'Credits kept in memory' : 'Credits secured') : 'Securing credits…'}</span></div></div><p class="lead">${synergies.length ? `Your awakened machinery: ${esc(synergies.join(' · '))}.` : 'A focused build, a defensive reaction, or a different weapon may change the next expedition.'}</p>${isV2(s) ? `<div class="ledger-grid"><div><small>Shop purchases</small><b>${s.stats.shopPurchases}</b></div><div><small>Scrap spent</small><b>${s.stats.spent}</b></div><div><small>Combat time</small><b>${Math.floor(s.time / 60)}m ${Math.floor(s.time % 60)}s</b></div><div><small>Synergies</small><b>${s.synergies.length}</b></div></div>` : ''}<p class="notice">${s.cleared ? 'Your stage and Ascension progress are unlocked.' : 'Credits can awaken another tower or improve your permanent runes.'}${storageFailed ? ' Export a backup before closing this tab.' : ''}</p>${nextTower ? `<p class="notice">Next awakening: ${nextTower.name} · ${nextTower.cost} credits. ${availableCredits >= nextTower.cost ? 'You can awaken it in the hangar.' : `${nextTower.cost - availableCredits} credits to go.`}</p>` : ''}<div class="result-actions"><button id="result-ledger" class="outline-button">Damage ledger</button><button id="result-export" class="outline-button">Export save</button><button id="return-spire" class="gold-button">Return to the spire ${glyph('arrow')}</button></div>`,
  );
  $('result-export').onclick = downloadCurrent;
  $('result-ledger').onclick = openStats;
  $('return-spire').onclick = async () => {
    const button = $<HTMLButtonElement>('return-spire');
    button.disabled = true;
    button.textContent = 'Securing rewards…';
    try {
      await settle();
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
      download(JSON.stringify(await readRawSave(), null, 2), 'last-spire-recovery.json');
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
  if (!s || paused || manager.choicesPause() || s.phase !== 'combat') return;
  const success = isV2(s) ? useSkill(s, which) : legacySkill(s, which);
  if (success) {
    sound(which === 'signature' ? 590 : 440);
    updateHud();
  }
}
$('menu-btn').onclick = openMenu;
$('settings-btn').onclick = openSettings;
$('arsenal-btn').onclick = openArsenal;
$('codex-btn').onclick = () => openCodex();
$('stats-btn').onclick = openStats;
$('rewards-btn').onclick = () => showRewards();
$('pause-btn').onclick = togglePause;
$('pause-indicator').onclick = () => {
  if (paused) togglePause();
  else if (manager.visible('rewards')) manager.close('rewards');
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
  if (key === 'c') manager.visible('codex') ? manager.close('codex') : openCodex();
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
document.addEventListener('visibilitychange', () => {
  if (document.hidden && playing) {
    paused = true;
    void persist();
    updateHud();
  }
});
window.addEventListener('pagehide', () => void persist());
let last = 0,
  accumulator = 0,
  hudTimer = 0,
  saveTimer = 0,
  perfTime = 0,
  frames = 0,
  drawCost = 0;
function frame(now: number) {
  const delta = Math.min(0.12, Math.max(0, (now - last) / 1000 || 0));
  last = now;
  const s = current();
  if (playing && !paused && !manager.choicesPause() && s.phase === 'combat') {
    accumulator += delta * data.settings.speed;
    while (accumulator >= TICK) {
      if (isV2(s)) step(s, TICK);
      else legacyStep(s, TICK);
      accumulator -= TICK;
      if (s.phase !== 'combat') break;
    }
  } else accumulator = 0;
  const before = performance.now();
  renderer.draw(s, data.settings);
  drawCost += performance.now() - before;
  frames++;
  perfTime += delta;
  if (perfTime >= 1) {
    $('arena').dataset.fps = String(Math.round(frames / perfTime));
    $('arena').dataset.renderMs = (drawCost / frames).toFixed(2);
    $('arena').dataset.enemies = String(s.enemies.length);
    $('arena').dataset.projectiles = String(s.projectiles.length);
    perfTime = 0;
    frames = 0;
    drawCost = 0;
  }
  hudTimer += delta;
  saveTimer += delta;
  if (hudTimer > 0.16) {
    hudTimer = 0;
    updateHud();
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
          manager.close('rewards');
          openVictory();
        }
        if (s.phase === 'ended') {
          manager.close('rewards');
          manager.close('victory');
          openResults();
        }
        scheduleSave();
      }
      const rewardId = isV2(s)
        ? (s.pendingRewards[0]?.id ?? '')
        : s.phase === 'draft' || s.phase === 'shop'
          ? `legacy-${s.wave}-${s.phase}`
          : '';
      if (rewardId && rewardId !== lastRewardId && s.phase !== 'victory' && s.phase !== 'ended') {
        lastRewardId = rewardId;
        showRewards(rewardId);
        sound(680);
      }
      if (s.notices.length && now >= nextNoticeAt) {
        nextNoticeAt = now + 2400;
        const message = s.notices.shift()!;
        notify(message);
        if (/evol|synerg|awaken/i.test(message)) sound(780);
      }
    }
  }
  if (saveTimer > 5) {
    saveTimer = 0;
    if (playing && !settlePromise) void persist();
  }
  requestAnimationFrame(frame);
}
async function init() {
  let recovery = '';
  try {
    data = await loadGame();
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
  chosenTower = data.run?.tower ?? data.profile.unlocked[0] ?? 'bastion';
  chosenStage = data.run?.stage ?? 0;
  chosenDifficulty = data.run?.difficulty ?? 0;
  playing = !!data.run;
  paused = playing && data.run?.phase === 'combat';
  makePreview();
  applySettings();
  loading = false;
  $('loading-screen').remove();
  updateHud();
  if (recovery) openRecovery(recovery);
  else if (!playing) openLaunch();
  else if (data.run?.phase === 'victory') openVictory();
  else if (data.run?.phase === 'ended') openResults();
  else if (data.run?.version === 1 && ['draft', 'shop'].includes(data.run.phase)) {
    paused = false;
    showLegacyRewards(data.run);
  } else notify('Expedition restored. Press Space or tap play when you’re ready.');
  requestAnimationFrame(frame);
}
void init();
