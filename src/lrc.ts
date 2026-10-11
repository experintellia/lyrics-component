// LRC parse/serialize. No React, no DOM.

export interface LrcLine { timeMs: number | null; text: string } // text keeps raw <mm:ss.xx> word tags
export interface LrcDoc { meta: { key: string; value: string }[]; lines: LrcLine[] }

// [mm:ss], [mm:ss.x], [mm:ss.xx], [mm:ss.xxx], [mm:ss:xx]; minutes unbounded.
const TIME = String.raw`(\d+):(\d{1,2})(?:[.:](\d{1,3}))?`;
const LEADING_TAGS = new RegExp(String.raw`^(?:\[${TIME}\])+`);
const TAG = new RegExp(String.raw`\[${TIME}\]`, 'g');
const WORD_TAG = new RegExp(`<${TIME}>`, 'g');
const META = /^\[([a-z#]+):(.*)\]$/;

// Fraction by digit count: .5 = .50 = .500 = 500 ms.
const toMs = (m: string, s: string, f = '') => +m * 60000 + +s * 1000 + +f.padEnd(3, '0');

export function formatTime(ms: number): string {
  ms = Math.max(0, Math.round(ms));
  const m = String(Math.floor(ms / 60000)).padStart(2, '0');
  const s = String(Math.floor(ms / 1000) % 60).padStart(2, '0');
  const frac = ms % 1000;
  return `${m}:${s}.${frac % 10 ? String(frac).padStart(3, '0') : String(frac / 10).padStart(2, '0')}`;
}

export function displayText(text: string): string {
  return text.replace(WORD_TAG, '').trim();
}

export interface LrcWord { timeMs: number | null; text: string } // text keeps its trailing whitespace

// Enhanced LRC: a <mm:ss.xx> tag times the text after it. Words split at whitespace and at tags, so
// "Hel<t>lo" gives syllables and an untimed word belongs to the timed one before it (phrase timing).
// A trailing tag (end of the last word) becomes an empty word. joinWords(lineWords(x)) is stable.
const TOKEN = new RegExp(`<${TIME}>|\\s+|[^\\s<]+|<`, 'g');
export function lineWords(text: string): LrcWord[] {
  const out: LrcWord[] = [];
  let tag: number | null = null;
  for (const [tok, m, s, f] of text.matchAll(TOKEN)) {
    const last = out[out.length - 1];
    if (m !== undefined) tag = toMs(m, s, f);
    else if (/^\s/.test(tok)) {
      if (last) last.text += tok;
    } else if (tag === null && last && !/\s$/.test(last.text)) last.text += tok;
    else {
      out.push({ timeMs: tag, text: tok });
      tag = null;
    }
  }
  if (tag !== null) out.push({ timeMs: tag, text: '' });
  return out;
}

export function joinWords(words: LrcWord[]): string {
  return words.map((w) => (w.timeMs === null ? '' : `<${formatTime(w.timeMs)}>`) + w.text).join('');
}

export function setLineTime(line: LrcLine, timeMs: number | null): LrcLine {
  if (line.timeMs === null || timeMs === null) return { ...line, timeMs };
  const delta = timeMs - line.timeMs;
  if (!delta) return line;
  const text = line.text.replace(WORD_TAG, (_, m, s, f) => `<${formatTime(toMs(m, s, f) + delta)}>`);
  return { timeMs, text };
}

// Sections and line spans are shared by the waveform, the editor and ttml.ts: @internal, not a stable API.

/** `from`/`to`: the section's line indices [from, to).
 *  @internal */
export interface Section { startMs: number; endMs: number; label: string; from: number; to: number }

const LABEL = /^\[.+\]$/; // an unstamped "[Chorus]" line names the section it starts
const isLabel = (l: LrcLine) => l.timeMs === null && LABEL.test(displayText(l.text));
const stampFrom = (lines: LrcLine[], i: number, end: number) => lines.slice(i).find((l) => l.timeMs !== null)?.timeMs ?? end;

/** Sections start at the first line, after blank lines, or at a label line; each runs from its first stamp
 *  to the next stamp after its lines (the next section's, or a stamped gap's). Sections without stamps are dropped.
 *  @internal */
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

/** The time a stamped line covers: its stamp up to the next stamp (or the end).
 *  @internal */
export function lineSpan(lines: LrcLine[], i: number, durationMs = Infinity): [number, number] | null {
  const t = lines[i]?.timeMs;
  return t == null ? null : [t, Math.max(t, stampFrom(lines, i + 1, durationMs))];
}

export function parseLrc(input: string): LrcDoc {
  const raw = input.replace(/\s+$/, '').split(/\r?\n/);
  const isLrc = raw.some((l) => LEADING_TAGS.test(l.trim()));
  const meta: LrcDoc['meta'] = [];
  let offset = 0;
  // Blocks: a stamped line plus the unstamped lines after it. Head block = unstamped lines before any stamp.
  const head: LrcLine[] = [];
  const blocks: LrcLine[][] = [];
  const push = (l: LrcLine) => (blocks.length ? blocks[blocks.length - 1] : head).push(l);

  for (const rawLine of raw) {
    const line = rawLine.trim();
    const m = META.exec(line);
    if (m) {
      if (m[1] === 'offset') offset = Number(m[2].trim()) || 0;
      else meta.push({ key: m[1], value: m[2].trim() });
      continue;
    }
    if (!isLrc) {
      // Plain text keeps blank lines (stanza breaks), except leading ones.
      if (line || head.length) head.push({ timeMs: null, text: rawLine.trimEnd() });
      continue;
    }
    const tags = LEADING_TAGS.exec(line);
    if (!tags) {
      // LRC keeps one blank line after text as a stanza break (the editor writes them); leading and repeated ones go.
      const prev = (blocks.length ? blocks[blocks.length - 1] : head).at(-1);
      if (line || prev?.text) push({ timeMs: null, text: line });
      continue;
    }
    // Several tags → one line per tag (word tags are relative to the first). Empty text = instrumental gap.
    const first: LrcLine = { timeMs: null, text: line.slice(tags[0].length).trim() };
    for (const [, mm, ss, ff] of tags[0].matchAll(TAG)) {
      first.timeMs ??= toMs(mm, ss, ff);
      blocks.push([setLineTime(first, toMs(mm, ss, ff))]);
    }
  }

  blocks.sort((a, b) => a[0].timeMs! - b[0].timeMs!); // stable: equal times keep file order
  let lines = head.concat(...blocks);
  // [offset:N]: positive N = lyrics earlier. Baked in, clamped ≥ 0, tag dropped.
  if (offset) lines = lines.map((l) => (l.timeMs === null ? l : setLineTime(l, Math.max(0, l.timeMs - offset))));
  return { meta, lines };
}

export function serializeLrc(doc: LrcDoc): string {
  const out = [
    ...doc.meta.map(({ key, value }) => `[${key}:${value}]`),
    ...doc.lines.map((l) => (l.timeMs === null ? l.text : `[${formatTime(l.timeMs)}]${l.text}`)),
  ];
  return out.length ? out.join('\n') + '\n' : '';
}
