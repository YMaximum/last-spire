import { describe, expect, it } from 'vitest';
import { SimulationClock, resolveDecisionPause, type ClockWork } from '../src/game/clock';
import { PageLoop } from '../src/ui/page-loop';
import { createRun, step as combatStep } from '../src/game/engine';
import { defaultProfile } from '../src/legacy/classic/storage';

const tick = 1 / 30;
describe('the UI decision pause policy', () => {
  const input = {
    queued: false,
    fusion: false,
    choiceWindow: false,
    windowPaused: false,
    autoPause: false,
    background: false,
    held: false,
  };
  it('allows foreground combat when the player opts out of choice auto-pause', () => {
    expect(resolveDecisionPause({ ...input, queued: true }).paused).toBe(false);
  });
  it('pauses on a background decision and keeps that hold after focus returns', () => {
    const away = resolveDecisionPause({ ...input, queued: true, background: true });
    expect(away).toEqual({ held: true, paused: true });
    expect(resolveDecisionPause({ ...input, queued: true, held: away.held })).toEqual(away);
    expect(resolveDecisionPause({ ...input, held: away.held })).toEqual({
      held: false,
      paused: false,
    });
  });
  it('does not let a closed or minimized reward window bypass default decision pause', () => {
    expect(resolveDecisionPause({ ...input, queued: true, autoPause: true }).paused).toBe(true);
  });
  it('stops automatic fusion offers even with foreground auto-pause disabled', () => {
    expect(resolveDecisionPause({ ...input, fusion: true }).paused).toBe(true);
  });
  it('respects other choice windows while away and their normal foreground pause', () => {
    expect(resolveDecisionPause({ ...input, choiceWindow: true, background: true }).paused).toBe(
      true,
    );
    expect(resolveDecisionPause({ ...input, windowPaused: true }).paused).toBe(true);
  });
});
function scenario(speed: 1 | 2 | 3 = 1) {
  let ticks = 0,
    allowed = true;
  const clock = new SimulationClock(tick, 120, 8, () => 0);
  const work: ClockWork = { speed, background: false, canStep: () => allowed, step: () => ticks++ };
  clock.advance(0, work);
  return {
    clock,
    work,
    ticks: () => ticks,
    allow: (value: boolean) => {
      allowed = value;
    },
  };
}

describe('document-local fixed-tick progress', () => {
  it('produces identical combat and RNG state with frame-rate and background scheduling', () => {
    const a = createRun(defaultProfile(), 'pyre', 0, 0, 771, { mode: 'normal' });
    a.id = 'clock-combat';
    const b = structuredClone(a);
    for (const [run, interval, background] of [
      [a, 20, false],
      [b, 1000, true],
    ] as const) {
      const clock = new SimulationClock(tick, 120, 8, () => 0);
      const work: ClockWork = {
        speed: 3,
        background,
        canStep: () => run.phase === 'combat' && !run.pendingRewards.length,
        step: () => combatStep(run),
      };
      clock.advance(0, work);
      for (let wallTime = interval; wallTime <= 4000; wallTime += interval)
        clock.advance(wallTime, work);
    }
    expect(b).toEqual(a);
    expect(a.time).toBeCloseTo(12);
    expect(a.kills + a.projectiles.length).toBeGreaterThan(0);
  });
  it.each([1, 2, 3] as const)(
    'matches foreground and one-second background callbacks at %sx',
    (speed) => {
      const foreground = scenario(speed),
        background = scenario(speed);
      background.work.background = true;
      for (let i = 1; i <= 50; i++) foreground.clock.advance(i * 20, foreground.work);
      background.clock.advance(1000, background.work);
      expect(foreground.ticks()).toBe(30 * speed);
      expect(background.ticks()).toBe(foreground.ticks());
    },
  );
  it('bounds work per callback without throwing away accumulated combat time', () => {
    const s = scenario();
    s.clock.advance(30_000, s.work);
    expect(s.ticks()).toBe(120);
    expect(s.clock.catchingUp).toBe(true);
    for (let i = 0; i < 10; i++) s.clock.advance(30_000, s.work);
    expect(s.ticks()).toBe(900);
    expect(s.clock.catchingUp).toBe(false);
  });
  it.each(['decision', 'defeat'])(
    'stops catch-up exactly at %s and discards time after the stop',
    () => {
      const s = scenario();
      s.work.step = () => {
        count++;
        if (count === 3) s.allow(false);
      };
      let count = 0;
      s.clock.advance(60_000, s.work);
      expect(count).toBe(3);
      expect(s.clock.catchingUp).toBe(false);
      s.allow(true);
      s.clock.advance(120_000, s.work);
      expect(count).toBe(3);
      s.clock.advance(121_000, s.work);
      expect(count).toBe(33);
    },
  );
  it('does not accumulate progress during explicit pause', () => {
    const s = scenario();
    s.allow(false);
    s.clock.advance(60_000, s.work);
    s.allow(true);
    s.clock.advance(120_000, s.work);
    expect(s.ticks()).toBe(0);
    s.clock.advance(121_000, s.work);
    expect(s.ticks()).toBe(30);
  });
  it('keeps suspended background debt marked after focus returns', () => {
    const s = scenario();
    let pending = false,
      forcedPause = false;
    s.work.background = true;
    s.work.canStep = (away) => {
      if (pending && away) forcedPause = true;
      return !forcedPause;
    };
    s.work.step = () => {
      pending = true;
    };
    s.clock.advance(0, s.work);
    s.work.background = false;
    expect(s.clock.advance(90_000, s.work)).toBe(1);
    expect(forcedPause).toBe(true);
    expect(s.clock.catchingUp).toBe(false);
  });
  it('does not recover closed-browser time into a new document or restored page', () => {
    const s = scenario();
    s.clock.reset();
    s.clock.advance(1_000_000_000, s.work);
    expect(s.ticks()).toBe(0);
    s.clock.advance(1_000_001_000, s.work);
    expect(s.ticks()).toBe(30);
  });
  it('applies a speed change to subsequent elapsed time', () => {
    const s = scenario();
    s.work.speed = 3;
    s.clock.advance(1000, s.work);
    expect(s.ticks()).toBe(30);
    s.clock.advance(2000, s.work);
    expect(s.ticks()).toBe(120);
  });
  it('retains backlog when the execution time budget expires', () => {
    let now = 0,
      count = 0;
    const clock = new SimulationClock(tick, 120, 3, () => now++);
    const work: ClockWork = {
      speed: 1,
      background: true,
      canStep: () => true,
      step: () => count++,
    };
    clock.advance(0, work);
    clock.advance(1000, work);
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(30);
    expect(clock.catchingUp).toBe(true);
    for (let i = 0; i < 30; i++) clock.advance(1000, work);
    expect(count).toBe(30);
  });
});

describe('one page callback at a time', () => {
  it('switches schedulers on visibility changes and cancels work on page exit', () => {
    let hidden = false,
      id = 0,
      calls = 0;
    const frames = new Map<number, FrameRequestCallback>(),
      timers = new Map<number, () => void>();
    const loop = new PageLoop(() => calls++, {
      hidden: () => hidden,
      now: () => 10,
      frame: (fn) => {
        frames.set(++id, fn);
        return id;
      },
      cancelFrame: (key) => {
        frames.delete(key);
      },
      timer: (fn, ms) => {
        expect(ms).toBe(1000);
        timers.set(++id, fn);
        return id;
      },
      cancelTimer: (key) => {
        timers.delete(key);
      },
    });
    loop.start();
    loop.start();
    expect(frames.size).toBe(1);
    expect(timers.size).toBe(0);
    expect(calls).toBe(1);
    hidden = true;
    loop.refresh();
    loop.refresh();
    expect(frames.size).toBe(0);
    expect(timers.size).toBe(1);
    const late = [...timers.values()][0];
    hidden = false;
    loop.refresh();
    expect(frames.size).toBe(1);
    expect(timers.size).toBe(0);
    loop.stop();
    const before = calls;
    late();
    expect(calls).toBe(before);
    expect(frames.size + timers.size).toBe(0);
  });
});
