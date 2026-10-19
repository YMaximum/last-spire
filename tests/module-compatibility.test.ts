import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import * as classic from '../src/legacy/classic/engine';
import * as runeforged from '../src/legacy/runeforged/engine';
import * as current from '../src/game/engine';
import { defaultProfile } from '../src/legacy/classic/storage';
import { emptySave, exportGame, parseGame } from '../src/persistence/storage';
import type { RunState } from '../src/model/shared';
import type { RunV2 } from '../src/model/arsenal';

// Captured from merged main before moving modules. These are synthetic hashes,
// not player saves. They lock the serialized rules, RNG, offers and resume state.
const cases = [
  {
    rules: 'classic',
    tower: 'bastion',
    stage: 0,
    difficulty: 0,
    seed: 731,
    mode: 'normal',
    checkpoint: '735219cf8e474f005751749f98856029715e0e75fbd6d35cc66d5d0853d15025',
    resumed: '0c04a279af49a74322f6a630fe59216c297e36d3d02a82165d4ffb87266b7294',
  },
  {
    rules: 'runeforged',
    tower: 'pyre',
    stage: 1,
    difficulty: 1,
    seed: 991,
    mode: 'normal',
    checkpoint: '45cea982e1396e99b007a7fd19f35c732f03cc1603ebb4f7d24a1498e7481d29',
    resumed: 'dc138be7b2dd7103b458ed5c1c620db153cb3bf33f01f853112dc19b34dbdc07',
  },
  {
    rules: 'current',
    tower: 'bastion',
    stage: 0,
    difficulty: 0,
    seed: 8008,
    mode: 'normal',
    checkpoint: 'e9f9bdefcc845766bb5e094ee18b196d4f287ce2b4360231ecb5f3ffe53c0e30',
    resumed: 'cfdd4a758bbe982db61bc6db9bc9821b8dc526130e06aeafe01e18701d5f1ef5',
  },
  {
    rules: 'current',
    tower: 'monolith',
    stage: 2,
    difficulty: 2,
    seed: 1701,
    mode: 'endless',
    checkpoint: 'd8ca62daee4e17651aec6fefed8e010f5d45f2bcc3ff7dfbac8e554ade87f8d5',
    resumed: 'ba6077acd33b31d6f4ede5f29ca60e89bc8eccd40e41312091215e4e33fa77a6',
  },
  {
    rules: 'current',
    tower: 'glacier',
    stage: 1,
    difficulty: 1,
    seed: 9009,
    mode: 'quick',
    checkpoint: '49c86d6e4f441da2ec6ae7a16d7eafc322b72e2f11b724b79666c8f4b3b7574f',
    resumed: '3b15be172e81c59f38a36b0cb7c16243a46eb93c63ed0d7003b816e5f018b837',
  },
] as const;

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const step = (run: RunState | RunV2) => (run.version === 1 ? classic.step(run) : current.step(run));

// Preserve the original envelope hashes while upgrading the save wrapper.
// Only stage metadata and the schema number differ; all prior run/RNG bytes match.
function legacyEnvelope(save: ReturnType<typeof emptySave>): string {
  const envelope = JSON.parse(exportGame(save));
  envelope.version = 3;
  delete envelope.progression.stages;
  delete envelope.progression.bestiary;
  return JSON.stringify(envelope, null, 2);
}
describe('module moves preserve shipped save and simulation contracts', () => {
  it.each(cases)('$rules / $tower / $mode matches pre-refactor checkpoints', (scenario) => {
    const profile = defaultProfile();
    profile.tutorialDone = true;
    const engine = scenario.rules === 'classic' ? classic : runeforged;
    const run =
      scenario.rules === 'current'
        ? current.createRun(
            profile,
            scenario.tower,
            scenario.stage,
            scenario.difficulty,
            scenario.seed,
            {
              mode: scenario.mode,
              shopVersion: 1,
              encounterVersion: 1,
              arsenalVersion: 1,
            },
          )
        : engine.createRun(
            profile,
            scenario.tower,
            scenario.stage,
            scenario.difficulty,
            scenario.seed,
          );
    run.id = `parity-${scenario.rules}-${scenario.seed}`;
    if (run.version === 1) run.attacks[0].shots = 15_001;
    for (let tick = 0; tick < 900; tick++) step(run);

    const save = emptySave();
    save.profile = profile;
    save.run = run;
    if ('rulesVersion' in run && run.rulesVersion === 3) {
      save.progression.active = {
        runId: run.id,
        rulesVersion: 3,
        runes: { ...save.progression.runes.selected, ...run.runeSnapshot },
        autocast: structuredClone(save.progression.autocast),
      };
    }
    const checkpoint = legacyEnvelope(save);
    expect(hash(checkpoint)).toBe(scenario.checkpoint);

    const restored = parseGame(checkpoint).run!;
    for (let tick = 0; tick < 900; tick++) {
      step(run);
      step(restored);
    }
    expect(restored).toEqual(run);
    expect(hash(legacyEnvelope(save))).toBe(scenario.resumed);
  });
});
