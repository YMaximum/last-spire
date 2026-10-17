import { describe, expect, it } from 'vitest';
import { FrameMeter } from '../src/v3/performance';

describe('foreground performance measurements', () => {
  it.each([30, 60, 120])('measures %i FPS independently of simulation speed', (fps) => {
    const meter = new FrameMeter();
    for (let i = 0; i < fps * 4; i++) {
      meter.record({ seconds: 1 / fps, simulationMs: 2, renderMs: 4, foreground: true });
    }
    expect(meter.read().fps).toBeCloseTo(fps);
    expect(meter.read().simulationMs).toBe(2);
    expect(meter.read().renderMs).toBe(4);
    expect(meter.read().frames).toBeLessThanOrEqual(1024);
    expect(meter.read().status).toBe('foreground');
  });

  it('does not mix throttled background frames with foreground samples', () => {
    const meter = new FrameMeter();
    for (let i = 0; i < 100; i++)
      meter.record({ seconds: 1 / 30, simulationMs: 1, renderMs: 2, foreground: true });
    expect(meter.read().status).toBe('foreground');
    meter.record({ seconds: 2, simulationMs: 0, renderMs: 0, foreground: false });
    expect(meter.read()).toMatchObject({ status: 'background', frames: 0, fps: 0 });
    meter.record({ seconds: 1 / 60, simulationMs: 1, renderMs: 2, foreground: true });
    expect(meter.read()).toMatchObject({ status: 'warming-up', frames: 0 });
    meter.record({ seconds: 1 / 60, simulationMs: 1, renderMs: 2, foreground: true });
    expect(meter.read().fps).toBeCloseTo(60);
  });

  it('includes real foreground stalls instead of inflating the frame rate', () => {
    const meter = new FrameMeter();
    meter.record({ seconds: 1 / 60, simulationMs: 1, renderMs: 2, foreground: true });
    meter.record({ seconds: 2, simulationMs: 1, renderMs: 2, foreground: true });
    expect(meter.read()).toMatchObject({ frames: 1, fps: 0.5, frameP95Ms: 2000 });
    meter.record({ seconds: NaN, simulationMs: 1, renderMs: 2, foreground: true });
    expect(meter.read().fps).toBe(0);
  });

  it('ages out old stalls and bounds high-refresh samples', () => {
    const meter = new FrameMeter();
    meter.record({ seconds: 1 / 60, simulationMs: 1, renderMs: 2, foreground: true });
    meter.record({ seconds: 2, simulationMs: 1, renderMs: 2, foreground: true });
    for (let i = 0; i < 610; i++)
      meter.record({ seconds: 1 / 60, simulationMs: 1, renderMs: 2, foreground: true });
    expect(meter.read().fps).toBeCloseTo(60);
    expect(meter.read().seconds).toBeLessThan(10.02);
    for (let i = 0; i < 3000; i++)
      meter.record({ seconds: 1 / 240, simulationMs: 1, renderMs: 2, foreground: true });
    expect(meter.read().frames).toBe(1024);
    expect(meter.read().fps).toBeCloseTo(240);
  });
});
