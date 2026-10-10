import { useEffect, useMemo, useRef } from 'react';
import { usePlaybackTime } from './clock';
import { displayText, parseLrc } from './lrc';
import type { LyricsProps } from './types';

const RESUME_MS = 3000; // auto-scroll resumes this long after the user's last manual scroll

export function LyricsView({ lrc, position, onSeek, offsetMs = 0 }: LyricsProps) {
  const lines = useMemo(() => parseLrc(lrc).lines, [lrc]);
  const { audibleMs, seek } = usePlaybackTime(position, offsetMs, onSeek);
  const box = useRef<HTMLDivElement>(null);
  const userTimer = useRef(0); // non-zero while the user is scrolling manually

  // Latest stamp at or before audible time (parseLrc sorts stamped lines). Equal times all match;
  // if that stamp is an instrumental gap (empty text), nothing visible matches, so nothing is highlighted.
  // ponytail: linear scan per frame; fine for song-length files.
  let cur: number | null = null;
  for (const l of lines) if (l.timeMs !== null && l.timeMs <= audibleMs) cur = l.timeMs;

  // The clock re-renders us every frame; the line list only changes when the current stamp does.
  const list = useMemo(
    () =>
      lines.map((l, i) => {
        const text = displayText(l.text);
        if (l.timeMs === null) return <div key={i} className="lyrics-line" dir="auto">{text}</div>;
        if (!text) return null; // instrumental gap: affects `cur`, nothing to show or tap
        return (
          <button key={i} type="button" className="lyrics-line" dir="auto" data-t={l.timeMs} aria-current={l.timeMs === cur || undefined}>
            {text}
          </button>
        );
      }),
    [lines, cur],
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
