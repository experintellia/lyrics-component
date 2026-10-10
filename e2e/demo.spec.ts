import { expect, test, type Page } from '@playwright/test';

// ponytail: no @types/node (no new deps), so Node's Buffer is untyped here. Playwright needs a real Buffer.
declare const Buffer: any;

/** 5 s, 440 Hz, 16-bit mono PCM WAV, built in memory (no binary fixtures in git). */
function wav(seconds = 5, rate = 8000) {
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
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(8000 * Math.sin((2 * Math.PI * 440 * i) / rate)), 44 + i * 2);
  return b;
}

const LRC = '[ti:Tone]\n[00:00.50]First line\n[00:02.00]Second line\n[00:03.50]Third line\n';

async function load(page: Page) {
  await page.goto('/');
  await page.getByLabel('Audio').setInputFiles({ name: 'tone.wav', mimeType: 'audio/wav', buffer: wav() });
  await page.getByLabel('Lyrics').setInputFiles({ name: 'tone.lrc', mimeType: 'text/plain', buffer: Buffer.from(LRC) });
  await expect(page.locator('.lyrics-line')).toHaveText(['First line', 'Second line', 'Third line']);
  await expect.poll(() => page.locator('audio').evaluate((a: HTMLAudioElement) => a.duration)).toBeCloseTo(5, 1);
}

const audioTime = (page: Page) => page.locator('audio').evaluate((a: HTMLAudioElement) => a.currentTime);

test('view highlights the current line and click seeks the audio', async ({ page }) => {
  await load(page);
  await page.locator('audio').evaluate((a: HTMLAudioElement) => (a.currentTime = 2.2));
  await expect(page.getByRole('button', { name: 'Second line' })).toHaveAttribute('aria-current', 'true');

  await page.getByRole('button', { name: 'Third line' }).click();
  await expect(page.getByRole('button', { name: 'Third line' })).toHaveAttribute('aria-current', 'true');
  await expect.poll(() => audioTime(page)).toBeCloseTo(3.5, 1);
});

test('edit: play, stamp a line, download LRC with the new stamp', async ({ page }) => {
  await load(page);
  await page.getByLabel('Edit').check();
  await expect(page.getByLabel('Line 1')).toHaveValue('First line');

  // Muted + called from the page: headless WebKit won't autoplay otherwise.
  await page.locator('audio').evaluate(async (a: HTMLAudioElement) => {
    a.muted = true;
    await a.play();
  });
  await expect.poll(() => audioTime(page)).toBeGreaterThan(1);
  await page.locator('audio').evaluate((a: HTMLAudioElement) => a.pause());
  const ms = Math.round((await audioTime(page)) * 1000);

  await page.getByRole('button', { name: 'Stamp', exact: true }).click(); // first row is selected
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: /Download/ }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('tone.lrc');
  let text = '';
  for await (const chunk of await file.createReadStream()) text += chunk;

  const m = text.match(/^\[(\d+):(\d+\.\d+)\]First line$/m);
  expect(m, text).not.toBeNull();
  expect(Math.abs(+m![1] * 60000 + +m![2] * 1000 - ms)).toBeLessThan(50);
  expect(text).toContain('[ti:Tone]');
  expect(text).toContain('[00:02.00]Second line');
});

test('UI rules: 44px targets, ≥12px font, wrapping, hover scoped, no smooth scroll under reduced motion', async ({ page }) => {
  await load(page);
  const line = page.locator('.lyrics-line').first();
  const css = (sel: string, prop: string) =>
    page.locator(sel).first().evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);
  expect((await line.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(parseFloat(await css('.lyrics-line', 'font-size'))).toBeGreaterThanOrEqual(12);
  expect(await css('.lyrics-line', 'overflow-wrap')).toBe('anywhere');
  expect(await css('.lyrics-view', 'scroll-behavior')).toBe('smooth');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await css('.lyrics-view', 'scroll-behavior')).toBe('auto');

  // Every :hover rule of ours sits inside @media (hover: hover).
  const unscoped = await page.evaluate(() =>
    [...document.styleSheets].flatMap((s) =>
      [...s.cssRules].filter((r) => r instanceof CSSStyleRule && r.selectorText.includes(':hover')).map((r) => (r as CSSStyleRule).selectorText),
    ),
  );
  expect(unscoped).toEqual([]);

  await page.getByLabel('Edit').check();
  for (const el of await page.locator('.lyrics-editor button, .lyrics-editor-row input').all()) {
    const box = (await el.boundingBox())!;
    expect(Math.min(box.width, box.height), await el.evaluate((e) => e.outerHTML)).toBeGreaterThanOrEqual(44);
  }
  expect(parseFloat(await css('.lyrics-editor-hint', 'font-size'))).toBeGreaterThanOrEqual(12);
});

test('peaks load (waveform drawn across the canvas) and zoom redraws it', async ({ page }) => {
  const warnings: string[] = [];
  page.on('console', (m) => m.type() === 'warning' && warnings.push(m.text()));
  await load(page);
  await page.getByLabel('Edit').check();
  const canvas = page.locator('.lyrics-wave canvas');
  // Without peaks only the playhead and stamp markers cross the middle row; with peaks every column does.
  const midRowInked = () =>
    canvas.evaluate((c: HTMLCanvasElement) => {
      const row = c.getContext('2d')!.getImageData(0, c.height >> 1, c.width, 1).data;
      let n = 0;
      for (let i = 3; i < row.length; i += 4) if (row[i]) n++;
      return n / c.width;
    });
  await expect.poll(midRowInked).toBeGreaterThan(0.9);
  expect(warnings).toEqual([]);

  const before = await canvas.evaluate((c: HTMLCanvasElement) => c.toDataURL());
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect.poll(() => canvas.evaluate((c: HTMLCanvasElement) => c.toDataURL())).not.toBe(before);
});

test('S stamps while a checkbox has focus; unsaved edits trigger the beforeunload guard', async ({ page }) => {
  await load(page);
  await page.getByLabel('Edit').check();
  await page.getByLabel('Edit').focus();
  await page.keyboard.press('s');
  await expect(page.locator('.lyrics-editor-time').first()).toHaveText('00:00.00');
  await expect(page.getByRole('button', { name: /Download/ })).toHaveText(/\*$/); // dirty

  const dialog = new Promise<string>((resolve) => page.once('dialog', (d) => (resolve(d.type()), d.dismiss())));
  await page.close({ runBeforeUnload: true });
  expect(await dialog).toBe('beforeunload');
});

test('tap-along on a phone: the newly selected row never hides under the sticky Stamp button', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 600 });
  await page.goto('/');
  const lines = Array.from({ length: 20 }, (_, i) => `Line number ${i + 1}`).join('\n');
  await page.getByLabel('Lyrics').setInputFiles({ name: 'l.txt', mimeType: 'text/plain', buffer: Buffer.from(lines) });
  await page.getByLabel('Edit').check();
  const stamp = page.getByRole('button', { name: 'Stamp', exact: true });
  for (let i = 0; i < 19; i++) {
    await stamp.click();
    const sel = (await page.locator('.lyrics-editor-row[aria-current] input').boundingBox())!;
    const btn = (await stamp.boundingBox())!;
    expect(sel.y + sel.height, `after stamp ${i + 1}`).toBeLessThanOrEqual(btn.y);
  }
});
