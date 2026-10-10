import { Fragment, memo, useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import { usePlaybackTime } from './clock';
import { displayText, lineWords, parseLrc, type LrcWord } from './lrc';
import type { LyricsProps } from './types';

const RESUME_MS = 3000; // auto-scroll resumes this long after the user's last manual scroll

// words only if word-tagged; endMs = the next later stamp, where a word line's last word stops filling
interface ViewLine { timeMs: number | null; text: string; words: LrcWord[] | null; endMs: number | null }

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
// In a current word line, sung phrases are spans (so the last one can ease back from the active scale), the
// active phrase carries its start/end for the per-frame fill (see LyricsView), and the rest is one muted span.
const Line = memo(function Line({ line, current, past, sung }: { line: ViewLine; current: boolean; past: boolean; sung: number }) {
  const { timeMs, text, words, endMs } = line;
  if (timeMs === null) return <div className="lyrics-line" dir="auto">{text}</div>;
  if (!text) return null; // instrumental gap: affects `cur`, nothing to show or tap
  let body: ReactNode = text;
  if (current && words) {
    // A phrase is a timed word plus the untimed words after it; leading untimed words start with the line.
    const phrases: { t: number; text: string }[] = [];
    for (const w of words.slice(0, sung)) {
      if (w.timeMs !== null || !phrases.length) phrases.push({ t: w.timeMs ?? timeMs, text: '' });
      phrases[phrases.length - 1].text += w.text;
    }
    const end = words[sung]?.timeMs ?? endMs; // words[sung] is timed whenever it exists
    body = (
      <>
        {phrases.map((p, i) => {
          const active = i === phrases.length - 1;
          const t = p.text.trimEnd(); // the space stays outside the inline-block
          return (
            <Fragment key={i}>
              <span
                className={active ? 'lyrics-active' : 'lyrics-sung'}
                data-s={active ? p.t : undefined}
                data-e={active ? (end ?? undefined) : undefined}
              >
                {t}
              </span>
              {p.text.slice(t.length)}
            </Fragment>
          );
        })}
        <span className="lyrics-upcoming">{words.slice(sung).map((w) => w.text).join('')}</span>
      </>
    );
  }
  return (
    <button type="button" className="lyrics-line" dir="auto" data-t={timeMs} data-past={past || undefined} aria-current={current || undefined}>
      {body}
    </button>
  );
});

export function LyricsView({ lrc, position, onSeek, offsetMs = 0 }: LyricsProps) {
  const lines = useMemo(() => {
    const parsed = parseLrc(lrc).lines;
    return parsed.map((l): ViewLine => {
      const t = l.timeMs;
      const words = t === null ? null : lineWords(l.text);
      // ponytail: O(n²) find of the next later stamp (stamped lines are sorted); fine for song-length files.
      const endMs = t === null ? null : (parsed.find((n) => n.timeMs !== null && n.timeMs > t)?.timeMs ?? null);
      return { timeMs: t, text: displayText(l.text), words: words?.some((w) => w.timeMs !== null) ? words : null, endMs };
    });
  }, [lrc]);
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
        const past = l.timeMs !== null && cur !== null && l.timeMs < cur;
        return <Line key={i} line={l} current={current} past={past} sung={current && l.words ? sungCount(l.words, audibleMs) : 0} />;
      }),
    // audibleMs is read only through sungKey, which changes whenever its effect would
    [lines, cur, sungKey],
  );

  // Karaoke fill, every frame: written straight to the active phrase(s), so the list doesn't re-render.
  // A last word with no later stamp or end tag runs to the end of the song.
  useLayoutEffect(() => {
    box.current?.querySelectorAll<HTMLElement>('.lyrics-active').forEach((el) => {
      const s = +el.dataset.s!;
      const e = el.dataset.e ? +el.dataset.e : position.durationMs;
      const p = e > s ? Math.min(1, Math.max(0, (audibleMs - s) / (e - s))) : 1;
      el.style.setProperty('--lyrics-fill', `${p * 100}%`);
    });
  });

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
