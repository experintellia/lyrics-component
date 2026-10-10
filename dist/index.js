import { jsx, jsxs, Fragment } from "react/jsx-runtime";
import { useRef, useState, useLayoutEffect, useEffect, useMemo, memo, useReducer } from "react";
import { parseLrc, lineWords, displayText, setLineTime, joinWords, formatTime, serializeLrc } from "./lrc.js";
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
  const next2 = { ...startClock(p, now), seekMs: s.seekMs, seekUntil: s.seekUntil };
  if (holding(s, now)) {
    if (Math.abs(p.timeMs - s.seekMs) <= SNAP_MS) next2.seekMs = null;
    return next2;
  }
  if (p.playing && s.playing && !s.fresh) {
    const shown = clockTime(s, now);
    const diff = p.timeMs - shown;
    if (diff < 0 && diff >= -SNAP_MS) next2.floorMs = shown;
  }
  return next2;
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
function sungCount(words2, ms) {
  let n = 0;
  for (const w of words2) {
    if (w.timeMs !== null && w.timeMs > ms) break;
    n++;
  }
  return n;
}
const Line = memo(function Line2({ line, current, sung }) {
  const { timeMs, text, words: words2 } = line;
  if (timeMs === null) return /* @__PURE__ */ jsx("div", { className: "lyrics-line", dir: "auto", children: text });
  if (!text) return null;
  const join = (ws) => ws.map((w) => w.text).join("");
  return /* @__PURE__ */ jsx("button", { type: "button", className: "lyrics-line", dir: "auto", "data-t": timeMs, "aria-current": current || void 0, children: current && words2 ? /* @__PURE__ */ jsxs(Fragment, { children: [
    join(words2.slice(0, sung)),
    /* @__PURE__ */ jsx("span", { className: "lyrics-upcoming", children: join(words2.slice(sung)) })
  ] }) : text });
});
function LyricsView({ lrc, position, onSeek, offsetMs = 0 }) {
  const lines = useMemo(
    () => parseLrc(lrc).lines.map((l) => {
      const words2 = l.timeMs === null ? null : lineWords(l.text);
      return { timeMs: l.timeMs, text: displayText(l.text), words: (words2 == null ? void 0 : words2.some((w) => w.timeMs !== null)) ? words2 : null };
    }),
    [lrc]
  );
  const { audibleMs, seek } = usePlaybackTime(position, offsetMs, onSeek);
  const box = useRef(null);
  const userTimer = useRef(0);
  let cur = null;
  for (const l of lines) if (l.timeMs !== null && l.timeMs <= audibleMs) cur = l.timeMs;
  let sungKey = 0;
  for (const l of lines) if (l.timeMs === cur && l.words) sungKey += sungCount(l.words, audibleMs);
  const list = useMemo(
    () => lines.map((l, i) => {
      const current = l.timeMs !== null && l.timeMs === cur;
      return /* @__PURE__ */ jsx(Line, { line: l, current, sung: current && l.words ? sungCount(l.words, audibleMs) : 0 }, i);
    }),
    // audibleMs is read only through sungKey, which changes whenever its effect would
    [lines, cur, sungKey]
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
const hasText = (l) => !!l && !!displayText(l.text);
const docText = (doc) => doc.lines.map((l) => displayText(l.text)).join("\n");
const words = (l) => l ? lineWords(l.text).filter((w) => w.text) : [];
const nextWord = (l) => Math.max(0, words(l).findIndex((w) => w.timeMs === null));
const hasWordTimes = (l) => lineWords(l.text).some((w) => w.timeMs !== null);
function next(lines, i, d) {
  for (let k = i + d; k >= 0 && k < lines.length; k += d) if (hasText(lines[k])) return k;
  return i;
}
function first(lines, todo) {
  const i = lines.findIndex((l) => hasText(l) && todo(l));
  return i >= 0 ? i : Math.max(0, lines.findIndex(hasText));
}
const unstamped = (l) => l.timeMs === null;
function initState(doc) {
  const sel = first(doc.lines, unstamped);
  return {
    doc,
    past: [],
    future: [],
    step: doc.lines.length ? "lines" : "lyrics",
    sel,
    word: nextWord(doc.lines[sel]),
    draft: docText(doc),
    emit: false
  };
}
function applyText(old, text) {
  var _a;
  const rows = text ? text.split("\n").map((r) => r.trimEnd()) : [];
  const a = old.map((l) => displayText(l.text));
  const b = rows.map((r) => r.trim());
  const n = a.length;
  const m = b.length;
  const L = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out = [];
  let removed = [];
  for (let i = 0, j = 0; j < m; ) {
    if (i < n && a[i] === b[j]) {
      out.push(old[i++]);
      j++;
      removed = [];
    } else if (i < n && L[i + 1][j] >= L[i][j + 1]) removed.push(old[i++]);
    else out.push({ timeMs: ((_a = removed.shift()) == null ? void 0 : _a.timeMs) ?? null, text: rows[j++] });
  }
  return out;
}
function commit(s, lines, extra) {
  return { ...s, doc: { ...s.doc, lines }, past: [...s.past, s.doc], future: [], emit: true, ...extra };
}
function applyDraft(s) {
  const old = s.doc.lines;
  const lines = applyText(old, s.draft);
  if (lines.length === old.length && lines.every((l, i) => l === old[i])) return s;
  const sel = Math.min(s.sel, Math.max(0, lines.length - 1));
  return commit(s, lines, { sel, word: nextWord(lines[sel]) });
}
const select = (s, sel) => ({ ...s, sel, word: nextWord(s.doc.lines[sel]) });
function restore(s, doc, past, future) {
  const changed = doc.lines.length === s.doc.lines.length ? doc.lines.findIndex((l, i) => l !== s.doc.lines[i]) : -1;
  const sel = changed >= 0 ? changed : Math.max(0, Math.min(s.sel, doc.lines.length - 1));
  return { ...s, doc, past, future, sel, word: nextWord(doc.lines[sel]), draft: docText(doc), emit: true };
}
function reducer(s, a) {
  const lines = s.doc.lines;
  const line = lines[s.sel];
  const put = (l, extra) => commit(s, lines.map((x, i) => i === s.sel ? l : x), extra);
  switch (a.t) {
    case "load": {
      const { sel, word, draft } = initState(a.doc);
      return { ...s, doc: a.doc, past: [...s.past, s.doc], future: [], sel, word, draft, emit: false };
    }
    case "draft":
      return { ...s, draft: a.text };
    case "commit":
      return applyDraft(s);
    case "step": {
      const c = applyDraft(s);
      const l = c.doc.lines;
      if (a.step === "lyrics" || a.step === s.step) return { ...c, step: a.step };
      const todo = a.step === "lines" ? unstamped : (x) => words(x).some((w) => w.timeMs === null);
      return { ...select(c, first(l, todo)), step: a.step };
    }
    case "select":
      return select(s, a.i);
    case "move":
      return select(s, next(lines, s.sel, a.d));
    case "stamp": {
      if (!line) return s;
      const done = line.timeMs === null && lines.every((x, i) => i === s.sel || !hasText(x) || x.timeMs !== null);
      const sel = done ? -1 : next(lines, s.sel, 1);
      return put(setLineTime(line, a.ms), { sel, word: nextWord(lines[sel]) });
    }
    case "stampWord": {
      const ws = line ? lineWords(line.text) : [];
      const n = ws.filter((w) => w.text).length;
      if (!line || s.word >= n) return s;
      ws[s.word] = { ...ws[s.word], timeMs: a.ms };
      const l = { timeMs: s.word === 0 ? a.ms : line.timeMs, text: joinWords(ws) };
      if (s.word + 1 < n) return put(l, { word: s.word + 1 });
      const sel = next(lines, s.sel, 1);
      return sel === s.sel ? put(l, { word: n }) : put(l, { sel, word: nextWord(lines[sel]) });
    }
    case "pickWord":
      return { ...s, word: a.w };
    case "nudge":
      return (line == null ? void 0 : line.timeMs) != null ? put(setLineTime(line, Math.max(0, line.timeMs + a.d))) : s;
    case "clear":
      return (line == null ? void 0 : line.timeMs) != null ? put(setLineTime(line, null)) : s;
    case "clearWords":
      return line && hasWordTimes(line) ? put({ ...line, text: displayText(line.text) }, { word: 0 }) : s;
    case "undo": {
      const c = applyDraft(s);
      return c.past.length ? restore(c, c.past[c.past.length - 1], c.past.slice(0, -1), [c.doc, ...c.future]) : c;
    }
    case "redo":
      return s.future.length ? restore(s, s.future[0], [...s.past, s.doc], s.future.slice(1)) : s;
  }
}
const STEPS$1 = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600].map((s) => s * 1e3);
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
    const step = STEPS$1.find((s) => s / msPx >= 64 * dpr) ?? STEPS$1[STEPS$1.length - 1];
    for (let t = Math.ceil(start / step) * step; t < start + span; t += step) {
      ctx.fillRect(x(t), 0, dpr, 6 * dpr);
      ctx.fillText(formatTime(t).replace(/\.\d+$/, ""), x(t) + 3 * dpr, 18 * dpr);
    }
    let no = 0;
    for (const l of lines) {
      if (displayText(l.text)) no++;
      if (l.timeMs === null || l.timeMs < start || l.timeMs > start + span) continue;
      ctx.fillRect(x(l.timeMs), 22 * dpr, dpr, h);
      if (displayText(l.text)) ctx.fillText(String(no), x(l.timeMs) + 3 * dpr, h - 4 * dpr);
    }
    ctx.fillStyle = cssVar("--lyrics-accent", "#2a7ae2");
    ctx.fillRect(x(timeMs) - dpr, 0, 2 * dpr, h);
  });
  const click = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (r.width) onSeek(Math.max(0, Math.round(start + (e.clientX - r.left) / r.width * span)));
  };
  return /* @__PURE__ */ jsxs("div", { className: "lyrics-wave", children: [
    /* @__PURE__ */ jsx("canvas", { ref, onClick: click, "aria-label": "Waveform: click to seek", title: "Click to seek" }),
    /* @__PURE__ */ jsxs("div", { className: "lyrics-wave-zoom", children: [
      /* @__PURE__ */ jsx("button", { type: "button", onClick: () => setSpan((s) => clampSpan(s / 2)), children: "Zoom in" }),
      /* @__PURE__ */ jsx("button", { type: "button", onClick: () => setSpan((s) => clampSpan(s * 2)), children: "Zoom out" })
    ] })
  ] });
}
const STEPS = [
  ["lyrics", "Lyrics"],
  ["lines", "Sync lines"],
  ["words", "Sync words", "optional"]
];
const isTextField = (el) => el instanceof HTMLElement && (el.isContentEditable || el.matches(
  "textarea, select, input:not([type=checkbox], [type=radio], [type=range], [type=button], [type=submit], [type=reset], [type=file], [type=color], [type=image])"
));
const NATIVE_KEYS = "input, select, audio, video, a, button:not(.lyrics-editor-line)";
function LyricsEditor(p) {
  return p.onChange ? /* @__PURE__ */ jsx(Editor, { ...p }) : /* @__PURE__ */ jsx(LyricsView, { ...p });
}
function Editor({ lrc, onChange, position, onSeek, peaks, offsetMs = 0 }) {
  const [s, dispatch] = useReducer(reducer, lrc, (l) => initState(parseLrc(l)));
  const { audibleMs, seek } = usePlaybackTime(position, offsetMs, onSeek);
  const seekRef = useRef(seek);
  seekRef.current = seek;
  const last = useRef(lrc);
  const cb = useRef(onChange);
  cb.current = onChange;
  const emit = (doc) => {
    var _a;
    const out = serializeLrc(doc);
    if (out === last.current) return;
    last.current = out;
    (_a = cb.current) == null ? void 0 : _a.call(cb, out);
  };
  useEffect(() => {
    if (lrc === last.current) return;
    last.current = lrc;
    dispatch({ t: "load", doc: parseLrc(lrc) });
  }, [lrc]);
  useEffect(() => {
    if (s.emit) emit(s.doc);
  }, [s.doc]);
  useEffect(() => {
    const t = setTimeout(() => dispatch({ t: "commit" }), 500);
    return () => clearTimeout(t);
  }, [s.draft]);
  const latest = useRef(s);
  latest.current = s;
  useEffect(
    () => () => {
      const c = reducer(latest.current, { t: "commit" });
      if (c !== latest.current) emit(c.doc);
    },
    []
  );
  const lines = s.doc.lines;
  const line = lines[s.sel];
  const ws = words(line);
  const wordStep = s.step === "words";
  const canStamp = wordStep ? s.word < ws.length : !!line;
  const ms = Math.max(0, Math.round(audibleMs));
  const stamp = () => canStamp && dispatch(wordStep ? { t: "stampWord", ms } : { t: "stamp", ms });
  const textLines = lines.filter(hasText);
  const lineNo = lines.slice(0, s.sel + 1).filter(hasText).length;
  const wordsDone = textLines.filter((l) => timedWords(l) === words(l).length).length;
  const label = !canStamp ? "Stamp" : wordStep ? `Stamp “${ws[s.word].text.trim()}”` : `${line.timeMs !== null ? "Re-stamp" : "Stamp"} ${hasText(line) ? `line ${lineNo}` : "break"}`;
  const nos = useMemo(() => {
    let n = 0;
    return lines.map((l) => hasText(l) ? ++n : n);
  }, [lines]);
  let clash = "";
  if (s.step === "lines" && line)
    lines.forEach((l, i) => {
      if (i === s.sel || l.timeMs === null || !hasText(l)) return;
      if (i < s.sel && l.timeMs > ms && !clash) clash = `before line ${nos[i]}`;
      if (i > s.sel && l.timeMs < ms) clash = `after line ${nos[i]}`;
    });
  const todo = lines.findIndex((l) => hasText(l) && l.timeMs === null);
  const resume = todo >= 0 && todo !== s.sel ? { i: todo, no: nos[todo] } : void 0;
  const preRoll = (i) => {
    const t = lines[i].timeMs;
    if (t === null) return;
    const prev = lines.slice(0, i).reduce((m, l) => l.timeMs !== null && l.timeMs <= t ? Math.max(m, l.timeMs) : m, 0);
    seekRef.current(Math.max(prev, t - 3e3));
  };
  const preRollRef = useRef(preRoll);
  preRollRef.current = preRoll;
  const keys = useRef(null);
  keys.current = (e) => {
    if (isTextField(e.target)) return;
    const native = e.target instanceof Element && !!e.target.closest(NATIVE_KEYS);
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (mod && k === "z") dispatch({ t: e.shiftKey ? "redo" : "undo" });
    else if (mod && k === "y") dispatch({ t: "redo" });
    else if (s.step === "lyrics" || mod || e.altKey) return;
    else if (k === "s" || k === "enter" && !native) !e.repeat && stamp();
    else if ((k === "arrowup" || k === "arrowdown") && !native) dispatch({ t: "move", d: k === "arrowup" ? -1 : 1 });
    else return;
    e.preventDefault();
  };
  useEffect(() => {
    const h = (e) => keys.current(e);
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);
  const list = useRef(null);
  useEffect(() => {
    var _a, _b, _c;
    (_c = (_b = (_a = list.current) == null ? void 0 : _a.querySelector("[aria-current]")) == null ? void 0 : _b.scrollIntoView) == null ? void 0 : _c.call(_b, { block: "nearest" });
  }, [s.sel, s.step, lines]);
  const dur = position.durationMs;
  const rows = useMemo(() => {
    let no = 0;
    return lines.map((l, i) => {
      const text = displayText(l.text);
      if (!text && l.timeMs === null) return /* @__PURE__ */ jsx("li", { className: "lyrics-editor-gap" }, i);
      if (text) no++;
      const sel = i === s.sel;
      const late = dur > 0 && l.timeMs !== null && l.timeMs > dur;
      return /* @__PURE__ */ jsxs("li", { className: "lyrics-editor-row", "aria-current": sel || void 0, "data-late": late || void 0, children: [
        /* @__PURE__ */ jsxs(
          "button",
          {
            type: "button",
            className: "lyrics-editor-line",
            onClick: () => {
              dispatch({ t: "select", i });
              preRollRef.current(i);
            },
            children: [
              /* @__PURE__ */ jsx("span", { className: "lyrics-editor-no", children: text ? no : "♪" }),
              /* @__PURE__ */ jsx("span", { className: "lyrics-editor-time", title: late ? "After the end of the track" : void 0, children: l.timeMs === null ? "—" : formatTime(l.timeMs) }),
              /* @__PURE__ */ jsxs("span", { className: "lyrics-editor-text", dir: "auto", children: [
                text || "Instrumental break",
                s.step === "words" && text && /* @__PURE__ */ jsx("small", { className: "lyrics-editor-badge", children: timedWords(l) === words(l).length ? "words ✓" : `${timedWords(l)}/${words(l).length} words` })
              ] })
            ]
          }
        ),
        sel && (s.step === "words" ? /* @__PURE__ */ jsx(WordTools, { line: l, word: s.word, dispatch, seek: (t) => seekRef.current(t) }) : /* @__PURE__ */ jsx(LineTools, { line: l, dispatch, seek: (t) => seekRef.current(t), resume }))
      ] }, i);
    });
  }, [lines, s.sel, s.word, s.step, dur, resume == null ? void 0 : resume.i]);
  const undoRedo = /* @__PURE__ */ jsxs("span", { className: "lyrics-editor-undo", children: [
    /* @__PURE__ */ jsx("button", { type: "button", disabled: !s.past.length, onClick: () => dispatch({ t: "undo" }), children: "Undo" }),
    /* @__PURE__ */ jsx("button", { type: "button", disabled: !s.future.length, onClick: () => dispatch({ t: "redo" }), children: "Redo" })
  ] });
  const synced = textLines.filter((l) => l.timeMs !== null).length;
  const allSynced = synced === textLines.length;
  let banner;
  if (!textLines.length) banner = /* @__PURE__ */ jsx(Fragment, { children: "No lyrics yet. Add them in step 1 first." });
  else if (wordStep)
    banner = /* @__PURE__ */ jsxs(Fragment, { children: [
      "Optional, for word-by-word highlighting. Tap a line, press play, then tap ",
      /* @__PURE__ */ jsx("b", { children: "Stamp" }),
      " as each highlighted word starts. After its last word, the next line comes up."
    ] });
  else if (allSynced)
    banner = /* @__PURE__ */ jsx(Fragment, { children: "All lines are synced ✓ Play it back to check. Tap a line to fix it, or time single words in step 3 (optional)." });
  else
    banner = /* @__PURE__ */ jsxs(Fragment, { children: [
      synced ? "" : "These lyrics have no timing yet. ",
      "Press play, then tap ",
      /* @__PURE__ */ jsx("b", { children: "Stamp" }),
      " the moment each highlighted line starts."
    ] });
  const progress = !textLines.length ? "" : wordStep ? !ws.length ? `Line ${lineNo}` : s.word < ws.length ? `Line ${lineNo}: word ${s.word + 1} of ${ws.length}` : `Line ${lineNo}: all words timed ✓` : allSynced ? line ? `All ${textLines.length} lines synced ✓` : "" : `${synced} of ${textLines.length} lines synced`;
  return /* @__PURE__ */ jsxs("div", { className: "lyrics-editor", children: [
    /* @__PURE__ */ jsx("div", { className: "lyrics-editor-tabs", role: "tablist", "aria-label": "Editor steps", children: STEPS.map(([id, name, note], k) => /* @__PURE__ */ jsxs(
      "button",
      {
        type: "button",
        role: "tab",
        "aria-selected": s.step === id,
        onClick: () => dispatch({ t: "step", step: id }),
        children: [
          /* @__PURE__ */ jsx("span", { className: "lyrics-editor-stepno", "aria-hidden": "true", children: k + 1 }),
          " ",
          name,
          note && /* @__PURE__ */ jsx("small", { "aria-hidden": "true", children: note })
        ]
      },
      id
    )) }),
    s.step === "lyrics" ? /* @__PURE__ */ jsxs("div", { role: "tabpanel", "aria-label": "Lyrics", className: "lyrics-editor-panel", children: [
      /* @__PURE__ */ jsx("p", { className: "lyrics-editor-banner", id: "lyrics-editor-howto", children: "Type or paste the lyrics — one line per row; blank line between verses." }),
      /* @__PURE__ */ jsx(
        "textarea",
        {
          className: "lyrics-editor-text-input",
          "aria-label": "Lyrics text",
          "aria-describedby": "lyrics-editor-howto",
          dir: "auto",
          rows: Math.max(8, s.draft.split("\n").length + 1),
          value: s.draft,
          onChange: (e) => dispatch({ t: "draft", text: e.target.value }),
          onBlur: () => dispatch({ t: "commit" })
        }
      ),
      /* @__PURE__ */ jsxs("div", { className: "lyrics-editor-dock", children: [
        /* @__PURE__ */ jsx("p", { className: "lyrics-editor-progress", children: s.draft.trim() ? `${s.draft.split("\n").filter((r) => r.trim()).length} lines` : dur ? "Type or paste at least one line to continue." : "Load the song and add at least one line to continue." }),
        undoRedo,
        /* @__PURE__ */ jsx(
          "button",
          {
            type: "button",
            className: "lyrics-editor-primary",
            disabled: !s.draft.trim(),
            onClick: () => dispatch({ t: "step", step: "lines" }),
            children: "Next: sync to the music →"
          }
        )
      ] })
    ] }) : /* @__PURE__ */ jsxs("div", { role: "tabpanel", "aria-label": wordStep ? "Sync words" : "Sync lines", className: "lyrics-editor-panel", children: [
      /* @__PURE__ */ jsx("p", { className: "lyrics-editor-banner", children: banner }),
      /* @__PURE__ */ jsx(Waveform, { peaks, timeMs: audibleMs, lines, onSeek: seek }),
      /* @__PURE__ */ jsxs("p", { className: "lyrics-editor-tip", children: [
        wordStep ? `${wordsDone} of ${textLines.length} lines have word timing. Tap a line to time its words (it rewinds to just before the line).` : "Tap any line to fix its time (it rewinds to just before the line).",
        /* @__PURE__ */ jsx("span", { className: "lyrics-editor-hint", children: " Keys: S or Enter = Stamp · ↑/↓ = choose line · Ctrl/⌘+Z = undo" })
      ] }),
      textLines.length ? /* @__PURE__ */ jsx("ol", { ref: list, className: "lyrics-editor-lines", children: rows }) : /* @__PURE__ */ jsx("button", { type: "button", className: "lyrics-editor-primary", onClick: () => dispatch({ t: "step", step: "lyrics" }), children: "← Add lyrics" }),
      /* @__PURE__ */ jsxs("div", { className: "lyrics-editor-dock", "data-done": !wordStep && allSynced && !line || void 0, children: [
        /* @__PURE__ */ jsxs("p", { className: "lyrics-editor-progress", children: [
          /* @__PURE__ */ jsx("span", { className: "lyrics-editor-now", "aria-label": "Playback position", children: formatTime(audibleMs) }),
          !position.playing && /* @__PURE__ */ jsx("b", { children: " · paused" }),
          clash ? /* @__PURE__ */ jsxs("b", { className: "lyrics-editor-warn", children: [
            " · ⚠ the playhead is ",
            clash,
            ": play from just before this line first"
          ] }) : progress && /* @__PURE__ */ jsxs("span", { children: [
            " · ",
            progress
          ] })
        ] }),
        undoRedo,
        !wordStep && allSynced && !line ? (
          // Just finished: a done card instead of a "Re-stamp" button that invites an accidental overwrite.
          /* @__PURE__ */ jsxs("div", { className: "lyrics-editor-done", role: "status", children: [
            /* @__PURE__ */ jsxs("p", { children: [
              /* @__PURE__ */ jsxs("b", { children: [
                "All ",
                textLines.length,
                " lines synced ✓"
              ] }),
              " Play it from the start to check. Tap any line to fix it."
            ] }),
            /* @__PURE__ */ jsx("button", { type: "button", onClick: () => seek(0), children: "⏮ Back to the start" }),
            /* @__PURE__ */ jsx("button", { type: "button", onClick: () => dispatch({ t: "step", step: "words" }), children: "Next: sync words (optional) →" })
          ] })
        ) : (
          /* preventDefault: tapping Stamp must not steal focus or pop up the iOS keyboard. Paused: Stamp is
             outlined, so the host's Play is the first thing to press. */
          /* @__PURE__ */ jsx(
            "button",
            {
              type: "button",
              className: "lyrics-editor-stamp",
              disabled: !canStamp,
              "data-paused": !position.playing || void 0,
              "data-warn": !!clash || void 0,
              onPointerDown: (e) => e.preventDefault(),
              onClick: stamp,
              children: label
            }
          )
        )
      ] })
    ] })
  ] });
}
const timedWords = (l) => words(l).filter((w) => w.timeMs !== null).length;
const PlayHere = ({ line, seek }) => /* @__PURE__ */ jsx("button", { type: "button", disabled: line.timeMs === null, onClick: () => seek(line.timeMs), children: "▶ Play from here" });
function LineTools({ line, dispatch, seek, resume }) {
  const back = resume && /* @__PURE__ */ jsxs("button", { type: "button", className: "lyrics-editor-link", onClick: () => dispatch({ t: "select", i: resume.i }), children: [
    "Back to line ",
    resume.no,
    " →"
  ] });
  if (line.timeMs === null)
    return /* @__PURE__ */ jsxs("div", { className: "lyrics-editor-tools", children: [
      /* @__PURE__ */ jsxs("p", { className: "lyrics-editor-tip", children: [
        "Not synced yet: press play and tap ",
        /* @__PURE__ */ jsx("b", { children: "Stamp" }),
        " when this line starts."
      ] }),
      back
    ] });
  return /* @__PURE__ */ jsxs("div", { className: "lyrics-editor-tools", role: "group", "aria-label": "Fix this line", children: [
    /* @__PURE__ */ jsxs("p", { className: "lyrics-editor-tip", children: [
      "Wrong time? Press play, then tap ",
      /* @__PURE__ */ jsx("b", { children: "Re-stamp" }),
      " when the line starts. Or nudge it:"
    ] }),
    [-100, 100].map((d) => /* @__PURE__ */ jsx("button", { type: "button", className: "lyrics-editor-nudge", onClick: () => dispatch({ t: "nudge", d }), children: d < 0 ? "−0.1 s" : "+0.1 s" }, d)),
    /* @__PURE__ */ jsx(PlayHere, { line, seek }),
    back,
    /* @__PURE__ */ jsx("button", { type: "button", className: "lyrics-editor-quiet", onClick: () => dispatch({ t: "clear" }), children: "Clear time" })
  ] });
}
function WordTools({ line, word, dispatch, seek }) {
  const ws = words(line);
  return /* @__PURE__ */ jsxs("div", { className: "lyrics-editor-tools", role: "group", "aria-label": "Word timing", children: [
    /* @__PURE__ */ jsx("div", { className: "lyrics-editor-chips", children: ws.map((w, k) => /* @__PURE__ */ jsxs(
      "button",
      {
        type: "button",
        className: "lyrics-editor-chip",
        "aria-current": k === word || void 0,
        "data-timed": w.timeMs !== null || void 0,
        onClick: () => dispatch({ t: "pickWord", w: k }),
        children: [
          w.text.trim(),
          /* @__PURE__ */ jsx("small", { children: w.timeMs === null ? "—" : formatTime(w.timeMs) })
        ]
      },
      k
    )) }),
    /* @__PURE__ */ jsx("p", { className: "lyrics-editor-tip", children: !ws.length ? "No words on this line." : word < ws.length ? "Tap Stamp as the blue word starts. After the last word, the next line opens. Tap a word to re-time from that word on." : "All words timed. Tap a word to re-time from that word on." }),
    /* @__PURE__ */ jsx(PlayHere, { line, seek }),
    /* @__PURE__ */ jsx("button", { type: "button", onClick: () => dispatch({ t: "move", d: 1 }), children: "Next line →" }),
    /* @__PURE__ */ jsx(
      "button",
      {
        type: "button",
        className: "lyrics-editor-quiet",
        disabled: !hasWordTimes(line),
        onClick: () => dispatch({ t: "clearWords" }),
        children: "Clear word timing"
      }
    )
  ] });
}
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
  joinWords,
  lineWords,
  parseLrc,
  peaksFromAudio,
  serializeLrc,
  setLineTime,
  usePlaybackTime
};
