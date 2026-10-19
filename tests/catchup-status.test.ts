import { describe, expect, it } from 'vitest';
import { CatchupStatus } from '../src/ui/catchup-status';
import { SimulationClock, type ClockWork } from '../src/game/clock';
import { PageLoop } from '../src/ui/page-loop';

describe('catch-up presentation under load', () => {
  it('does not announce repeated one-tick foreground backlogs', () => {
    const status = new CatchupStatus();
    for (let frame = 0; frame < 600; frame++)
      expect(status.update(frame * 16, frame % 2 ? 1 / 30 : 0, false)).toBe('');
  });

  it('waits for a sustained backlog and distinguishes foreground load from time away', () => {
    const status = new CatchupStatus();
    expect(status.update(0, 2, false)).toBe('');
    expect(status.update(999, 2, false)).toBe('');
    expect(status.update(1000, 2, false)).toContain('heavy load');
    expect(status.update(1100, 2, true)).toContain('time away');
  });

  it('holds a brief notice long enough to read instead of flashing when debt drains', () => {
    const status = new CatchupStatus();
    status.update(0, 1, true);
    const shown = status.update(1000, 1, true);
    expect(shown).not.toBe('');
    expect(status.update(1016, 0, false)).toBe(shown);
    expect(status.update(2499, 0, false)).toBe(shown);
    expect(status.update(2500, 0, false)).toBe('');
  });

  it('resets the delay when isolated stalls recover', () => {
    const status = new CatchupStatus();
    status.update(0, 1, false);
    status.update(900, 0, false);
    expect(status.update(1100, 1, false)).toBe('');
    expect(status.update(1900, 1, false)).toBe('');
    expect(status.update(2100, 1, false)).toContain('heavy load');
  });

  it('reproduces a heavy tick without requiring an absent-tab recovery', () => {
    let cpu = 0,
      ticks = 0;
    const clock = new SimulationClock(1 / 30, 120, 8, () => cpu);
    const work: ClockWork = {
      speed: 3,
      background: false,
      canStep: () => true,
      step: () => {
        ticks++;
        cpu += 9;
      },
    };
    clock.advance(0, work);
    work.speed = 1;
    clock.advance(100, work);
    expect(ticks).toBe(1);
    expect(clock.catchingUp).toBe(true);
    expect(clock.backgroundCatchup).toBe(false);
    expect(clock.pendingSeconds).toBeCloseTo(0.3 - 1 / 30);
    expect(new CatchupStatus().update(100, clock.pendingSeconds, false)).toBe('');
    for (let i = 0; i < 8; i++) clock.advance(100, work);
    expect(ticks).toBe(9);
    expect(clock.pendingSeconds).toBeCloseTo(0);
  });

  it('retains elapsed background work and stops at a pending decision', () => {
    let allowed = true,
      ticks = 0;
    const clock = new SimulationClock(1 / 30, 1, 8, () => 0);
    const work: ClockWork = {
      speed: 1,
      background: true,
      canStep: () => allowed,
      step: () => {
        ticks++;
        if (ticks === 3) allowed = false;
      },
    };
    clock.advance(0, work);
    clock.advance(1000, work);
    expect(clock.backgroundCatchup).toBe(true);
    work.background = false;
    clock.advance(1000, work);
    expect(clock.backgroundCatchup).toBe(true);
    clock.advance(1000, work);
    expect(ticks).toBe(3);
    expect(clock.pendingSeconds).toBe(0);
    expect(clock.backgroundCatchup).toBe(false);
  });
});

describe('bounded hidden-tab recovery scheduling', () => {
  it('drains remaining work promptly, then returns to the idle interval', () => {
    let debt = true,
      hidden = true,
      id = 0;
    const timers = new Map<number, { callback: () => void; delay: number }>();
    const frames = new Map<number, FrameRequestCallback>();
    const loop = new PageLoop(() => {}, {
      hidden: () => hidden,
      catchingUp: () => debt,
      now: () => 0,
      frame: (callback) => {
        frames.set(++id, callback);
        return id;
      },
      cancelFrame: (key) => {
        frames.delete(key);
      },
      timer: (callback, delay) => {
        timers.set(++id, { callback, delay });
        return id;
      },
      cancelTimer: (key) => {
        timers.delete(key);
      },
    });
    loop.start();
    expect(timers.size).toBe(1);
    expect([...timers.values()][0].delay).toBe(16);
    debt = false;
    [...timers.values()][0].callback();
    expect(timers.size).toBe(1);
    expect([...timers.values()][0].delay).toBe(1000);
    hidden = false;
    debt = true;
    loop.refresh();
    expect(timers.size).toBe(0);
    expect(frames.size).toBe(1);
    loop.stop();
    expect(timers.size + frames.size).toBe(0);
  });
});
