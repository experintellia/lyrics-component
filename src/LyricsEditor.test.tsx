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
const input = (i: number) => $$('.lyrics-editor-row input')[i] as HTMLInputElement;
const button = (label: string) => $$('button').find((b) => b.textContent === label)!;
const click = (el: HTMLElement) => act(() => el.click());
const key = (k: string, opts: KeyboardEventInit = {}, target: EventTarget = document.body) =>
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...opts }));
  });
const type = (i: number, value: string) =>
  act(() => {
    const el = input(i);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
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

describe('LyricsEditor', () => {
  it('stamps the selected line at the playhead and selects the next', () => {
    render();
    expect(selected()).toBe(0);
    click(button('Stamp'));
    expect(lastLrc()).toBe('[00:05.00]a\nb\nc\n');
    expect(selected()).toBe(1);
    render({ position: pos(7_250) });
    key('s');
    expect(lastLrc()).toBe('[00:05.00]a\n[00:07.25]b\nc\n');
    expect(selected()).toBe(2);
    expect(times()).toEqual(['00:05.00', '00:07.25', '--:--.--']);
  });

  it('stamps at audible time (position − offsetMs) and plays a line at its time + offsetMs', () => {
    render({ offsetMs: 200 });
    click(button('Stamp'));
    expect(lastLrc()).toBe('[00:04.80]a\nb\nc\n');
    click($$('.lyrics-editor-time')[0]);
    click(button('Play line'));
    expect(onSeek).toHaveBeenCalledWith(5_000);
  });

  it('nudges by ±10/±100 ms and shifts word tags', () => {
    render({ lrc: '[00:01.00]<00:01.50>a' });
    click(button('+100 ms'));
    expect(lastLrc()).toBe('[00:01.10]<00:01.60>a\n');
    click(button('−10 ms'));
    expect(lastLrc()).toBe('[00:01.09]<00:01.59>a\n');
    click(button('+10 ms'));
    click(button('−100 ms'));
    expect(lastLrc()).toBe('[00:01.00]<00:01.50>a\n');
  });

  it('clears a stamp', () => {
    render({ lrc: '[00:01.00]a\n[00:02.00]b' });
    click(button('Clear'));
    expect(lastLrc()).toBe('a\n[00:02.00]b\n');
    expect(button('Clear').hasAttribute('disabled')).toBe(true);
  });

  it('undo/redo: one step per stamp/nudge/clear, via buttons and shortcuts', () => {
    render();
    click(button('Stamp')); // a @ 5.00
    click($$('.lyrics-editor-time')[0]);
    click(button('+10 ms')); // a @ 5.01
    click(button('Clear'));
    expect(lastLrc()).toBe('a\nb\nc\n');
    click(button('Undo'));
    expect(lastLrc()).toBe('[00:05.01]a\nb\nc\n');
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

  it('undo groups typing per line', () => {
    render();
    type(0, 'ax');
    type(0, 'axy');
    type(1, 'bz');
    click(button('Undo'));
    expect(lastLrc()).toBe('axy\nb\nc\n');
    click(button('Undo'));
    expect(lastLrc()).toBe('a\nb\nc\n');
  });

  it('onChange: stamps immediately, text after 500 ms idle or on blur', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    render();
    type(0, 'ax');
    act(() => vi.advanceTimersByTime(400));
    type(0, 'axy');
    act(() => vi.advanceTimersByTime(499));
    expect(onChange).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(lastLrc()).toBe('axy\nb\nc\n');

    act(() => input(1).focus());
    type(1, 'bb');
    act(() => input(1).blur());
    expect(lastLrc()).toBe('axy\nbb\nc\n');

    act(() => input(2).focus());
    type(2, 'cc');
    click(button('Stamp')); // flushes pending text along with the stamp
    expect(onChange).toHaveBeenCalledTimes(3);
    expect(lastLrc()).toBe('axy\nbb\n[00:05.00]cc\n');
  });

  it('flushes pending text on unmount', () => {
    render();
    type(0, 'ax');
    act(() => root.unmount());
    expect(lastLrc()).toBe('ax\nb\nc\n');
    root = createRoot(container);
  });

  it('re-parses the lrc prop only when it differs from the last emitted value', () => {
    render();
    click(button('Stamp'));
    const emitted = lastLrc();
    type(1, 'typed'); // pending, not yet emitted
    render({ lrc: emitted }); // host echoes our own value back
    expect(input(1).value).toBe('typed');
    expect(button('Undo').hasAttribute('disabled')).toBe(false);
    render({ lrc: '[00:09.00]new' }); // host loads something else
    expect(rows()).toHaveLength(1);
    expect(input(0).value).toBe('new');
    expect(times()).toEqual(['00:09.00']);
  });

  it('flags stamps beyond durationMs, but not while durationMs is 0', () => {
    render({ lrc: '[00:10.00]a\n[05:00.00]b', position: pos(0, 60_000) });
    expect(rows().map((r) => r.hasAttribute('data-late'))).toEqual([false, true]);
    render({ position: pos(0, 0) });
    expect(rows().map((r) => r.hasAttribute('data-late'))).toEqual([false, false]);
  });

  it('ignores shortcuts while a text field has focus', () => {
    render();
    act(() => input(0).focus());
    key('s', {}, input(0));
    key('z', { ctrlKey: true }, input(0));
    expect(onChange).not.toHaveBeenCalled();
    act(() => input(0).blur());
    key('s');
    expect(lastLrc()).toBe('[00:05.00]a\nb\nc\n');
  });

  it('shortcuts still work while a non-text input (checkbox, slider) has focus', () => {
    render();
    const box = container.appendChild(document.createElement('input'));
    box.type = 'checkbox';
    act(() => box.focus());
    key('s', {}, box);
    expect(lastLrc()).toBe('[00:05.00]a\nb\nc\n');
    box.type = 'range';
    key('z', { ctrlKey: true }, box);
    expect(lastLrc()).toBe('a\nb\nc\n');
  });

  it('without onChange it is read-only: renders the display, no inputs or stamp button', () => {
    render({ lrc: '[00:01.00]a', onChange: undefined });
    expect($$('.lyrics-editor-row input')).toHaveLength(0);
    expect(button('Stamp')).toBeUndefined();
    expect($$('.lyrics-view button.lyrics-line').map((b) => b.textContent)).toEqual(['a']);
  });

  it('Enter that confirms an IME candidate (keyCode 229, WebKit) does not split', () => {
    render();
    act(() => input(0).focus());
    key('Enter', { keyCode: 229 }, input(0));
    expect(rows()).toHaveLength(3);
  });

  it('stamp button prevents default on pointerdown (keeps focus / no iOS keyboard)', () => {
    render();
    const ev = new Event('pointerdown', { bubbles: true, cancelable: true });
    act(() => {
      button('Stamp').dispatchEvent(ev);
    });
    expect(ev.defaultPrevented).toBe(true);
  });

  it('Enter splits a row at the caret, Backspace at start merges it back', () => {
    render({ lrc: '[00:01.00]hello world' });
    act(() => {
      input(0).focus();
      input(0).setSelectionRange(5, 5);
    });
    key('Enter', {}, input(0));
    expect(rows()).toHaveLength(2);
    expect([input(0).value, input(1).value]).toEqual(['hello', ' world']);
    expect(document.activeElement).toBe(input(1));
    expect(times()).toEqual(['00:01.00', '--:--.--']);
    key('Backspace', {}, input(1));
    expect(rows()).toHaveLength(1);
    expect(input(0).value).toBe('hello world');
  });

  it('a multi-line paste splits into rows (and keeps stamps of pasted LRC)', () => {
    render({ lrc: '' });
    expect(rows()).toHaveLength(1); // an empty doc still offers one row to type into
    const ev = new Event('paste', { bubbles: true, cancelable: true });
    Object.assign(ev, { clipboardData: { getData: () => '[00:01.00]one\n[00:02.00]two\nthree' } });
    act(() => {
      input(0).dispatchEvent(ev);
    });
    expect(ev.defaultPrevented).toBe(true);
    expect(rows().map((_, i) => input(i).value)).toEqual(['one', 'two', 'three']);
    expect(times()).toEqual(['00:01.00', '00:02.00', '--:--.--']);
  });

  it('waveform click seeks to the clicked time (+ offsetMs)', () => {
    render({ position: pos(20_000), offsetMs: 100 }); // audible 19.9 s, view 14.9–24.9 s
    const canvas = container.querySelector('canvas')!;
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 100 } as DOMRect);
    act(() => {
      canvas.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 75 }));
    });
    expect(onSeek).toHaveBeenCalledWith(14_900 + 7_500 + 100);
  });

  it('waveform draws only the visible range of peaks, plus ruler, markers and playhead', () => {
    const ctx = { clearRect: vi.fn(), fillRect: vi.fn(), fillText: vi.fn(), fillStyle: '', font: '' };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never);
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(100);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(50);
    const peaks = { min: new Float32Array(30_000).fill(-0.5), max: new Float32Array(30_000).fill(0.5), msPerBucket: 10 };
    render({ lrc: '[00:20.00]a', peaks, position: pos(20_000) });
    expect(ctx.fillText.mock.calls.map((c) => c[0])).toEqual(['00:20']); // 100 px wide → 10 s ruler step
    const cols = ctx.fillRect.mock.calls.filter((c) => c[3] === 25); // peak columns: ±0.5 of a 50 px canvas
    expect(cols).toHaveLength(100);
    expect(cols[0]).toEqual([0, 12.5, 1, 25]);
  });
});
