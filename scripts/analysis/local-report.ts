import { CARD_BY_ID, FUSION_BY_ID, TOWERS, WEAPON_BY_ID } from '../../src/content/catalog';
import { RUNE_IDS } from '../../src/game/controls';
import { EVOLUTION_BY_ID } from '../../src/content/evolutions';
import { mean, wilson } from './balance-report';

type ObjectValue = Record<string, unknown>;
const object = (x: unknown): ObjectValue =>
  x && typeof x === 'object' && !Array.isArray(x) ? (x as ObjectValue) : {};
const finite = (x: unknown): x is number =>
  typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 1e15;
const array = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
const build = (x: unknown): string =>
  typeof x === 'string' &&
  x.length <= 80 &&
  /^(?:[a-f0-9]{40}|\d+\.\d+\.\d+(?:-(?:test|dev))?|development)$/.test(x)
    ? x
    : 'unknown';
const contentId = (x: unknown, catalog: object): x is string =>
  typeof x === 'string' && Object.hasOwn(catalog, x);
interface CardCount {
  cardId: string;
  draftOffered: number;
  draftChosen: number;
  shopOffered: number;
  shopPurchased: number;
  unmatchedSelections: number;
}
interface Group {
  key: string;
  runs: number;
  completed: number;
  unfinished: number;
  knownFiniteOutcomes: number;
  finiteClears: number;
  campaignClears: number;
  droppedEvents: number;
  droppedSamples: number;
  fusionCounts: Record<string, number>;
  damageByCore: Record<string, number>;
  renderMs: number[];
  simulationMs: number[];
  frameP95Ms: number[];
  catchup: number[];
  finishedSeconds: number[];
  waveReached: number[];
  legacyPerfSamples: number;
  foregroundSamples: number;
  shopSpend: number;
  repairSpend: number;
  cardCounts: Record<string, CardCount>;
}
/** Whitelist aggregation: no run/account IDs, timestamps, names, paths, or free text are returned. */
export function analyzeLocalExport(input: unknown) {
  const root = object(input);
  if (
    root.version !== 1 ||
    !Array.isArray(root.runs) ||
    root.runs.length > 30 ||
    root.unavailable === true
  )
    throw new Error('Unsupported or unavailable local gameplay export.');
  const buckets = new Map<string, Group>();
  let excluded = 0;
  for (const raw of root.runs) {
    const run = object(raw);
    if (
      run.version !== 1 ||
      !TOWERS.some((t) => t.id === run.tower) ||
      ![0, 1, 2].includes(run.stage as number) ||
      !Number.isSafeInteger(run.difficulty) ||
      (run.difficulty as number) < 0 ||
      (run.difficulty as number) > 10 ||
      !['normal', 'quick', 'endless', 'legacy'].includes(run.mode as string) ||
      typeof run.completed !== 'boolean' ||
      !Array.isArray(run.events) ||
      run.events.length > 5000 ||
      !Array.isArray(run.samples) ||
      run.samples.length > 1000
    ) {
      excluded++;
      continue;
    }
    const events = run.events.map(object);
    const samples = run.samples.map(object);
    const snapshots = [
      ...events
        .filter((e) => ['begin', 'resume'].includes(e.type as string))
        .map((e) => object(object(e.data).state)),
      ...samples.map((s) => object(s.data)),
      object(run.outcome),
    ];
    const states = snapshots.filter((s) => Object.keys(s).length);
    const latest = Object.keys(object(run.outcome)).length
      ? object(run.outcome)
      : object(samples.at(-1)?.data);
    const rule = object(states.find((s) => s.rules)?.rules);
    const ruleTag = ['combat', 'arsenal', 'encounters', 'shops', 'evolution']
      .map((k) =>
        Number.isSafeInteger(rule[k]) && (rule[k] as number) >= 0 && (rule[k] as number) <= 3
          ? rule[k]
          : '?',
      )
      .join('.');
    const builds = [
      ...new Set([
        build(run.build),
        ...events.filter((e) => e.type === 'resume').map((e) => build(object(e.data).clientBuild)),
      ]),
    ].sort();
    const runes = object(run.runes);
    const runeTag = RUNE_IDS.map((key) =>
      Number.isSafeInteger(runes[key]) &&
      (runes[key] as number) >= 0 &&
      (runes[key] as number) <= 1000
        ? runes[key]
        : '?',
    ).join('.');
    const edition =
      typeof rule.balanceEdition === 'string' &&
      /^(?:spire-e\d{1,4}|unranked)$/.test(rule.balanceEdition)
        ? rule.balanceEdition
        : 'unknown';
    const pathId = object(latest.evolution).pathId;
    const path = contentId(pathId, EVOLUTION_BY_ID) ? pathId : 'unknown';
    const continuation =
      latest.endless === true ? 'endless' : latest.endless === false ? 'finite' : 'unknown';
    const key = [
      builds.join('+'),
      run.tower,
      run.stage,
      run.difficulty,
      run.mode,
      continuation,
      ruleTag,
      edition,
      path,
      runeTag,
    ].join('/');
    let group = buckets.get(key);
    if (!group) {
      group = {
        key,
        runs: 0,
        completed: 0,
        unfinished: 0,
        knownFiniteOutcomes: 0,
        finiteClears: 0,
        campaignClears: 0,
        droppedEvents: 0,
        droppedSamples: 0,
        fusionCounts: {},
        damageByCore: {},
        renderMs: [],
        simulationMs: [],
        frameP95Ms: [],
        catchup: [],
        finishedSeconds: [],
        waveReached: [],
        legacyPerfSamples: 0,
        foregroundSamples: 0,
        shopSpend: 0,
        repairSpend: 0,
        cardCounts: {},
      };
      buckets.set(key, group);
    }
    group.runs++;
    const complete =
      run.completed === true && ['ended', 'victory'].includes(latest.phase as string);
    group[complete ? 'completed' : 'unfinished']++;
    if (complete && typeof latest.cleared === 'boolean') {
      if (latest.cleared) group.campaignClears++;
      if (['normal', 'quick'].includes(run.mode as string)) {
        group.knownFiniteOutcomes++;
        if (latest.cleared) group.finiteClears++;
      }
    }
    group.droppedEvents += finite(run.droppedEvents) ? run.droppedEvents : 0;
    group.droppedSamples += finite(run.droppedSamples) ? run.droppedSamples : 0;
    if (finite(latest.wave)) group.waveReached.push(latest.wave);
    const finish = events.filter((e) => e.type === 'finish' && finite(e.at)).at(-1);
    if (complete && finish) group.finishedSeconds.push(finish.at as number);
    const coreKinds = new Map<string, string>();
    for (const state of [...states, ...events.map((e) => object(e.data))]) {
      for (const rawCore of array(state.equipment)) {
        const core = object(rawCore);
        if (
          typeof core.id === 'string' &&
          core.id.length <= 128 &&
          contentId(core.kind, WEAPON_BY_ID)
        )
          coreKinds.set(core.id, core.kind);
      }
    }
    for (const [id, damage] of Object.entries(object(latest.damageByWeapon))) {
      if (!finite(damage)) continue;
      const kind = coreKinds.get(id) ?? (['burn', 'poison'].includes(id) ? id : 'unattributed');
      group.damageByCore[kind] = (group.damageByCore[kind] ?? 0) + damage;
    }
    const card = (id: string) =>
      (group!.cardCounts[id] ??= {
        cardId: id,
        draftOffered: 0,
        draftChosen: 0,
        shopOffered: 0,
        shopPurchased: 0,
        unmatchedSelections: 0,
      });
    const seenOffers = new Set<string>(),
      seenChoices = new Set<string>();
    const offered = new Map<string, string>();
    for (const event of events) {
      const data = object(event.data);
      if (event.type === 'offers' && ['draft', 'shop'].includes(data.kind as string)) {
        for (const rawOffer of array(data.offers).slice(0, 10)) {
          const offer = object(rawOffer);
          if (
            typeof offer.id !== 'string' ||
            offer.id.length > 128 ||
            !contentId(offer.cardId, CARD_BY_ID)
          )
            continue;
          const id = `${data.kind}:${offer.id}`;
          if (seenOffers.has(id)) continue;
          seenOffers.add(id);
          offered.set(id, offer.cardId);
          card(offer.cardId)[data.kind === 'draft' ? 'draftOffered' : 'shopOffered']++;
        }
      }
      if (
        ['level-choice', 'shop-purchase'].includes(event.type as string) &&
        contentId(data.cardId, CARD_BY_ID) &&
        typeof data.offerId === 'string' &&
        data.offerId.length <= 128
      ) {
        const shop = event.type === 'shop-purchase',
          id = `${shop ? 'shop' : 'draft'}:${data.offerId}`;
        if (seenChoices.has(id)) continue;
        seenChoices.add(id);
        const c = card(data.cardId);
        c[shop ? 'shopPurchased' : 'draftChosen']++;
        if (offered.get(id) !== data.cardId) c.unmatchedSelections++;
        if (
          shop &&
          finite(data.scrapBefore) &&
          finite(data.scrapAfter) &&
          data.scrapBefore >= data.scrapAfter
        )
          group.shopSpend += data.scrapBefore - data.scrapAfter;
      }
      if (event.type === 'shop-repair' && finite(data.scrap)) group.repairSpend += data.scrap;
      if (event.type === 'fusion' && contentId(data.recipeId, FUSION_BY_ID))
        group.fusionCounts[data.recipeId] = (group.fusionCounts[data.recipeId] ?? 0) + 1;
    }
    for (const sample of samples) {
      const perf = object(object(sample.data).performance);
      if (finite(perf.catchupSeconds)) group.catchup.push(perf.catchupSeconds);
      if (perf.status !== 'foreground') {
        if (!perf.status && finite(perf.fps)) group.legacyPerfSamples++;
        continue;
      }
      group.foregroundSamples++;
      if (finite(perf.renderMs)) group.renderMs.push(perf.renderMs);
      if (finite(perf.simulationMs)) group.simulationMs.push(perf.simulationMs);
      if (finite(perf.frameP95Ms)) group.frameP95Ms.push(perf.frameP95Ms);
    }
  }
  return {
    schema: 1,
    source: 'local-observations',
    inputRuns: root.runs.length,
    excludedRuns: excluded,
    groups: [...buckets.values()].map((g) => ({
      key: g.key,
      runs: g.runs,
      completed: g.completed,
      unfinished: g.unfinished,
      knownFiniteOutcomes: g.knownFiniteOutcomes,
      finiteClears: g.finiteClears,
      finiteClearRate: g.knownFiniteOutcomes ? g.finiteClears / g.knownFiniteOutcomes : null,
      finiteClearRate95: wilson(g.finiteClears, g.knownFiniteOutcomes),
      campaignClears: g.campaignClears,
      droppedEvents: g.droppedEvents,
      droppedSamples: g.droppedSamples,
      meanKnownFinishMinutes: mean(g.finishedSeconds.map((s) => s / 60)),
      meanWaveReached: mean(g.waveReached),
      damageByCore: g.damageByCore,
      fusionCounts: g.fusionCounts,
      shopSpendObserved: g.shopSpend,
      repairSpendObserved: g.repairSpend,
      cards: Object.values(g.cardCounts),
      performance: {
        foregroundSamples: g.foregroundSamples,
        legacyContextSamples: g.legacyPerfSamples,
        meanSampledRenderMs: mean(g.renderMs),
        meanSampledSimulationMs: mean(g.simulationMs),
        worstSampledFrameP95Ms: g.frameP95Ms.length ? Math.max(...g.frameP95Ms) : null,
        worstCatchupSeconds: g.catchup.length ? Math.max(...g.catchup) : null,
      },
    })),
    limitations: [
      'Local voluntary observations, not a representative player sample or a causal card ranking.',
      'Unfinished records are not defeats. Missing new fields remain unknown.',
      'Groups separate known builds, rules, balance editions, evolution paths, tower, stage, difficulty, original mode, Endless continuation, and rune loadout.',
      'Unknown metadata groups may mix incompatible historical rules; do not treat them as controlled cohorts.',
      'Truncated offers/selections can be unmatched. Counts are observations, not unbiased pick rates.',
      'Damage attribution can be incomplete after replacement or truncated logs; cumulative samples are not summed.',
      'Performance uses sampled recent windows, not a whole-run distribution; background and legacy-context timings are excluded.',
    ],
  };
}

export function localMarkdown(report: ReturnType<typeof analyzeLocalExport>): string {
  return (
    '# Local gameplay observations\n\n' +
    `${report.inputRuns} input records; ${report.excludedRuns} excluded. No identities, run IDs, timestamps, or raw events included.\n\n` +
    '| Build/tower/stage/difficulty/mode/continuation/rules/edition/evolution/runes | Runs | Completed | Unfinished | Known finite clears |\n|---|---:|---:|---:|---|\n' +
    report.groups
      .map(
        (g) =>
          `| ${g.key} | ${g.runs} | ${g.completed} | ${g.unfinished} | ${g.finiteClears}/${g.knownFiniteOutcomes} |`,
      )
      .join('\n') +
    '\n\n' +
    report.limitations.map((s) => `- ${s}`).join('\n') +
    '\n'
  );
}
