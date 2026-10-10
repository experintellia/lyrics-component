import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { clockTime, seekClock, startClock, tick, usePlaybackTime, visibleClock } from './clock';
import type { Position } from './types';

const pos = (timeMs: number, playing = true): Position => ({ timeMs, playing, durationMs: 300_000 });

describe('clock state machine', () => {
  it('interpolates while playing: lastTick + (now - arrival)', () => {
    const s = startClock(pos(10_000), 0);
    expect(clockTime(s, 0)).toBe(10_000);
    expect(clockTime(s, 250)).toBe(10_250);
  });

  it('caps interpolation at lastTick + 500 ms when ticks stall', () => {
    const s = startClock(pos(10_000), 0);
    expect(clockTime(s, 499)).toBe(10_499);
    expect(clockTime(s, 5_000)).toBe(10_500);
  });

  it('paused: uses the value exactly, no interpolation', () => {
    const s = startClock(pos(10_000, false), 0);
    expect(clockTime(s, 5_000)).toBe(10_000);
    const t = tick(startClock(pos(10_000), 0), pos(10_123, false), 200);
    expect(clockTime(t, 200)).toBe(10_123);
    expect(clockTime(t, 900)).toBe(10_123);
  });

  it('snaps forward when a tick is > 300 ms ahead', () => {
    const s = tick(startClock(pos(10_000), 0), pos(12_000), 250);
    expect(clockTime(s, 250)).toBe(12_000);
  });

  it('snaps back when a tick is > 300 ms behind', () => {
    const s = tick(startClock(pos(10_000), 0), pos(9_800), 250); // estimate 10_250, diff -450
    expect(clockTime(s, 250)).toBe(9_800);
  });

  it('takes a slightly-ahead tick as-is', () => {
    const s = tick(startClock(pos(10_000), 0), pos(10_400), 250); // estimate 10_250, diff +150
    expect(clockTime(s, 250)).toBe(10_400);
  });

  it('holds instead of running backwards when a tick is behind by <= 300 ms', () => {
    const s = tick(startClock(pos(10_000), 0), pos(10_100), 250); // estimate 10_250, diff -150
    expect(clockTime(s, 250)).toBe(10_250);
    expect(clockTime(s, 350)).toBe(10_250); // tick-based 10_200, still held
    expect(clockTime(s, 450)).toBe(10_300); // caught up, moves on
  });

  it('ignores an identical repeated tick (does not reset arrival)', () => {
    const s = startClock(pos(10_000), 0);
    const t = tick(s, pos(10_000), 200);
    expect(t).toBe(s);
    expect(clockTime(t, 300)).toBe(10_300);
  });

  it('a play/pause change with the same timeMs is a tick', () => {
    const s = tick(startClock(pos(10_000, false), 0), pos(10_000, true), 1_000);
    expect(clockTime(s, 1_100)).toBe(10_100);
  });

  it('seek: shows the target immediately and ignores stale in-flight ticks', () => {
    let s = seekClock(startClock(pos(10_000), 0), 60_000, 100);
    expect(clockTime(s, 100)).toBe(60_000);
    s = tick(s, pos(10_250), 250); // stale
    expect(clockTime(s, 250)).toBe(60_000);
    expect(clockTime(s, 900)).toBe(60_000); // held, not advancing
  });

  it('seek: a tick within 300 ms of the target ends the hold', () => {
    let s = seekClock(startClock(pos(10_000), 0), 60_000, 100);
    s = tick(s, pos(59_800), 600); // seek landed, 200 ms short
    expect(clockTime(s, 600)).toBe(59_800);
    expect(clockTime(s, 700)).toBe(59_900);
  });

  it('seek: hold ends after 1 s without a matching tick', () => {
    let s = seekClock(startClock(pos(10_000, false), 0), 60_000, 100);
    expect(clockTime(s, 1_099)).toBe(60_000);
    expect(clockTime(s, 1_100)).toBe(10_000);
    s = tick(s, pos(20_000), 1_200); // after the hold, any tick counts
    expect(clockTime(s, 1_200)).toBe(20_000);
  });

  it('seek while paused: target held, then the landed paused value', () => {
    let s = seekClock(startClock(pos(10_000, false), 0), 60_000, 0);
    expect(clockTime(s, 10)).toBe(60_000);
    s = tick(s, pos(60_000, false), 400);
    expect(clockTime(s, 2_000)).toBe(60_000);
  });

  it('visible again: drops interpolation state and takes the next value as-is', () => {
    let s = startClock(pos(10_000), 0);
    s = visibleClock(s);
    expect(clockTime(s, 60_000)).toBe(10_000); // no extrapolation from stale arrival
    s = tick(s, pos(9_900), 60_000); // would be "slightly behind" vs. an estimate; taken as-is
    expect(clockTime(s, 60_000)).toBe(9_900);
    expect(clockTime(s, 60_100)).toBe(10_000);
  });

  it('visible again: clears a slightly-behind hold floor', () => {
    let s = tick(startClock(pos(10_000), 0), pos(10_100), 250); // floor 10_250
    s = tick(visibleClock(s), pos(10_050), 300);
    expect(clockTime(s, 300)).toBe(10_050);
  });
});

describe('usePlaybackTime', () => {
  let frames: FrameRequestCallback[] = [];
  let now = 0;
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let out: ReturnType<typeof usePlaybackTime>;
  const onSeek = vi.fn();

  function Probe(props: { position: Position; offsetMs: number }) {
    out = usePlaybackTime(props.position, props.offsetMs, onSeek);
    return null;
  }
  const render = (position: Position, offsetMs = 0) =>
    act(() => root.render(createElement(Probe, { position, offsetMs })));
  const step = (ms: number) =>
    act(() => {
      now += ms;
      const due = frames;
      frames = [];
      due.forEach((f) => f(now));
    });

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    frames = [];
    now = 0;
    onSeek.mockClear();
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => frames.push(f));
    vi.stubGlobal('cancelAnimationFrame', () => {});
    container = document.createElement('div');
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('interpolates per frame while playing and subtracts offsetMs', async () => {
    await render(pos(10_000), 200);
    expect(out.audibleMs).toBe(9_800);
    await step(100);
    expect(out.audibleMs).toBe(9_900);
  });

  it('runs no frames while paused', async () => {
    await render(pos(10_000, false));
    expect(frames).toHaveLength(0);
    await step(500);
    expect(out.audibleMs).toBe(10_000);
  });

  it('seek calls onSeek with the offset added and holds the target', async () => {
    await render(pos(10_000, false), 200);
    await act(() => out.seek(30_000));
    expect(onSeek).toHaveBeenCalledWith(30_200);
    expect(out.audibleMs).toBe(30_000);
    await render(pos(10_000, true), 200); // stale tick
    await step(100);
    expect(out.audibleMs).toBe(30_000);
    await render(pos(30_150, true), 200); // seek landed
    await step(100);
    expect(out.audibleMs).toBe(30_050);
  });

  it('visibilitychange to visible drops interpolation', async () => {
    await render(pos(10_000));
    await step(400);
    expect(out.audibleMs).toBe(10_400);
    await act(() => document.dispatchEvent(new Event('visibilitychange')));
    await step(16);
    expect(out.audibleMs).toBe(10_000);
  });
});
