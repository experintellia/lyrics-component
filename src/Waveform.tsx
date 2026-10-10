import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { displayText, formatTime, lineWords, type LrcLine } from './lrc';
import type { Peaks } from './types';

const STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600].map((s) => s * 1000); // ruler tick spacing
const clampSpan = (ms: number) => Math.min(600_000, Math.max(1_000, ms));
const DRAG_PX = 4; // less movement than this between press and release is a tap
// ponytail: fixed hues (not CSS vars); translucent mid-lightness reads on light and dark. Blue is the accent's.
const HUES = [30, 150, 290, 60]; // four, so a song's usual 4 stanzas don't repeat a colour
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

const FIT_MARGIN = 500; // ms shown before and after a fitted line
// ponytail: a fitted line is at most 15 s wide (e.g. one running into an unstamped instrumental, or the last
// line before the duration is known); its words sit near its start anyway.
const FIT_MAX = 15_000;

/** The visible [start, span]: centred on the playhead, or (word step) fitted to a line's span plus a margin,
 *  widened by the zoom buttons (`widen` ≥ 1). */
export function viewWindow(centreMs: number, spanMs: number, fit?: [number, number] | null, widen = 1): [number, number] {
  if (!fit) return [Math.max(0, centreMs - spanMs / 2), spanMs];
  const len = Math.min(fit[1], fit[0] + FIT_MAX) - fit[0];
  const span = clampSpan((len + 2 * FIT_MARGIN) * widen);
  return [Math.max(0, fit[0] + len / 2 - span / 2), span];
}

/** One timed word on the waveform: its stamp up to the next word stamp (or the end tag, or `endMs`).
 *  `rest`: the untimed words after it, which share its span (phrase timing, or not stamped yet). */
export interface WordMark { startMs: number; endMs: number; text: string; rest: string; next: boolean }

/** Markers for a line's timed words; `next` flags the word to stamp next (index as in `words()`). */
export function wordMarks(text: string, endMs: number, next: number): WordMark[] {
  const ws = lineWords(text);
  return ws.flatMap((w, k) => {
    if (w.timeMs === null || !w.text) return []; // untimed, or the trailing end tag
    let j = k + 1;
    while (j < ws.length && ws[j].timeMs === null) j++;
    const end = ws[j]?.timeMs ?? endMs;
    const rest = ws.slice(k + 1, j).map((x) => x.text).join('').trim();
    return [{ startMs: w.timeMs, endMs: Math.max(w.timeMs, end), text: w.text.trim(), rest, next: k === next }];
  });
}

/** Canvas waveform (or a plain time ruler without peaks), centred on the audible playhead. */
export function Waveform({ peaks, timeMs, lines, onSeek, selected, fit, marks, pending, loop }: {
  peaks?: Peaks;
  timeMs: number; // audible
  lines: LrcLine[];
  onSeek: (audibleMs: number) => void;
  selected?: number; // index into lines; its span gets the accent tint
  fit?: [number, number] | null; // word step: show this span (the selected line) instead of following the playhead
  marks?: WordMark[]; // word step: word markers instead of line markers
  pending?: string; // word step: the next word to stamp, untimed; labelled at the playhead (where Stamp puts it)
  loop?: [number, number] | null; // word step, Loop line on: bracketed, everything outside dimmed
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [zoomSpan, setSpan] = useState(10_000); // visible ms (line step)
  const [widen, setWiden] = useState(1); // word step: zoomed out by this much from the fitted line
  // Tape scrub: while dragging, the view centres on the dragged time instead of the playhead. A fitted view
  // stays put, so there the playhead follows the finger instead.
  const press = useRef<{ x: number; t: number; moved: boolean } | null>(null);
  const [dragMs, setDragMs] = useState<number | null>(null);
  const centre = dragMs ?? timeMs;
  // ponytail: the view always centres on the playhead (or the fitted line); to look elsewhere, seek (or drag) there.
  const [start, span] = viewWindow(centre, zoomSpan, fit, widen);
  const fitted = !!fit;
  const zoom = (f: number) =>
    fitted ? setWiden((w) => Math.min(60, Math.max(1, w * f))) : setSpan((s) => clampSpan(s * f));

  // Ctrl+wheel (= trackpad pinch in Chromium/Firefox) zooms; needs a non-passive listener.
  useEffect(() => {
    const c = ref.current!;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      zoom(e.deltaY > 0 ? 1.25 : 0.8);
    };
    c.addEventListener('wheel', onWheel, { passive: false });
    return () => c.removeEventListener('wheel', onWheel);
  }, [fitted]);

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
    // The opaque colour behind us (for chips and the playhead halo), in light and dark themes alike.
    let bg = '';
    for (let e = c.parentElement; e && !bg; e = e.parentElement) {
      const b = getComputedStyle(e).backgroundColor;
      if (b && b !== 'transparent' && !/^rgba\(.*,\s*0\)$/.test(b)) bg = b;
    }
    bg ||= '#fff';
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

    // Loop line: dim everything outside the line, then bracket it [ ].
    if (loop) {
      const [a, b] = [clampX(loop[0]), clampX(loop[1])];
      ctx.fillStyle = bg;
      ctx.globalAlpha = 0.6;
      ctx.fillRect(0, 0, a, h);
      ctx.fillRect(b, 0, w - b, h);
      ctx.globalAlpha = 1;
      ctx.fillStyle = accent;
      for (const [lx, d] of [[a, 1], [b, -1]]) {
        ctx.fillRect(d > 0 ? lx : lx - 3 * dpr, 0, 3 * dpr, h);
        ctx.fillRect(d > 0 ? lx : lx - 10 * dpr, 0, 10 * dpr, 3 * dpr);
        ctx.fillRect(d > 0 ? lx : lx - 10 * dpr, h - 3 * dpr, 10 * dpr, 3 * dpr);
      }
    }

    ctx.fillStyle = cs.color;
    ctx.font = font(12);
    const head = x(centre);
    // While dragging, a time bubble on the playhead shows where the release will land (drawn last).
    const bubble = dragMs === null ? '' : formatTime(Math.round(centre / 10) * 10);
    const bw = ctx.measureText(bubble).width + 10 * dpr;
    const bx = Math.min(w - bw, Math.max(0, head - bw / 2));
    const step = STEPS.find((s) => s / msPx >= 64 * dpr) ?? STEPS[STEPS.length - 1];
    for (let t = Math.ceil(start / step) * step; t < start + span; t += step) {
      ctx.fillRect(x(t), 0, dpr, 6 * dpr);
      const text = formatTime(t).replace(/\.\d+$/, '');
      const x1 = x(t) + 6 * dpr + ctx.measureText(text).width;
      // Skip labels cut off at the right edge, crossed by the playhead (its halo is 2 px each side) or under
      // the drag bubble.
      const hidden = (head >= x(t) + dpr && head <= x1 + 2 * dpr) || (bubble && x1 >= bx && x(t) <= bx + bw);
      if (x1 <= w && !hidden) ctx.fillText(text, x(t) + 3 * dpr, 18 * dpr);
    }
    // Stamp markers below the ruler, each tagged with its line number at the bottom.
    let no = 0;
    for (const l of marks ? [] : lines) {
      if (displayText(l.text)) no++;
      if (l.timeMs === null || l.timeMs < start || l.timeMs > start + span) continue;
      ctx.fillRect(x(l.timeMs), 22 * dpr, dpr, h);
      if (!displayText(l.text)) continue;
      const tw = ctx.measureText(String(no)).width; // near the right edge: left of its marker
      ctx.fillText(String(no), x(l.timeMs) + 3 * dpr + tw > w ? x(l.timeMs) - 3 * dpr - tw : x(l.timeMs) + 3 * dpr, h - 4 * dpr);
    }
    // Word step: a marker per timed word, alternate spans lightly shaded; the word Stamp re-times next is
    // outlined. Their labels go on top of the playhead, below.
    marks?.forEach((m, k) => {
      const x0 = clampX(m.startMs);
      const x1 = clampX(m.endMs);
      ctx.save();
      ctx.globalAlpha = k % 2 ? 0.08 : 0.16;
      ctx.fillRect(x0, 22 * dpr, x1 - x0, h);
      ctx.globalAlpha = 1;
      ctx.fillRect(x0, 22 * dpr, dpr, h);
      if (m.next) {
        ctx.strokeStyle = accent;
        ctx.lineWidth = 3 * dpr;
        ctx.strokeRect(x0 + 1.5 * dpr, 23.5 * dpr, x1 - x0 - 3 * dpr, h - 25 * dpr);
      }
      ctx.restore();
    });
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
    ctx.fillStyle = bg;
    ctx.fillRect(head - 2 * dpr, 0, 4 * dpr, h);
    ctx.fillStyle = accent;
    ctx.fillRect(head - dpr, 0, 2 * dpr, h);
    // Word labels: an outlined chip per timed word (like its chip in the list), on top of the playhead,
    // shortened with "…" to fit its span or left out. Its untimed words follow as faint ghost text.
    const fitText = (text: string, max: number) => {
      for (let n = text.length; n > 0; n--) {
        const t = n < text.length ? text.slice(0, n) + '…' : text;
        if (ctx.measureText(t).width <= max) return t;
      }
      return '';
    };
    marks?.forEach((m) => {
      const x0 = clampX(m.startMs) + 2 * dpr;
      const room = clampX(m.endMs) - x0 - 3 * dpr;
      ctx.font = font(12, m.next ? 'bold' : '');
      const text = fitText(m.text, room - 10 * dpr);
      if (!text) return;
      const cw = ctx.measureText(text).width + 10 * dpr;
      ctx.fillStyle = bg;
      ctx.fillRect(x0, h - 21 * dpr, cw, 18 * dpr);
      ctx.strokeStyle = accent;
      ctx.lineWidth = dpr;
      ctx.strokeRect(x0 + dpr / 2, h - 20.5 * dpr, cw - dpr, 17 * dpr);
      ctx.fillStyle = cs.color;
      ctx.fillText(text, x0 + 5 * dpr, h - 8 * dpr);
      const ghost = text === m.text && m.rest && fitText(m.rest, room - cw - 4 * dpr);
      if (ghost) {
        ctx.font = font(12);
        ctx.globalAlpha = 0.5;
        ctx.fillText(ghost, x0 + cw + 4 * dpr, h - 8 * dpr);
        ctx.globalAlpha = 1;
      }
    });
    // The next word to stamp sits at the playhead: that's where Stamp will put it.
    if (pending) {
      ctx.fillStyle = accent;
      ctx.font = font(12, 'bold');
      const bw = ctx.measureText(pending).width + 10 * dpr;
      const bx = head + 4 * dpr + bw > w ? head - 4 * dpr - bw : head + 4 * dpr;
      ctx.fillRect(bx, 24 * dpr, bw, 18 * dpr); // under the ruler, clear of the word labels at the bottom
      ctx.fillStyle = '#fff';
      ctx.fillText(pending, bx + 5 * dpr, 38 * dpr);
      ctx.fillStyle = accent;
    }
    if (bubble) {
      ctx.fillStyle = accent;
      ctx.font = font(12);
      ctx.fillRect(bx, 0, bw, 20 * dpr);
      ctx.fillStyle = '#fff';
      ctx.fillText(bubble, bx + 5 * dpr, 15 * dpr);
    }
  });

  const at = (e: PointerEvent<HTMLCanvasElement>) => e.currentTarget.getBoundingClientRect();
  const dir = fitted ? -1 : 1; // tape (drag left = later), or in a fitted view the playhead follows the finger
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
    if (p.moved) setDragMs(Math.max(0, Math.round(p.t - dir * (dx / r.width) * span)));
  };
  const up = (e: PointerEvent<HTMLCanvasElement>) => {
    const p = press.current;
    const r = at(e);
    press.current = null;
    setDragMs(null);
    if (!p || !r.width) return;
    // One seek on release (host seeks are slow); the clock's seek hold shows the target until it lands.
    const dx = e.clientX - p.x;
    if (p.moved || Math.abs(dx) >= DRAG_PX) onSeek(Math.max(0, Math.round(p.t - dir * (dx / r.width) * span)));
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
        <button type="button" aria-label="Zoom in" title="Zoom in" disabled={fitted && widen === 1} onClick={() => zoom(0.5)}>+</button>
        <button type="button" aria-label="Zoom out" title="Zoom out" onClick={() => zoom(2)}>−</button>
      </div>
    </div>
  );
}
