import { jsx, jsxs, Fragment } from "react/jsx-runtime";
import { useRef, useState, useLayoutEffect, useEffect, useMemo, memo, Fragment as Fragment$1, useReducer } from "react";
import { parseLrc, lineWords, displayText, setLineTime, joinWords, formatTime, serializeLrc } from "./lrc.js";
const SNAP_MS = 300;
const CAP_MS = 500;
const SEEK_HOLD_MS = 1e3;
const holding = (s, now) => s.seekMs !== null && now < s.seekUntil;
function clockTime(s, now) {
  if (holding(s, now)) return s.seekMs;
  if (!s.playing || s.fresh) return s.tickMs;
  return Math.max(s.floorMs, s.tickMs + Math.min(now - s.arrival, CAP_MS) * s.rate);
}
function startClock(p, now) {
  return { tickMs: p.timeMs, arrival: now, playing: p.playing, rate: p.rate ?? 1, floorMs: -Infinity, seekMs: null, seekUntil: 0, fresh: false };
}
function tick(s, p, now) {
  if (p.timeMs === s.tickMs && p.playing === s.playing && (p.rate ?? 1) === s.rate) return s;
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
  const lag = offsetMs * (position.rate ?? 1);
  const seek = (audibleTargetMs) => {
    const target = audibleTargetMs + lag;
    state.current = seekClock(state.current, target, performance.now());
    onSeek(target);
    kick();
  };
  return { audibleMs: ms - lag, seek };
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
const Line = memo(function Line2({ line, current, past, sung }) {
  var _a;
  const { timeMs, text, words: words2, endMs } = line;
  if (timeMs === null) return /* @__PURE__ */ jsx("div", { className: "lyrics-line", dir: "auto", children: text });
  if (!text) return null;
  let body = text;
  if (current && words2) {
    const phrases = [];
    for (const w of words2.slice(0, sung)) {
      if (w.timeMs !== null || !phrases.length) phrases.push({ t: w.timeMs ?? timeMs, text: "" });
      phrases[phrases.length - 1].text += w.text;
    }
    const end = ((_a = words2[sung]) == null ? void 0 : _a.timeMs) ?? endMs;
    body = /* @__PURE__ */ jsxs(Fragment, { children: [
      phrases.map((p, i) => {
        const active = i === phrases.length - 1;
        const t = p.text.trimEnd();
        return /* @__PURE__ */ jsxs(Fragment$1, { children: [
          /* @__PURE__ */ jsx(
            "span",
            {
              className: active ? "lyrics-active" : "lyrics-sung",
              "data-s": active ? p.t : void 0,
              "data-e": active ? end ?? void 0 : void 0,
              children: t
            }
          ),
          p.text.slice(t.length)
        ] }, i);
      }),
      /* @__PURE__ */ jsx("span", { className: "lyrics-upcoming", children: words2.slice(sung).map((w) => w.text).join("") })
    ] });
  }
  return /* @__PURE__ */ jsx("button", { type: "button", className: "lyrics-line", dir: "auto", "data-t": timeMs, "data-past": past || void 0, "aria-current": current || void 0, children: body });
});
function LyricsView({ lrc, position, onSeek, offsetMs = 0 }) {
  const lines = useMemo(() => {
    const parsed = parseLrc(lrc).lines;
    return parsed.map((l) => {
      var _a;
      const t = l.timeMs;
      const words2 = t === null ? null : lineWords(l.text);
      const endMs = t === null ? null : ((_a = parsed.find((n) => n.timeMs !== null && n.timeMs > t)) == null ? void 0 : _a.timeMs) ?? null;
      return { timeMs: t, text: displayText(l.text), words: (words2 == null ? void 0 : words2.some((w) => w.timeMs !== null)) ? words2 : null, endMs };
    });
  }, [lrc]);
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
      const past = l.timeMs !== null && cur !== null && l.timeMs < cur;
      return /* @__PURE__ */ jsx(Line, { line: l, current, past, sung: current && l.words ? sungCount(l.words, audibleMs) : 0 }, i);
    }),
    // audibleMs is read only through sungKey, which changes whenever its effect would
    [lines, cur, sungKey]
  );
  useLayoutEffect(() => {
    var _a;
    (_a = box.current) == null ? void 0 : _a.querySelectorAll(".lyrics-active").forEach((el) => {
      const s = +el.dataset.s;
      const e = el.dataset.e ? +el.dataset.e : position.durationMs;
      const p = e > s ? Math.min(1, Math.max(0, (audibleMs - s) / (e - s))) : 1;
      el.style.setProperty("--lyrics-fill", `${p * 100}%`);
    });
  });
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
const nextWord = (l) => Math.max(0, words(l).findIndex((w, k) => w.timeMs === null && !(k === 0 && l.timeMs !== null)));
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
  var _a;
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
    case "paste": {
      const c = applyDraft(s);
      const before = c.draft.slice(0, a.start);
      const after = c.draft.slice(a.end);
      const pre = before && !before.endsWith("\n") ? before + "\n" : before;
      const post = after && !after.startsWith("\n") ? "\n" + after : after;
      const k = a.doc.lines.length;
      const lines2 = applyText(c.doc.lines, pre + Array(k).fill("\0").join("\n") + post);
      lines2.splice(pre.split("\n").length - 1, k, ...a.doc.lines);
      const keys = new Set(a.doc.meta.map((m) => m.key));
      const doc = { meta: [...c.doc.meta.filter((m) => !keys.has(m.key)), ...a.doc.meta], lines: lines2 };
      const sel = Math.min(c.sel, lines2.length - 1);
      const draft = pre + a.doc.lines.map((l) => displayText(l.text)).join("\n") + post;
      const n = a.doc.lines.filter((l) => l.timeMs !== null).length;
      return { ...c, doc, past: [...c.past, c.doc], future: [], emit: true, sel, word: nextWord(lines2[sel]), draft, pasted: { n, doc } };
    }
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
      if (s.word > 0 && ws[0].timeMs === null) ws[0] = { ...ws[0], timeMs: line.timeMs };
      const l = { timeMs: s.word === 0 ? a.ms : line.timeMs, text: joinWords(ws) };
      if (s.word + 1 < n) return put(l, { word: s.word + 1 });
      const sel = next(lines, s.sel, 1);
      return sel === s.sel ? put(l, { word: n }) : put(l, { sel, word: nextWord(lines[sel]) });
    }
    case "pickWord":
      return { ...s, word: a.w };
    case "moveWord": {
      const w = s.word + a.d;
      if (w >= 0 && w < words(line).length) return { ...s, word: w };
      const i = next(lines, s.sel, a.d);
      return i === s.sel ? s : { ...s, sel: i, word: a.d > 0 ? 0 : Math.max(0, words(lines[i]).length - 1) };
    }
    case "nudge": {
      if (s.step !== "words") return (line == null ? void 0 : line.timeMs) != null ? put(setLineTime(line, Math.max(0, line.timeMs + a.d))) : s;
      const ws = line ? lineWords(line.text) : [];
      const t = ((_a = ws[s.word]) == null ? void 0 : _a.text) ? ws[s.word].timeMs : null;
      if (t === null) return s;
      ws[s.word] = { ...ws[s.word], timeMs: Math.max(0, t + a.d) };
      return put({ timeMs: s.word === 0 ? ws[0].timeMs : line.timeMs, text: joinWords(ws) });
    }
    case "clear":
      return (line == null ? void 0 : line.timeMs) != null ? put(setLineTime(line, null)) : s;
    case "clearWords":
      return line && hasWordTimes(line) ? put({ ...line, text: displayText(line.text) }, { word: nextWord(line) }) : s;
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
const DRAG_PX = 4;
const HUES = [30, 150, 290, 60];
const section = (k) => [`--lyrics-section-${k % HUES.length + 1}`, HUES[k % HUES.length]];
const bandColor = (k, alpha = 0.2) => {
  const [v, hue] = section(k);
  return `color-mix(in srgb, var(${v}, hsl(${hue} 75% 50%)) ${alpha * 100}%, transparent)`;
};
const LABEL = /^\[.+\]$/;
const isLabel = (l) => l.timeMs === null && LABEL.test(displayText(l.text));
const stampFrom = (lines, i, end) => {
  var _a;
  return ((_a = lines.slice(i).find((l) => l.timeMs !== null)) == null ? void 0 : _a.timeMs) ?? end;
};
function sections(lines, durationMs = Infinity) {
  var _a;
  const out = [];
  for (let i = 0; i < lines.length; ) {
    if (!displayText(lines[i].text)) {
      i++;
      continue;
    }
    let j = i + 1;
    while (j < lines.length && displayText(lines[j].text) && !isLabel(lines[j])) j++;
    const start = (_a = lines.slice(i, j).find((l) => l.timeMs !== null)) == null ? void 0 : _a.timeMs;
    const label = isLabel(lines[i]) ? displayText(lines[i].text).slice(1, -1) : "";
    if (start != null) out.push({ startMs: start, endMs: Math.max(start, stampFrom(lines, j, durationMs)), label, from: i, to: j });
    i = j;
  }
  return out;
}
function lineSpan(lines, i, durationMs = Infinity) {
  var _a;
  const t = (_a = lines[i]) == null ? void 0 : _a.timeMs;
  return t == null ? null : [t, Math.max(t, stampFrom(lines, i + 1, durationMs))];
}
const FIT_MARGIN = 500;
const FIT_MAX = 15e3;
function viewWindow(centreMs, spanMs, fit, widen = 1) {
  if (!fit) return [Math.max(0, centreMs - spanMs / 2), spanMs];
  const len = Math.min(fit[1], fit[0] + FIT_MAX) - fit[0];
  const span = clampSpan((len + 2 * FIT_MARGIN) * widen);
  return [Math.max(0, fit[0] + len / 2 - span / 2), span];
}
function wordMarks(text, endMs, next2) {
  const ws = lineWords(text);
  return ws.flatMap((w, k) => {
    var _a;
    if (w.timeMs === null || !w.text) return [];
    let j = k + 1;
    while (j < ws.length && ws[j].timeMs === null) j++;
    const end = ((_a = ws[j]) == null ? void 0 : _a.timeMs) ?? endMs;
    const rest = ws.slice(k + 1, j).map((x) => x.text).join("").trim();
    return [{ startMs: w.timeMs, endMs: Math.max(w.timeMs, end), text: w.text.trim(), rest, next: k === next2 }];
  });
}
function Waveform({ peaks, timeMs, lines, onSeek, selected, fit, marks, pending, loop }) {
  const ref = useRef(null);
  const [zoomSpan, setSpan] = useState(1e4);
  const [widen, setWiden] = useState(1);
  const press = useRef(null);
  const [dragMs, setDragMs] = useState(null);
  const centre = dragMs ?? timeMs;
  const [start, span] = viewWindow(centre, zoomSpan, fit, widen);
  const fitted = !!fit;
  const zoom = (f) => fitted ? setWiden((w) => Math.min(60, Math.max(1, w * f))) : setSpan((s) => clampSpan(s * f));
  useEffect(() => {
    const c = ref.current;
    const onWheel = (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      zoom(e.deltaY > 0 ? 1.25 : 0.8);
    };
    c.addEventListener("wheel", onWheel, { passive: false });
    return () => c.removeEventListener("wheel", onWheel);
  }, [fitted]);
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
    const accent = cssVar("--lyrics-accent", "#2a7ae2");
    let bg = "";
    for (let e = c.parentElement; e && !bg; e = e.parentElement) {
      const b = getComputedStyle(e).backgroundColor;
      if (b && b !== "transparent" && !/^rgba\(.*,\s*0\)$/.test(b)) bg = b;
    }
    bg || (bg = "#fff");
    const msPx = span / w;
    const x = (t) => Math.round((t - start) / msPx);
    const clampX = (t) => Math.min(w, Math.max(0, x(t)));
    const font = (px, weight = "") => `${weight} ${px * dpr}px ${cs.fontFamily || "sans-serif"}`;
    const duration = peaks ? peaks.max.length * peaks.msPerBucket : Infinity;
    ctx.clearRect(0, 0, w, h);
    const secs = sections(lines, duration);
    const secColor = (k, sl) => {
      const [v, hue] = section(k);
      return cssVar(v, `hsl(${hue} ${sl})`);
    };
    ctx.globalAlpha = 0.2;
    secs.forEach((s, k) => {
      ctx.fillStyle = secColor(k, "75% 50%");
      ctx.fillRect(clampX(s.startMs), 0, clampX(s.endMs) - clampX(s.startMs), h);
    });
    ctx.globalAlpha = 1;
    const sel = selected === void 0 ? null : lineSpan(lines, selected, duration);
    if (sel) {
      ctx.clearRect(clampX(sel[0]), 0, clampX(sel[1]) - clampX(sel[0]), h);
      ctx.fillStyle = accent;
      ctx.globalAlpha = 0.3;
      ctx.fillRect(clampX(sel[0]), 0, clampX(sel[1]) - clampX(sel[0]), h);
      ctx.globalAlpha = 1;
    }
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
    const bubble = dragMs === null ? "" : formatTime(Math.round(centre / 10) * 10);
    const bw = ctx.measureText(bubble).width + 10 * dpr;
    const bx = Math.min(w - bw, Math.max(0, head - bw / 2));
    const step = STEPS$1.find((s) => s / msPx >= 64 * dpr) ?? STEPS$1[STEPS$1.length - 1];
    for (let t = Math.ceil(start / step) * step; t < start + span; t += step) {
      ctx.fillRect(x(t), 0, dpr, 6 * dpr);
      const text = formatTime(t).replace(/\.\d+$/, "");
      const x1 = x(t) + 6 * dpr + ctx.measureText(text).width;
      const hidden = head >= x(t) + dpr && head <= x1 + 2 * dpr || bubble && x1 >= bx && x(t) <= bx + bw;
      if (x1 <= w && !hidden) ctx.fillText(text, x(t) + 3 * dpr, 18 * dpr);
    }
    let no = 0;
    for (const l of marks ? [] : lines) {
      if (displayText(l.text)) no++;
      if (l.timeMs === null || l.timeMs < start || l.timeMs > start + span) continue;
      ctx.fillRect(x(l.timeMs), 22 * dpr, dpr, h);
      if (!displayText(l.text)) continue;
      const tw = ctx.measureText(String(no)).width;
      ctx.fillText(String(no), x(l.timeMs) + 3 * dpr + tw > w ? x(l.timeMs) - 3 * dpr - tw : x(l.timeMs) + 3 * dpr, h - 4 * dpr);
    }
    marks == null ? void 0 : marks.forEach((m, k) => {
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
    ctx.font = font(11, "bold");
    secs.forEach((s, k) => {
      const x0 = clampX(s.startMs);
      const x1 = clampX(s.endMs);
      if (!s.label || x1 - x0 < 12 * dpr) return;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0, 0, x1 - x0 - 2 * dpr, h);
      ctx.clip();
      ctx.fillStyle = secColor(k, "70% 32%");
      ctx.fillRect(x0 + 3 * dpr, 24 * dpr, ctx.measureText(s.label).width + 8 * dpr, 16 * dpr);
      ctx.fillStyle = "#fff";
      ctx.fillText(s.label, x0 + 7 * dpr, 36 * dpr);
      ctx.restore();
    });
    ctx.fillStyle = bg;
    ctx.fillRect(head - 2 * dpr, 0, 4 * dpr, h);
    ctx.fillStyle = accent;
    ctx.fillRect(head - dpr, 0, 2 * dpr, h);
    const fitText = (text, max) => {
      for (let n = text.length; n > 0; n--) {
        const t = n < text.length ? text.slice(0, n) + "…" : text;
        if (ctx.measureText(t).width <= max) return t;
      }
      return "";
    };
    marks == null ? void 0 : marks.forEach((m) => {
      const x0 = clampX(m.startMs) + 2 * dpr;
      const room = clampX(m.endMs) - x0 - 3 * dpr;
      ctx.font = font(12, m.next ? "bold" : "");
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
    if (pending) {
      ctx.fillStyle = accent;
      ctx.font = font(12, "bold");
      const bw2 = ctx.measureText(pending).width + 10 * dpr;
      const bx2 = head + 4 * dpr + bw2 > w ? head - 4 * dpr - bw2 : head + 4 * dpr;
      ctx.fillRect(bx2, 24 * dpr, bw2, 18 * dpr);
      ctx.fillStyle = "#fff";
      ctx.fillText(pending, bx2 + 5 * dpr, 38 * dpr);
      ctx.fillStyle = accent;
    }
    if (bubble) {
      ctx.fillStyle = accent;
      ctx.font = font(12);
      ctx.fillRect(bx, 0, bw, 20 * dpr);
      ctx.fillStyle = "#fff";
      ctx.fillText(bubble, bx + 5 * dpr, 15 * dpr);
    }
  });
  const at = (e) => e.currentTarget.getBoundingClientRect();
  const dir = fitted ? -1 : 1;
  const down = (e) => {
    var _a, _b;
    if (e.button !== 0) return;
    (_b = (_a = e.currentTarget).setPointerCapture) == null ? void 0 : _b.call(_a, e.pointerId);
    press.current = { x: e.clientX, t: timeMs, moved: false };
  };
  const move = (e) => {
    const p = press.current;
    const r = at(e);
    if (!p || !r.width) return;
    const dx = e.clientX - p.x;
    if (Math.abs(dx) >= DRAG_PX) p.moved = true;
    if (p.moved) setDragMs(Math.max(0, Math.round(p.t - dir * (dx / r.width) * span)));
  };
  const up = (e) => {
    const p = press.current;
    const r = at(e);
    press.current = null;
    setDragMs(null);
    if (!p || !r.width) return;
    const dx = e.clientX - p.x;
    if (p.moved || Math.abs(dx) >= DRAG_PX) onSeek(Math.max(0, Math.round(p.t - dir * (dx / r.width) * span)));
    else onSeek(Math.max(0, Math.round(start + (e.clientX - r.left) / r.width * span)));
  };
  const cancel = () => {
    press.current = null;
    setDragMs(null);
  };
  return /* @__PURE__ */ jsxs("div", { className: "lyrics-wave", children: [
    /* @__PURE__ */ jsx(
      "canvas",
      {
        ref,
        onPointerDown: down,
        onPointerMove: move,
        onPointerUp: up,
        onPointerCancel: cancel,
        "aria-label": "Waveform: tap to jump to a spot, or drag sideways to scrub",
        title: "Click to jump there, or drag sideways to scrub"
      }
    ),
    /* @__PURE__ */ jsxs("div", { className: "lyrics-wave-zoom", children: [
      /* @__PURE__ */ jsx("button", { type: "button", "aria-label": "Zoom in", title: "Zoom in", disabled: fitted && widen === 1, onClick: () => zoom(0.5), children: "+" }),
      /* @__PURE__ */ jsx("button", { type: "button", "aria-label": "Zoom out", title: "Zoom out", onClick: () => zoom(2), children: "−" })
    ] })
  ] });
}
const STEPS = [
  ["lyrics", "Lyrics"],
  ["lines", "Sync lines"],
  ["words", "Sync words", "optional"]
];
let kbFocus = null;
if (typeof window !== "undefined") {
  window.addEventListener("focusin", (e) => {
    try {
      kbFocus = e.target instanceof Element && e.target.matches(":focus-visible") ? e.target : null;
    } catch {
      kbFocus = null;
    }
  }, true);
  window.addEventListener("pointerdown", () => kbFocus = null, true);
}
const focusVisible = (el) => el === kbFocus;
function isShortcut(e, isFocusVisible = focusVisible) {
  const el = e.target;
  if (!(el instanceof HTMLElement)) return true;
  const typing = el.isContentEditable || el.matches(
    "textarea, select, input:not([type=checkbox], [type=radio], [type=range], [type=button], [type=submit], [type=reset], [type=file], [type=color], [type=image])"
  );
  return !typing && !((e.key === "Enter" || e.key === " ") && isFocusVisible(el));
}
function LyricsEditor(p) {
  return p.onChange ? /* @__PURE__ */ jsx(Editor, { ...p }) : /* @__PURE__ */ jsx(LyricsView, { ...p });
}
function Editor({ lrc, onChange, position, onSeek, peaks, offsetMs = 0 }) {
  var _a, _b;
  const [s, dispatch] = useReducer(reducer, lrc, (l) => initState(parseLrc(l)));
  const { audibleMs, seek } = usePlaybackTime(position, offsetMs, onSeek);
  const seekRef = useRef(seek);
  seekRef.current = seek;
  const last = useRef(lrc);
  const cb = useRef(onChange);
  cb.current = onChange;
  const emit = (doc) => {
    var _a2;
    const out = serializeLrc(doc);
    if (out === last.current) return;
    last.current = out;
    (_a2 = cb.current) == null ? void 0 : _a2.call(cb, out);
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
  const caretFromEnd = useRef(null);
  const textRef = useRef(null);
  useLayoutEffect(() => {
    const ta = textRef.current;
    if (caretFromEnd.current === null || !ta) return;
    const at = ta.value.length - caretFromEnd.current;
    ta.setSelectionRange(at, at);
    caretFromEnd.current = null;
  }, [s.pasted]);
  const lines = s.doc.lines;
  const line = lines[s.sel];
  const ws = words(line);
  const wordStep = s.step === "words";
  const dur = position.durationMs;
  const span = wordStep ? lineSpan(lines, s.sel, dur || Infinity) : null;
  const [loop, setLoop] = useState(true);
  useEffect(() => {
    if (loop && span && position.playing && audibleMs >= span[1]) seekRef.current(span[0]);
  });
  const lineStart = wordStep ? line == null ? void 0 : line.timeMs : null;
  useEffect(() => {
    if (lineStart != null) seekRef.current(lineStart);
  }, [s.sel, wordStep]);
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
  const keys = useRef(null);
  keys.current = (e) => {
    if (!isShortcut(e)) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (mod && k === "z") dispatch({ t: e.shiftKey ? "redo" : "undo" });
    else if (mod && k === "y") dispatch({ t: "redo" });
    else if (s.step === "lyrics" || mod || e.altKey) return;
    else if (k === "s" || k === "enter") !e.repeat && stamp();
    else if (k === "arrowup" || k === "arrowdown") dispatch({ t: wordStep ? "moveWord" : "move", d: k === "arrowup" ? -1 : 1 });
    else return;
    e.preventDefault();
  };
  useEffect(() => {
    const h = (e) => keys.current(e);
    window.addEventListener("keydown", h, true);
    return () => window.removeEventListener("keydown", h, true);
  }, []);
  const list = useRef(null);
  useEffect(() => {
    var _a2, _b2, _c;
    (_c = (_b2 = (_a2 = list.current) == null ? void 0 : _a2.querySelector("[aria-current]")) == null ? void 0 : _b2.scrollIntoView) == null ? void 0 : _c.call(_b2, { block: "nearest" });
  }, [s.sel, s.step, lines]);
  const rows = useMemo(() => {
    const band = new Array(lines.length);
    sections(lines).forEach((sec, k) => band.fill(k, sec.from, sec.to));
    let no = 0;
    return lines.map((l, i) => {
      const text = displayText(l.text);
      if (!text && l.timeMs === null) return /* @__PURE__ */ jsx("li", { className: "lyrics-editor-gap" }, i);
      if (text) no++;
      const sel = i === s.sel;
      const late = dur > 0 && l.timeMs !== null && l.timeMs > dur;
      return /* @__PURE__ */ jsxs(
        "li",
        {
          className: "lyrics-editor-row",
          "aria-current": sel || void 0,
          "data-late": late || void 0,
          style: band[i] === void 0 ? void 0 : { borderInlineStartColor: bandColor(band[i], 0.7) },
          children: [
            /* @__PURE__ */ jsxs(
              "button",
              {
                type: "button",
                className: "lyrics-editor-line",
                onClick: () => {
                  dispatch({ t: "select", i });
                  if (l.timeMs !== null) seekRef.current(l.timeMs);
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
          ]
        },
        i
      );
    });
  }, [lines, s.sel, s.word, s.step, dur, resume == null ? void 0 : resume.i]);
  const undoRedo = /* @__PURE__ */ jsxs("span", { className: "lyrics-editor-undo", children: [
    /* @__PURE__ */ jsx("button", { type: "button", disabled: !s.past.length, onClick: () => dispatch({ t: "undo" }), children: "Undo" }),
    /* @__PURE__ */ jsx("button", { type: "button", disabled: !s.future.length, onClick: () => dispatch({ t: "redo" }), children: "Redo" })
  ] });
  const synced = textLines.filter((l) => l.timeMs !== null).length;
  const pasted = ((_a = s.pasted) == null ? void 0 : _a.doc) === s.doc ? s.pasted.n : 0;
  const allSynced = synced === textLines.length;
  let banner;
  if (!textLines.length) banner = /* @__PURE__ */ jsx(Fragment, { children: "No lyrics yet. Add them in step 1 first." });
  else if (wordStep)
    banner = /* @__PURE__ */ jsxs(Fragment, { children: [
      "Optional, for word-by-word highlighting. Tap a line, press play, then tap ",
      /* @__PURE__ */ jsx("b", { children: "Stamp" }),
      " as each highlighted word starts. The line loops until you're done; after its last word, the next line plays from its start (its first word is timed by the line stamp)."
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
  const progress = !textLines.length ? "" : wordStep ? `${loop ? "↻ " : ""}Line ${lineNo}${!ws.length ? "" : s.word < ws.length ? `: word ${s.word + 1} of ${ws.length}` : ": all words timed ✓"}` : allSynced ? line ? `All ${textLines.length} lines synced ✓` : "" : `${synced} of ${textLines.length} lines synced`;
  return /* @__PURE__ */ jsxs("div", { className: "lyrics-editor", children: [
    /* @__PURE__ */ jsxs("div", { className: "lyrics-editor-head", children: [
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
      s.step !== "lyrics" && /* @__PURE__ */ jsx(
        Waveform,
        {
          peaks,
          timeMs: audibleMs,
          lines,
          onSeek: seek,
          selected: s.sel,
          fit: span,
          marks: span ? wordMarks(line.text, span[1], s.word) : void 0,
          pending: wordStep && ((_b = ws[s.word]) == null ? void 0 : _b.timeMs) === null ? ws[s.word].text.trim() : void 0,
          loop: loop ? span : null
        }
      )
    ] }),
    s.step === "lyrics" ? /* @__PURE__ */ jsxs("div", { role: "tabpanel", "aria-label": "Lyrics", className: "lyrics-editor-panel", children: [
      pasted ? (
        // Replaces the how-to: pasted time tags vanish from the box, so say where they went.
        /* @__PURE__ */ jsxs("p", { className: "lyrics-editor-banner", "data-ok": true, role: "status", id: "lyrics-editor-howto", children: [
          /* @__PURE__ */ jsxs("b", { children: [
            "Kept the timing of ",
            pasted,
            " pasted line",
            pasted === 1 ? "" : "s",
            " ✓"
          ] }),
          " The pasted lyrics had timestamps; they're in the Sync lines step now, not in this box. Undo removes the paste."
        ] })
      ) : /* @__PURE__ */ jsx("p", { className: "lyrics-editor-banner", id: "lyrics-editor-howto", children: "Type or paste the lyrics — one line per row; blank line between verses." }),
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
          onBlur: () => dispatch({ t: "commit" }),
          ref: textRef,
          onPaste: (e) => {
            const doc = parseLrc(e.clipboardData.getData("text/plain"));
            if (!doc.lines.some((l) => l.timeMs !== null)) return;
            e.preventDefault();
            const { selectionStart: start, selectionEnd: end } = e.currentTarget;
            caretFromEnd.current = s.draft.length - end;
            dispatch({ t: "paste", doc, start, end });
          }
        }
      ),
      /* @__PURE__ */ jsxs("div", { className: "lyrics-editor-dock", children: [
        /* @__PURE__ */ jsx("p", { className: "lyrics-editor-progress", children: s.draft.trim() ? `${s.draft.split("\n").filter((r) => r.trim()).length} lines${synced ? ` · ${synced} timed` : ""}` : dur ? "Type or paste at least one line to continue." : "Load the song and add at least one line to continue." }),
        undoRedo,
        /* @__PURE__ */ jsx(
          "button",
          {
            type: "button",
            className: "lyrics-editor-primary",
            disabled: !s.draft.trim(),
            onClick: () => dispatch({ t: "step", step: "lines" }),
            children: synced ? "Next: check the timing →" : "Next: sync to the music →"
          }
        )
      ] })
    ] }) : /* @__PURE__ */ jsxs("div", { role: "tabpanel", "aria-label": wordStep ? "Sync words" : "Sync lines", className: "lyrics-editor-panel", children: [
      /* @__PURE__ */ jsx("p", { className: "lyrics-editor-banner", children: banner }),
      /* @__PURE__ */ jsxs("p", { className: "lyrics-editor-tip", children: [
        wordStep ? `${wordsDone} of ${textLines.length} lines have word timing. Tap a line or word to play from it. Words are quick: set the playback speed to 0.5×.` : "Tap a line to play from its time. Too late? Drag the waveform back or nudge −0.1 s. For precise timing, set the playback speed to 0.5×.",
        /* @__PURE__ */ jsxs("span", { className: "lyrics-editor-hint", children: [
          " ",
          "Keys: S or Enter = Stamp · ↑/↓ = choose ",
          wordStep ? "word" : "line",
          " · Ctrl/⌘+Z = undo. Shortcuts work anywhere except while typing."
        ] })
      ] }),
      textLines.length ? /* @__PURE__ */ jsx("ol", { ref: list, className: "lyrics-editor-lines", children: rows }) : /* @__PURE__ */ jsx("button", { type: "button", className: "lyrics-editor-primary", onClick: () => dispatch({ t: "step", step: "lyrics" }), children: "← Add lyrics" }),
      /* @__PURE__ */ jsxs("div", { className: "lyrics-editor-dock", "data-done": !wordStep && allSynced && !line || void 0, children: [
        /* @__PURE__ */ jsxs("p", { className: "lyrics-editor-progress", children: [
          /* @__PURE__ */ jsx("span", { className: "lyrics-editor-now", "aria-label": "Playback position", children: formatTime(audibleMs) }),
          !position.playing && /* @__PURE__ */ jsx("b", { children: " · paused" }),
          (position.rate ?? 1) !== 1 && /* @__PURE__ */ jsxs("b", { children: [
            " · ",
            position.rate,
            "×",
            /* @__PURE__ */ jsx("span", { className: "lyrics-editor-wide", children: " speed" })
          ] }),
          clash ? /* @__PURE__ */ jsxs("b", { className: "lyrics-editor-warn", children: [
            " · ⚠ the playhead is ",
            clash,
            ": play from just before this line first"
          ] }) : progress && /* @__PURE__ */ jsxs("span", { children: [
            " · ",
            progress
          ] })
        ] }),
        wordStep && /* @__PURE__ */ jsxs("label", { className: "lyrics-editor-loop", children: [
          /* @__PURE__ */ jsx("input", { type: "checkbox", checked: loop, onChange: (e) => setLoop(e.target.checked) }),
          " ↻ Loop line"
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
const PlayHere = ({ ms, seek, label = "from here" }) => /* @__PURE__ */ jsxs("button", { type: "button", disabled: ms === null, onClick: () => seek(ms), children: [
  "▶ Play ",
  label
] });
const Nudges = ({ dispatch }) => [-100, 100].map((d) => /* @__PURE__ */ jsx("button", { type: "button", className: "lyrics-editor-nudge", onClick: () => dispatch({ t: "nudge", d }), children: d < 0 ? "−0.1 s" : "+0.1 s" }, d));
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
    /* @__PURE__ */ jsx(Nudges, { dispatch }),
    /* @__PURE__ */ jsx(PlayHere, { ms: line.timeMs, seek }),
    back,
    /* @__PURE__ */ jsx("button", { type: "button", className: "lyrics-editor-quiet", onClick: () => dispatch({ t: "clear" }), children: "Clear time" })
  ] });
}
function WordTools({ line, word, dispatch, seek }) {
  const ws = words(line);
  const sel = ws[word];
  return /* @__PURE__ */ jsxs("div", { className: "lyrics-editor-tools", role: "group", "aria-label": "Word timing", children: [
    /* @__PURE__ */ jsx("div", { className: "lyrics-editor-chips", children: ws.map((w, k) => /* @__PURE__ */ jsxs(
      "button",
      {
        type: "button",
        className: "lyrics-editor-chip",
        "aria-current": k === word || void 0,
        "data-timed": w.timeMs !== null || void 0,
        onClick: () => {
          dispatch({ t: "pickWord", w: k });
          if (w.timeMs !== null) seek(w.timeMs);
        },
        children: [
          w.text.trim(),
          /* @__PURE__ */ jsx("small", { children: w.timeMs === null ? "—" : formatTime(w.timeMs) })
        ]
      },
      k
    )) }),
    /* @__PURE__ */ jsx("p", { className: "lyrics-editor-tip", children: !ws.length ? "No words on this line." : `${word < ws.length ? "Tap Stamp as the blue word starts. After the last word, the next line plays from its start." : "All words timed."} Tap a timed word to hear it; Stamp then re-times it.` }),
    (sel == null ? void 0 : sel.timeMs) != null && /* @__PURE__ */ jsx(Nudges, { dispatch }),
    /* @__PURE__ */ jsx(PlayHere, { ms: (sel == null ? void 0 : sel.timeMs) ?? line.timeMs, seek, label: (sel == null ? void 0 : sel.timeMs) != null ? `from “${sel.text.trim()}”` : "line" }),
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
  isShortcut,
  joinWords,
  lineWords,
  parseLrc,
  peaksFromAudio,
  serializeLrc,
  setLineTime,
  usePlaybackTime
};
