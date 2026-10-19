import { TOWERS } from '../content/catalog';
import { STAGES } from '../content/world';
import { difficultyName } from '../game/stage-progress';
import type { RunMode } from '../game/types';
import type { RuneId } from '../game/controls';
import type { TowerId } from '../model/shared';
import type { SaveV3 } from '../persistence/storage';

const esc = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

export interface LaunchState {
  save: SaveV3;
  tower: TowerId;
  stage: number;
  difficulty: number;
  mode: RunMode;
  playing: boolean;
}

export function towerPortrait(id: TowerId, color: string): string {
  const silhouettes: Record<TowerId, string> = {
    bastion: 'M12 52V24h6V14h8v10h12V14h8v10h6v28ZM22 52V36h20v16',
    pyre: 'M14 52V26h10V12h16v14h10v26ZM25 12V5h14v7M22 34h20v12H22Z',
    tempest: 'M18 52V28h10V16h8v12h10v24M10 30V10m44 20V10M7 10h6m38 0h6M32 16V5',
    glacier: 'M12 52 20 22 32 8l12 14 8 30ZM20 22l12 7 12-7M32 29v23',
    verdant: 'M23 52V27l9-13 9 13v25M23 32 9 22V12m32 20 14-10V12M23 43 10 49m31-6 13 6',
    null: 'M23 52V17l9-9 9 9v35M14 14a24 24 0 0 0 0 34m36-34a24 24 0 0 1 0 34',
    monolith: 'M18 52V16L32 5l14 11v36ZM23 19l9-7 9 7-9 18Z',
  };
  return `<svg class="tower-mark" viewBox="0 0 64 64" aria-hidden="true"><path d="M7 56h50M13 60h38" fill="none" stroke="#887653" stroke-width="3"/><path d="${silhouettes[id]}" fill="#29382e" stroke="#bba16c" stroke-width="2" stroke-linejoin="round"/><path d="m32 25 6 8-6 8-6-8Z" fill="${color}" stroke="#e6d8a2" stroke-width="1.5"/></svg>`;
}

export function launchMarkup(
  state: LaunchState,
  runeMarkup: string,
  runeNames: Record<RuneId, string>,
): string {
  const { save, playing, tower, stage, difficulty, mode } = state;
  const stageProgress = save.progression.stages[stage];
  const selected = TOWERS.find((t) => t.id === tower) ?? TOWERS[0];
  const active =
    playing && save.progression.active?.runId === save.run?.id ? save.progression.active : null;
  const runes = active?.runes ?? save.progression.runes.selected;
  const equipped = (Object.keys(runeNames) as RuneId[]).filter((id) => runes[id] > 0);
  const disabled = playing ? 'disabled' : '';
  const phase = playing ? save.run?.phase : undefined;
  const action =
    phase === 'ended'
      ? 'Collect rewards'
      : phase === 'victory'
        ? 'Review victory'
        : 'Resume expedition';
  return `<div class="launch-panel"><div class="launch-scroll"><div class="launch-intro"><p class="lead">Choose a heart. Forge your expedition.</p><span class="launch-credit">${save.profile.credits.toLocaleString()} credits</span></div>
    <section aria-label="Choose tower"><div class="launch-section-heading"><h3>Your spire</h3><small>${playing ? 'Run loadout locked' : 'Seven engines · one starting core'}</small></div><div class="launch-towers">${TOWERS.map(
      (t) => {
        const unlocked = save.profile.unlocked.includes(t.id);
        const unavailable = playing || (!unlocked && save.profile.credits < t.cost);
        return `<button data-launch-tower="${t.id}" class="launch-tower-option ${t.id === tower ? 'selected' : ''} ${unlocked ? '' : 'locked'}" aria-pressed="${t.id === tower}" aria-label="${unlocked ? `Select ${t.name}` : `Awaken ${t.name} for ${t.cost} credits`}" ${unavailable ? 'disabled' : ''} style="--accent:${t.color}">${towerPortrait(t.id, t.color)}<b>${t.name}</b><small>${t.id === tower ? 'Selected' : unlocked ? 'Available' : `${t.cost} credits`}</small></button>`;
      },
    ).join(
      '',
    )}</div><div class="launch-core" style="--accent:${selected.color}">${towerPortrait(selected.id, selected.color)}<div><h3>${selected.name} <small>${selected.subtitle}</small></h3><p>${esc(selected.id === 'tempest' ? 'Lightning chains jump to three nearby enemies.' : selected.passive)}</p><p><strong>${esc(selected.skill)}</strong> · ${esc(selected.skillDescription)}</p></div></div></section>
    <section class="launch-options" aria-label="Expedition settings"><label class="control-label">Run mode<select id="mode-select" ${disabled}><option value="quick" ${mode === 'quick' ? 'selected' : ''}>Quick · 50 waves · 15–20 min</option><option value="normal" ${mode === 'normal' ? 'selected' : ''}>Normal · 100 waves · 30–45 min</option><option value="endless" ${mode === 'endless' ? 'selected' : ''}>Endless · until defeat or retirement</option></select></label><label class="control-label">Stage<select id="stage-select" ${disabled}>${STAGES.map((s) => `<option value="${s.id}" ${stage === s.id ? 'selected' : ''} ${s.id >= save.profile.stageUnlocked ? 'disabled' : ''}>${s.name}${s.id >= save.profile.stageUnlocked ? ' · Locked' : ''}</option>`).join('')}</select></label><label class="control-label">Difficulty<select id="difficulty-select" ${disabled}>${Array.from({ length: 6 }, (_, i) => `<option value="${i}" ${i === difficulty ? 'selected' : ''} ${i > stageProgress.unlockedDifficulty ? 'disabled' : ''}>${i === 0 ? 'Normal' : `Ascension ${i}`}${i > stageProgress.unlockedDifficulty ? ' · Locked' : ''}</option>`).join('')}</select></label></section>
    <section class="stage-progress" aria-label="Stage completion records"><div class="launch-section-heading"><h3>${STAGES[stage].name} records</h3><small>Difficulty unlocks belong to this stage</small></div><div class="difficulty-records">${Array.from({ length: 6 }, (_, d) => `<span class="difficulty-record ${stageProgress.clearedDifficulties.includes(d) ? 'cleared' : d <= stageProgress.unlockedDifficulty ? 'available' : 'locked'}"><b>${difficultyName(d)}</b><small>${stageProgress.clearedDifficulties.includes(d) ? 'Cleared' : d <= stageProgress.unlockedDifficulty ? 'Unlocked' : 'Locked'}</small></span>`).join('')}</div><p class="quiet">${stageProgress.legacyClear ? 'Previous stage clear preserved; only recorded difficulty clears are marked above. ' : ''}Clear this stage to unlock its next Ascension. Newly opened stages begin at Normal.</p><details class="stage-record-details"><summary>All stage records</summary>${STAGES.map((s) => `<p><strong>${s.name}</strong> · ${s.id >= save.profile.stageUnlocked ? 'Stage locked' : `Access through ${difficultyName(save.progression.stages[s.id].unlockedDifficulty)}`} · ${save.progression.stages[s.id].clearedDifficulties.length ? `Cleared: ${save.progression.stages[s.id].clearedDifficulties.map(difficultyName).join(', ')}` : save.progression.stages[s.id].legacyClear ? 'Legacy stage clear' : 'No recorded clears'}</p>`).join('')}</details></section>
    <section aria-label="Equipped permanent runes"><div class="launch-section-heading"><h3>Equipped runes</h3><small>Purchased levels ≠ selected levels</small></div><div class="launch-rune-summary">${equipped.length ? equipped.map((id) => `<span>${esc(runeNames[id])} <b>${runes[id]}</b></span>`).join('') : '<p>No runes equipped. Permanent upgrades are optional.</p>'}</div><details class="launch-runes"><summary>Manage permanent runes <span>Purchase & equip</span></summary><p>Buying raises ownership. Select any purchased level freely before a run. ${playing ? 'This expedition keeps its original loadout.' : 'Only the selected levels apply to your next expedition.'}</p>${runeMarkup}</details></section>
    </div><footer class="launch-start"><div><strong>${playing ? `Wave ${save.run?.wave} · ${STAGES[stage]?.name ?? 'Expedition'}` : mode === 'endless' ? 'Endless expedition' : `${mode === 'quick' ? 50 : 100} waves`}</strong><small>${playing ? 'Resume your saved build, or retire before starting over.' : 'XP upgrades · milestone shops · autosaved'}</small></div><div class="launch-actions">${playing ? '<button id="launch-retire" class="outline-button">Retire expedition</button>' : ''}<button id="${playing ? 'resume-btn' : 'begin-btn'}" class="gold-button">${playing ? action : 'Start expedition'} <span aria-hidden="true">▷</span></button></div></footer></div>`;
}
