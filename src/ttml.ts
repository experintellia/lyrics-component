// TTML export (Apple Music style lyrics). No React, no DOM. Import is out of scope.
import { displayText, lineSpan, lineWords, sections, type LrcDoc } from './lrc';

const ENT: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ENT[c]);
const pad = (n: number, w = 2) => String(n).padStart(w, '0');
// HH:MM:SS.mmm: TTML's full clock-time, valid in any TTML reader; Apple Music reads it like its own M:SS.mmm.
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
    const tail = ws.at(-1)?.text === '' ? ws.pop()!.timeMs : null; // trailing tag: end of the last word
    if (end === Infinity && tail !== null) end = tail;
    if (!ws.some((w) => w.timeMs !== null)) return `<p${timed(begin, end)}>${esc(displayText(lines[i].text))}</p>`;
    // Untimed words join the timed span before them (phrase timing); leading ones start with the line.
    const spans: { t: number; text: string }[] = [];
    for (const w of ws) {
      if (w.timeMs !== null || !spans.length) spans.push({ t: w.timeMs ?? begin, text: w.text });
      else spans[spans.length - 1].text += w.text;
    }
    const inner = spans.map(
      (s, k) => `<span${timed(s.t, spans[k + 1]?.t ?? tail ?? end)}>${esc(s.text.trimEnd())}</span>${/\s$/.test(s.text) ? ' ' : ''}`,
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
