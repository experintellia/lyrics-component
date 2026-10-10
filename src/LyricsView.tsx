import { memo, useEffect, useMemo, useRef } from 'react';
import { usePlaybackTime } from './clock';
import { displayText, lineWords, parseLrc, type LrcWord } from './lrc';
import type { LyricsProps } from './types';

const RESUME_MS = 3000; // auto-scroll resumes this long after the user's last manual scroll

interface ViewLine { timeMs: number | null; text: string; words: LrcWord[] | null } // words only if word-tagged

// Words sung by `ms`: an untimed word goes with the timed word before it (a leading one with the line).
function sungCount(words: LrcWord[], ms: number): number {
  let n = 0;
  for (const w of words) {
    if (w.timeMs !== null && w.timeMs > ms) break;
    n++;
  }
  return n;
}

// Memoised so a word change re-renders only the current line(s); everyone else gets equal props.
const Line = memo(function Line({ line, current, sung }: { line: ViewLine; current: boolean; sung: number }) {
  const { timeMs, text, words } = line;
  if (timeMs === null) return <div className="lyrics-line" dir="auto">{text}</div>;
  if (!text) return null; // instrumental gap: affects `cur`, nothing to show or tap
  const join = (ws: LrcWord[]) => ws.map((w) => w.text).join('');
  return (
    <button type="button" className="lyrics-line" dir="auto" data-t={timeMs} aria-current={current || undefined}>
      {current && words ? (
        <>
          {join(words.slice(0, sung))}
          <span className="lyrics-upcoming">{join(words.slice(sung))}</span>
        </>
      ) : (
        text
      )}
    </button>
  );
});

export function LyricsView({ lrc, position, onSeek, offsetMs = 0 }: LyricsProps) {
  const lines = useMemo(
    () =>
      parseLrc(lrc).lines.map((l): ViewLine => {
        const words = l.timeMs === null ? null : lineWords(l.text);
        return { timeMs: l.timeMs, text: displayText(l.text), words: words?.some((w) => w.timeMs !== null) ? words : null };
      }),
    [lrc],
  );
  const { audibleMs, seek } = usePlaybackTime(position, offsetMs, onSeek);
  const box = useRef<HTMLDivElement>(null);
  const userTimer = useRef(0); // non-zero while the user is scrolling manually

  // Latest stamp at or before audible time (parseLrc sorts stamped lines). Equal times all match;
  // if that stamp is an instrumental gap (empty text), nothing visible matches, so nothing is highlighted.
  // ponytail: linear scan per frame; fine for song-length files.
  let cur: number | null = null;
  for (const l of lines) if (l.timeMs !== null && l.timeMs <= audibleMs) cur = l.timeMs;

  // Sung words in the current line(s). One number keys the memo: each line's count only grows with time,
  // so the sum changes exactly when some line's does (duets with equal stamps included).
  let sungKey = 0;
  for (const l of lines) if (l.timeMs === cur && l.words) sungKey += sungCount(l.words, audibleMs);

  // The clock re-renders us every frame; the list only changes when the current stamp or word does.
  const list = useMemo(
    () =>
      lines.map((l, i) => {
        const current = l.timeMs !== null && l.timeMs === cur;
        return <Line key={i} line={l} current={current} sung={current && l.words ? sungCount(l.words, audibleMs) : 0} />;
      }),
    // audibleMs is read only through sungKey, which changes whenever its effect would
    [lines, cur, sungKey],
  );

  // Scrolls only our own box (scrollIntoView would also scroll the host page). Smoothness is CSS
  // `scroll-behavior`, which is switched off under prefers-reduced-motion.
  const scrollToCurrent = () => {
    const b = box.current;
    const el = b?.querySelector<HTMLElement>('[aria-current]');
    if (b && el && !userTimer.current) b.scrollTop = el.offsetTop - (b.clientHeight - el.offsetHeight) / 2;
  };
  useEffect(scrollToCurrent, [cur]);

  // Only user input pauses auto-scroll (we never listen to `scroll`, so our own scrolling doesn't).
  const onUserScroll = () => {
    clearTimeout(userTimer.current);
    userTimer.current = window.setTimeout(() => {
      userTimer.current = 0;
      scrollToCurrent();
    }, RESUME_MS);
  };

  if (!lines.length) return null; // the host owns empty states

  return (
    <div
      ref={box}
      className="lyrics-view"
      onWheel={onUserScroll}
      onTouchMove={onUserScroll}
      // Keyboard scrolling (focus on a line). Not Space: on a focused line that's a click (seek), not a scroll.
      onKeyDown={(e) => /^(Arrow(Up|Down)|Page(Up|Down)|Home|End)$/.test(e.key) && onUserScroll()}
      // A pointerdown on the box itself (not a line) is a scrollbar drag.
      onPointerDown={(e) => e.target === e.currentTarget && onUserScroll()}
      onClick={(e) => {
        const t = (e.target as HTMLElement).closest('button')?.dataset.t;
        if (t) seek(+t);
      }}
    >
      {list}
    </div>
  );
}
