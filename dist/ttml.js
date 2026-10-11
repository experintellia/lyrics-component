import { sections, displayText, lineWords, lineSpan } from "./lrc.js";
const ENT = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const esc = (s) => s.replace(/[&<>"]/g, (c) => ENT[c]);
const pad = (n, w = 2) => String(n).padStart(w, "0");
const clock = (ms) => {
  ms = Math.max(0, Math.round(ms));
  return `${pad(Math.floor(ms / 36e5))}:${pad(Math.floor(ms / 6e4) % 60)}:${pad(Math.floor(ms / 1e3) % 60)}.${pad(ms % 1e3, 3)}`;
};
const timed = (begin, end) => ` begin="${clock(begin)}"` + (end === Infinity ? "" : ` end="${clock(end)}"`);
function serializeTtml(doc, opts = {}) {
  const { lines } = doc;
  const dur = opts.durationMs || Infinity;
  const secs = sections(lines, dur);
  if (!secs.length) throw new Error("serializeTtml: no stamped lines");
  const words = lines.map((l) => l.timeMs !== null && displayText(l.text) ? lineWords(l.text) : []);
  const wordMode = words.some((ws) => ws.some((w) => w.timeMs !== null));
  const p = (i) => {
    var _a;
    const ws = words[i];
    let [begin, end] = lineSpan(lines, i, dur);
    const tail = ((_a = ws.at(-1)) == null ? void 0 : _a.text) === "" ? ws.pop().timeMs : null;
    if (end === Infinity && tail !== null) end = tail;
    if (!ws.some((w) => w.timeMs !== null)) return `<p${timed(begin, end)}>${esc(displayText(lines[i].text))}</p>`;
    const spans = [];
    for (const w of ws) {
      if (w.timeMs !== null || !spans.length) spans.push({ t: w.timeMs ?? begin, text: w.text });
      else spans[spans.length - 1].text += w.text;
    }
    const inner = spans.map(
      (s, k) => {
        var _a2;
        return `<span${timed(s.t, ((_a2 = spans[k + 1]) == null ? void 0 : _a2.t) ?? tail ?? end)}>${esc(s.text.trimEnd())}</span>${/\s$/.test(s.text) ? " " : ""}`;
      }
    );
    return `<p${timed(begin, end)}>${inner.join("").trimEnd()}</p>`;
  };
  const body = secs.map((s) => {
    const ps = lines.slice(s.from, s.to).flatMap((l, k) => l.timeMs === null ? [] : [`  ${p(s.from + k)}`]);
    return `<div${timed(s.startMs, s.endMs)}${s.label ? ` itunes:song-part="${esc(s.label)}"` : ""}>
${ps.join("\n")}
</div>`;
  });
  const meta = (key) => {
    var _a;
    return (_a = doc.meta.find((m) => m.key === key)) == null ? void 0 : _a.value;
  };
  const [ti, ar] = [meta("ti"), meta("ar")];
  const head = ti || ar ? `<head><metadata>${ti ? `<ttm:title>${esc(ti)}</ttm:title>` : ""}${ar ? `<ttm:agent type="person" xml:id="artist"><ttm:name type="full">${esc(ar)}</ttm:name></ttm:agent>` : ""}</metadata></head>
` : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:itunes="http://music.apple.com/lyric-ttml-internal" itunes:timing="${wordMode ? "Word" : "Line"}" xml:lang="${esc(opts.lang ?? "")}">
${head}<body${dur === Infinity ? "" : ` dur="${clock(dur)}"`}>
${body.join("\n")}
</body>
</tt>
`;
}
export {
  serializeTtml
};
