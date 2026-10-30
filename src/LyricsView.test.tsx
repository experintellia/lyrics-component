import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { LyricsView } from './LyricsView';
import type { Position } from './types';

// Paused positions: the clock shows them exactly and runs no frames, so audibleMs = timeMs - offsetMs.
const pos = (timeMs: number): Position => ({ timeMs, playing: false, durationMs: 300_000 });

const LRC = '[00:01.00]One\n[00:02.00]Two\n[00:03.00]Three\n';

describe('LyricsView', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  const onSeek = vi.fn();

  const render = (lrc: string, timeMs: number, offsetMs = 0) =>
    act(() => root.render(<LyricsView lrc={lrc} position={pos(timeMs)} onSeek={onSeek} offsetMs={offsetMs} />));
  const current = () => [...container.querySelectorAll('[aria-current]')].map((e) => e.textContent);
  const view = () => container.querySelector<HTMLElement>('.lyrics-view')!;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    onSeek.mockClear();
    vi.stubGlobal('requestAnimationFrame', () => 0);
    vi.stubGlobal('cancelAnimationFrame', () => {});
    container = document.body.appendChild(document.createElement('div'));
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('highlights the line at audible time, nothing before the first stamp', async () => {
    await render(LRC, 500);
    expect(current()).toEqual([]);
    await render(LRC, 1_500);
    expect(current()).toEqual(['One']);
    await render(LRC, 2_000);
    expect(current()).toEqual(['Two']);
    await render(LRC, 99_000);
    expect(current()).toEqual(['Three']);
  });

  it('lines are buttons with dir="auto"; aria-current is "true"', async () => {
    await render(LRC, 1_500);
    const buttons = container.querySelectorAll('button.lyrics-line');
    expect(buttons).toHaveLength(3);
    buttons.forEach((b) => expect(b.getAttribute('dir')).toBe('auto'));
    expect(buttons[0].getAttribute('aria-current')).toBe('true');
    expect(container.querySelector('[aria-live]')).toBeNull();
  });

  it('marks sung lines (data-past) so they can fade more than upcoming ones', async () => {
    await render(LRC, 2_500);
    const past = () => [...container.querySelectorAll('[data-past]')].map((e) => e.textContent);
    expect(past()).toEqual(['One']);
    await render(LRC, 500);
    expect(past()).toEqual([]);
  });

  it('subtracts offsetMs before highlighting', async () => {
    await render(LRC, 2_100, 200); // audible 1_900
    expect(current()).toEqual(['One']);
  });

  it('duet: equal times highlight all matching lines', async () => {
    await render('[00:01.00]Her\n[00:01.00]Him\n[00:02.00]Both\n', 1_200);
    expect(current()).toEqual(['Her', 'Him']);
  });

  it('instrumental gap (empty stamp) clears the highlight and renders no button', async () => {
    const lrc = '[00:01.00]One\n[00:02.00]\n[00:03.00]Two\n';
    await render(lrc, 2_500);
    expect(current()).toEqual([]);
    expect(container.querySelectorAll('button')).toHaveLength(2);
    await render(lrc, 3_000);
    expect(current()).toEqual(['Two']);
  });

  it('strips word tags for display', async () => {
    await render('[00:01.00]<00:01.00>Hel <00:01.50>lo\n', 1_000);
    expect(current()).toEqual(['Hel lo']);
  });

  // Each current line's karaoke parts: sung phrases, the active phrase and its fill, upcoming text.
  const karaoke = () =>
    [...container.querySelectorAll('[aria-current]')].map((e) => {
      const active = e.querySelector<HTMLElement>('.lyrics-active');
      return {
        sung: [...e.querySelectorAll('.lyrics-sung')].map((s) => s.textContent),
        active: active?.textContent ?? null,
        fill: active?.style.getPropertyValue('--lyrics-fill') ?? null,
        upcoming: e.querySelector('.lyrics-upcoming')?.textContent ?? null,
      };
    });
  const k = (sung: string[], active: string | null, fill: string | null, upcoming: string | null) => ({ sung, active, fill, upcoming });

  it('word mode: the active word fills over its duration; sung lit, upcoming muted; syllables split', async () => {
    const lrc = '[00:01.00]<00:01.00>Hel<00:01.50>lo <00:02.00>world\n[00:03.00]Next\n';
    await render(lrc, 1_000);
    expect(karaoke()).toEqual([k([], 'Hel', '0%', 'lo world')]);
    await render(lrc, 1_250);
    expect(karaoke()).toEqual([k([], 'Hel', '50%', 'lo world')]);
    await render(lrc, 1_500);
    expect(karaoke()).toEqual([k(['Hel'], 'lo', '0%', 'world')]); // the space stays outside the word box
    await render(lrc, 1_900);
    expect(karaoke()).toEqual([k(['Hel'], 'lo', '80%', 'world')]);
    await render(lrc, 2_500); // last word runs to the next line's stamp
    expect(karaoke()).toEqual([k(['Hel', 'lo'], 'world', '50%', '')]);
    expect(container.querySelector('[aria-current]')!.textContent).toBe('Hello world'); // accessible name intact
    await render(lrc, 3_000);
    expect(karaoke()).toEqual([k([], null, null, null)]); // line without word tags: whole line, as before
    expect(container.querySelector('[aria-current]')!.innerHTML).toBe('Next');
  });

  it('a word before its stamp is upcoming; the active fill is clamped', async () => {
    const lrc = '[00:01.00]A <00:01.50>b <00:02.00>c\n';
    await render(lrc, 1_000); // leading untimed word: a phrase from the line stamp
    expect(karaoke()).toEqual([k([], 'A', '0%', 'b c')]);
    await render('[00:01.00]<00:01.20>A <00:01.50>b\n', 1_100); // first tag after the line stamp
    expect(karaoke()).toEqual([k([], null, null, 'A b')]);
  });

  it('phrase timing: untimed words fill together with the timed word before them', async () => {
    const lrc = '[00:01.00]Oh <00:01.50>take me <00:02.50>home tonight\n';
    await render(lrc, 1_250); // leading untimed words start with the line
    expect(karaoke()).toEqual([k([], 'Oh', '50%', 'take me home tonight')]);
    await render(lrc, 2_000);
    expect(karaoke()).toEqual([k(['Oh'], 'take me', '50%', 'home tonight')]);
    await render(lrc, 2_500 + (300_000 - 2_500) / 4); // last phrase of the song runs to durationMs
    expect(karaoke()).toEqual([k(['Oh', 'take me'], 'home tonight', '25%', '')]);
  });

  it('trailing end tag: the last word fills up to it, then the whole line is lit', async () => {
    const lrc = '[00:01.00]<00:01.00>Bye <00:01.50>now<00:02.00>\n[00:05.00]Later\n';
    await render(lrc, 1_750);
    expect(karaoke()).toEqual([k(['Bye'], 'now', '50%', '')]);
    await render(lrc, 2_500);
    expect(karaoke()).toMatchObject([{ sung: ['Bye', 'now'], active: '', upcoming: '' }]);
  });

  it('duet: each current line fills its own active word', async () => {
    const lrc = '[00:01.00]<00:01.00>Her <00:02.00>part\n[00:01.00]<00:01.00>His <00:01.40>line\n[00:03.00]Both\n';
    await render(lrc, 1_500);
    expect(karaoke()).toEqual([k([], 'Her', '50%', 'part'), k(['His'], 'line', '6.25%', '')]);
  });

  it('non-current lines are left as plain text', async () => {
    const lrc = '[00:01.00]<00:01.00>A <00:01.50>b\n[00:02.00]<00:02.00>C <00:02.50>d\n';
    await render(lrc, 2_200);
    expect(karaoke()).toEqual([k([], 'C', '40%', 'd')]);
    expect(container.querySelectorAll('.lyrics-upcoming, .lyrics-active')).toHaveLength(2);
    expect(container.querySelector('button:not([aria-current])')!.outerHTML).not.toMatch(/span|style/);
  });

  it('within a word, only the fill variable changes (no re-render of the list)', async () => {
    const lrc = '[00:01.00]<00:01.00>One <00:02.00>two\n[00:03.00]Next\n';
    await render(lrc, 1_100);
    const active = container.querySelector('.lyrics-active')!;
    const seen = new MutationObserver(() => {});
    seen.observe(view(), { subtree: true, childList: true, characterData: true });
    await render(lrc, 1_200);
    await render(lrc, 1_700);
    expect(seen.takeRecords()).toEqual([]); // no DOM rewrite (jsdom doesn't report custom-property style changes)
    seen.disconnect();
    expect(container.querySelector('.lyrics-active')).toBe(active);
    expect(karaoke()).toEqual([k([], 'One', '70%', 'two')]);
  });

  it('CSS: text-clipped fill, RTL runs right to left, scale and transitions only with motion allowed', async () => {
    // ponytail: no @types/node, so a non-literal specifier keeps tsc from resolving node:fs (vitest's ?raw gives '').
    const { readFileSync } = await import('node:' + 'fs');
    const css: string = readFileSync('src/view.css', 'utf8') // vitest runs from the repo root;
    const flat = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ');
    expect(flat).toMatch(/\.lyrics-active \{[^}]*linear-gradient\(to right, currentColor var\(--lyrics-fill, 0%\)[^}]*-webkit-background-clip: text; background-clip: text;/);
    expect(flat).toMatch(/\.lyrics-active:dir\(rtl\) \{ background-image: linear-gradient\(to left, currentColor var\(--lyrics-fill/);
    expect(flat).toMatch(/\.lyrics-upcoming \{ color: var\(--lyrics-muted/);
    // Everything that moves sits in one no-preference block, so reduced motion gets none of it.
    const at = flat.indexOf('@media (prefers-reduced-motion: no-preference) {');
    let depth = 0;
    let stop = at;
    for (const c of flat.slice(at)) {
      depth += c === '{' ? 1 : c === '}' ? -1 : 0;
      stop++;
      if (c === '}' && !depth) break;
    }
    const motion = flat.slice(at, stop);
    expect(motion).toMatch(/button\.lyrics-line\[aria-current\] \{ transform: scale\(1\.\d+\); \}/); // line and word mode
    expect(motion).toMatch(/\.lyrics-active \{ transform: scale\(1\.0\d\);/);
    expect(motion).toMatch(/button\.lyrics-line:dir\(rtl\) \{ transform-origin: right center; \}/);
    expect((flat.slice(0, at) + flat.slice(stop)).replace(/@keyframes[^}]*\}[^}]*\}/, '')).not.toMatch(/transform|transition|animation/);
  });

  it('clicking a line seeks to lineTime + offsetMs and highlights it immediately', async () => {
    await render(LRC, 1_200, 150);
    await act(() => container.querySelectorAll('button')[2].click());
    expect(onSeek).toHaveBeenCalledWith(3_150);
    expect(current()).toEqual(['Three']);
  });

  it('plain text: lines as text, no buttons, no highlight, blank lines kept', async () => {
    await render('First line\n\nSecond [Chorus]\n', 5_000);
    expect(container.querySelectorAll('button')).toHaveLength(0);
    expect([...container.querySelectorAll('.lyrics-line')].map((e) => e.textContent)).toEqual([
      'First line',
      '',
      'Second [Chorus]',
    ]);
    expect(current()).toEqual([]);
  });

  it('empty lrc renders nothing', async () => {
    await render('', 0);
    expect(container.innerHTML).toBe('');
    await render('  \n\n', 0);
    expect(container.innerHTML).toBe('');
  });

  it('auto-scrolls on line change, pauses on manual scroll, resumes after ~3 s', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await render(LRC, 1_000);
    const scrollTop = vi.fn();
    Object.defineProperty(view(), 'scrollTop', { set: scrollTop, configurable: true });

    await render(LRC, 2_000);
    expect(scrollTop).toHaveBeenCalledTimes(1);

    await act(() => view().dispatchEvent(new WheelEvent('wheel', { bubbles: true })));
    await render(LRC, 3_000);
    expect(scrollTop).toHaveBeenCalledTimes(1); // paused

    await act(() => vi.advanceTimersByTime(3_000));
    expect(scrollTop).toHaveBeenCalledTimes(1); // paused: stays where the user scrolled
  });

  it('while playing, resumes auto-scroll ~3 s after a manual scroll; pausing or pressing play overrides it', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const at = (playing: boolean) =>
      act(() => root.render(<LyricsView lrc={LRC} position={{ ...pos(1_000), playing }} onSeek={onSeek} />));
    const wheel = () => act(() => view().dispatchEvent(new WheelEvent('wheel', { bubbles: true })));
    await at(true);
    const scrollTop = vi.fn();
    Object.defineProperty(view(), 'scrollTop', { set: scrollTop, configurable: true });

    await wheel();
    await act(() => vi.advanceTimersByTime(3_000));
    expect(scrollTop).toHaveBeenCalledTimes(1); // playing: resumed after the timeout

    await wheel();
    await at(false); // paused before the timer fires
    await act(() => vi.advanceTimersByTime(3_000));
    expect(scrollTop).toHaveBeenCalledTimes(1); // paused: stays put

    await wheel();
    await at(true); // play within 3 s: back right away
    expect(scrollTop).toHaveBeenCalledTimes(2);
    await act(() => vi.advanceTimersByTime(3_000));
    expect(scrollTop).toHaveBeenCalledTimes(2); // the pending timer was cancelled
  });

  it.each([
    ['touchmove', () => new TouchEvent('touchmove', { bubbles: true })],
    ['scrollbar pointerdown', () => new MouseEvent('pointerdown', { bubbles: true })],
    ['PageDown', () => new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true })],
  ])('%s also pauses auto-scroll', async (_, ev) => {
    vi.useFakeTimers();
    await render(LRC, 1_000);
    const scrollTop = vi.fn();
    Object.defineProperty(view(), 'scrollTop', { set: scrollTop, configurable: true });
    await act(() => view().dispatchEvent(ev()));
    await render(LRC, 2_000);
    expect(scrollTop).not.toHaveBeenCalled();
  });

  it('does not auto-scroll in a gap or for an unchanged line', async () => {
    await render('[00:01.00]One\n[00:02.00]\n', 1_000);
    const scrollTop = vi.fn();
    Object.defineProperty(view(), 'scrollTop', { set: scrollTop, configurable: true });
    await render('[00:01.00]One\n[00:02.00]\n', 1_500);
    await render('[00:01.00]One\n[00:02.00]\n', 2_500);
    expect(scrollTop).not.toHaveBeenCalled();
  });
});
