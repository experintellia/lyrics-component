import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { formatTime, type LrcLine } from './lrc';
import type { Peaks } from './types';

const STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600].map((s) => s * 1000); // ruler tick spacing
const clampSpan = (ms: number) => Math.min(600_000, Math.max(1_000, ms));

/** Canvas waveform (or a plain time ruler without peaks), centred on the audible playhead. */
export function Waveform({ peaks, timeMs, lines, onSeek }: {
  peaks?: Peaks;
  timeMs: number; // audible
  lines: LrcLine[];
  onSeek: (audibleMs: number) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [span, setSpan] = useState(10_000); // visible ms
  // ponytail: the view always centres on the playhead; to look elsewhere, seek there.
  const start = Math.max(0, timeMs - span / 2);

  // Ctrl+wheel (= trackpad pinch in Chromium/Firefox) zooms; needs a non-passive listener.
  useEffect(() => {
    const c = ref.current!;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setSpan((s) => clampSpan(s * (e.deltaY > 0 ? 1.25 : 0.8)));
    };
    c.addEventListener('wheel', onWheel, { passive: false });
    return () => c.removeEventListener('wheel', onWheel);
  }, []);

  // Redraw after every render (the editor re-renders each animation frame while playing).
  // ponytail: canvas size is read on draw; a resize while paused shows up on the next render.
  useEffect(() => {
    const c = ref.current!;
    const ctx = c.getContext('2d');
    if (!ctx) return; // jsdom / no canvas support
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(c.clientWidth * dpr);
    const h = Math.round(c.clientHeight * dpr);
    if (c.width !== w) c.width = w;
    if (c.height !== h) c.height = h;
    if (!w || !h) return;
    const cs = getComputedStyle(c);
    const cssVar = (name: string, d: string) => cs.getPropertyValue(name).trim() || d;
    const msPx = span / w;
    const x = (t: number) => Math.round((t - start) / msPx);
    ctx.clearRect(0, 0, w, h);

    if (peaks) {
      // Only the visible range: one min/max column per device pixel.
      ctx.fillStyle = cssVar('--lyrics-muted', '#888');
      const mid = h / 2;
      for (let px = 0; px < w; px++) {
        const b0 = Math.floor((start + px * msPx) / peaks.msPerBucket);
        const b1 = Math.min(peaks.max.length, Math.max(b0 + 1, Math.floor((start + (px + 1) * msPx) / peaks.msPerBucket)));
        let lo = 0;
        let hi = 0;
        for (let b = b0; b < b1; b++) {
          if (peaks.min[b] < lo) lo = peaks.min[b];
          if (peaks.max[b] > hi) hi = peaks.max[b];
        }
        ctx.fillRect(px, mid - hi * mid, 1, Math.max(1, (hi - lo) * mid));
      }
    }

    ctx.fillStyle = cs.color;
    ctx.font = `${12 * dpr}px ${cs.fontFamily || 'sans-serif'}`;
    const step = STEPS.find((s) => s / msPx >= 64 * dpr) ?? STEPS[STEPS.length - 1];
    for (let t = Math.ceil(start / step) * step; t < start + span; t += step) {
      ctx.fillRect(x(t), 0, dpr, 6 * dpr);
      ctx.fillText(formatTime(t).replace(/\.\d+$/, ''), x(t) + 3 * dpr, 18 * dpr);
    }
    for (const l of lines) {
      if (l.timeMs !== null && l.timeMs >= start && l.timeMs <= start + span) ctx.fillRect(x(l.timeMs), 22 * dpr, dpr, h);
    }
    ctx.fillStyle = cssVar('--lyrics-accent', '#2a7ae2');
    ctx.fillRect(x(timeMs) - dpr, 0, 2 * dpr, h);
  });

  const click = (e: MouseEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (r.width) onSeek(Math.max(0, Math.round(start + ((e.clientX - r.left) / r.width) * span)));
  };

  return (
    <div className="lyrics-wave">
      <canvas ref={ref} onClick={click} aria-label="Waveform: click to seek" />
      <button type="button" aria-label="Zoom out" onClick={() => setSpan((s) => clampSpan(s * 2))}>−</button>
      <button type="button" aria-label="Zoom in" onClick={() => setSpan((s) => clampSpan(s / 2))}>+</button>
    </div>
  );
}
