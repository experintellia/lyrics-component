// TTML export (Apple Music style lyrics). No React, no DOM. Import is out of scope.
import { displayText, lineSpan, lineWords, sections, type LrcDoc } from './lrc';

const ENT: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
// Also drops what XML 1.0 can't hold at all: control characters, lone surrogates, U+FFFE/U+FFFF.
const esc = (s: string) => s.replace(/[&<>"]|[\0-\x08\x0B\x0C\x0E-\x1F\uD800-\uDFFF\uFFFE\uFFFF]/gu, (c) => ENT[c] ?? '');
const pad = (n: number, w = 2) => String(n).padStart(w, '0');
// HH:MM:SS.mmm, TTML's full clock-time form. Times are absolute at every level (div, p, span), as in Apple's files;
// a strict TTML reader would take a child's begin as relative to its parent's (par time containment).
const clock = (ms: number) => {
  ms = Math.max(0, Math.round(ms));
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)}.${pad(ms % 1000, 3)}`;
};
// end = Infinity (the last line when the duration is unknown) → no end attribute: it runs to the end of the media.
const timed = (begin: number, end: number) => ` begin="${clock(begin)}"` + (end === Infinity ? '' : ` end="${clock(end)}"`);

/** One <div> per waveform section (label → itunes:song-part), one <p> per stamped line, one <span> per timed word.
 *  Unstamped lines and stamped gaps are not written (a gap only ends the line before it). Throws if nothing is stamped. */
export function serializeTtml(doc: LrcDoc, opts: { durationMs?: number; lang?: string } = {}): string {
  const { lines } = doc;
  const dur = opts.durationMs || Infinity; // 0 = still loading = unknown
  const secs = sections(lines, dur);
  if (!secs.length) throw new Error('serializeTtml: no stamped lines');
  const words = lines.map((l) => (l.timeMs !== null && displayText(l.text) ? lineWords(l.text) : []));
  const wordMode = words.some((ws) => ws.some((w) => w.timeMs !== null));

  const p = (i: number) => {
    const ws = words[i];
    let [begin, end] = lineSpan(lines, i, dur)!;
    let tail = ws.at(-1)?.text === '' ? ws.pop()!.timeMs : null; // trailing tag: end of the last word
    if (end === Infinity && tail !== null) end = Math.max(begin, tail);
    if (tail !== null) tail = Math.min(end, Math.max(begin, tail));
    if (!ws.some((w) => w.timeMs !== null)) return `<p${timed(begin, end)}>${esc(displayText(lines[i].text))}</p>`;
    // Untimed words join the timed span before them (phrase timing); leading ones start with the line.
    // Out-of-order tags are clamped: starts stay within the line and never go backwards.
    const spans: { t: number; text: string }[] = [];
    for (const w of ws) {
      const prev = spans.at(-1)?.t ?? begin;
      if (w.timeMs !== null || !spans.length) spans.push({ t: Math.min(end, Math.max(prev, w.timeMs ?? begin)), text: w.text });
      else spans[spans.length - 1].text += w.text;
    }
    const inner = spans.map(
      (s, k) => `<span${timed(s.t, Math.max(s.t, spans[k + 1]?.t ?? tail ?? end))}>${esc(s.text.trimEnd())}</span>${/\s$/.test(s.text) ? ' ' : ''}`,
    );
    return `<p${timed(begin, end)}>${inner.join('').trimEnd()}</p>`;
  };

  const body = secs.map((s) => {
    const ps = lines.slice(s.from, s.to).flatMap((l, k) => (l.timeMs === null ? [] : [`  ${p(s.from + k)}`]));
    return `<div${timed(s.startMs, s.endMs)}${s.label ? ` itunes:song-part="${esc(s.label)}"` : ''}>\n${ps.join('\n')}\n</div>`;
  });
  const meta = (key: string) => doc.meta.find((m) => m.key === key)?.value;
  const [ti, ar] = [meta('ti'), meta('ar')];
  const head = ti || ar
    ? `<head><metadata>${ti ? `<ttm:title>${esc(ti)}</ttm:title>` : ''}${
        ar ? `<ttm:agent type="person" xml:id="artist"><ttm:name type="full">${esc(ar)}</ttm:name></ttm:agent>` : ''}</metadata></head>\n`
    : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:itunes="http://music.apple.com/lyric-ttml-internal" itunes:timing="${wordMode ? 'Word' : 'Line'}" xml:lang="${esc(opts.lang ?? '')}">
${head}<body${dur === Infinity ? '' : ` dur="${clock(dur)}"`}>
${body.join('\n')}
</body>
</tt>
`;
}
