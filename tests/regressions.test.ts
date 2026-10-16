import { describe, it, expect } from 'vitest';
import { createRun, creditReward, retire, step, TICK } from '../src/engine';
import { defaultProfile, exportSave, parseSave } from '../src/storage';
import { defaultSettings } from '../src/storage';
describe('launch regressions', () => {
  it('does not grant credits for instantly retiring an untouched run', () => {
    const s = createRun(defaultProfile(), 'bastion', 0, 0, 58);
    retire(s);
    expect(s.earned).toBe(0);
    expect(creditReward(s)).toBe(0);
  });
  it('round-trips a combat snapshot including pooled shots and all statuses', () => {
    const s = createRun(defaultProfile(), 'tempest', 0, 0, 38291);
    s.attacks.push({
      pattern: 'mine',
      element: 'fire',
      modifier: 'rupture',
      rank: 2,
      cooldown: 0,
      shots: 0,
    });
    for (let i = 0; i < 600; i++) step(s, TICK);
    const loaded = parseSave(
      exportSave({ version: 1, profile: defaultProfile(), run: s, settings: defaultSettings() }),
    );
    expect(loaded.run?.rng).toBe(s.rng);
    expect(loaded.run?.projectiles).toEqual(s.projectiles);
    expect(loaded.run?.enemies).toEqual(s.enemies);
  });
  it('increases late ascension health without front-loading the whole penalty', () => {
    const spawn = (wave: number, difficulty: number) => {
      const s = createRun(defaultProfile(), 'bastion', 0, difficulty, 8932);
      s.wave = wave;
      s.spawnTimer = 0;
      s.attacks.forEach((a) => (a.cooldown = 100));
      step(s);
      return s.enemies[0].maxHp;
    };
    const early = spawn(1, 5) / spawn(1, 0),
      late = spawn(100, 5) / spawn(100, 0);
    expect(late).toBeGreaterThan(early * 2);
  });
  it('makes endless enemy health outgrow normal quadratic attack scaling', () => {
    const spawn = (wave: number) => {
      const s = createRun(defaultProfile(), 'bastion', 0, 0, 8932);
      s.wave = wave;
      s.endless = true;
      s.spawnTimer = 0;
      s.attacks.forEach((a) => (a.cooldown = 100));
      step(s);
      return s.enemies[0].maxHp;
    };
    expect(spawn(200) / spawn(100)).toBeGreaterThan(8);
  });
});
