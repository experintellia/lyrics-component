import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Position } from './types';

const SNAP_MS = 300; // a tick further than this from the estimate replaces it
const CAP_MS = 500; // never extrapolate further than this past the last tick
const SEEK_HOLD_MS = 1000; // max time to hold a seek target while waiting for the host

/** All times are in the host's position domain (offset is applied by the hook). */
export interface ClockState {
  tickMs: number; // last tick's timeMs
  arrival: number; // `now` when it arrived
  playing: boolean;
  floorMs: number; // "hold instead of running backwards": never show less than this
  seekMs: number | null; // seek target being held...
  seekUntil: number; // ...until this `now`
  fresh: boolean; // after visibilitychange: no extrapolation, take next tick as-is
}

const holding = (s: ClockState, now: number) => s.seekMs !== null && now < s.seekUntil;

export function clockTime(s: ClockState, now: number): number {
  if (holding(s, now)) return s.seekMs!;
  if (!s.playing || s.fresh) return s.tickMs;
  return Math.max(s.floorMs, s.tickMs + Math.min(now - s.arrival, CAP_MS));
}

export function startClock(p: Position, now: number): ClockState {
  return { tickMs: p.timeMs, arrival: now, playing: p.playing, floorMs: -Infinity, seekMs: null, seekUntil: 0, fresh: false };
}

export function tick(s: ClockState, p: Position, now: number): ClockState {
  // ponytail: a tick identical to the last one (same timeMs and playing) is ignored. Hosts often
  // re-render with a fresh `position` object literal; resetting `arrival` on those would freeze the
  // display. A host genuinely reporting a stalled position is covered by the 500 ms cap.
  if (p.timeMs === s.tickMs && p.playing === s.playing) return s;
  const next: ClockState = { ...startClock(p, now), seekMs: s.seekMs, seekUntil: s.seekUntil };
  if (holding(s, now)) {
    // Stale in-flight ticks are recorded but don't move the display; a tick near the target ends the hold.
    if (Math.abs(p.timeMs - s.seekMs!) <= SNAP_MS) next.seekMs = null;
    return next;
  }
  if (p.playing && s.playing && !s.fresh) {
    const shown = clockTime(s, now);
    const diff = p.timeMs - shown;
    if (diff < 0 && diff >= -SNAP_MS) next.floorMs = shown; // slightly behind: hold, don't go backwards
  }
  return next; // paused, resumed, fresh, ahead, or > 300 ms off: take it as-is
}

export function seekClock(s: ClockState, targetMs: number, now: number): ClockState {
  return { ...s, seekMs: targetMs, seekUntil: now + SEEK_HOLD_MS };
}

export function visibleClock(s: ClockState): ClockState {
  return { ...s, fresh: true, seekMs: null, floorMs: -Infinity };
}

export function usePlaybackTime(
  position: Position,
  offsetMs: number,
  onSeek: (ms: number) => void,
): { audibleMs: number; seek: (audibleTargetMs: number) => void } {
  const state = useRef<ClockState>(null);
  state.current ??= startClock(position, performance.now());
  const [ms, setMs] = useState(position.timeMs);
  const raf = useRef(0);

  // Runs frames only while playing or holding a seek; stops itself otherwise.
  const kick = () => {
    if (raf.current) return;
    const frame = () => {
      const now = performance.now();
      const s = state.current!;
      setMs(clockTime(s, now));
      raf.current = s.playing || holding(s, now) ? requestAnimationFrame(frame) : 0;
    };
    frame();
  };

  useLayoutEffect(() => {
    state.current = tick(state.current!, position, performance.now());
    kick();
  }, [position]);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState !== 'visible') return;
      state.current = visibleClock(state.current!);
      kick();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      cancelAnimationFrame(raf.current);
      raf.current = 0;
    };
  }, []);

  const seek = (audibleTargetMs: number) => {
    const target = audibleTargetMs + offsetMs;
    state.current = seekClock(state.current!, target, performance.now());
    onSeek(target);
    kick();
  };

  return { audibleMs: ms - offsetMs, seek };
}
