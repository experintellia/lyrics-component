import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { parseLrc } from './lrc';
import { bandColor, lineSpan, sections, viewWindow, Waveform, wordMarks } from './Waveform';

const lines = (lrc: string) => parseLrc(lrc).lines;

describe('sections', () => {
  it('splits at blank lines and label lines; runs to the next section’s first stamp or the end', () => {
    const l = lines('[00:01.00]A1\n[00:02.00]A2\n\n[00:05.00]B1\n[Chorus]\n[00:08.00]C1\n[00:09.00]C2');
    expect(sections(l, 20_000)).toEqual([
      { startMs: 1000, endMs: 5000, label: '', from: 0, to: 2 },
      { startMs: 5000, endMs: 8000, label: '', from: 3, to: 4 },
      { startMs: 8000, endMs: 20_000, label: 'Chorus', from: 4, to: 7 },
    ]);
    expect(sections(l).at(-1)!.endMs).toBe(Infinity); // no duration known
  });

  it('starts at the first stamp, ends at a stamped gap, drops sections without stamps', () => {
    const l = lines('[Intro]\nx\n[00:03.00]A\n[00:04.00]\n[Verse]\nnothing stamped\n\n[00:10.00]C');
    expect(sections(l, 12_000)).toEqual([
      { startMs: 3000, endMs: 4000, label: 'Intro', from: 0, to: 3 }, // gap stamp ends it
      { startMs: 10_000, endMs: 12_000, label: '', from: 7, to: 8 },
    ]);
    expect(sections(lines('plain\ntext'))).toEqual([]);
  });
});

describe('bandColor', () => {
  it('uses the host’s --lyrics-section-N (cycling past 4), else the default hue', () => {
    expect(bandColor(4)).toBe('var(--lyrics-section-1, hsl(30 75% 50% / 0.7))');
  });
});

describe('lineSpan', () => {
  it('runs from the line’s stamp to the next stamp, skipping unstamped lines', () => {
    const l = lines('[00:01.00]A\nB\n[00:03.00]C');
    expect(lineSpan(l, 0, 9000)).toEqual([1000, 3000]);
    expect(lineSpan(l, 1, 9000)).toBeNull();
    expect(lineSpan(l, 2, 9000)).toEqual([3000, 9000]);
    expect(lineSpan(l, 7)).toBeNull();
  });
});

describe('viewWindow', () => {
  it('centres on the playhead, or fits a line span plus 0.5 s each side (widen zooms out)', () => {
    expect(viewWindow(20_000, 10_000)).toEqual([15_000, 10_000]);
    expect(viewWindow(2_000, 10_000)).toEqual([0, 10_000]);
    expect(viewWindow(99_000, 10_000, [10_000, 13_000])).toEqual([9_500, 4_000]); // playhead doesn't move it
    expect(viewWindow(0, 10_000, [10_000, 13_000], 2)).toEqual([7_500, 8_000]);
    expect(viewWindow(0, 10_000, [10_000, Infinity])).toEqual([9_500, 16_000]); // unknown end: capped at 15 s
  });
});

describe('wordMarks', () => {
  it('one mark per timed word, up to the next stamp, end tag or line end; flags the next word', () => {
    expect(wordMarks('<00:01.00>a b <00:02.00>c <00:02.50>', 4_000, 2)).toEqual([
      { startMs: 1000, endMs: 2000, text: 'a', rest: 'b', next: false }, // untimed "b" shares the span of "a"
      { startMs: 2000, endMs: 2500, text: 'c', rest: '', next: true },
    ]);
    expect(wordMarks('<00:01.00>a <00:03.00>b', 5_000, 0).map((m) => [m.endMs, m.next])).toEqual([[3000, true], [5000, false]]);
    expect(wordMarks('plain words', 5_000, 0)).toEqual([]);
  });
});

describe('Waveform pointer seeking', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  const onSeek = vi.fn();
  const canvas = () => container.querySelector('canvas')!;
  // 10 s visible over 1000 px: 1 px = 10 ms. At timeMs 20 s the view spans 15–25 s.
  const render = (timeMs: number) =>
    act(() => root.render(<Waveform timeMs={timeMs} lines={[]} onSeek={onSeek} />));
  const fire = (type: string, clientX: number) =>
    act(() => {
      canvas().dispatchEvent(new MouseEvent(type, { bubbles: true, clientX, button: 0 }));
    });

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    onSeek.mockClear();
    container = document.body.appendChild(document.createElement('div'));
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const setup = async () => {
    await render(20_000);
    canvas().getBoundingClientRect = () => ({ left: 0, width: 1000 }) as DOMRect;
  };

  it('a tap seeks to the tapped spot', async () => {
    await setup();
    await fire('pointerdown', 750);
    await fire('pointermove', 752); // jitter under the drag threshold
    await fire('pointerup', 752);
    expect(onSeek).toHaveBeenCalledExactlyOnceWith(22_520);
  });

  it('a drag moves the tape (left = later) and seeks once, on release', async () => {
    await setup();
    await fire('pointerdown', 500);
    await fire('pointermove', 400);
    await fire('pointermove', 300);
    expect(onSeek).not.toHaveBeenCalled();
    await render(20_100); // playback moving underneath doesn't disturb the drag
    await fire('pointerup', 200);
    expect(onSeek).toHaveBeenCalledExactlyOnceWith(23_000);
  });

  it('never seeks before 0; a cancelled drag (vertical scroll) seeks nothing', async () => {
    await setup();
    await fire('pointerdown', 500);
    await fire('pointerup', 5000);
    expect(onSeek).toHaveBeenCalledExactlyOnceWith(0);
    onSeek.mockClear();
    await fire('pointerdown', 500);
    await fire('pointermove', 300);
    await fire('pointercancel', 300);
    await fire('pointerup', 300);
    expect(onSeek).not.toHaveBeenCalled();
  });
});
