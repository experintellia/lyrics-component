import { describe, expect, it } from 'vitest';
import { parseLrc } from './lrc';
import { serializeTtml } from './ttml';

const ttml = (lrc: string, opts?: { durationMs?: number; lang?: string }) => serializeTtml(parseLrc(lrc), opts);
const ps = (out: string) => out.match(/<p .*<\/p>/g);

describe('serializeTtml', () => {
  it('line mode: one <p> per stamped line, ending at the next stamp', () => {
    const out = ttml('[00:01.00]One\n[00:02.50]Two', { durationMs: 65_000, lang: 'en' });
    expect(out).toContain('itunes:timing="Line" xml:lang="en"');
    expect(out).toContain('<body dur="00:01:05.000">');
    expect(ps(out)).toEqual([
      '<p begin="00:00:01.000" end="00:00:02.500">One</p>',
      '<p begin="00:00:02.500" end="00:01:05.000">Two</p>',
    ]);
  });

  it('last line: ends at durationMs, else at its trailing word tag, else has no end', () => {
    expect(ps(ttml('[00:01.00]One', { durationMs: 9000 }))).toEqual(['<p begin="00:00:01.000" end="00:00:09.000">One</p>']);
    expect(ps(ttml('[00:01.00]One'))).toEqual(['<p begin="00:00:01.000">One</p>']);
    expect(ttml('[00:01.00]One')).toContain('<body>');
    expect(ps(ttml('[00:01.00]<00:01.00>One <00:01.80>'))).toEqual([
      '<p begin="00:00:01.000" end="00:00:01.800"><span begin="00:00:01.000" end="00:00:01.800">One</span></p>',
    ]);
  });

  it('word mode: one <span> per timed word, ending at the next word, the end tag or the line end', () => {
    const out = ttml('[00:01.00]<00:01.00>Carry <00:01.40>me <00:01.70>home\n[00:03.00]<00:03.00>Hel<00:03.20>lo <00:03.50>\n[00:04.00]Plain', { durationMs: 5000 });
    expect(out).toContain('itunes:timing="Word"');
    expect(ps(out)).toEqual([
      '<p begin="00:00:01.000" end="00:00:03.000"><span begin="00:00:01.000" end="00:00:01.400">Carry</span> ' +
        '<span begin="00:00:01.400" end="00:00:01.700">me</span> <span begin="00:00:01.700" end="00:00:03.000">home</span></p>',
      '<p begin="00:00:03.000" end="00:00:04.000"><span begin="00:00:03.000" end="00:00:03.200">Hel</span>' +
        '<span begin="00:00:03.200" end="00:00:03.500">lo</span></p>', // syllables: no space between spans
      '<p begin="00:00:04.000" end="00:00:05.000">Plain</p>', // a line without word tags stays plain
    ]);
  });

  it('phrase timing: untimed words join the timed span before them; leading ones start with the line', () => {
    expect(ps(ttml('[00:01.00]Oh <00:01.50>carry me <00:02.00>home', { durationMs: 3000 }))).toEqual([
      '<p begin="00:00:01.000" end="00:00:03.000"><span begin="00:00:01.000" end="00:00:01.500">Oh</span> ' +
        '<span begin="00:00:01.500" end="00:00:02.000">carry me</span> <span begin="00:00:02.000" end="00:00:03.000">home</span></p>',
    ]);
  });

  it('gaps and unstamped lines: not written; a gap ends the line before it', () => {
    const out = ttml('[00:01.00]One\n[00:02.00]\nUnstamped\n[00:05.00]Two', { durationMs: 6000 });
    expect(ps(out)).toEqual([
      '<p begin="00:00:01.000" end="00:00:02.000">One</p>',
      '<p begin="00:00:05.000" end="00:00:06.000">Two</p>',
    ]);
    expect(out).not.toContain('Unstamped');
  });

  it('sections: one <div> each, like the waveform bands; a label becomes itunes:song-part', () => {
    const out = ttml('[00:01.00]A1\n[00:02.00]A2\n\n[Chorus]\n[00:05.00]C1\n[00:06.00]C2', { durationMs: 8000 });
    expect(out.match(/<div[^>]*>/g)).toEqual([
      '<div begin="00:00:01.000" end="00:00:05.000">',
      '<div begin="00:00:05.000" end="00:00:08.000" itunes:song-part="Chorus">',
    ]);
    expect(out).not.toContain('[Chorus]');
  });

  it('metadata: [ti:] and [ar:] go into <head>; text and attributes are escaped', () => {
    const out = ttml('[ti:Rock & "Roll"]\n[ar:<Band>]\n[Verse "1"]\n[00:01.00]a < b & c > d', { lang: 'en"' });
    expect(out).toContain('<ttm:title>Rock &amp; &quot;Roll&quot;</ttm:title>');
    expect(out).toContain('<ttm:name type="full">&lt;Band&gt;</ttm:name>');
    expect(out).toContain('itunes:song-part="Verse &quot;1&quot;"');
    expect(out).toContain('xml:lang="en&quot;"');
    expect(out).toContain('>a &lt; b &amp; c &gt; d</p>');
  });

  it('out-of-order word tags are clamped: no span or line ends before it begins', () => {
    expect(ps(ttml('[00:02.00]<00:02.00>a <00:04.00>b\n[00:03.00]next', { durationMs: 5000 }))![0]).toBe(
      '<p begin="00:00:02.000" end="00:00:03.000"><span begin="00:00:02.000" end="00:00:03.000">a</span> ' +
        '<span begin="00:00:03.000" end="00:00:03.000">b</span></p>', // word after the next line's stamp
    );
    expect(ps(ttml('[00:03.00]<00:03.00>a <00:01.00>b', { durationMs: 5000 }))).toEqual([
      '<p begin="00:00:03.000" end="00:00:05.000"><span begin="00:00:03.000" end="00:00:03.000">a</span> ' +
        '<span begin="00:00:03.000" end="00:00:05.000">b</span></p>', // word before the one before it
    ]);
    expect(ps(ttml('[00:01.00]<00:01.00>a <00:00.50>'))).toEqual([
      '<p begin="00:00:01.000" end="00:00:01.000"><span begin="00:00:01.000" end="00:00:01.000">a</span></p>', // end tag before the line
    ]);
  });

  it('drops characters XML 1.0 cannot hold', () => {
    expect(ps(ttml('[00:01.00]a\u0001b\u001Fc\uD800d\uFFFEe 😀', { durationMs: 2000 }))).toEqual(['<p begin="00:00:01.000" end="00:00:02.000">abcde 😀</p>']);
  });

  it('refuses a document with nothing stamped', () => {
    expect(() => ttml('plain\ntext')).toThrow(/no stamped lines/);
    expect(() => ttml('[00:01.00]')).toThrow(/no stamped lines/);
  });

  it('is well-formed XML in the TTML namespace', () => {
    const out = ttml('[ti:T & T]\n[ar:A]\n[Intro]\n[00:01.00]<00:01.00>x & <00:01.50>y\n\n[00:03.00]"z" <w>', { durationMs: 4000, lang: 'en' });
    const xml = new DOMParser().parseFromString(out, 'application/xml');
    expect(xml.getElementsByTagName('parsererror')).toHaveLength(0);
    expect(xml.documentElement.namespaceURI).toBe('http://www.w3.org/ns/ttml');
    expect(xml.getElementsByTagNameNS('http://www.w3.org/ns/ttml', 'p')).toHaveLength(2);
    expect([...xml.getElementsByTagNameNS('http://www.w3.org/ns/ttml', 'span')].map((s) => s.textContent)).toEqual(['x &', 'y']);
    expect(xml.getElementsByTagNameNS('http://www.w3.org/ns/ttml', 'div')[0].getAttributeNS('http://music.apple.com/lyric-ttml-internal', 'song-part')).toBe('Intro');
  });
});
