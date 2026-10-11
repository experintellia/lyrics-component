import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, type Dispatch } from 'react';
import { rateOf, usePlaybackTime } from './clock';
import { hasText, hasWordTimes, initState, reducer, words, type Action, type Step } from './editorModel';
import { displayText, formatTime, lineSpan, parseLrc, sections, serializeLrc, type LrcDoc, type LrcLine } from './lrc';
import type { LyricsProps } from './types';
import { LyricsView } from './LyricsView';
import { bandColor, Waveform, wordMarks } from './Waveform';

const STEPS: [Step, string, string?][] = [
  ['lyrics', 'Lyrics'],
  ['lines', 'Sync lines'],
  ['words', 'Sync words', 'optional'],
];

// Keyboard focus = :focus-visible as of when the element got focus. Asking at keydown time is useless:
// Chromium and WebKit turn :focus-visible on for a clicked button as soon as any key is pressed.
// ponytail: one pair of window listeners for the page, installed on import.
let kbFocus: EventTarget | null = null;
if (typeof window !== 'undefined') {
  window.addEventListener('focusin', (e) => {
    try {
      kbFocus = e.target instanceof Element && e.target.matches(':focus-visible') ? e.target : null;
    } catch {
      kbFocus = null; // engine without :focus-visible
    }
  }, true);
  window.addEventListener('pointerdown', () => (kbFocus = null), true); // clicking it makes it a mouse focus
}
const focusVisible = (el: Element) => el === kbFocus;

/** The shortcut rule (the demo's Space uses it too): keys are shortcuts anywhere except while typing in a text
 *  entry. A button or slider focused by a click must not swallow them; only on a keyboard-focused
 *  (:focus-visible) control do Enter and Space keep their native meaning (activate it). A focused <select> counts
 *  as typing: its arrow keys, letters, Space and Enter all pick an option, so it keeps every key. */
export function isShortcut(e: KeyboardEvent, isFocusVisible = focusVisible): boolean {
  const el = e.target;
  if (!(el instanceof HTMLElement)) return true;
  const typing =
    el.isContentEditable ||
    el.matches(
      'textarea, select, input:not([type=checkbox], [type=radio], [type=range], [type=button], [type=submit], [type=reset], [type=file], [type=color], [type=image])',
    );
  return !typing && !((e.key === 'Enter' || e.key === ' ') && isFocusVisible(el));
}

// No onChange = read-only (host contract): show the display instead of an editor whose edits go nowhere.
export function LyricsEditor(p: LyricsProps) {
  return p.onChange ? <Editor {...p} /> : <LyricsView {...p} />;
}

function Editor({ lrc, onChange, position, onSeek, peaks, offsetMs = 0 }: LyricsProps) {
  const [s, dispatch] = useReducer(reducer, lrc, (l) => initState(parseLrc(l)));
  const { audibleMs, seek } = usePlaybackTime(position, offsetMs, onSeek);
  const seekRef = useRef(seek);
  seekRef.current = seek;

  // --- onChange: every doc change right away. Text becomes a doc change on blur or after 500 ms idle.
  // Pending text is also flushed on unmount, pagehide and visibilitychange to hidden.
  const last = useRef(lrc); // last string received from or emitted to the host
  const cb = useRef(onChange);
  cb.current = onChange;
  const emit = (doc: LrcDoc) => {
    const out = serializeLrc(doc);
    if (out === last.current) return;
    last.current = out;
    cb.current?.(out);
  };
  // Re-parse only when the prop differs from what we last emitted (not on our own echo).
  useEffect(() => {
    if (lrc === last.current) return;
    last.current = lrc;
    dispatch({ t: 'load', doc: parseLrc(lrc) });
  }, [lrc]);
  useEffect(() => {
    if (s.emit) emit(s.doc);
  }, [s.doc]);
  useEffect(() => {
    const t = setTimeout(() => dispatch({ t: 'commit' }), 500);
    return () => clearTimeout(t);
  }, [s.draft]);
  // Unmount (e.g. host remounts on track change), page hide/close, or tab backgrounded (mobile may kill it
  // unannounced): don't lose text typed in the last 500 ms.
  const latest = useRef(s);
  latest.current = s;
  useEffect(() => {
    const flush = () => {
      const c = reducer(latest.current, { t: 'commit' });
      if (c !== latest.current) emit(c.doc);
    };
    const onHide = () => document.visibilityState === 'hidden' && flush();
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onHide);
      flush();
    };
  }, []);

  // Pasted LRC goes through the reducer (the textarea gets a new value), so put the caret back after it.
  const caretFromEnd = useRef<number | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const ta = textRef.current;
    if (caretFromEnd.current === null || !ta) return;
    const at = ta.value.length - caretFromEnd.current;
    ta.setSelectionRange(at, at);
    caretFromEnd.current = null;
  }, [s.pasted]);

  const lines = s.doc.lines;
  const line = lines[s.sel] as LrcLine | undefined;
  const ws = words(line);
  const wordStep = s.step === 'words';
  const dur = position.durationMs;
  // Word step: the waveform fits the selected line, and (Loop line) playback loops over it.
  const span = wordStep ? lineSpan(lines, s.sel, dur || Infinity) : null;
  const [loop, setLoop] = useState(true);
  // Once per pass: seek's hold shows the line start right away, so this doesn't fire again while the host seeks.
  useEffect(() => {
    if (loop && span && position.playing && audibleMs >= span[1]) seekRef.current(span[0]);
  });
  // Word step: a new line (finished the last word, Next line, ↑/↓ across lines, entering the step) starts
  // playback at its stamp, so its first words aren't missed while the previous line's last word rang out.
  const lineStart = wordStep ? line?.timeMs : null;
  useEffect(() => {
    if (lineStart != null) seekRef.current(lineStart);
  }, [s.sel, wordStep]);
  const canStamp = wordStep ? s.word < ws.length : !!line;
  const ms = Math.max(0, Math.round(audibleMs));
  const stamp = () => canStamp && dispatch(wordStep ? { t: 'stampWord', ms } : { t: 'stamp', ms });
  // ↺ jumps back 5 s of listening: at 0.5× that's 2.5 s of the song (rounded to 0.1 s, so it matches its label).
  const backS = Math.round(50 * rateOf(position)) / 10;
  const textLines = lines.filter(hasText);
  const lineNo = lines.slice(0, s.sel + 1).filter(hasText).length;
  const wordsDone = textLines.filter((l) => timedWords(l) === words(l).length).length;
  const label = !canStamp
    ? 'Stamp'
    : wordStep
      ? `Stamp “${ws[s.word].text.trim()}”`
      : `${line!.timeMs !== null ? 'Re-stamp' : 'Stamp'} ${hasText(line) ? `line ${lineNo}` : 'break'}`;
  // Line numbers (text lines only) by index, for the out-of-order warning and the "resume" link.
  const nos = useMemo(() => {
    let n = 0;
    return lines.map((l) => (hasText(l) ? ++n : n));
  }, [lines]);
  // A stamp here would land before an earlier line's time or after a later one's: warn, don't block
  // (fixing two wrong lines may need it). ponytail: linear scan per frame; fine for song-length lyrics.
  let clash = '';
  if (s.step === 'lines' && line)
    lines.forEach((l, i) => {
      if (i === s.sel || l.timeMs === null || !hasText(l)) return;
      if (i < s.sel && l.timeMs > ms && !clash) clash = `before line ${nos[i]}`;
      if (i > s.sel && l.timeMs < ms) clash = `after line ${nos[i]}`;
    });
  const todo = lines.findIndex((l) => hasText(l) && l.timeMs === null);
  const resume = todo >= 0 && todo !== s.sel ? { i: todo, no: nos[todo] } : undefined;

  // Shortcuts, by the one rule in isShortcut. Capture phase, so a focused control can't handle them first.
  // Bound once; `keys` sees fresh state.
  const keys = useRef<(e: KeyboardEvent) => void>(null);
  keys.current = (e) => {
    if (!isShortcut(e)) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (mod && k === 'z') dispatch({ t: e.shiftKey ? 'redo' : 'undo' });
    else if (mod && k === 'y') dispatch({ t: 'redo' });
    else if (s.step === 'lyrics' || mod || e.altKey) return;
    else if (k === 's' || k === 'enter') !e.repeat && stamp();
    else if (k === 'arrowup' || k === 'arrowdown') dispatch({ t: wordStep ? 'moveWord' : 'move', d: k === 'arrowup' ? -1 : 1 });
    // ←/→ nudge 10 ms, Shift 100 ms. Wins over a clicked slider's native ←/→, as ↑/↓ already do.
    else if (k === 'arrowleft' || k === 'arrowright') dispatch({ t: 'nudge', d: (k === 'arrowleft' ? -1 : 1) * (e.shiftKey ? 100 : 10) });
    else return;
    e.preventDefault();
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => keys.current!(e);
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, []);

  // Keep the selected line clear of the sticky head and Stamp dock (CSS scroll-margin sets the gap). Not
  // block: 'nearest': Chromium skips scroll-margin for a row already in the viewport, i.e. under the head.
  // Also on doc changes: stamping the last line keeps it selected but adds its tools, so the row grows.
  // The rows' scroll-margin clears the sticky head by its height, measured now (fonts, waveform, wrapping vary).
  const list = useRef<HTMLOListElement>(null);
  const head = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = head.current!;
    el.parentElement!.style.setProperty('--lyrics-head-h', `${el.offsetHeight}px`);
    const row = list.current?.querySelector('[aria-current]');
    if (!row?.scrollIntoView) return;
    const r = row.getBoundingClientRect();
    const top = Math.max(0, el.getBoundingClientRect().bottom);
    const bottom = Math.min(innerHeight, el.parentElement!.querySelector('.lyrics-editor-dock')!.getBoundingClientRect().top);
    if (r.top < top) row.scrollIntoView({ block: 'start' });
    else if (r.bottom > bottom) {
      // Too tall to fit between its scroll-margins (head + fade above, dock below): show its top instead.
      const cs = getComputedStyle(row);
      const room = innerHeight - parseFloat(cs.scrollMarginTop) - parseFloat(cs.scrollMarginBottom);
      row.scrollIntoView({ block: r.height > room ? 'start' : 'end' });
    }
  }, [s.sel, s.step, lines]);

  // The editor re-renders every animation frame while playing; the list only when its inputs change.
  const rows = useMemo(() => {
    // Each verse's rows get its waveform band's colour as a left edge, so bands map to verses.
    const band = new Array<number | undefined>(lines.length);
    sections(lines).forEach((sec, k) => band.fill(k, sec.from, sec.to));
    let no = 0;
    return lines.map((l, i) => {
      const text = displayText(l.text);
      if (!text && l.timeMs === null) return <li key={i} className="lyrics-editor-gap" />; // stanza break
      if (text) no++;
      const sel = i === s.sel;
      const late = dur > 0 && l.timeMs !== null && l.timeMs > dur;
      return (
        <li
          key={i}
          className="lyrics-editor-row"
          aria-current={sel || undefined}
          data-late={late || undefined}
          style={band[i] === undefined ? undefined : { borderInlineStartColor: bandColor(band[i]) }}
        >
          <button
            type="button"
            className="lyrics-editor-line"
            onClick={() => {
              dispatch({ t: 'select', i });
              if (l.timeMs !== null) seekRef.current(l.timeMs); // its exact stamp, as ▶ Play from here
            }}
          >
            <span className="lyrics-editor-no">{text ? no : '♪'}</span>
            <span className="lyrics-editor-time" title={late ? 'After the end of the track' : undefined}>
              {l.timeMs === null ? '—' : formatTime(l.timeMs)}
            </span>
            <span className="lyrics-editor-text" dir="auto">
              {text || 'Instrumental break'}
              {s.step === 'words' && text && (
                <small className="lyrics-editor-badge">
                  {timedWords(l) === words(l).length ? 'words ✓' : `${timedWords(l)}/${words(l).length} words`}
                </small>
              )}
            </span>
          </button>
          {sel &&
            (s.step === 'words' ? (
              <WordTools line={l} word={s.word} dispatch={dispatch} seek={(t) => seekRef.current(t)} />
            ) : (
              <LineTools line={l} dispatch={dispatch} seek={(t) => seekRef.current(t)} resume={resume} />
            ))}
        </li>
      );
    });
  }, [lines, s.sel, s.word, s.step, dur, resume?.i]);

  const undoRedo = (
    <span className="lyrics-editor-undo">
      <button type="button" disabled={!s.past.length} onClick={() => dispatch({ t: 'undo' })}>Undo</button>
      <button type="button" disabled={!s.future.length} onClick={() => dispatch({ t: 'redo' })}>Redo</button>
    </span>
  );

  const synced = textLines.filter((l) => l.timeMs !== null).length;
  const pasted = s.pasted?.doc === s.doc ? s.pasted.n : 0;
  const allSynced = synced === textLines.length;
  let banner;
  if (!textLines.length) banner = <>No lyrics yet. Add them in step 1 first.</>;
  else if (wordStep)
    banner = (
      <>
        Optional, for word-by-word highlighting. Tap a line, press play, then tap <b>Stamp</b> as each highlighted
        word starts. The line loops until you're done; after its last word, the next line plays from its start (its first word is timed by the line stamp).
      </>
    );
  else if (allSynced)
    banner = <>All lines are synced ✓ Play it back to check. Tap a line to fix it, or time single words in step 3 (optional).</>;
  else
    banner = (
      <>
        {synced ? '' : 'These lyrics have no timing yet. '}Press play, then tap <b>Stamp</b> the moment each
        highlighted line starts.
      </>
    );
  // Always on screen in the sticky dock, so the user knows where they are even with the steps scrolled away.
  const progress = !textLines.length
    ? ''
    : wordStep
      ? `${loop ? '↻ ' : ''}Line ${lineNo}${
          !ws.length ? '' : s.word < ws.length ? `: word ${s.word + 1} of ${ws.length}` : ': all words timed ✓'}`
      : allSynced
        ? line
          ? `All ${textLines.length} lines synced ✓`
          : '' // the done card says it
        : `${synced} of ${textLines.length} lines synced`;

  return (
    <div className="lyrics-editor">
      {/* Sticky: the step tabs, and while syncing the waveform, so it stays in view next to the line being fixed. */}
      <div className="lyrics-editor-head" ref={head}>
        <div className="lyrics-editor-tabs" role="tablist" aria-label="Editor steps">
          {STEPS.map(([id, name, note], k) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={s.step === id}
              onClick={() => dispatch({ t: 'step', step: id })}
            >
              <span className="lyrics-editor-stepno" aria-hidden="true">{k + 1}</span> {name}
              {note && <small aria-hidden="true">{note}</small>}
            </button>
          ))}
        </div>
        {s.step !== 'lyrics' && (
          <Waveform
            peaks={peaks}
            timeMs={audibleMs}
            lines={lines}
            onSeek={seek}
            selected={s.sel}
            fit={span}
            marks={span ? wordMarks(line!.text, span[1], s.word) : undefined}
            pending={wordStep && ws[s.word]?.timeMs === null ? ws[s.word].text.trim() : undefined}
            loop={loop ? span : null}
          />
        )}
      </div>

      {s.step === 'lyrics' ? (
        <div role="tabpanel" aria-label="Lyrics" className="lyrics-editor-panel">
          {pasted ? (
            // Replaces the how-to: pasted time tags vanish from the box, so say where they went.
            <p className="lyrics-editor-banner" data-ok role="status" id="lyrics-editor-howto">
              <b>Kept the timing of {pasted} pasted line{pasted === 1 ? '' : 's'} ✓</b> The pasted lyrics had
              timestamps; they're in the Sync lines step now, not in this box. Undo removes the paste.
            </p>
          ) : (
            <p className="lyrics-editor-banner" id="lyrics-editor-howto">
              Type or paste the lyrics — one line per row; blank line between verses.
            </p>
          )}
          <textarea
            className="lyrics-editor-text-input"
            aria-label="Lyrics text"
            aria-describedby="lyrics-editor-howto"
            dir="auto"
            rows={Math.max(8, s.draft.split('\n').length + 1)} // grows with the text; the page scrolls, not the box
            value={s.draft}
            onChange={(e) => dispatch({ t: 'draft', text: e.target.value })}
            onBlur={() => dispatch({ t: 'commit' })}
            ref={textRef}
            onPaste={(e) => {
              const doc = parseLrc(e.clipboardData.getData('text/plain'));
              if (!doc.lines.some((l) => l.timeMs !== null)) return; // plain text: the browser pastes it
              e.preventDefault();
              const { selectionStart: start, selectionEnd: end } = e.currentTarget;
              caretFromEnd.current = s.draft.length - end;
              dispatch({ t: 'paste', doc, start, end });
            }}
          />
          <div className="lyrics-editor-dock">
            <p className="lyrics-editor-progress">
              {s.draft.trim()
                ? `${s.draft.split('\n').filter((r) => r.trim()).length} lines${synced ? ` · ${synced} timed` : ''}`
                : dur
                  ? 'Type or paste at least one line to continue.'
                  : 'Load the song and add at least one line to continue.'}
            </p>
            {/* Transcribing: hear the last bit again. preventDefault keeps the caret in the box (no blur, no iOS keyboard hide). */}
            <button
              type="button"
              aria-label={`Back ${backS} s`} // contains the visible "5 s", for voice control
              disabled={!dur}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => seek(Math.max(0, audibleMs - backS * 1000))}
            >
              ↺ {backS} s
            </button>
            {undoRedo}
            <button
              type="button"
              className="lyrics-editor-primary"
              disabled={!s.draft.trim()}
              onClick={() => dispatch({ t: 'step', step: 'lines' })}
            >
              {synced ? 'Next: check the timing →' : 'Next: sync to the music →'}
            </button>
          </div>
        </div>
      ) : (
        <div role="tabpanel" aria-label={wordStep ? 'Sync words' : 'Sync lines'} className="lyrics-editor-panel">
          <p className="lyrics-editor-banner">{banner}</p>
          <p className="lyrics-editor-tip">
            {wordStep
              ? `${wordsDone} of ${textLines.length} lines have word timing. Tap a line or word to play from it. Words are quick: set the playback speed to 0.5×.`
              : 'Tap a line to play from its time. Too late? Drag the waveform back or nudge −0.1 s. For precise timing, set the playback speed to 0.5×.'}
            <span className="lyrics-editor-hint">
              {' '}Keys: S or Enter = Stamp · ↑/↓ = choose {wordStep ? 'word' : 'line'} · ←/→ = nudge 0.01 s
              (Shift: 0.1 s) · Ctrl/⌘+Z = undo. Shortcuts work
              anywhere except while typing.
            </span>
          </p>
          {textLines.length ? (
            <ol ref={list} className="lyrics-editor-lines">{rows}</ol>
          ) : (
            <button type="button" className="lyrics-editor-primary" onClick={() => dispatch({ t: 'step', step: 'lyrics' })}>
              ← Add lyrics
            </button>
          )}
          <div className="lyrics-editor-dock" data-done={(!wordStep && allSynced && !line) || undefined}>
            <p className="lyrics-editor-progress">
              <span className="lyrics-editor-now" aria-label="Playback position">{formatTime(audibleMs)}</span>
              {!position.playing && <b> · paused</b>}
              {rateOf(position) !== 1 && (
                <b> · {rateOf(position)}×<span className="lyrics-editor-wide"> speed</span></b>
              )}
              {clash ? (
                <b className="lyrics-editor-warn"> · ⚠ the playhead is {clash}: play from just before this line first</b>
              ) : (
                progress && <span> · {progress}</span>
              )}
            </p>
            {wordStep && (
              <label className="lyrics-editor-loop">
                <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} /> ↻ Loop line
              </label>
            )}
            {undoRedo}
            {!wordStep && allSynced && !line ? (
              // Just finished: a done card instead of a "Re-stamp" button that invites an accidental overwrite.
              <div className="lyrics-editor-done" role="status">
                <p>
                  <b>All {textLines.length} lines synced ✓</b> Play it from the start to check. Tap any line to fix it.
                </p>
                <button type="button" onClick={() => seek(0)}>⏮ Back to the start</button>
                <button type="button" onClick={() => dispatch({ t: 'step', step: 'words' })}>
                  Next: sync words (optional) →
                </button>
              </div>
            ) : (
              /* preventDefault: tapping Stamp must not steal focus or pop up the iOS keyboard. Paused: Stamp is
                 outlined, so the host's Play is the first thing to press. */
              <button
                type="button"
                className="lyrics-editor-stamp"
                disabled={!canStamp}
                data-paused={!position.playing || undefined}
                data-warn={!!clash || undefined}
                onPointerDown={(e) => e.preventDefault()}
                onClick={stamp}
              >
                {label}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

interface ToolProps {
  line: LrcLine;
  dispatch: Dispatch<Action>;
  seek: (ms: number) => void;
  resume?: { i: number; no: number }; // first untimed line, if it isn't the selected one
}

// ponytail: "play from here" = seek; whether it plays is the host's playing state (the host owns transport).
const timedWords = (l: LrcLine) => words(l).filter((w) => w.timeMs !== null).length;

const PlayHere = ({ ms, seek, label = 'from here' }: { ms: number | null; seek: (ms: number) => void; label?: string }) => (
  <button type="button" disabled={ms === null} onClick={() => seek(ms!)}>▶ Play {label}</button>
);
const Nudges = ({ dispatch }: { dispatch: Dispatch<Action> }) =>
  [-100, 100].map((d) => (
    <button key={d} type="button" className="lyrics-editor-nudge" onClick={() => dispatch({ t: 'nudge', d })}>
      {d < 0 ? '−0.1 s' : '+0.1 s'}
    </button>
  ));

function LineTools({ line, dispatch, seek, resume }: ToolProps) {
  const back = resume && (
    <button type="button" className="lyrics-editor-link" onClick={() => dispatch({ t: 'select', i: resume.i })}>
      Back to line {resume.no} →
    </button>
  );
  if (line.timeMs === null)
    return (
      <div className="lyrics-editor-tools">
        <p className="lyrics-editor-tip">Not synced yet: press play and tap <b>Stamp</b> when this line starts.</p>
        {back}
      </div>
    );
  // ponytail: buttons are ±0.1 s only, to keep phones uncrowded; the handoff's ±10 ms is on ←/→ (no button).
  return (
    <div className="lyrics-editor-tools" role="group" aria-label="Fix this line">
      <p className="lyrics-editor-tip">
        Wrong time? Press play, then tap <b>Re-stamp</b> when the line starts. Or nudge it:
      </p>
      <Nudges dispatch={dispatch} />
      <PlayHere ms={line.timeMs} seek={seek} />
      {back}
      <button type="button" className="lyrics-editor-quiet" onClick={() => dispatch({ t: 'clear' })}>Clear time</button>
    </div>
  );
}

function WordTools({ line, word, dispatch, seek }: ToolProps & { word: number }) {
  const ws = words(line);
  const sel = ws[word] as (typeof ws)[number] | undefined; // the selected word; none once all are timed
  return (
    <div className="lyrics-editor-tools" role="group" aria-label="Word timing">
      <div className="lyrics-editor-chips">
        {ws.map((w, k) => (
          <button
            key={k}
            type="button"
            className="lyrics-editor-chip"
            aria-current={k === word || undefined}
            data-timed={w.timeMs !== null || undefined}
            onClick={() => {
              dispatch({ t: 'pickWord', w: k });
              if (w.timeMs !== null) seek(w.timeMs); // its exact stamp, as for lines
            }}
          >
            {w.text.trim()}
            <small>{w.timeMs === null ? '—' : formatTime(w.timeMs)}</small>
          </button>
        ))}
      </div>
      <p className="lyrics-editor-tip">
        {!ws.length
          ? 'No words on this line.'
          : `${word < ws.length ? 'Tap Stamp as the blue word starts. After the last word, the next line plays from its start.' : 'All words timed.'} Tap a timed word to hear it; Stamp then re-times it.`}
      </p>
      {sel?.timeMs != null && <Nudges dispatch={dispatch} />}
      {/* Names its target: the selected word if timed, else the line start. */}
      <PlayHere ms={sel?.timeMs ?? line.timeMs} seek={seek} label={sel?.timeMs != null ? `from “${sel.text.trim()}”` : 'line'} />
      <button type="button" onClick={() => dispatch({ t: 'move', d: 1 })}>Next line →</button>
      <button
        type="button"
        className="lyrics-editor-quiet"
        disabled={!hasWordTimes(line)}
        onClick={() => dispatch({ t: 'clearWords' })}
      >
        Clear word timing
      </button>
    </div>
  );
}
