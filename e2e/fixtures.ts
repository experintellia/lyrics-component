// Shared test fixtures, generated in memory (no binary fixtures in git).
import { expect, type Locator, type Page } from '@playwright/test';

// ponytail: no @types/node (no new deps), so Node's Buffer is untyped here. Playwright needs a real Buffer.
declare const Buffer: any;

/**
 * 16-bit mono PCM WAV. `musical`: notes on a 120 bpm beat with decaying hits and quieter verses /
 * louder choruses, so the waveform looks like a song. Otherwise a steady 440 Hz tone.
 */
export function wav(seconds = 5, musical = false, rate = 8000) {
  const n = seconds * rate;
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + n * 2, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16); // fmt chunk size
  b.writeUInt16LE(1, 20); // PCM
  b.writeUInt16LE(1, 22); // mono
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28); // byte rate
  b.writeUInt16LE(2, 32); // block align
  b.writeUInt16LE(16, 34); // bits per sample
  b.write('data', 36);
  b.writeUInt32LE(n * 2, 40);
  const scale = [220, 247, 262, 294, 330, 294, 262, 247];
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    let v = Math.sin(2 * Math.PI * 440 * t) * 0.25;
    if (musical) {
      const beat = Math.floor(t * 2);
      const hit = Math.exp(-(t * 2 - beat) * 3); // each beat decays
      const section = t < 1 ? t : t > seconds - 2 ? (seconds - t) / 2 : Math.floor((t - 1) / 7) % 2 ? 0.95 : 0.5;
      const f = scale[beat % scale.length];
      v = section * (0.3 + 0.7 * hit) * (0.7 * Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(4 * Math.PI * f * t));
    }
    b.writeInt16LE(Math.round(30000 * v), 44 + i * 2);
  }
  return b;
}

/** Original lyrics (not a real song): 16 lines in four stanzas. */
export const SONG = [
  'Morning light on the harbour wall',
  'Gulls are circling, hear them call',
  'I left my coat on the kitchen chair',
  'And walked out into the open air',
  '',
  'Carry me home on the evening tide',
  'Leave the lantern burning by the door',
  'Every road I took was a road to you',
  "And I don't need to wander anymore",
  '',
  'Paper boats in the gutter run',
  'Racing shadows to beat the sun',
  'Every window has a story told',
  'Every doorstep is a step of gold',
  '',
  'Carry me home when the stars are wide',
  'Leave the kettle singing on the stove',
  'Every song I sang was a song for you',
  'Hum it softly, this is how I know',
].join('\n');

const two = (n: number) => String(n).padStart(2, '0');
export function tag(s: number) {
  const cs = Math.round(s * 100);
  return `${two(Math.floor(cs / 6000))}:${two(Math.floor(cs / 100) % 60)}.${two(cs % 100)}`;
}

/** SONG line-synced: line k (blank lines kept, not counted) at 1 + 1.75·k s. `words`: also word tags on the choruses. */
export function songLrc(words = false) {
  let k = 0;
  return (
    '[ti:Harbour Light]\n' +
    SONG.split('\n')
      .map((line) => {
        if (!line) return '';
        const i = k;
        const t = 1 + 1.75 * k++;
        if (!words || !(i >= 4 && i < 8)) return `[${tag(t)}]${line}`;
        const ws = line.split(' ');
        return `[${tag(t)}]` + ws.map((w, j) => `<${tag(t + (j * 1.6) / ws.length)}>${w}`).join(' ');
      })
      .join('\n') +
    '\n'
  );
}

export const audioTime = (page: Page) => page.locator('audio').evaluate((a: HTMLAudioElement) => a.currentTime);

/** Seek (paused) and wait until the demo's position has caught up. */
export async function seek(page: Page, s: number) {
  await page.locator('audio').evaluate((a: HTMLAudioElement, t) => (a.currentTime = t), s);
  await expect.poll(() => audioTime(page)).toBeCloseTo(s, 2);
}

export async function loadAudio(page: Page, seconds = 5, musical = false) {
  // By script, not setInputFiles (which stamps lastModified "now"): a re-pick must be the same file
  // (name, size, lastModified), as the demo keys its drafts.
  await page.getByLabel('Audio file').evaluate((input: HTMLInputElement, b64) => {
    const dt = new DataTransfer();
    dt.items.add(new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], 'song.wav', { type: 'audio/wav', lastModified: 1.7e12 }));
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, wav(seconds, musical).toString('base64'));
  await expect.poll(() => page.locator('audio').evaluate((a: HTMLAudioElement) => a.duration)).toBeCloseTo(seconds, 1);
}

export const loadLyrics = (page: Page, name: string, text: string) =>
  page.getByLabel('Lyrics file').setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(text) });

/** Paste `text` over everything in a textarea, as a real clipboard paste would (works in Chromium and WebKit). */
export const pasteOver = (box: Locator, text: string) =>
  box.evaluate((el: HTMLTextAreaElement, text) => {
    el.focus();
    el.select();
    const data = new DataTransfer();
    data.setData('text/plain', text);
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, text);
