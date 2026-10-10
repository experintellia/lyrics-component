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
      if (line) push({ timeMs: null, text: line });
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
  parseLrc,
  serializeLrc,
  setLineTime
};
