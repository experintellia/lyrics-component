import { memo, useEffect, useLayoutEffect, useReducer, useRef, type Dispatch, type RefObject } from 'react';
import { usePlaybackTime } from './clock';
import { formatTime, parseLrc, serializeLrc, setLineTime, type LrcDoc, type LrcLine } from './lrc';
import type { LyricsProps } from './types';
import { LyricsView } from './LyricsView';
import { Waveform } from './Waveform';

type Action =
  | { t: 'load'; doc: LrcDoc }
  | { t: 'select'; i: number }
  | { t: 'type'; i: number; text: string }
  | { t: 'split'; i: number; start: number; end: number }
  | { t: 'merge'; i: number }
  | { t: 'paste'; i: number; start: number; end: number; text: string }
  | { t: 'stamp'; ms: number }
  | { t: 'nudge'; d: number }
  | { t: 'clear' }
  | { t: 'undo' }
  | { t: 'redo' };

interface State {
  doc: LrcDoc;
  past: LrcDoc[];
  future: LrcDoc[];
  sel: number;
  typing: number | null; // line whose typing is grouped into the current undo step
  emit: 'now' | 'idle' | 'none'; // when to report this doc via onChange
  focus: { i: number; at: number } | null; // input to focus after a split/merge/paste
}

const EMPTY: LrcLine = { timeMs: null, text: '' };

// ponytail: unbounded undo history; docs share line objects, so each step is one array.
function commit(s: State, doc: LrcDoc, emit: State['emit'], extra?: Partial<State>): State {
  return { ...s, doc, past: [...s.past, s.doc], future: [], typing: null, emit, focus: null, ...extra };
}

function reducer(s: State, a: Action): State {
  const lines = s.doc.lines;
  const put = (next: LrcLine[]) => ({ ...s.doc, lines: next });
  switch (a.t) {
    case 'load':
      return commit(s, a.doc, 'none', { sel: 0 });
    case 'select':
      return { ...s, sel: a.i };
    case 'type': {
      const next = lines.slice();
      next[a.i] = { ...(lines[a.i] ?? EMPTY), text: a.text };
      if (s.typing === a.i) return { ...s, doc: put(next), emit: 'idle' };
      return commit(s, put(next), 'idle', { typing: a.i });
    }
    case 'split': {
      const cur = lines[a.i] ?? EMPTY;
      const next = lines.slice();
      next.splice(a.i, 1, { ...cur, text: cur.text.slice(0, a.start) }, { timeMs: null, text: cur.text.slice(a.end) });
      return commit(s, put(next), 'idle', { sel: a.i + 1, focus: { i: a.i + 1, at: 0 } });
    }
    case 'merge': {
      const prev = lines[a.i - 1];
      const cur = lines[a.i];
      if (!prev || !cur) return s;
      const next = lines.slice();
      next.splice(a.i - 1, 2, { ...prev, text: prev.text + cur.text });
      return commit(s, put(next), 'idle', { sel: a.i - 1, focus: { i: a.i - 1, at: prev.text.length } });
    }
    case 'paste': {
      // Multi-line paste: parsed like a file (so a pasted LRC keeps its stamps), split into rows at the caret.
      const cur = lines[a.i] ?? EMPTY;
      const p = parseLrc(a.text);
      const ins = p.lines.length ? p.lines.slice() : [EMPTY];
      const last = ins.length - 1;
      ins[0] = { timeMs: cur.timeMs ?? ins[0].timeMs, text: cur.text.slice(0, a.start) + ins[0].text };
      const at = ins[last].text.length;
      ins[last] = { ...ins[last], text: ins[last].text + cur.text.slice(a.end) };
      const next = lines.slice();
      next.splice(a.i, 1, ...ins);
      return commit(s, { meta: [...s.doc.meta, ...p.meta], lines: next }, 'idle', {
        sel: a.i + last,
        focus: { i: a.i + last, at },
      });
    }
    case 'stamp':
    case 'nudge':
    case 'clear': {
      const line = lines[s.sel];
      if (!line || (a.t !== 'stamp' && line.timeMs === null)) return s;
      const ms = a.t === 'stamp' ? a.ms : a.t === 'clear' ? null : Math.max(0, line.timeMs! + a.d);
      const next = lines.slice();
      next[s.sel] = setLineTime(line, ms);
      return commit(s, put(next), 'now', a.t === 'stamp' ? { sel: Math.min(s.sel + 1, lines.length - 1) } : {});
    }
    case 'undo':
      return s.past.length ? restore(s, s.past[s.past.length - 1], s.past.slice(0, -1), [s.doc, ...s.future]) : s;
    case 'redo':
      return s.future.length ? restore(s, s.future[0], [...s.past, s.doc], s.future.slice(1)) : s;
  }
}

function restore(s: State, doc: LrcDoc, past: LrcDoc[], future: LrcDoc[]): State {
  const sel = Math.max(0, Math.min(s.sel, doc.lines.length - 1));
  return { ...s, doc, past, future, sel, typing: null, emit: 'now', focus: null };
}

// Text entry only: a focused checkbox, slider or button (e.g. a host's volume/seek control) must not block S.
const isTextField = (el: EventTarget | null) =>
  el instanceof HTMLElement &&
  (el.isContentEditable ||
    el.matches(
      'textarea, select, input:not([type=checkbox], [type=radio], [type=range], [type=button], [type=submit], [type=reset], [type=file], [type=color], [type=image])',
    ));

// No onChange = read-only (host contract): show the display instead of an editor whose edits go nowhere.
export function LyricsEditor(p: LyricsProps) {
  return p.onChange ? <Editor {...p} /> : <LyricsView {...p} />;
}

function Editor({ lrc, onChange, position, onSeek, peaks, offsetMs = 0 }: LyricsProps) {
  const [s, dispatch] = useReducer(reducer, lrc, (l): State => ({
    doc: parseLrc(l),
    past: [],
    future: [],
    sel: 0,
    typing: null,
    emit: 'none',
    focus: null,
  }));
  const { audibleMs, seek } = usePlaybackTime(position, offsetMs, onSeek);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);

  // --- onChange: stamps/nudges/clears/undo now; text after 500 ms idle or blur.
  const last = useRef(lrc); // last string received from or emitted to the host
  const pending = useRef<LrcDoc | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const cb = useRef(onChange);
  cb.current = onChange;
  const flush = () => {
    clearTimeout(timer.current);
    const doc = pending.current;
    pending.current = null;
    if (!doc) return;
    const out = serializeLrc(doc);
    if (out === last.current) return;
    last.current = out;
    cb.current?.(out);
  };

  // Re-parse only when the prop differs from what we last emitted (not on our own echo).
  useEffect(() => {
    if (lrc === last.current) return;
    last.current = lrc;
    pending.current = null;
    dispatch({ t: 'load', doc: parseLrc(lrc) });
  }, [lrc]);

  useEffect(() => {
    if (s.emit === 'none') return;
    pending.current = s.doc;
    clearTimeout(timer.current);
    if (s.emit === 'now') flush();
    else timer.current = setTimeout(flush, 500);
  }, [s.doc]);

  // Unmount (e.g. host remounts on track change): don't lose text typed in the last 500 ms.
  useEffect(() => () => flush(), []);

  useLayoutEffect(() => {
    const el = s.focus && inputs.current[s.focus.i];
    if (!el) return;
    el.focus();
    el.setSelectionRange(s.focus!.at, s.focus!.at);
  }, [s.focus]);

  const lines = s.doc.lines;
  const line = lines[s.sel] as LrcLine | undefined;
  const stamped = line?.timeMs != null;
  const stamp = () => {
    dispatch({ t: 'stamp', ms: Math.max(0, Math.round(audibleMs)) });
    inputs.current[s.sel + 1]?.scrollIntoView?.({ block: 'nearest' });
  };

  // Shortcuts only when no text field has focus. The listener is bound once; `keys` sees fresh state.
  const keys = useRef<(e: KeyboardEvent) => void>(null);
  keys.current = (e) => {
    if (isTextField(e.target)) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (mod && k === 'z') dispatch({ t: e.shiftKey ? 'redo' : 'undo' });
    else if (mod && k === 'y') dispatch({ t: 'redo' });
    else if (k === 's' && !mod && !e.altKey && !e.repeat) stamp();
    else return;
    e.preventDefault();
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => keys.current!(e);
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  const dur = position.durationMs;
  return (
    <div className="lyrics-editor">
      <Waveform peaks={peaks} timeMs={audibleMs} lines={lines} onSeek={seek} />
      <div className="lyrics-editor-bar" role="toolbar" aria-label="Line tools">
        <span className="lyrics-editor-now">{formatTime(audibleMs)}</span>
        <button type="button" disabled={!s.past.length} onClick={() => dispatch({ t: 'undo' })}>Undo</button>
        <button type="button" disabled={!s.future.length} onClick={() => dispatch({ t: 'redo' })}>Redo</button>
        {[-100, -10, 10, 100].map((d) => (
          <button key={d} type="button" disabled={!stamped} onClick={() => dispatch({ t: 'nudge', d })}>
            {d < 0 ? '−' : '+'}
            {Math.abs(d)} ms
          </button>
        ))}
        <button type="button" disabled={!stamped} onClick={() => dispatch({ t: 'clear' })}>Clear</button>
        {/* ponytail: "play from line" = seek; whether it plays is the host's playing state. */}
        <button type="button" disabled={!stamped} onClick={() => seek(line!.timeMs!)}>Play line</button>
      </div>
      <ol className="lyrics-editor-lines" onBlur={flush}>
        {(lines.length ? lines : [EMPTY]).map((l, i) => (
          <Row
            key={i}
            line={l}
            i={i}
            selected={i === s.sel}
            late={dur > 0 && l.timeMs !== null && l.timeMs > dur}
            dispatch={dispatch}
            inputs={inputs}
          />
        ))}
      </ol>
      <p className="lyrics-editor-hint">
        S stamps the selected line (when no text field has focus). Ctrl/⌘+Z undo, Ctrl/⌘+Shift+Z or Ctrl+Y redo.
      </p>
      <button type="button" className="lyrics-editor-stamp" onPointerDown={(e) => e.preventDefault()} onClick={stamp}>
        Stamp
      </button>
    </div>
  );
}

// Memoised: the editor re-renders every animation frame while playing; rows only when their line changes.
// ponytail: <input> rows don't wrap long text (they scroll); a textarea with auto-height if that bites.
const Row = memo(function Row({ line, i, selected, late, dispatch, inputs }: {
  line: LrcLine;
  i: number;
  selected: boolean;
  late: boolean;
  dispatch: Dispatch<Action>;
  inputs: RefObject<(HTMLInputElement | null)[]>;
}) {
  return (
    <li className="lyrics-editor-row" aria-current={selected || undefined} data-late={late || undefined}>
      <button
        type="button"
        className="lyrics-editor-time"
        title={late ? 'Beyond the end of the track' : undefined}
        onClick={() => dispatch({ t: 'select', i })}
      >
        {line.timeMs === null ? '--:--.--' : formatTime(line.timeMs)}
      </button>
      <input
        ref={(el) => {
          inputs.current[i] = el;
        }}
        dir="auto"
        aria-label={`Line ${i + 1}`}
        value={line.text}
        onFocus={() => dispatch({ t: 'select', i })}
        onChange={(e) => dispatch({ t: 'type', i, text: e.target.value })}
        onKeyDown={(e) => {
          const { selectionStart: a, selectionEnd: b } = e.currentTarget;
          // keyCode 229: WebKit fires compositionend before the IME-confirming Enter, so isComposing is false.
          if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) {
            e.preventDefault();
            dispatch({ t: 'split', i, start: a ?? 0, end: b ?? 0 });
          } else if (e.key === 'Backspace' && i > 0 && a === 0 && b === 0) {
            e.preventDefault();
            dispatch({ t: 'merge', i });
          }
        }}
        onPaste={(e) => {
          const text = e.clipboardData.getData('text/plain');
          if (!text.includes('\n')) return;
          e.preventDefault();
          const { selectionStart: a, selectionEnd: b } = e.currentTarget;
          dispatch({ t: 'paste', i, start: a ?? 0, end: b ?? 0, text });
        }}
      />
    </li>
  );
});
