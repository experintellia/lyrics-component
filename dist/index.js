import { jsx, jsxs } from "react/jsx-runtime";
import { useRef, useState, useLayoutEffect, useEffect, useMemo, useReducer, memo } from "react";
import { parseLrc, displayText, formatTime, setLineTime, serializeLrc } from "./lrc.js";
const SNAP_MS = 300;
const CAP_MS = 500;
const SEEK_HOLD_MS = 1e3;
const holding = (s, now) => s.seekMs !== null && now < s.seekUntil;
function clockTime(s, now) {
  if (holding(s, now)) return s.seekMs;
  if (!s.playing || s.fresh) return s.tickMs;
  return Math.max(s.floorMs, s.tickMs + Math.min(now - s.arrival, CAP_MS));
}
function startClock(p, now) {
  return { tickMs: p.timeMs, arrival: now, playing: p.playing, floorMs: -Infinity, seekMs: null, seekUntil: 0, fresh: false };
}
function tick(s, p, now) {
  if (p.timeMs === s.tickMs && p.playing === s.playing) return s;
  const next = { ...startClock(p, now), seekMs: s.seekMs, seekUntil: s.seekUntil };
  if (holding(s, now)) {
    if (Math.abs(p.timeMs - s.seekMs) <= SNAP_MS) next.seekMs = null;
    return next;
  }
  if (p.playing && s.playing && !s.fresh) {
    const shown = clockTime(s, now);
    const diff = p.timeMs - shown;
    if (diff < 0 && diff >= -SNAP_MS) next.floorMs = shown;
  }
  return next;
}
function seekClock(s, targetMs, now) {
  return { ...s, seekMs: targetMs, seekUntil: now + SEEK_HOLD_MS };
}
function visibleClock(s) {
  return { ...s, fresh: true, seekMs: null, floorMs: -Infinity };
}
function usePlaybackTime(position, offsetMs, onSeek) {
  const state = useRef(null);
  state.current ?? (state.current = startClock(position, performance.now()));
  const [ms, setMs] = useState(position.timeMs);
  const raf = useRef(0);
  const kick = () => {
    if (raf.current) return;
    const frame = () => {
      const now = performance.now();
      const s = state.current;
      setMs(clockTime(s, now));
      raf.current = s.playing || holding(s, now) ? requestAnimationFrame(frame) : 0;
    };
    frame();
  };
  useLayoutEffect(() => {
    state.current = tick(state.current, position, performance.now());
    kick();
  }, [position]);
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState !== "visible") return;
      state.current = visibleClock(state.current);
      kick();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      cancelAnimationFrame(raf.current);
      raf.current = 0;
    };
  }, []);
  const seek = (audibleTargetMs) => {
    const target = audibleTargetMs + offsetMs;
    state.current = seekClock(state.current, target, performance.now());
    onSeek(target);
    kick();
  };
  return { audibleMs: ms - offsetMs, seek };
}
const RESUME_MS = 3e3;
function LyricsView({ lrc, position, onSeek, offsetMs = 0 }) {
  const lines = useMemo(() => parseLrc(lrc).lines, [lrc]);
  const { audibleMs, seek } = usePlaybackTime(position, offsetMs, onSeek);
  const box = useRef(null);
  const userTimer = useRef(0);
  let cur = null;
  for (const l of lines) if (l.timeMs !== null && l.timeMs <= audibleMs) cur = l.timeMs;
  const list = useMemo(
    () => lines.map((l, i) => {
      const text = displayText(l.text);
      if (l.timeMs === null) return /* @__PURE__ */ jsx("div", { className: "lyrics-line", dir: "auto", children: text }, i);
      if (!text) return null;
      return /* @__PURE__ */ jsx("button", { type: "button", className: "lyrics-line", dir: "auto", "data-t": l.timeMs, "aria-current": l.timeMs === cur || void 0, children: text }, i);
    }),
    [lines, cur]
  );
  const scrollToCurrent = () => {
    const b = box.current;
    const el = b == null ? void 0 : b.querySelector("[aria-current]");
    if (b && el && !userTimer.current) b.scrollTop = el.offsetTop - (b.clientHeight - el.offsetHeight) / 2;
  };
  useEffect(scrollToCurrent, [cur]);
  const onUserScroll = () => {
    clearTimeout(userTimer.current);
    userTimer.current = window.setTimeout(() => {
      userTimer.current = 0;
      scrollToCurrent();
    }, RESUME_MS);
  };
  if (!lines.length) return null;
  return /* @__PURE__ */ jsx(
    "div",
    {
      ref: box,
      className: "lyrics-view",
      onWheel: onUserScroll,
      onTouchMove: onUserScroll,
      onKeyDown: (e) => /^(Arrow(Up|Down)|Page(Up|Down)|Home|End)$/.test(e.key) && onUserScroll(),
      onPointerDown: (e) => e.target === e.currentTarget && onUserScroll(),
      onClick: (e) => {
        var _a;
        const t = (_a = e.target.closest("button")) == null ? void 0 : _a.dataset.t;
        if (t) seek(+t);
      },
      children: list
    }
  );
}
const STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600].map((s) => s * 1e3);
const clampSpan = (ms) => Math.min(6e5, Math.max(1e3, ms));
function Waveform({ peaks, timeMs, lines, onSeek }) {
  const ref = useRef(null);
  const [span, setSpan] = useState(1e4);
  const start = Math.max(0, timeMs - span / 2);
  useEffect(() => {
    const c = ref.current;
    const onWheel = (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setSpan((s) => clampSpan(s * (e.deltaY > 0 ? 1.25 : 0.8)));
    };
    c.addEventListener("wheel", onWheel, { passive: false });
    return () => c.removeEventListener("wheel", onWheel);
  }, []);
  useEffect(() => {
    const c = ref.current;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(c.clientWidth * dpr);
    const h = Math.round(c.clientHeight * dpr);
    if (c.width !== w) c.width = w;
    if (c.height !== h) c.height = h;
    if (!w || !h) return;
    const cs = getComputedStyle(c);
    const cssVar = (name, d) => cs.getPropertyValue(name).trim() || d;
    const msPx = span / w;
    const x = (t) => Math.round((t - start) / msPx);
    ctx.clearRect(0, 0, w, h);
    if (peaks) {
      ctx.fillStyle = cssVar("--lyrics-muted", "#888");
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
    ctx.font = `${12 * dpr}px ${cs.fontFamily || "sans-serif"}`;
    const step = STEPS.find((s) => s / msPx >= 64 * dpr) ?? STEPS[STEPS.length - 1];
    for (let t = Math.ceil(start / step) * step; t < start + span; t += step) {
      ctx.fillRect(x(t), 0, dpr, 6 * dpr);
      ctx.fillText(formatTime(t).replace(/\.\d+$/, ""), x(t) + 3 * dpr, 18 * dpr);
    }
    for (const l of lines) {
      if (l.timeMs !== null && l.timeMs >= start && l.timeMs <= start + span) ctx.fillRect(x(l.timeMs), 22 * dpr, dpr, h);
    }
    ctx.fillStyle = cssVar("--lyrics-accent", "#2a7ae2");
    ctx.fillRect(x(timeMs) - dpr, 0, 2 * dpr, h);
  });
  const click = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (r.width) onSeek(Math.max(0, Math.round(start + (e.clientX - r.left) / r.width * span)));
  };
  return /* @__PURE__ */ jsxs("div", { className: "lyrics-wave", children: [
    /* @__PURE__ */ jsx("canvas", { ref, onClick: click, "aria-label": "Waveform: click to seek" }),
    /* @__PURE__ */ jsx("button", { type: "button", "aria-label": "Zoom out", onClick: () => setSpan((s) => clampSpan(s * 2)), children: "−" }),
    /* @__PURE__ */ jsx("button", { type: "button", "aria-label": "Zoom in", onClick: () => setSpan((s) => clampSpan(s / 2)), children: "+" })
  ] });
}
const EMPTY = { timeMs: null, text: "" };
function commit(s, doc, emit, extra) {
  return { ...s, doc, past: [...s.past, s.doc], future: [], typing: null, emit, focus: null, ...extra };
}
function reducer(s, a) {
  const lines = s.doc.lines;
  const put = (next) => ({ ...s.doc, lines: next });
  switch (a.t) {
    case "load":
      return commit(s, a.doc, "none", { sel: 0 });
    case "select":
      return { ...s, sel: a.i };
    case "type": {
      const next = lines.slice();
      next[a.i] = { ...lines[a.i] ?? EMPTY, text: a.text };
      if (s.typing === a.i) return { ...s, doc: put(next), emit: "idle" };
      return commit(s, put(next), "idle", { typing: a.i });
    }
    case "split": {
      const cur = lines[a.i] ?? EMPTY;
      const next = lines.slice();
      next.splice(a.i, 1, { ...cur, text: cur.text.slice(0, a.start) }, { timeMs: null, text: cur.text.slice(a.end) });
      return commit(s, put(next), "idle", { sel: a.i + 1, focus: { i: a.i + 1, at: 0 } });
    }
    case "merge": {
      const prev = lines[a.i - 1];
      const cur = lines[a.i];
      if (!prev || !cur) return s;
      const next = lines.slice();
      next.splice(a.i - 1, 2, { ...prev, text: prev.text + cur.text });
      return commit(s, put(next), "idle", { sel: a.i - 1, focus: { i: a.i - 1, at: prev.text.length } });
    }
    case "paste": {
      const cur = lines[a.i] ?? EMPTY;
      const p = parseLrc(a.text);
      const ins = p.lines.length ? p.lines.slice() : [EMPTY];
      const last = ins.length - 1;
      ins[0] = { timeMs: cur.timeMs ?? ins[0].timeMs, text: cur.text.slice(0, a.start) + ins[0].text };
      const at = ins[last].text.length;
      ins[last] = { ...ins[last], text: ins[last].text + cur.text.slice(a.end) };
      const next = lines.slice();
      next.splice(a.i, 1, ...ins);
      return commit(s, { meta: [...s.doc.meta, ...p.meta], lines: next }, "idle", {
        sel: a.i + last,
        focus: { i: a.i + last, at }
      });
    }
    case "stamp":
    case "nudge":
    case "clear": {
      const line = lines[s.sel];
      if (!line || a.t !== "stamp" && line.timeMs === null) return s;
      const ms = a.t === "stamp" ? a.ms : a.t === "clear" ? null : Math.max(0, line.timeMs + a.d);
      const next = lines.slice();
      next[s.sel] = setLineTime(line, ms);
      return commit(s, put(next), "now", a.t === "stamp" ? { sel: Math.min(s.sel + 1, lines.length - 1) } : {});
    }
    case "undo":
      return s.past.length ? restore(s, s.past[s.past.length - 1], s.past.slice(0, -1), [s.doc, ...s.future]) : s;
    case "redo":
      return s.future.length ? restore(s, s.future[0], [...s.past, s.doc], s.future.slice(1)) : s;
  }
}
function restore(s, doc, past, future) {
  const sel = Math.max(0, Math.min(s.sel, doc.lines.length - 1));
  return { ...s, doc, past, future, sel, typing: null, emit: "now", focus: null };
}
const isTextField = (el) => el instanceof HTMLElement && (el.isContentEditable || el.matches(
  "textarea, select, input:not([type=checkbox], [type=radio], [type=range], [type=button], [type=submit], [type=reset], [type=file], [type=color], [type=image])"
));
function LyricsEditor(p) {
  return p.onChange ? /* @__PURE__ */ jsx(Editor, { ...p }) : /* @__PURE__ */ jsx(LyricsView, { ...p });
}
function Editor({ lrc, onChange, position, onSeek, peaks, offsetMs = 0 }) {
  const [s, dispatch] = useReducer(reducer, lrc, (l) => ({
    doc: parseLrc(l),
    past: [],
    future: [],
    sel: 0,
    typing: null,
    emit: "none",
    focus: null
  }));
  const { audibleMs, seek } = usePlaybackTime(position, offsetMs, onSeek);
  const inputs = useRef([]);
  const last = useRef(lrc);
  const pending = useRef(null);
  const timer = useRef(void 0);
  const cb = useRef(onChange);
  cb.current = onChange;
  const flush = () => {
    var _a;
    clearTimeout(timer.current);
    const doc = pending.current;
    pending.current = null;
    if (!doc) return;
    const out = serializeLrc(doc);
    if (out === last.current) return;
    last.current = out;
    (_a = cb.current) == null ? void 0 : _a.call(cb, out);
  };
  useEffect(() => {
    if (lrc === last.current) return;
    last.current = lrc;
    pending.current = null;
    dispatch({ t: "load", doc: parseLrc(lrc) });
  }, [lrc]);
  useEffect(() => {
    if (s.emit === "none") return;
    pending.current = s.doc;
    clearTimeout(timer.current);
    if (s.emit === "now") flush();
    else timer.current = setTimeout(flush, 500);
  }, [s.doc]);
  useEffect(() => () => flush(), []);
  useLayoutEffect(() => {
    const el = s.focus && inputs.current[s.focus.i];
    if (!el) return;
    el.focus();
    el.setSelectionRange(s.focus.at, s.focus.at);
  }, [s.focus]);
  const lines = s.doc.lines;
  const line = lines[s.sel];
  const stamped = (line == null ? void 0 : line.timeMs) != null;
  const stamp = () => {
    var _a, _b;
    dispatch({ t: "stamp", ms: Math.max(0, Math.round(audibleMs)) });
    (_b = (_a = inputs.current[s.sel + 1]) == null ? void 0 : _a.scrollIntoView) == null ? void 0 : _b.call(_a, { block: "nearest" });
  };
  const keys = useRef(null);
  keys.current = (e) => {
    if (isTextField(e.target)) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (mod && k === "z") dispatch({ t: e.shiftKey ? "redo" : "undo" });
    else if (mod && k === "y") dispatch({ t: "redo" });
    else if (k === "s" && !mod && !e.altKey && !e.repeat) stamp();
    else return;
    e.preventDefault();
  };
  useEffect(() => {
    const h = (e) => keys.current(e);
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);
  const dur = position.durationMs;
  return /* @__PURE__ */ jsxs("div", { className: "lyrics-editor", children: [
    /* @__PURE__ */ jsx(Waveform, { peaks, timeMs: audibleMs, lines, onSeek: seek }),
    /* @__PURE__ */ jsxs("div", { className: "lyrics-editor-bar", role: "toolbar", "aria-label": "Line tools", children: [
      /* @__PURE__ */ jsx("span", { className: "lyrics-editor-now", children: formatTime(audibleMs) }),
      /* @__PURE__ */ jsx("button", { type: "button", disabled: !s.past.length, onClick: () => dispatch({ t: "undo" }), children: "Undo" }),
      /* @__PURE__ */ jsx("button", { type: "button", disabled: !s.future.length, onClick: () => dispatch({ t: "redo" }), children: "Redo" }),
      [-100, -10, 10, 100].map((d) => /* @__PURE__ */ jsxs("button", { type: "button", disabled: !stamped, onClick: () => dispatch({ t: "nudge", d }), children: [
        d < 0 ? "−" : "+",
        Math.abs(d),
        " ms"
      ] }, d)),
      /* @__PURE__ */ jsx("button", { type: "button", disabled: !stamped, onClick: () => dispatch({ t: "clear" }), children: "Clear" }),
      /* @__PURE__ */ jsx("button", { type: "button", disabled: !stamped, onClick: () => seek(line.timeMs), children: "Play line" })
    ] }),
    /* @__PURE__ */ jsx("ol", { className: "lyrics-editor-lines", onBlur: flush, children: (lines.length ? lines : [EMPTY]).map((l, i) => /* @__PURE__ */ jsx(
      Row,
      {
        line: l,
        i,
        selected: i === s.sel,
        late: dur > 0 && l.timeMs !== null && l.timeMs > dur,
        dispatch,
        inputs
      },
      i
    )) }),
    /* @__PURE__ */ jsx("p", { className: "lyrics-editor-hint", children: "S stamps the selected line (when no text field has focus). Ctrl/⌘+Z undo, Ctrl/⌘+Shift+Z or Ctrl+Y redo." }),
    /* @__PURE__ */ jsx("button", { type: "button", className: "lyrics-editor-stamp", onPointerDown: (e) => e.preventDefault(), onClick: stamp, children: "Stamp" })
  ] });
}
const Row = memo(function Row2({ line, i, selected, late, dispatch, inputs }) {
  return /* @__PURE__ */ jsxs("li", { className: "lyrics-editor-row", "aria-current": selected || void 0, "data-late": late || void 0, children: [
    /* @__PURE__ */ jsx(
      "button",
      {
        type: "button",
        className: "lyrics-editor-time",
        title: late ? "Beyond the end of the track" : void 0,
        onClick: () => dispatch({ t: "select", i }),
        children: line.timeMs === null ? "--:--.--" : formatTime(line.timeMs)
      }
    ),
    /* @__PURE__ */ jsx(
      "input",
      {
        ref: (el) => {
          inputs.current[i] = el;
        },
        dir: "auto",
        "aria-label": `Line ${i + 1}`,
        value: line.text,
        onFocus: () => dispatch({ t: "select", i }),
        onChange: (e) => dispatch({ t: "type", i, text: e.target.value }),
        onKeyDown: (e) => {
          const { selectionStart: a, selectionEnd: b } = e.currentTarget;
          if (e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229) {
            e.preventDefault();
            dispatch({ t: "split", i, start: a ?? 0, end: b ?? 0 });
          } else if (e.key === "Backspace" && i > 0 && a === 0 && b === 0) {
            e.preventDefault();
            dispatch({ t: "merge", i });
          }
        },
        onPaste: (e) => {
          const text = e.clipboardData.getData("text/plain");
          if (!text.includes("\n")) return;
          e.preventDefault();
          const { selectionStart: a, selectionEnd: b } = e.currentTarget;
          dispatch({ t: "paste", i, start: a ?? 0, end: b ?? 0, text });
        }
      }
    )
  ] });
});
function bucketize(channels, sampleRate, msPerBucket) {
  var _a;
  const len = ((_a = channels[0]) == null ? void 0 : _a.length) ?? 0;
  const spb = sampleRate * msPerBucket / 1e3;
  const n = Math.ceil(len / spb);
  const min = new Float32Array(n);
  const max = new Float32Array(n);
  for (let b = 0; b < n; b++) {
    const start = Math.floor(b * spb);
    const end = Math.min(len, Math.floor((b + 1) * spb));
    let lo = Infinity;
    let hi = -Infinity;
    for (const ch of channels) {
      for (let i = start; i < end; i++) {
        const v = ch[i];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    min[b] = lo;
    max[b] = hi;
  }
  return { min, max, msPerBucket };
}
async function peaksFromAudio(src, msPerBucket = 10) {
  const bytes = src instanceof Blob ? await src.arrayBuffer() : src;
  const audio = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(bytes);
  const channels = Array.from({ length: audio.numberOfChannels }, (_, i) => audio.getChannelData(i));
  return bucketize(channels, audio.sampleRate, msPerBucket);
}
export {
  LyricsEditor,
  LyricsView,
  displayText,
  formatTime,
  parseLrc,
  peaksFromAudio,
  serializeLrc,
  setLineTime,
  usePlaybackTime
};
