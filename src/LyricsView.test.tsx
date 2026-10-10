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
    expect(scrollTop).toHaveBeenCalledTimes(2); // resumed: back to the current line
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
