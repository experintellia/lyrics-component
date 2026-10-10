import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { displayText, formatTime, type LrcLine } from './lrc';
import type { Peaks } from './types';

const STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600].map((s) => s * 1000); // ruler tick spacing
const clampSpan = (ms: number) => Math.min(600_000, Math.max(1_000, ms));
const DRAG_PX = 4; // less movement than this between press and release is a tap
// ponytail: fixed hues (not CSS vars); translucent mid-lightness reads on light and dark. Blue is the accent's.
const HUES = [30, 150, 290];
/** Section k's colour; the editor's line list uses it (stronger) to tie each verse to its band. */
export const bandColor = (k: number, alpha = 0.2) => `hsl(${HUES[k % HUES.length]} 75% 50% / ${alpha})`;

/** `from`/`to`: the section's line indices [from, to). */
export interface Section { startMs: number; endMs: number; label: string; from: number; to: number }

const LABEL = /^\[.+\]$/; // an unstamped "[Chorus]" line names the section it starts
const isLabel = (l: LrcLine) => l.timeMs === null && LABEL.test(displayText(l.text));
const stampFrom = (lines: LrcLine[], i: number, end: number) => lines.slice(i).find((l) => l.timeMs !== null)?.timeMs ?? end;

/** Sections start at the first line, after blank lines, or at a label line; each runs from its first stamp
 *  to the next stamp after its lines (the next section's, or a stamped gap's). Sections without stamps are dropped. */
export function sections(lines: LrcLine[], durationMs = Infinity): Section[] {
  const out: Section[] = [];
  for (let i = 0; i < lines.length; ) {
    if (!displayText(lines[i].text)) {
      i++;
      continue;
    }
    let j = i + 1;
    while (j < lines.length && displayText(lines[j].text) && !isLabel(lines[j])) j++;
    const start = lines.slice(i, j).find((l) => l.timeMs !== null)?.timeMs;
    const label = isLabel(lines[i]) ? displayText(lines[i].text).slice(1, -1) : '';
    if (start != null) out.push({ startMs: start, endMs: Math.max(start, stampFrom(lines, j, durationMs)), label, from: i, to: j });
    i = j;
  }
  return out;
}

/** The time a stamped line covers: its stamp up to the next stamp (or the end). */
export function lineSpan(lines: LrcLine[], i: number, durationMs = Infinity): [number, number] | null {
  const t = lines[i]?.timeMs;
  return t == null ? null : [t, Math.max(t, stampFrom(lines, i + 1, durationMs))];
}

/** Canvas waveform (or a plain time ruler without peaks), centred on the audible playhead. */
export function Waveform({ peaks, timeMs, lines, onSeek, selected }: {
  peaks?: Peaks;
  timeMs: number; // audible
  lines: LrcLine[];
  onSeek: (audibleMs: number) => void;
  selected?: number; // index into lines; its span gets the accent tint
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [span, setSpan] = useState(10_000); // visible ms
  // Tape scrub: while dragging, the view centres on the dragged time instead of the playhead.
  const press = useRef<{ x: number; t: number; moved: boolean } | null>(null);
  const [dragMs, setDragMs] = useState<number | null>(null);
  const centre = dragMs ?? timeMs;
  // ponytail: the view always centres on the playhead; to look elsewhere, seek (or drag) there.
  const start = Math.max(0, centre - span / 2);

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
    const accent = cssVar('--lyrics-accent', '#2a7ae2');
    const msPx = span / w;
    const x = (t: number) => Math.round((t - start) / msPx);
    const clampX = (t: number) => Math.min(w, Math.max(0, x(t))); // Infinity-safe
    const font = (px: number, weight = '') => `${weight} ${px * dpr}px ${cs.fontFamily || 'sans-serif'}`;
    const duration = peaks ? peaks.max.length * peaks.msPerBucket : Infinity;
    ctx.clearRect(0, 0, w, h);

    // Background: section bands, then the selected line's span in the accent colour.
    const secs = sections(lines, duration);
    secs.forEach((s, k) => {
      ctx.fillStyle = bandColor(k);
      ctx.fillRect(clampX(s.startMs), 0, clampX(s.endMs) - clampX(s.startMs), h);
    });
    const sel = selected === undefined ? null : lineSpan(lines, selected, duration);
    if (sel) {
      ctx.clearRect(clampX(sel[0]), 0, clampX(sel[1]) - clampX(sel[0]), h); // same tint over any band
      ctx.fillStyle = accent;
      ctx.globalAlpha = 0.3;
      ctx.fillRect(clampX(sel[0]), 0, clampX(sel[1]) - clampX(sel[0]), h);
      ctx.globalAlpha = 1;
    }

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
    ctx.font = font(12);
    const head = x(centre);
    const step = STEPS.find((s) => s / msPx >= 64 * dpr) ?? STEPS[STEPS.length - 1];
    for (let t = Math.ceil(start / step) * step; t < start + span; t += step) {
      ctx.fillRect(x(t), 0, dpr, 6 * dpr);
      const text = formatTime(t).replace(/\.\d+$/, '');
      const x1 = x(t) + 6 * dpr + ctx.measureText(text).width;
      // Skip labels cut off at the right edge or crossed by the playhead (its halo is 2 px each side).
      if (x1 <= w && !(head >= x(t) + dpr && head <= x1 + 2 * dpr)) ctx.fillText(text, x(t) + 3 * dpr, 18 * dpr);
    }
    // Stamp markers below the ruler, each tagged with its line number at the bottom.
    let no = 0;
    for (const l of lines) {
      if (displayText(l.text)) no++;
      if (l.timeMs === null || l.timeMs < start || l.timeMs > start + span) continue;
      ctx.fillRect(x(l.timeMs), 22 * dpr, dpr, h);
      if (displayText(l.text)) ctx.fillText(String(no), x(l.timeMs) + 3 * dpr, h - 4 * dpr);
    }
    // Section labels as chips under the ruler (opaque: legible over the waveform in any theme); a band that
    // began off-screen keeps its label at the left edge.
    ctx.font = font(11, 'bold');
    secs.forEach((s, k) => {
      const x0 = clampX(s.startMs);
      const x1 = clampX(s.endMs);
      if (!s.label || x1 - x0 < 12 * dpr) return;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0, 0, x1 - x0 - 2 * dpr, h);
      ctx.clip();
      ctx.fillStyle = `hsl(${HUES[k % HUES.length]} 70% 32%)`;
      ctx.fillRect(x0 + 3 * dpr, 24 * dpr, ctx.measureText(s.label).width + 8 * dpr, 16 * dpr);
      ctx.fillStyle = '#fff';
      ctx.fillText(s.label, x0 + 7 * dpr, 36 * dpr);
      ctx.restore();
    });
    // Playhead with a light halo, so it stands out on the accent-tinted span too.
    ctx.fillStyle = cssVar('--lyrics-bg', '#fff');
    ctx.fillRect(head - 2 * dpr, 0, 4 * dpr, h);
    ctx.fillStyle = accent;
    ctx.fillRect(head - dpr, 0, 2 * dpr, h);
    // While dragging, a time bubble on the playhead shows where the release will land.
    if (dragMs !== null) {
      const text = formatTime(Math.round(centre / 10) * 10);
      const bw = ctx.measureText(text).width + 10 * dpr;
      const bx = Math.min(w - bw, Math.max(0, head - bw / 2));
      ctx.fillRect(bx, 0, bw, 20 * dpr);
      ctx.fillStyle = '#fff';
      ctx.fillText(text, bx + 5 * dpr, 15 * dpr);
    }
  });

  const at = (e: PointerEvent<HTMLCanvasElement>) => e.currentTarget.getBoundingClientRect();
  const down = (e: PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture?.(e.pointerId); // jsdom lacks it
    press.current = { x: e.clientX, t: timeMs, moved: false };
  };
  const move = (e: PointerEvent<HTMLCanvasElement>) => {
    const p = press.current;
    const r = at(e);
    if (!p || !r.width) return;
    const dx = e.clientX - p.x;
    if (Math.abs(dx) >= DRAG_PX) p.moved = true;
    // Tape: drag left = forward in time.
    if (p.moved) setDragMs(Math.max(0, Math.round(p.t - (dx / r.width) * span)));
  };
  const up = (e: PointerEvent<HTMLCanvasElement>) => {
    const p = press.current;
    const r = at(e);
    press.current = null;
    setDragMs(null);
    if (!p || !r.width) return;
    // One seek on release (host seeks are slow); the clock's seek hold shows the target until it lands.
    const dx = e.clientX - p.x;
    if (p.moved || Math.abs(dx) >= DRAG_PX) onSeek(Math.max(0, Math.round(p.t - (dx / r.width) * span)));
    else onSeek(Math.max(0, Math.round(start + ((e.clientX - r.left) / r.width) * span)));
  };
  const cancel = () => {
    press.current = null; // e.g. the browser took over for a vertical scroll
    setDragMs(null);
  };

  return (
    <div className="lyrics-wave">
      <canvas
        ref={ref}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={cancel}
        aria-label="Waveform: tap to jump to a spot, or drag sideways to scrub"
        title="Click to jump there, or drag sideways to scrub"
      />
      <div className="lyrics-wave-zoom">
        <button type="button" aria-label="Zoom in" title="Zoom in" onClick={() => setSpan((s) => clampSpan(s / 2))}>+</button>
        <button type="button" aria-label="Zoom out" title="Zoom out" onClick={() => setSpan((s) => clampSpan(s * 2))}>−</button>
      </div>
    </div>
  );
}
