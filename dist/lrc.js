const TIME = String.raw`(\d+):(\d{1,2})(?:[.:](\d{1,3}))?`;
const LEADING_TAGS = new RegExp(String.raw`^(?:\[${TIME}\])+`);
const TAG = new RegExp(String.raw`\[${TIME}\]`, "g");
const WORD_TAG = new RegExp(`<${TIME}>`, "g");
const META = /^\[([a-z#]+):(.*)\]$/;
const toMs = (m, s, f = "") => +m * 6e4 + +s * 1e3 + +f.padEnd(3, "0");
function formatTime(ms) {
  ms = Math.max(0, Math.round(ms));
  const m = String(Math.floor(ms / 6e4)).padStart(2, "0");
  const s = String(Math.floor(ms / 1e3) % 60).padStart(2, "0");
  const frac = ms % 1e3;
  return `${m}:${s}.${frac % 10 ? String(frac).padStart(3, "0") : String(frac / 10).padStart(2, "0")}`;
}
function displayText(text) {
  return text.replace(WORD_TAG, "").trim();
}
const TOKEN = new RegExp(`<${TIME}>|\\s+|[^\\s<]+|<`, "g");
function lineWords(text) {
  const out = [];
  let tag = null;
  for (const [tok, m, s, f] of text.matchAll(TOKEN)) {
    const last = out[out.length - 1];
    if (m !== void 0) tag = toMs(m, s, f);
    else if (/^\s/.test(tok)) {
      if (last) last.text += tok;
    } else if (tag === null && last && !/\s$/.test(last.text)) last.text += tok;
    else {
      out.push({ timeMs: tag, text: tok });
      tag = null;
    }
  }
  if (tag !== null) out.push({ timeMs: tag, text: "" });
  return out;
}
function joinWords(words) {
  return words.map((w) => (w.timeMs === null ? "" : `<${formatTime(w.timeMs)}>`) + w.text).join("");
}
function setLineTime(line, timeMs) {
  if (line.timeMs === null || timeMs === null) return { ...line, timeMs };
  const delta = timeMs - line.timeMs;
  if (!delta) return line;
  const text = line.text.replace(WORD_TAG, (_, m, s, f) => `<${formatTime(toMs(m, s, f) + delta)}>`);
  return { timeMs, text };
}
function parseLrc(input) {
  const raw = input.replace(/\s+$/, "").split(/\r?\n/);
  const isLrc = raw.some((l) => LEADING_TAGS.test(l.trim()));
  const meta = [];
  let offset = 0;
  const head = [];
  const blocks = [];
  const push = (l) => (blocks.length ? blocks[blocks.length - 1] : head).push(l);
  for (const rawLine of raw) {
    const line = rawLine.trim();
    const m = META.exec(line);
    if (m) {
      if (m[1] === "offset") offset = Number(m[2].trim()) || 0;
      else meta.push({ key: m[1], value: m[2].trim() });
      continue;
    }
    if (!isLrc) {
      if (line || head.length) head.push({ timeMs: null, text: rawLine.trimEnd() });
      continue;
    }
    const tags = LEADING_TAGS.exec(line);
    if (!tags) {
      const prev = (blocks.length ? blocks[blocks.length - 1] : head).at(-1);
      if (line || (prev == null ? void 0 : prev.text)) push({ timeMs: null, text: line });
      continue;
    }
    const first = { timeMs: null, text: line.slice(tags[0].length).trim() };
    for (const [, mm, ss, ff] of tags[0].matchAll(TAG)) {
      first.timeMs ?? (first.timeMs = toMs(mm, ss, ff));
      blocks.push([setLineTime(first, toMs(mm, ss, ff))]);
    }
  }
  blocks.sort((a, b) => a[0].timeMs - b[0].timeMs);
  let lines = head.concat(...blocks);
  if (offset) lines = lines.map((l) => l.timeMs === null ? l : setLineTime(l, Math.max(0, l.timeMs - offset)));
  return { meta, lines };
}
function serializeLrc(doc) {
  const out = [
    ...doc.meta.map(({ key, value }) => `[${key}:${value}]`),
    ...doc.lines.map((l) => l.timeMs === null ? l.text : `[${formatTime(l.timeMs)}]${l.text}`)
  ];
  return out.length ? out.join("\n") + "\n" : "";
}
export {
  displayText,
  formatTime,
  joinWords,
  lineWords,
  parseLrc,
  serializeLrc,
  setLineTime
};
