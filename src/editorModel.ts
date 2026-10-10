// Editor state: reducer with undo/redo, plus the text → lines diff. No React, no DOM.
import { displayText, joinWords, lineWords, setLineTime, type LrcDoc, type LrcLine } from './lrc';

export type Step = 'lyrics' | 'lines' | 'words';

export type Action =
  | { t: 'load'; doc: LrcDoc }
  | { t: 'draft'; text: string } // textarea keystroke: no doc change yet
  | { t: 'paste'; doc: LrcDoc; start: number; end: number } // LRC pasted over draft[start, end)
  | { t: 'commit' } // textarea blur / 500 ms idle: draft → lines, one undo step
  | { t: 'step'; step: Step }
  | { t: 'select'; i: number }
  | { t: 'move'; d: 1 | -1 }
  | { t: 'moveWord'; d: 1 | -1 } // word step ↑/↓: previous/next word, across line ends
  | { t: 'stamp'; ms: number } // line step: time the selected line, advance
  | { t: 'stampWord'; ms: number } // word step: time the next word, advance
  | { t: 'pickWord'; w: number }
  | { t: 'nudge'; d: number } // the selected line; in the word step the selected word (word 0 moves the line too)
  | { t: 'clear' }
  | { t: 'clearWords' }
  | { t: 'undo' }
  | { t: 'redo' };

export interface State {
  doc: LrcDoc;
  past: LrcDoc[];
  future: LrcDoc[];
  step: Step;
  sel: number; // selected line (both sync steps); -1 = none (all lines just got synced)
  word: number; // next word to stamp in the selected line (word step)
  draft: string; // textarea content; becomes lines on commit
  emit: boolean; // report this doc via onChange (false after a load from the host)
  pasted?: { n: number; doc: LrcDoc }; // "kept the timing of n lines" notice, shown while doc is current
}

export const hasText = (l: LrcLine | undefined) => !!l && !!displayText(l.text);
export const docText = (doc: LrcDoc) => doc.lines.map((l) => displayText(l.text)).join('\n');
/** Words to stamp: lineWords minus a trailing end tag (an empty word, only ever last). */
export const words = (l: LrcLine | undefined) => (l ? lineWords(l.text).filter((w) => w.text) : []);
const nextWord = (l: LrcLine | undefined) => Math.max(0, words(l).findIndex((w) => w.timeMs === null));
export const hasWordTimes = (l: LrcLine) => lineWords(l.text).some((w) => w.timeMs !== null);

/** Next line with text from i in direction d (blank lines are stanza breaks, skipped), or i. */
function next(lines: LrcLine[], i: number, d: number) {
  for (let k = i + d; k >= 0 && k < lines.length; k += d) if (hasText(lines[k])) return k;
  return i;
}
/** The first line with text matching `todo`, else the first line with text, else 0. */
function first(lines: LrcLine[], todo: (l: LrcLine) => boolean) {
  const i = lines.findIndex((l) => hasText(l) && todo(l));
  return i >= 0 ? i : Math.max(0, lines.findIndex(hasText));
}
const unstamped = (l: LrcLine) => l.timeMs === null;

export function initState(doc: LrcDoc): State {
  const sel = first(doc.lines, unstamped);
  return {
    doc, past: [], future: [], step: doc.lines.length ? 'lines' : 'lyrics', sel,
    word: nextWord(doc.lines[sel]), draft: docText(doc), emit: false,
  };
}

/**
 * Textarea text → lines. Lines whose display text is unchanged keep their object (stamp and word tags),
 * matched with an LCS so inserting or removing a line doesn't shift every stamp. In a run of changed
 * lines, an edited line inherits the line time of the old line it replaces (in order), not its word tags.
 * ponytail: O(n·m) LCS table; fine for song-length lyrics.
 */
export function applyText(old: LrcLine[], text: string): LrcLine[] {
  const rows = text ? text.split('\n').map((r) => r.trimEnd()) : [];
  const a = old.map((l) => displayText(l.text));
  const b = rows.map((r) => r.trim());
  const n = a.length;
  const m = b.length;
  const L = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out: LrcLine[] = [];
  let removed: LrcLine[] = []; // old lines dropped in the current run of changes
  for (let i = 0, j = 0; j < m; ) {
    if (i < n && a[i] === b[j]) {
      out.push(old[i++]);
      j++;
      removed = [];
    } else if (i < n && L[i + 1][j] >= L[i][j + 1]) removed.push(old[i++]);
    else out.push({ timeMs: removed.shift()?.timeMs ?? null, text: rows[j++] });
  }
  return out;
}

function commit(s: State, lines: LrcLine[], extra?: Partial<State>): State {
  return { ...s, doc: { ...s.doc, lines }, past: [...s.past, s.doc], future: [], emit: true, ...extra };
}

// Draft → lines; returns s itself when nothing changed (no empty undo steps).
function applyDraft(s: State): State {
  const old = s.doc.lines;
  const lines = applyText(old, s.draft);
  if (lines.length === old.length && lines.every((l, i) => l === old[i])) return s;
  const sel = Math.min(s.sel, Math.max(0, lines.length - 1));
  return commit(s, lines, { sel, word: nextWord(lines[sel]) });
}

const select = (s: State, sel: number): State => ({ ...s, sel, word: nextWord(s.doc.lines[sel]) });

// Undo/redo: select the line that changed, so the user sees what was undone.
function restore(s: State, doc: LrcDoc, past: LrcDoc[], future: LrcDoc[]): State {
  const changed = doc.lines.length === s.doc.lines.length ? doc.lines.findIndex((l, i) => l !== s.doc.lines[i]) : -1;
  const sel = changed >= 0 ? changed : Math.max(0, Math.min(s.sel, doc.lines.length - 1));
  return { ...s, doc, past, future, sel, word: nextWord(doc.lines[sel]), draft: docText(doc), emit: true };
}

// ponytail: unbounded undo history; docs share line objects, so each step is one array.
export function reducer(s: State, a: Action): State {
  const lines = s.doc.lines;
  const line = lines[s.sel] as LrcLine | undefined;
  const put = (l: LrcLine, extra?: Partial<State>) => commit(s, lines.map((x, i) => (i === s.sel ? l : x)), extra);
  switch (a.t) {
    case 'load': {
      const { sel, word, draft } = initState(a.doc);
      return { ...s, doc: a.doc, past: [...s.past, s.doc], future: [], sel, word, draft, emit: false };
    }
    case 'draft':
      return { ...s, draft: a.text };
    case 'commit':
      return applyDraft(s);
    case 'paste': {
      // Pasted LRC = an import at the caret: its lines keep stamps and word tags, the lines around keep theirs.
      const c = applyDraft(s); // typing not yet committed is its own undo step (as for undo)
      const before = c.draft.slice(0, a.start);
      const after = c.draft.slice(a.end);
      const pre = before && !before.endsWith('\n') ? before + '\n' : before;
      const post = after && !after.startsWith('\n') ? '\n' + after : after;
      const k = a.doc.lines.length;
      // Diff with placeholder rows ('\0' matches no lyric), then put the pasted lines in their place.
      const lines = applyText(c.doc.lines, pre + Array(k).fill('\0').join('\n') + post);
      lines.splice(pre.split('\n').length - 1, k, ...a.doc.lines);
      const keys = new Set(a.doc.meta.map((m) => m.key));
      const doc = { meta: [...c.doc.meta.filter((m) => !keys.has(m.key)), ...a.doc.meta], lines };
      const sel = Math.min(c.sel, lines.length - 1);
      const draft = pre + a.doc.lines.map((l) => displayText(l.text)).join('\n') + post;
      const n = a.doc.lines.filter((l) => l.timeMs !== null).length;
      return { ...c, doc, past: [...c.past, c.doc], future: [], emit: true, sel, word: nextWord(lines[sel]), draft, pasted: { n, doc } };
    }
    case 'step': {
      const c = applyDraft(s);
      const l = c.doc.lines;
      if (a.step === 'lyrics' || a.step === s.step) return { ...c, step: a.step };
      // Words: resume at the first line with an untimed word (a partly timed line included).
      const todo = a.step === 'lines' ? unstamped : (x: LrcLine) => words(x).some((w) => w.timeMs === null);
      return { ...select(c, first(l, todo)), step: a.step };
    }
    case 'select':
      return select(s, a.i);
    case 'move':
      return select(s, next(lines, s.sel, a.d));
    case 'stamp': {
      if (!line) return s;
      // The stamp that syncs the last untimed line deselects (sel −1): the editor shows its "done" card.
      const done = line.timeMs === null && lines.every((x, i) => i === s.sel || !hasText(x) || x.timeMs !== null);
      const sel = done ? -1 : next(lines, s.sel, 1);
      return put(setLineTime(line, a.ms), { sel, word: nextWord(lines[sel]) });
    }
    case 'stampWord': {
      const ws = line ? lineWords(line.text) : [];
      const n = ws.filter((w) => w.text).length;
      if (!line || s.word >= n) return s;
      ws[s.word] = { ...ws[s.word], timeMs: a.ms };
      // Word 0's tag is the line time.
      const l: LrcLine = { timeMs: s.word === 0 ? a.ms : line.timeMs, text: joinWords(ws) };
      if (s.word + 1 < n) return put(l, { word: s.word + 1 });
      const sel = next(lines, s.sel, 1); // line finished: on to the next one
      return sel === s.sel ? put(l, { word: n }) : put(l, { sel, word: nextWord(lines[sel]) });
    }
    case 'pickWord':
      return { ...s, word: a.w };
    case 'moveWord': {
      const w = s.word + a.d;
      if (w >= 0 && w < words(line).length) return { ...s, word: w };
      const i = next(lines, s.sel, a.d);
      return i === s.sel ? s : { ...s, sel: i, word: a.d > 0 ? 0 : Math.max(0, words(lines[i]).length - 1) };
    }
    case 'nudge': {
      if (s.step !== 'words') return line?.timeMs != null ? put(setLineTime(line, Math.max(0, line.timeMs + a.d))) : s;
      const ws = line ? lineWords(line.text) : [];
      const t = ws[s.word]?.text ? ws[s.word].timeMs : null;
      if (t === null) return s;
      ws[s.word] = { ...ws[s.word], timeMs: Math.max(0, t + a.d) };
      return put({ timeMs: s.word === 0 ? ws[0].timeMs : line!.timeMs, text: joinWords(ws) }); // word 0's tag = line time
    }
    case 'clear':
      return line?.timeMs != null ? put(setLineTime(line, null)) : s;
    case 'clearWords':
      return line && hasWordTimes(line) ? put({ ...line, text: displayText(line.text) }, { word: 0 }) : s;
    case 'undo': {
      const c = applyDraft(s); // typing not yet committed is the last change
      return c.past.length ? restore(c, c.past[c.past.length - 1], c.past.slice(0, -1), [c.doc, ...c.future]) : c;
    }
    case 'redo':
      return s.future.length ? restore(s, s.future[0], [...s.past, s.doc], s.future.slice(1)) : s;
  }
}
