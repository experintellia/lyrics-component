import { describe, expect, it } from 'vitest';
import { displayText, formatTime, parseLrc, serializeLrc, setLineTime } from './lrc';

const times = (s: string) => parseLrc(s).lines.map((l) => l.timeMs);

describe('parse time tags', () => {
  it('reads [mm:ss] and fractions by digit count', () => {
    expect(times('[01:02]a\n[01:02.5]b\n[01:02.50]c\n[01:02.500]d\n[01:02.05]e\n[01:02.005]f')).toEqual([
      62000, 62005, 62050, 62500, 62500, 62500, // sorted
    ]);
  });
  it('reads the [mm:ss:xx] colon variant', () => {
    expect(times('[00:01:50]a')).toEqual([1500]);
  });
  it('allows minutes > 99', () => {
    expect(times('[123:04.10]a')).toEqual([123 * 60000 + 4100]);
  });
  it('accepts CRLF input', () => {
    expect(parseLrc('[ti:T]\r\n[00:01.00]a\r\n[00:02.00]b\r\n').lines).toEqual([
      { timeMs: 1000, text: 'a' },
      { timeMs: 2000, text: 'b' },
    ]);
  });
});

describe('LRC vs plain detection', () => {
  it('plain text: all lines unstamped, blank stanza breaks kept', () => {
    expect(parseLrc('Line one\n\nLine two\n').lines).toEqual([
      { timeMs: null, text: 'Line one' },
      { timeMs: null, text: '' },
      { timeMs: null, text: 'Line two' },
    ]);
  });
  it('one line starting with a time tag makes it LRC', () => {
    expect(parseLrc('intro\n[00:01.00]a').lines).toEqual([
      { timeMs: null, text: 'intro' },
      { timeMs: 1000, text: 'a' },
    ]);
  });
  it('a tag later in the line does not count', () => {
    expect(times('hello [00:01.00]')).toEqual([null]);
  });
  it('empty input', () => {
    expect(parseLrc('')).toEqual({ meta: [], lines: [] });
    expect(serializeLrc(parseLrc(''))).toBe('');
  });
});

describe('metadata', () => {
  it('only ^\\[[a-z#]+:.*\\]$ lines are metadata; [Chorus]/[Verse 1] are text', () => {
    const doc = parseLrc('[ar:Artist]\n[ti:Title]\n[Chorus]\n[00:01.00]a\n[Verse 1]\n[Ar:x]');
    expect(doc.meta).toEqual([
      { key: 'ar', value: 'Artist' },
      { key: 'ti', value: 'Title' },
    ]);
    expect(doc.lines.map((l) => l.text)).toEqual(['[Chorus]', 'a', '[Verse 1]', '[Ar:x]']);
  });
  it('keeps unknown tags (and [length:]) in order', () => {
    const doc = parseLrc('[x-foo:1]\n[length:03:20]\n[#:comment]\n[re:tool]\n[00:01]a');
    expect(doc.meta.map((m) => m.key)).toEqual(['length', '#', 're']);
    expect(doc.lines[0].text).toBe('[x-foo:1]'); // '-' is not in [a-z#], so it's text
    expect(serializeLrc(doc)).toBe('[length:03:20]\n[#:comment]\n[re:tool]\n[x-foo:1]\n[00:01.00]a\n');
  });
});

describe('offset', () => {
  it('bakes positive offset (earlier), clamps at 0, omits the tag on serialize', () => {
    const doc = parseLrc('[offset:+500]\n[00:00.20]a\n[00:02.00]b<00:02.50>c');
    expect(doc.lines).toEqual([
      { timeMs: 0, text: 'a' },
      { timeMs: 1500, text: 'b<00:02.00>c' },
    ]);
    expect(doc.meta).toEqual([]);
    expect(serializeLrc(doc)).not.toContain('offset');
  });
  it('negative offset makes lyrics later; offset may come after the lines', () => {
    expect(times('[00:01.00]a\n[offset:-250]')).toEqual([1250]);
  });
});

describe('lines', () => {
  it('splits multi-tag lines, one line per tag, not merged on save', () => {
    const doc = parseLrc('[00:10.00][00:30.00]Chorus\n[00:20.00]Verse');
    expect(doc.lines).toEqual([
      { timeMs: 10000, text: 'Chorus' },
      { timeMs: 20000, text: 'Verse' },
      { timeMs: 30000, text: 'Chorus' },
    ]);
    expect(serializeLrc(doc)).toBe('[00:10.00]Chorus\n[00:20.00]Verse\n[00:30.00]Chorus\n');
  });
  it('keeps empty-text stamps as instrumental gaps, drops untagged blank lines in LRC', () => {
    expect(parseLrc('[00:01.00]a\n\n[00:05.00]\n[00:09.00]b').lines).toEqual([
      { timeMs: 1000, text: 'a' },
      { timeMs: 5000, text: '' },
      { timeMs: 9000, text: 'b' },
    ]);
  });
  it('sorts stamped lines; unstamped lines follow their predecessor; equal times keep file order', () => {
    const doc = parseLrc('head\n[00:05.00]five\nafter five\n[00:01.00]one\n[00:05.00]five again\nafter one?');
    expect(doc.lines).toEqual([
      { timeMs: null, text: 'head' },
      { timeMs: 1000, text: 'one' },
      { timeMs: 5000, text: 'five' },
      { timeMs: null, text: 'after five' },
      { timeMs: 5000, text: 'five again' },
      { timeMs: null, text: 'after one?' },
    ]);
  });
});

describe('word tags', () => {
  const line = { timeMs: 1000, text: '<00:01.00>Hello <00:01.50>world' };
  it('are kept in the model', () => {
    expect(parseLrc(`[00:01.00]${line.text}`).lines[0]).toEqual(line);
  });
  it('are stripped by displayText', () => {
    expect(displayText(line.text)).toBe('Hello world');
    expect(displayText('<00:01:50>x<123:00.123>y')).toBe('xy');
  });
  it('shift with setLineTime by the same delta', () => {
    expect(setLineTime(line, 2005)).toEqual({ timeMs: 2005, text: '<00:02.005>Hello <00:02.505>world' });
    expect(setLineTime(line, 0).text).toBe('<00:00.00>Hello <00:00.50>world');
  });
  it('unchanged when stamping an unstamped line or clearing a stamp', () => {
    expect(setLineTime(line, null)).toEqual({ timeMs: null, text: line.text });
    expect(setLineTime({ timeMs: null, text: line.text }, 5000)).toEqual({ timeMs: 5000, text: line.text });
  });
  it('setLineTime does not mutate', () => {
    setLineTime(line, 9000);
    expect(line.timeMs).toBe(1000);
  });
});

describe('serialize', () => {
  it('formatTime writes .xx for multiples of 10 ms, else .xxx', () => {
    expect(formatTime(0)).toBe('00:00.00');
    expect(formatTime(62500)).toBe('01:02.50');
    expect(formatTime(62505)).toBe('01:02.505');
    expect(formatTime(62050)).toBe('01:02.05');
    expect(formatTime(62005)).toBe('01:02.005');
    expect(formatTime(123 * 60000 + 4100)).toBe('123:04.10');
  });
  it('writes metadata first, then lines in model order (no re-sort)', () => {
    const doc = {
      meta: [{ key: 'ti', value: 'T' }],
      lines: [
        { timeMs: 5000, text: 'b' },
        { timeMs: null, text: 'x' },
        { timeMs: 1000, text: 'a' },
      ],
    };
    expect(serializeLrc(doc)).toBe('[ti:T]\n[00:05.00]b\nx\n[00:01.00]a\n');
  });
  it('round-trips ms precision', () => {
    expect(times(serializeLrc({ meta: [], lines: [{ timeMs: 61234, text: 'a' }] }))).toEqual([61234]);
  });
  it.each([
    '[ar:A]\n[ti:T]\n[00:01.5]a\n[00:00.25]b\n',
    '[offset:300]\r\n[00:10][00:20]Chorus\r\n[Chorus]\r\n[00:15:3]\r\n',
    'just\n\nplain text\n\n\n',
    '[ti:Only meta]\nunstamped line\n',
    '[00:01.00]<00:01.00>w1 <00:01.234>w2\n[05:00.001]\n[Verse 1]\n[00:03.00]c',
    '',
  ])('serialize(parse(x)) is idempotent: %j', (x) => {
    const once = serializeLrc(parseLrc(x));
    expect(serializeLrc(parseLrc(once))).toBe(once);
    expect(parseLrc(once)).toEqual(parseLrc(x));
  });
});
