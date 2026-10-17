import type { RunV2, WeaponInstance } from '../v2/types';
import { CARDS, CARD_BY_ID, WEAPON_BY_ID, SYNERGIES, rarityLabel } from './catalog';
import { activeSynergies, getWeaponStats } from './engine';
import { cardIcon } from './icons';
import './inspector.css';

export type EntityRef = { kind: 'weapon' | 'card' | 'synergy'; id: string };
type EquipmentMetadata = {
  masteryRank?: number;
  masteryProgress?: number;
  masteryRequired?: number;
  fusionReady?: boolean;
  name?: string;
  description?: string;
  iconId?: string;
  kind?: string;
};
type InspectableWeapon = WeaponInstance & EquipmentMetadata;
export interface EntitySummary {
  title: string;
  body: string;
  refs: EntityRef[];
}
const escapeHTML = (value: unknown) =>
  String(value).replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
  );
const number = (value: number, digits = 1) =>
  Number.isFinite(value) ? value.toFixed(digits).replace(/\.0$/, '') : '—';
const equipment = (s: RunV2, id: string) =>
  s.weapons.find((w) => w.id === id) as InspectableWeapon | undefined;
const definition = (w: InspectableWeapon) => WEAPON_BY_ID[w.kind];
const weaponName = (w: InspectableWeapon) => w.name || definition(w)?.name || w.kind;
const masteryLabel = (w: InspectableWeapon) =>
  w.masteryRank !== undefined
    ? `Mastery ${Math.min(6, w.masteryRank)}/6`
    : `Investment rank ${w.mastery}`;
const progress = (w: InspectableWeapon) =>
  w.masteryRank === 6
    ? 1
    : w.masteryRequired
      ? Math.max(0, Math.min(1, (w.masteryProgress || 0) / w.masteryRequired))
      : Math.max(
          0,
          Math.min(1, (w.masteryRank ?? w.mastery) / (w.masteryRank !== undefined ? 6 : 24)),
        );
const scopeName = (scope: string) =>
  ({
    projectiles: 'All projectiles',
    defense: 'Tower defense',
    weapon: 'Chosen core',
    tower: 'Tower',
    skill: 'Skills',
  })[scope] || scope;

function requirementRefs(requirements: string[]): EntityRef[] {
  const refs = new Map<string, EntityRef>();
  for (const requirement of requirements) {
    const card =
      CARD_BY_ID[requirement] ||
      CARDS.find(
        (c) =>
          c.effect === requirement ||
          c.tags.includes(requirement) ||
          (requirement.startsWith('weapon:') && c.weapon === requirement.slice(7)) ||
          (requirement.startsWith('element:') && c.element === requirement.slice(8)),
      );
    if (card) refs.set(card.id, { kind: 'card', id: card.id });
  }
  return [...refs.values()];
}

export function entitySummary(s: RunV2, ref: EntityRef): EntitySummary {
  if (ref.kind === 'weapon') {
    const w = equipment(s, ref.id);
    if (!w)
      return {
        title: 'Empty arsenal socket',
        body: 'Acquire an arsenal core through an upgrade. Support cards do not occupy a socket.',
        refs: [],
      };
    const d = definition(w);
    const refs: EntityRef[] = CARDS.filter((c) => c.weapon === w.kind).map((c) => ({
      kind: 'card',
      id: c.id,
    }));
    w.infusions.forEach((element) => {
      const c = CARDS.find((c) => c.element === element);
      if (c) refs.push({ kind: 'card', id: c.id });
    });
    let effective = '';
    if (d) {
      const stats = getWeaponStats(s, w);
      effective = ` ${number(stats.damage)} damage · ${number(stats.cooldown, 2)}s interval · ${number(stats.range, 0)} range · ${stats.count} projectiles.`;
    }
    return {
      title: weaponName(w),
      body: `${rarityLabel(w.rarity)} · ${masteryLabel(w)}. ${w.description || d?.description || 'Equipped arsenal core.'}${effective}${w.infusions.length ? ` Infusions: ${w.infusions.join(', ')}.` : ''}${w.fusionReady ? ' Fusion ready—inspect the arsenal to combine mastered ingredients.' : ''}`,
      refs,
    };
  }
  if (ref.kind === 'card') {
    const c = CARD_BY_ID[ref.id];
    if (!c)
      return {
        title: 'Unknown inscription',
        body: 'This card is unavailable in the current catalog.',
        refs: [],
      };
    const owned = s.cards.filter((stack) => stack.cardId === c.id);
    const refs: EntityRef[] = owned.flatMap((stack) =>
      stack.targetId && equipment(s, stack.targetId)
        ? [{ kind: 'weapon' as const, id: stack.targetId }]
        : [],
    );
    const ownership = owned.length
      ? owned
          .map(
            (stack) =>
              `${stack.stacks} ${stack.stacks === 1 ? 'pick' : 'picks'} · ${rarityLabel(stack.rarity)}${stack.targetId ? ` on ${equipment(s, stack.targetId) ? weaponName(equipment(s, stack.targetId)!) : 'an earlier core'}` : ''} · investment ${stack.mastery}`,
          )
          .join('; ')
      : 'Not collected';
    const related = SYNERGIES.filter((y) =>
      y.requires.some(
        (requirement) =>
          requirement === c.id ||
          requirement === c.effect ||
          c.tags.includes(requirement) ||
          requirement === `weapon:${c.weapon}` ||
          requirement === `element:${c.element}`,
      ),
    );
    refs.push(...related.map((y) => ({ kind: 'synergy' as const, id: y.id })));
    return {
      title: c.name,
      body: `${scopeName(c.scope)} · ${ownership}. ${c.description} Family cap: ${c.maxStacks} picks.`,
      refs,
    };
  }
  const y = SYNERGIES.find((y) => y.id === ref.id);
  if (!y)
    return {
      title: 'Unknown convergence',
      body: 'This synergy is unavailable in the current catalog.',
      refs: [],
    };
  const refs = requirementRefs(y.requires);
  const prerequisites = y.requires
    .map(
      (requirement) =>
        CARD_BY_ID[requirement]?.name ||
        CARDS.find((c) => c.effect === requirement)?.name ||
        requirement.replace(/^(weapon|element|tower)[:\-]/, '').replaceAll('-', ' '),
    )
    .join(' + ');
  return {
    title: y.name,
    body: `${activeSynergies(s).includes(y.id) ? 'ACTIVE' : 'Not active'} · ${y.description} Requires ${prerequisites}. Trigger chains remain bounded by combat proc limits.`,
    refs,
  };
}

function refTitle(s: RunV2, ref: EntityRef) {
  return entitySummary(s, ref).title;
}
function iconFor(s: RunV2, ref: EntityRef, size = 32): string {
  if (ref.kind === 'weapon') {
    const w = equipment(s, ref.id);
    return cardIcon(
      w?.iconId || CARDS.find((c) => c.weapon === w?.kind)?.iconId || 'unknown',
      size,
    );
  }
  if (ref.kind === 'card') return cardIcon(CARD_BY_ID[ref.id]?.iconId || 'unknown', size);
  const y = SYNERGIES.find((y) => y.id === ref.id);
  const ingredient = y ? requirementRefs(y.requires)[0] : undefined;
  return `<span class="build-convergence-icon" aria-hidden="true">${ingredient ? iconFor(s, ingredient, size) : '✧'}<span>✦</span></span>`;
}
function entityAttributes(ref: EntityRef) {
  return `data-entity-kind="${ref.kind}" data-entity-id="${escapeHTML(ref.id)}"`;
}

/** HTML for an existing movable window. Delegate clicks on data-entity-kind/id. */
export function entityMarkup(s: RunV2, ref: EntityRef): string {
  const summary = entitySummary(s, ref);
  const refs = summary.refs.filter(
    (r, index, all) =>
      all.findIndex((other) => other.kind === r.kind && other.id === r.id) === index,
  );
  return `<article class="build-detail"><header>${iconFor(s, ref, 64)}<h3>${escapeHTML(summary.title)}</h3></header><p>${escapeHTML(summary.body)}</p>${
    refs.length
      ? `<h4>Connected inscriptions</h4><div class="build-references">${refs
          .map((link) => {
            const related = entitySummary(s, link);
            return `<button type="button" class="build-reference" ${entityAttributes(link)} title="${escapeHTML(related.body)}">${iconFor(s, link, 24)}<span>${escapeHTML(related.title)}</span></button>`;
          })
          .join('')}</div>`
      : ''
  }</article>`;
}

export class BuildInspector {
  private root: HTMLElement;
  private tooltip: HTMLElement;
  private signature = '';
  private hovered: HTMLElement | null = null;
  private resizeHandler = () => this.positionTooltip();
  private keyHandler = (event: KeyboardEvent) => {
    if (event.key === 'Escape') this.hideTooltip();
  };

  constructor(
    private options: {
      host: HTMLElement;
      getRun: () => RunV2 | null;
      onOpen: (ref: EntityRef) => void;
    },
  ) {
    this.root = document.createElement('aside');
    this.root.className = 'build-inspector';
    this.root.setAttribute('aria-label', 'Collected build');
    this.tooltip = document.createElement('div');
    this.tooltip.id = `build-tooltip-${Math.random().toString(36).slice(2, 10)}`;
    this.tooltip.className = 'build-tooltip';
    this.tooltip.role = 'tooltip';
    this.tooltip.hidden = true;
    options.host.append(this.root);
    document.body.append(this.tooltip);
    this.root.addEventListener('click', this.onClick);
    document.addEventListener('pointerover', this.onShow);
    document.addEventListener('focusin', this.onShow);
    document.addEventListener('pointerout', this.onLeave);
    document.addEventListener('focusout', this.onLeave);
    window.addEventListener('resize', this.resizeHandler);
    window.addEventListener('scroll', this.resizeHandler, true);
    document.addEventListener('keydown', this.keyHandler);
    this.update();
  }

  update() {
    const s = this.options.getRun();
    this.root.hidden = !s;
    if (!s) {
      this.signature = '';
      this.hideTooltip();
      return;
    }
    const synergies = activeSynergies(s);
    const next = JSON.stringify([
      s.weapons.map((w) => [
        w.id,
        w.kind,
        w.mastery,
        w.rarity,
        w.infusions,
        (w as InspectableWeapon).masteryRank,
        (w as InspectableWeapon).masteryProgress,
        (w as InspectableWeapon).masteryRequired,
        (w as InspectableWeapon).fusionReady,
      ]),
      s.cards,
      synergies,
    ]);
    if (next === this.signature) return;
    const firstRender = !this.signature;
    this.signature = next;
    const active =
      document.activeElement instanceof HTMLElement && this.root.contains(document.activeElement)
        ? document.activeElement.dataset
        : null;
    const expanded =
      firstRender && window.innerWidth >= 1000
        ? ['card', 'synergy']
        : [...this.root.querySelectorAll<HTMLDetailsElement>('details[open]')].map(
            (el) => el.dataset.buildCollection,
          );
    const cards = [
      ...new Set(
        s.cards
          .filter((stack) => CARD_BY_ID[stack.cardId]?.group !== 'weapon')
          .map((stack) => stack.cardId),
      ),
    ];
    const equipmentButtons = Array.from({ length: 6 }, (_, index) => {
      const w = s.weapons[index] as InspectableWeapon | undefined;
      if (!w)
        return `<span class="build-socket build-empty" aria-label="Arsenal socket ${index + 1}, empty"><span>${index + 1}</span><small>Empty</small></span>`;
      const ref: EntityRef = { kind: 'weapon', id: w.id };
      return `<button type="button" class="build-socket build-${w.rarity}${w.fusionReady ? ' build-fusion-ready' : ''}" ${entityAttributes(ref)} aria-label="Socket ${index + 1}: ${escapeHTML(weaponName(w))}, ${escapeHTML(masteryLabel(w))}${w.fusionReady ? ', fusion ready' : ''}">${iconFor(s, ref)}<span class="build-rank">${w.masteryRank !== undefined ? `M${Math.min(6, w.masteryRank)}` : w.mastery}</span><span class="build-mastery" aria-hidden="true"><i style="width:${progress(w) * 100}%"></i></span>${w.fusionReady ? '<span class="build-ready" aria-hidden="true">✦</span>' : ''}</button>`;
    }).join('');
    const collection = (kind: 'card' | 'synergy', ids: string[], label: string) =>
      `<details class="build-collection" data-build-collection="${kind}"${expanded.includes(kind) && ids.length ? ' open' : ''}><summary><span>${label}</span><b>${ids.length}</b><span class="build-expand" aria-hidden="true">⌄</span></summary><div class="build-collection-items" role="group" aria-label="${label}">${
        ids.length
          ? ids
              .map((id) => {
                const ref: EntityRef = { kind, id };
                const count =
                  kind === 'card'
                    ? s.cards.filter((c) => c.cardId === id).reduce((sum, c) => sum + c.stacks, 0)
                    : 0;
                return `<button type="button" class="build-token" ${entityAttributes(ref)} aria-label="${escapeHTML(refTitle(s, ref))}${count > 1 ? `, ${count} picks` : ''}">${iconFor(s, ref, 28)}${count > 1 ? `<span class="build-count">${count}</span>` : ''}</button>`;
              })
              .join('')
          : '<p class="build-collection-empty">None collected yet</p>'
      }</div></details>`;
    this.root.innerHTML = `<section class="build-rack" aria-label="Six arsenal sockets"><h2>Arsenal <span>${s.weapons.length}/6</span></h2><div class="build-sockets">${equipmentButtons}</div></section><div class="build-collections">${collection('card', cards, 'Cards')}${collection('synergy', synergies, 'Synergies')}</div>`;
    this.hideTooltip();
    if (active?.entityKind && active.entityId)
      [...this.root.querySelectorAll<HTMLElement>('[data-entity-kind]')]
        .find(
          (el) =>
            el.dataset.entityKind === active.entityKind && el.dataset.entityId === active.entityId,
        )
        ?.focus({ preventScroll: true });
  }

  private readRef(target: EventTarget | null): { element: HTMLElement; ref: EntityRef } | null {
    const element =
      target instanceof Element
        ? target.closest<HTMLElement>('[data-entity-kind][data-entity-id]')
        : null;
    const kind = element?.dataset.entityKind;
    return element &&
      (this.root.contains(element) || element.closest('.build-detail')) &&
      (kind === 'weapon' || kind === 'card' || kind === 'synergy') &&
      element.dataset.entityId
      ? { element, ref: { kind, id: element.dataset.entityId } }
      : null;
  }
  private onClick = (event: Event) => {
    const hit = this.readRef(event.target);
    if (hit) {
      this.hideTooltip();
      this.options.onOpen(hit.ref);
    }
  };
  private onShow = (event: Event) => {
    const hit = this.readRef(event.target),
      s = this.options.getRun();
    if (!hit || !s || this.hovered === hit.element) return;
    this.hideTooltip();
    this.hovered = hit.element;
    const summary = entitySummary(s, hit.ref);
    const title = document.createElement('strong'),
      body = document.createElement('p');
    title.textContent = summary.title;
    body.textContent = summary.body;
    this.tooltip.replaceChildren(title, body);
    this.tooltip.hidden = false;
    hit.element.setAttribute('aria-describedby', this.tooltip.id);
    this.positionTooltip();
  };
  private onLeave = (event: Event) => {
    const hit = this.readRef(event.target);
    if (!hit) return;
    const related = (event as FocusEvent | PointerEvent).relatedTarget;
    if (!(related instanceof Node) || !hit.element.contains(related)) this.hideTooltip();
  };
  private positionTooltip() {
    if (!this.hovered || this.tooltip.hidden) return;
    const anchor = this.hovered.getBoundingClientRect(),
      tip = this.tooltip.getBoundingClientRect(),
      margin = 10;
    this.tooltip.style.left = `${Math.max(margin, Math.min(window.innerWidth - tip.width - margin, anchor.left))}px`;
    this.tooltip.style.top = `${Math.max(margin, Math.min(window.innerHeight - tip.height - margin, anchor.top > tip.height + margin ? anchor.top - tip.height - margin : anchor.bottom + margin))}px`;
  }
  private hideTooltip() {
    this.hovered?.removeAttribute('aria-describedby');
    this.hovered = null;
    this.tooltip.hidden = true;
  }
  destroy() {
    this.hideTooltip();
    window.removeEventListener('resize', this.resizeHandler);
    window.removeEventListener('scroll', this.resizeHandler, true);
    document.removeEventListener('keydown', this.keyHandler);
    document.removeEventListener('pointerover', this.onShow);
    document.removeEventListener('focusin', this.onShow);
    document.removeEventListener('pointerout', this.onLeave);
    document.removeEventListener('focusout', this.onLeave);
    this.root.remove();
    this.tooltip.remove();
  }
}
