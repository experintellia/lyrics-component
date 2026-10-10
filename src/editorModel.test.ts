import { describe, expect, it } from 'vitest';
import { applyText, initState, reducer, type Action, type State } from './editorModel';
import { parseLrc, serializeLrc } from './lrc';

const run = (lrc: string, ...actions: Action[]) => actions.reduce(reducer, initState(parseLrc(lrc)));
const out = (s: State) => serializeLrc(s.doc);

describe('applyText (line diff)', () => {
  const old = parseLrc('[00:01.00]<00:01.00>one <00:01.50>x\n[00:02.00]two\n[00:03.00]three\n[00:04.00]').lines;
  const lrc = (text: string) => serializeLrc({ meta: [], lines: applyText(old, text) });

  it('keeps stamps and word tags of unchanged lines when a line is inserted', () => {
    expect(lrc('new\none x\ntwo\nmiddle\nthree\n')).toBe(
      'new\n[00:01.00]<00:01.00>one <00:01.50>x\n[00:02.00]two\nmiddle\n[00:03.00]three\n[00:04.00]\n',
    );
  });

  it('keeps the others when a line is removed', () => {
    expect(lrc('one x\nthree\n')).toBe('[00:01.00]<00:01.00>one <00:01.50>x\n[00:03.00]three\n[00:04.00]\n');
  });

  it('an edited line keeps its line time but drops word tags; unchanged lines keep everything', () => {
    expect(lrc('one y\ntwo!\nthree\n')).toBe('[00:01.00]one y\n[00:02.00]two!\n[00:03.00]three\n[00:04.00]\n');
  });

  it('keeps the same objects when nothing changed; empty text = no lines', () => {
    expect(applyText(old, 'one x\ntwo\nthree\n').every((l, i) => l === old[i])).toBe(true);
    expect(applyText(old, '')).toEqual([]);
  });
});

describe('editor reducer', () => {
  it('opens on Lyrics when empty, else on Sync lines at the first unstamped line', () => {
    expect(initState(parseLrc('')).step).toBe('lyrics');
    const s = initState(parseLrc('[00:01.00]a\nb\nc'));
    expect([s.step, s.sel]).toEqual(['lines', 1]);
  });

  it('text commit is one undo step and a no-op when nothing changed', () => {
    const s = run('a\nb', { t: 'draft', text: 'a\nbb' }, { t: 'draft', text: 'a\nbbb' }, { t: 'commit' }, { t: 'commit' });
    expect(out(s)).toBe('a\nbbb\n');
    expect(s.past).toHaveLength(1);
    expect(out(reducer(s, { t: 'undo' }))).toBe('a\nb\n');
  });

  it('undo commits pending typing first, so redo can bring it back', () => {
    const s = run('a', { t: 'draft', text: 'ab' }, { t: 'undo' });
    expect([out(s), s.draft]).toEqual(['a\n', 'a']);
    expect(reducer(s, { t: 'redo' }).draft).toBe('ab');
  });

  it('the stamp that times the last untimed line deselects (done); re-stamping a synced doc does not', () => {
    let s = run('a\nb', { t: 'stamp', ms: 1000 }, { t: 'stamp', ms: 2000 });
    expect(s.sel).toBe(-1);
    s = reducer(s, { t: 'select', i: 0 });
    s = reducer(s, { t: 'stamp', ms: 500 });
    expect(s.sel).toBe(1);
    expect(reducer(s, { t: 'move', d: 1 }).sel).toBe(1);
  });

  it('stamping skips blank lines (stanza breaks); undo selects the line it changed', () => {
    let s = run('a\n\nb', { t: 'stamp', ms: 1000 });
    expect(s.sel).toBe(2);
    s = reducer(s, { t: 'undo' });
    expect([out(s), s.sel]).toEqual(['a\n\nb\n', 0]);
  });

  it('word step: word 0 sets the line time, words in order, finishing a line advances', () => {
    let s = run('hello big world\nnext', { t: 'step', step: 'words' });
    expect([s.sel, s.word]).toEqual([0, 0]);
    s = reducer(s, { t: 'stampWord', ms: 1000 });
    s = reducer(s, { t: 'stampWord', ms: 1500 });
    expect(out(s)).toBe('[00:01.00]<00:01.00>hello <00:01.50>big world\nnext\n');
    s = reducer(s, { t: 'stampWord', ms: 2000 });
    expect([s.sel, s.word]).toEqual([1, 0]);
    expect(out(s)).toBe('[00:01.00]<00:01.00>hello <00:01.50>big <00:02.00>world\nnext\n');
    s = reducer(s, { t: 'select', i: 0 });
    s = reducer(s, { t: 'clearWords' });
    expect(out(s)).toBe('[00:01.00]hello big world\nnext\n');
  });

  it('word step: nudge moves the selected word (word 0 moves the line time too); untimed word: no-op', () => {
    let s = run('[00:01.00]<00:01.00>a <00:02.00>b c\nd', { t: 'step', step: 'words' });
    expect(s.word).toBe(2); // first untimed word
    expect(reducer(s, { t: 'nudge', d: 100 })).toBe(s);
    s = reducer(reducer(s, { t: 'pickWord', w: 1 }), { t: 'nudge', d: 100 });
    expect(out(s)).toBe('[00:01.00]<00:01.00>a <00:02.10>b c\nd\n');
    s = reducer(reducer(s, { t: 'pickWord', w: 0 }), { t: 'nudge', d: -100 });
    expect(out(s)).toBe('[00:00.90]<00:00.90>a <00:02.10>b c\nd\n');
    expect(s.past).toHaveLength(2);
  });

  it('word step: ↑/↓ choose words, crossing into the previous/next line', () => {
    let s = run('a b\n\nc d', { t: 'step', step: 'words' }, { t: 'moveWord', d: 1 });
    expect([s.sel, s.word]).toEqual([0, 1]);
    s = reducer(s, { t: 'moveWord', d: 1 });
    expect([s.sel, s.word]).toEqual([2, 0]); // blank line skipped
    s = reducer(s, { t: 'moveWord', d: -1 });
    expect([s.sel, s.word]).toEqual([0, 1]); // last word of the line before
    s = reducer(reducer(s, { t: 'moveWord', d: -1 }), { t: 'moveWord', d: -1 });
    expect([s.sel, s.word]).toEqual([0, 0]); // first word of the first line: stays
  });

  describe('paste LRC', () => {
    const lrc = '[ti:Song]\n[offset:500]\n[00:10.00]<00:10.00>one <00:10.50>two\n[00:12.00]three';
    const paste = (s: State, text: string, start: number, end = start) =>
      reducer(s, { t: 'paste', doc: parseLrc(text), start, end });

    it('into an empty box is a full import: stamps, word tags, meta, offset baked in', () => {
      const s = paste(initState(parseLrc('')), lrc, 0);
      expect(out(s)).toBe('[ti:Song]\n[00:09.50]<00:09.50>one <00:10.00>two\n[00:11.50]three\n');
      expect([s.draft, s.pasted?.n, s.pasted?.doc === s.doc]).toEqual(['one two\nthree', 2, true]);
    });

    it('in the middle splices at the caret; the lines around keep their stamps; one undo step', () => {
      const s0 = run('[ar:Me]\n[00:01.00]a\n[00:20.00]b');
      const s = paste(s0, '[00:05.00]x\n[00:06.00]y\n', 1); // caret right after "a"
      expect(out(s)).toBe('[ar:Me]\n[00:01.00]a\n[00:05.00]x\n[00:06.00]y\n[00:20.00]b\n');
      expect(s.draft).toBe('a\nx\ny\nb');
      expect(s.past).toHaveLength(1);
      expect(reducer(s, { t: 'commit' })).toBe(s); // the new draft matches the lines
      const u = reducer(s, { t: 'undo' });
      expect([out(u), u.draft]).toEqual(['[ar:Me]\n[00:01.00]a\n[00:20.00]b\n', 'a\nb']);
    });

    it('over a selection replaces it (a line split mid-way keeps both halves)', () => {
      const s = paste(run('[00:01.00]a\n[00:02.00]bc\n[00:03.00]d'), '[00:07.00]x', 3, 4); // selects "c"
      expect(out(s)).toBe('[00:01.00]a\n[00:02.00]b\n[00:07.00]x\n[00:03.00]d\n');
      const all = paste(run('[00:01.00]a\nb'), '[00:07.00]x', 0, 3);
      expect(out(all)).toBe('[00:07.00]x\n');
    });
  });
});
