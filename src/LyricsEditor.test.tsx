import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LyricsEditor } from './LyricsEditor';
import type { LyricsProps } from './types';

let container: HTMLDivElement;
let root: Root;
const onChange = vi.fn();
const onSeek = vi.fn();
let props: LyricsProps;

const pos = (timeMs: number, durationMs = 300_000) => ({ timeMs, playing: false, durationMs });
const render = (p: Partial<LyricsProps> = {}) => {
  props = { ...props, ...p };
  act(() => root.render(<LyricsEditor {...props} />));
};
const $$ = (sel: string) => [...container.querySelectorAll<HTMLElement>(sel)];
const rows = () => $$('.lyrics-editor-row');
const times = () => $$('.lyrics-editor-time').map((b) => b.textContent);
const selected = () => rows().findIndex((r) => r.getAttribute('aria-current') === 'true');
const button = (label: string) => $$('button').find((b) => b.textContent === label)!;
const stampButton = () => $$('.lyrics-editor-stamp')[0] as HTMLButtonElement;
const tab = (name: string) => $$('[role=tab]').find((b) => b.textContent!.includes(name))!;
const activeTab = () => $$('[role=tab][aria-selected=true]')[0]?.textContent;
const textarea = () => container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Lyrics text"]')!;
const chips = () => $$('.lyrics-editor-chip').map((c) => c.firstChild!.textContent);
const click = (el: HTMLElement) => act(() => el.click());
const key = (k: string, opts: KeyboardEventInit = {}, target: EventTarget = document.body) =>
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...opts }));
  });
const type = (value: string) =>
  act(() => {
    const el = textarea();
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
const blur = () => act(() => textarea().dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
const lastLrc = () => onChange.mock.lastCall?.[0];

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null); // jsdom has no canvas
  vi.stubGlobal('requestAnimationFrame', () => 0);
  vi.stubGlobal('cancelAnimationFrame', () => {});
  onChange.mockReset();
  onSeek.mockReset();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  props = { lrc: 'a\nb\nc', onChange, onSeek, position: pos(5_000) };
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('LyricsEditor steps', () => {
  it('opens on Lyrics when empty, otherwise on Sync lines; plain text gets the "no timing yet" banner', () => {
    render({ lrc: '' });
    expect(activeTab()).toContain('Lyrics');
    expect(textarea()).not.toBeNull();
    act(() => root.unmount());
    root = createRoot(container);
    render({ lrc: 'a\nb' });
    expect(activeTab()).toContain('Sync lines');
    expect(container.querySelector('.lyrics-editor-banner')!.textContent).toContain('no timing yet');
    expect(rows().map((r) => r.querySelector('button')!.textContent)).toEqual(['1—a', '2—b']);
  });

  it('tabs have stable accessible names', () => {
    render();
    expect($$('[role=tab]').map((t) => [...t.childNodes].filter((n) => !(n as Element).ariaHidden).map((n) => n.textContent).join('').trim()))
      .toEqual(['Lyrics', 'Sync lines', 'Sync words']);
  });

  it('text becomes lines on blur and after 500 ms idle; unchanged lines keep their stamps', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    render({ lrc: '[00:01.00]a\n[00:02.00]b' });
    click(tab('Lyrics'));
    expect(textarea().value).toBe('a\nb');
    type('new\na\nb');
    act(() => vi.advanceTimersByTime(499));
    expect(onChange).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(lastLrc()).toBe('new\n[00:01.00]a\n[00:02.00]b\n');
    type('new\na\nb\nc');
    blur();
    expect(lastLrc()).toBe('new\n[00:01.00]a\n[00:02.00]b\nc\n');
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('pasting LRC keeps its timing at the caret (one undo step, notice); plain text pastes natively', () => {
    const paste = (text: string, start: number, end = start) => {
      const el = textarea();
      el.focus();
      el.setSelectionRange(start, end);
      const e = Object.assign(new Event('paste', { bubbles: true, cancelable: true }), {
        clipboardData: { getData: () => text },
      });
      act(() => void el.dispatchEvent(e));
      return e.defaultPrevented;
    };
    const notice = () => container.querySelector('[data-ok][role=status] b')?.textContent;
    render({ lrc: '[00:01.00]a\n[00:20.00]b' });
    click(tab('Lyrics'));
    expect(paste('plain\ntext', 1)).toBe(false);
    expect(notice()).toBeUndefined();
    expect(paste('[ti:T]\n[00:05.00]<00:05.00>x <00:05.50>y\n[00:06.00]z', 1)).toBe(true);
    expect(lastLrc()).toBe('[ti:T]\n[00:01.00]a\n[00:05.00]<00:05.00>x <00:05.50>y\n[00:06.00]z\n[00:20.00]b\n');
    expect(textarea().value).toBe('a\nx y\nz\nb');
    expect(textarea().selectionStart).toBe(7); // caret right after the pasted lines
    expect(notice()).toBe('Kept the timing of 2 pasted lines ✓');
    expect(button('Next: check the timing →')).toBeTruthy(); // the lyrics are timed now
    click(button('Undo'));
    expect(lastLrc()).toBe('[00:01.00]a\n[00:20.00]b\n');
    expect(notice()).toBeUndefined();
  });

  it('"Next" commits the text and goes to Sync lines at the first unstamped line', () => {
    render({ lrc: '' });
    expect(container.textContent).toContain('Type or paste at least one line to continue.'); // why Next is disabled
    render({ position: pos(0, 0) });
    expect(container.textContent).toContain('Load the song and add at least one line to continue.'); // no audio either
    type('one\ntwo');
    click(button('Next: sync to the music →'));
    expect(lastLrc()).toBe('one\ntwo\n');
    expect(activeTab()).toContain('Sync lines');
    expect(selected()).toBe(0);
  });

  it('flushes typed text on unmount', () => {
    render({ lrc: '' });
    type('typed');
    act(() => root.unmount());
    expect(lastLrc()).toBe('typed\n');
    root = createRoot(container);
  });
});

describe('Sync lines', () => {
  it('stamps the selected line at the playhead and advances; the label names the target', () => {
    render();
    expect(selected()).toBe(0);
    expect(stampButton().textContent).toBe('Stamp line 1');
    click(stampButton());
    expect(lastLrc()).toBe('[00:05.00]a\nb\nc\n');
    expect(selected()).toBe(1);
    expect(stampButton().textContent).toBe('Stamp line 2');
    expect(container.querySelector('.lyrics-editor-progress')!.textContent).toBe('00:05.00 · paused · 1 of 3 lines synced');
    render({ position: { ...pos(5_000), playing: true } });
    expect(container.querySelector('.lyrics-editor-progress')!.textContent).toBe('00:05.00 · 1 of 3 lines synced');
    render({ position: pos(7_250) });
    key('s');
    key('Enter');
    expect(lastLrc()).toBe('[00:05.00]a\n[00:07.25]b\n[00:07.25]c\n');
    expect(times()).toEqual(['00:05.00', '00:07.25', '00:07.25']);
    // The stamp that finishes the last line swaps Stamp for a done card (no "Re-stamp" to hit by accident).
    expect(stampButton()).toBeUndefined();
    expect(selected()).toBe(-1);
    expect(container.querySelector('.lyrics-editor-done')!.textContent).toContain('All 3 lines synced ✓');
    click(button('⏮ Back to the start'));
    expect(onSeek).toHaveBeenLastCalledWith(0);
    click(rows()[2].querySelector('button')!); // tapping a line brings Re-stamp back
    expect(stampButton().textContent).toBe('Re-stamp line 3');
    click(button('Undo')); // undo the last stamp: done card gone, line 3 back to "—"
    expect(times()).toEqual(['00:05.00', '00:07.25', '—']);
    expect(container.querySelector('.lyrics-editor-done')).toBeNull();
  });

  it('done card offers word timing', () => {
    render({ lrc: '[00:01.00]a\nb' });
    click(stampButton());
    click(button('Next: sync words (optional) →'));
    expect(activeTab()).toContain('Sync words');
  });

  it('tapping a timed line rewinds to just before it (not before the previous line); unsynced lines don’t seek', () => {
    render({ lrc: '[00:01.00]a\n[00:10.00]b\nc' });
    click(rows()[1].querySelector('button')!);
    expect(onSeek).toHaveBeenLastCalledWith(7_000); // 3 s pre-roll
    click(rows()[0].querySelector('button')!);
    expect(onSeek).toHaveBeenLastCalledWith(0);
    render({ lrc: '[00:01.00]a\n[00:02.00]b\nc' });
    click(rows()[1].querySelector('button')!);
    expect(onSeek).toHaveBeenLastCalledWith(1_000); // not before line 1
    onSeek.mockClear();
    click(rows()[2].querySelector('button')!);
    expect(onSeek).not.toHaveBeenCalled();
  });

  it('warns (but allows) a stamp that would put the line out of order; links back to the first unsynced line', () => {
    render({ lrc: '[00:01.00]a\n[00:02.00]b\n[00:03.00]c\nd', position: pos(2_500) });
    for (let k = 0; k < 3; k++) key('ArrowUp'); // keys select without rewinding
    expect(selected()).toBe(0);
    expect(stampButton().hasAttribute('data-warn')).toBe(true);
    expect(container.querySelector('.lyrics-editor-progress')!.textContent).toContain('the playhead is after line 2');
    render({ position: pos(500) });
    expect(stampButton().hasAttribute('data-warn')).toBe(false);
    click(button('Back to line 4 →'));
    expect(selected()).toBe(3);
    render({ position: pos(2_500) });
    expect(container.querySelector('.lyrics-editor-progress')!.textContent).toContain('the playhead is before line 3');
    expect(button('Back to line 4 →')).toBeUndefined(); // already there
  });

  it('paused: Stamp is marked so it can step back visually', () => {
    render();
    expect(stampButton().hasAttribute('data-paused')).toBe(true);
    render({ position: { ...pos(5_000), playing: true } });
    expect(stampButton().hasAttribute('data-paused')).toBe(false);
  });

  it('stamps at audible time (position − offsetMs) and plays a line at its time + offsetMs', () => {
    render({ offsetMs: 200 });
    click(stampButton());
    expect(lastLrc()).toBe('[00:04.80]a\nb\nc\n');
    click(rows()[0].querySelector('button')!);
    expect(onSeek).toHaveBeenLastCalledWith(2_000); // pre-roll: 4.8 − 3 s, + offset
    click(button('▶ Play from here'));
    expect(onSeek).toHaveBeenLastCalledWith(5_000);
  });

  it('↑/↓ select lines; tapping a line selects it and shows its tools', () => {
    render();
    key('ArrowDown');
    key('ArrowDown');
    key('ArrowDown');
    expect(selected()).toBe(2);
    key('ArrowUp');
    expect(selected()).toBe(1);
    expect(rows()[1].textContent).toContain('Not synced yet');
    click(rows()[0].querySelector('button')!);
    expect(selected()).toBe(0);
  });

  it('nudges by ±0.1 s (shifting word tags) and clears', () => {
    render({ lrc: '[00:01.00]<00:01.50>a' });
    click(button('+0.1 s'));
    expect(lastLrc()).toBe('[00:01.10]<00:01.60>a\n');
    click(button('−0.1 s'));
    click(button('−0.1 s'));
    expect(lastLrc()).toBe('[00:00.90]<00:01.40>a\n');
    click(button('Clear time'));
    expect(lastLrc()).toBe('<00:01.40>a\n');
    expect(button('+0.1 s')).toBeUndefined(); // tools only for a stamped line
  });

  it('undo/redo: one step per stamp/nudge/clear, via buttons and shortcuts', () => {
    render();
    click(stampButton()); // a @ 5.00
    click(rows()[0].querySelector('button')!);
    click(button('+0.1 s')); // a @ 5.10
    click(button('Clear time'));
    expect(lastLrc()).toBe('a\nb\nc\n');
    click(button('Undo'));
    expect(lastLrc()).toBe('[00:05.10]a\nb\nc\n');
    key('z', { ctrlKey: true });
    expect(lastLrc()).toBe('[00:05.00]a\nb\nc\n');
    key('z', { metaKey: true });
    expect(lastLrc()).toBe('a\nb\nc\n');
    expect(button('Undo').hasAttribute('disabled')).toBe(true);
    key('Z', { ctrlKey: true, shiftKey: true });
    expect(lastLrc()).toBe('[00:05.00]a\nb\nc\n');
    key('y', { ctrlKey: true });
    click(button('Redo'));
    expect(lastLrc()).toBe('a\nb\nc\n');
  });

  it('shortcuts: off in the textarea; S works on a checkbox, Enter/arrows keep their meaning on controls', () => {
    render();
    const box = container.appendChild(document.createElement('input'));
    box.type = 'checkbox';
    key('Enter', {}, box);
    key('ArrowDown', {}, box);
    expect(onChange).not.toHaveBeenCalled();
    expect(selected()).toBe(0);
    key('s', {}, box);
    expect(lastLrc()).toBe('[00:05.00]a\nb\nc\n');
    click(tab('Lyrics'));
    key('s', {}, textarea());
    key('z', { ctrlKey: true }, textarea());
    key('s');
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('flags stamps beyond durationMs, but not while durationMs is 0', () => {
    render({ lrc: '[00:10.00]a\n[05:00.00]b', position: pos(0, 60_000) });
    expect(rows().map((r) => r.hasAttribute('data-late'))).toEqual([false, true]);
    render({ position: pos(0, 0) });
    expect(rows().map((r) => r.hasAttribute('data-late'))).toEqual([false, false]);
  });

  it('stamp button prevents default on pointerdown (keeps focus / no iOS keyboard)', () => {
    render();
    const ev = new Event('pointerdown', { bubbles: true, cancelable: true });
    act(() => {
      stampButton().dispatchEvent(ev);
    });
    expect(ev.defaultPrevented).toBe(true);
  });
});

describe('Sync words', () => {
  it('stamps words in order (word 0 sets the line time), then moves to the next line', () => {
    render({ lrc: '[00:01.00]hello world\n[00:03.00]bye' });
    click(tab('Sync words'));
    expect(chips()).toEqual(['hello', 'world']);
    expect(stampButton().textContent).toBe('Stamp “hello”');
    click(stampButton()); // 5.00
    expect(lastLrc()).toBe('[00:05.00]<00:05.00>hello world\n[00:03.00]bye\n');
    render({ position: pos(5_500) });
    key('s');
    expect(lastLrc()).toBe('[00:05.00]<00:05.00>hello <00:05.50>world\n[00:03.00]bye\n');
    expect(selected()).toBe(1);
    expect(stampButton().textContent).toBe('Stamp “bye”');
    expect(container.textContent).toContain('1 of 2 lines have word timing');
    click(rows()[0].querySelector('button')!);
    click(button('Next line →'));
    expect(selected()).toBe(1);
  });

  it('partly timed lines show "n/m words" and do not count as done; the dock names line and word', () => {
    render({ lrc: '[00:01.00]<00:01.00>a b c\n[00:03.00]d' });
    click(tab('Sync words'));
    expect($$('.lyrics-editor-badge').map((b) => b.textContent)).toEqual(['1/3 words', '0/1 words']); // every line
    expect(container.textContent).toContain('0 of 2 lines have word timing');
    expect(container.querySelector('.lyrics-editor-progress')!.textContent).toBe('00:05.00 · paused · Line 1: word 2 of 3');
    click(stampButton());
    click(stampButton());
    expect(container.textContent).toContain('1 of 2 lines have word timing');
    expect(rows()[0].querySelector('.lyrics-editor-badge')!.textContent).toBe('words ✓');
  });

  it('tapping a chip re-times from that word; clear word timing; undo', () => {
    render({ lrc: '[00:01.00]<00:01.00>a <00:02.00>b' });
    click(tab('Sync words'));
    click($$('.lyrics-editor-chip')[1]);
    expect(stampButton().textContent).toBe('Stamp “b”');
    click(stampButton());
    expect(lastLrc()).toBe('[00:01.00]<00:01.00>a <00:05.00>b\n');
    click(button('Clear word timing'));
    expect(lastLrc()).toBe('[00:01.00]a b\n');
    click(button('Undo'));
    expect(lastLrc()).toBe('[00:01.00]<00:01.00>a <00:05.00>b\n');
  });
});

describe('LyricsEditor host contract', () => {
  it('re-parses the lrc prop only when it differs from the last emitted value', () => {
    render();
    click(stampButton());
    const emitted = lastLrc();
    render({ lrc: emitted }); // host echoes our own value back
    expect(button('Undo').hasAttribute('disabled')).toBe(false);
    render({ lrc: '[00:09.00]new' }); // host loads something else
    expect(rows()).toHaveLength(1);
    expect(times()).toEqual(['00:09.00']);
  });

  it('without onChange it is read-only: renders the display, no editor', () => {
    render({ lrc: '[00:01.00]a', onChange: undefined });
    expect(container.querySelector('.lyrics-editor')).toBeNull();
    expect($$('.lyrics-view button.lyrics-line').map((b) => b.textContent)).toEqual(['a']);
  });

  it('waveform tap seeks to the tapped time (+ offsetMs)', () => {
    render({ position: pos(20_000), offsetMs: 100 }); // audible 19.9 s, view 14.9–24.9 s
    const canvas = container.querySelector('canvas')!;
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 100 } as DOMRect);
    act(() => {
      for (const type of ['pointerdown', 'pointerup'])
        canvas.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: 75, button: 0 }));
    });
    expect(onSeek).toHaveBeenCalledWith(14_900 + 7_500 + 100);
  });

  it('waveform draws only the visible range of peaks, plus ruler, markers and playhead', () => {
    const ctx = { clearRect: vi.fn(), fillRect: vi.fn(), fillText: vi.fn(), measureText: () => ({ width: 20 }), fillStyle: '', font: '' };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never);
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(100);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(50);
    const peaks = { min: new Float32Array(30_000).fill(-0.5), max: new Float32Array(30_000).fill(0.5), msPerBucket: 10 };
    render({ lrc: '[00:20.00]a', peaks, position: pos(20_000) });
    expect(ctx.fillText.mock.calls.map((c) => c[0])).toEqual(['00:20', '1']); // 10 s ruler step (100 px); marker tagged line 1
    const cols = ctx.fillRect.mock.calls.filter((c) => c[3] === 25); // peak columns: ±0.5 of a 50 px canvas
    expect(cols).toHaveLength(100);
    expect(cols[0]).toEqual([0, 12.5, 1, 25]);
    render({ lrc: '[00:20.00]a', peaks, position: pos(20_150) }); // playhead 1.5 px past the 00:20 tick
    ctx.fillText.mockClear();
    render({ lrc: '[00:20.00]a', peaks, position: pos(20_150) }); // one settled frame
    expect(ctx.fillText.mock.calls.map((c) => c[0])).toEqual(['1']); // its label would sit under the playhead
  });
});
