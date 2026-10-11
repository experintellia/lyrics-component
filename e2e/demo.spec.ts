import { expect, test, type Page } from '@playwright/test';
import { audioTime, loadAudio, loadLyrics, pasteOver, seek } from './fixtures';

const LRC = '[ti:Tone]\n[00:00.50]First line\n[00:02.00]Second line\n[00:03.50]Third line\n';

async function load(page: Page) {
  await page.goto('/');
  await loadAudio(page);
  await loadLyrics(page, 'tone.lrc', LRC);
  await expect(page.getByRole('tab', { name: 'Preview' })).toHaveAttribute('aria-selected', 'true'); // synced: preview
  await expect(page.locator('.lyrics-line')).toHaveText(['First line', 'Second line', 'Third line']);
}

async function downloadText(page: Page) {
  // Note the type of the file's blob URL.
  await page.evaluate(() => {
    const create = URL.createObjectURL;
    URL.createObjectURL = (o) => ((document.body.dataset.blobType = (o as Blob).type), create(o));
  });
  await page.getByRole('button', { name: /^Save \.lrc/ }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: /^Download / }).click();
  const file = await download;
  // octet-stream: with text/plain, iOS Safari can open the file in place of the page and lose the edits.
  expect(await page.evaluate(() => document.body.dataset.blobType)).toBe('application/octet-stream');
  let text = '';
  for await (const chunk of await file.createReadStream()) text += chunk;
  return { name: file.suggestedFilename(), text };
}

test('empty state: audio and optional lyrics pickers; type lyrics, then Next goes to syncing', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.demo-file label')).toHaveText([/^Audio Choose audio file/, /^Lyrics \(optional\)/]);
  await expect(page.getByText('Load the song and add at least one line to continue.')).toBeVisible(); // why Next is disabled
  await expect(page.getByRole('tab', { name: 'Edit' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tab', { name: 'Lyrics', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.getByLabel('Lyrics text').fill('One\nTwo\n\nThree');
  await page.getByRole('button', { name: /^Next: sync/ }).click();
  await expect(page.getByRole('tab', { name: 'Sync lines' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.lyrics-editor-text')).toHaveText(['One', 'Two', 'Three']);
  await expect(page.getByText('0 of 3 lines synced')).toBeVisible();
  await expect(page.locator('.demo-file label').nth(1)).toContainText('3 typed lines'); // no "no file chosen" contradiction
  await expect(page.getByRole('button', { name: /^Save \.lrc/ })).toBeDisabled(); // nothing synced yet
});

test('view highlights the current line and click seeks the audio', async ({ page }) => {
  await load(page);
  await seek(page, 2.2);
  await expect(page.getByRole('button', { name: 'Second line' })).toHaveAttribute('aria-current', 'true');

  await page.getByRole('button', { name: 'Third line' }).click();
  await expect(page.getByRole('button', { name: 'Third line' })).toHaveAttribute('aria-current', 'true');
  await expect.poll(() => audioTime(page)).toBeCloseTo(3.5, 1);
});

test('full flow: plain text → sync every line → sync words → preview highlights line and word → download', async ({ page }) => {
  await page.goto('/');
  await loadAudio(page);
  await loadLyrics(page, 'song.txt', 'First line\nSecond line here\n\nThird line\nFourth line\n');
  // Plain text opens the editor on Sync lines, explaining there's no timing yet.
  await expect(page.getByRole('tab', { name: 'Edit' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tab', { name: 'Sync lines' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText(/no timing yet/)).toBeVisible();
  // Preview of plain text points back to syncing.
  await page.getByRole('tab', { name: 'Preview' }).click();
  await page.getByRole('button', { name: 'Start syncing →' }).click();
  await expect(page.getByRole('tab', { name: 'Sync lines' })).toHaveAttribute('aria-selected', 'true');

  const stamp = page.getByRole('button', { name: /^(Re-s|S)tamp/ });
  await expect(stamp).toHaveText('Stamp line 1');
  await expect(page.getByLabel('Playback position').locator('..')).toContainText('paused');
  // The demo's own Play button sits right under Stamp (muted first: headless WebKit won't play otherwise).
  await page.locator('audio').evaluate((a: HTMLAudioElement) => (a.muted = true));
  await page.getByRole('button', { name: '▶ Play' }).click();
  await expect(page.getByRole('button', { name: '❚❚ Pause' })).toBeVisible();
  for (let k = 0; k < 4; k++) {
    await expect.poll(() => audioTime(page)).toBeGreaterThan(0.4 + k * 0.9);
    await stamp.click();
    if (k < 3) await expect(stamp).toHaveText(`Stamp line ${k + 2}`);
  }
  await page.getByRole('button', { name: '❚❚ Pause' }).click();
  await expect(page.getByRole('status')).toContainText('All 4 lines synced ✓'); // done card replaces Stamp
  await expect(stamp).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Save \.lrc/ })).toHaveAttribute('data-primary', 'true'); // done: saving is the next step
  await expect(page.locator('.lyrics-editor-time', { hasText: '—' })).toHaveCount(0);

  // Word timing on line 2 (paused; seek, then stamp each word).
  await page.getByRole('tab', { name: 'Sync words' }).click();
  await page.getByRole('button', { name: /Second line here/ }).click();
  await expect(stamp).toHaveText('Stamp “line”'); // word 0 is timed by the line stamp
  await page.locator('.lyrics-editor-chip', { hasText: 'Second' }).click(); // re-time it anyway
  for (const [t, w] of [[1.5, 'Second'], [1.7, 'line'], [1.9, 'here']] as const) {
    await seek(page, t);
    await expect(page.getByLabel('Playback position')).toHaveText(`00:0${t.toFixed(2)}`);
    await expect(stamp).toHaveText(`Stamp “${w}”`);
    await stamp.click();
  }
  await expect(page.getByText('1 of 4 lines have word timing')).toBeVisible();
  // Line finished: playback jumps to the next line's start.
  const third = (await page.locator('.lyrics-editor-row', { hasText: 'Third line' }).locator('.lyrics-editor-time').textContent())!;
  const [mm, ss] = third.split(':');
  await expect.poll(() => page.evaluate(() => document.querySelector('audio')!.currentTime)).toBeCloseTo(+mm * 60 + +ss, 1);

  await page.getByRole('tab', { name: 'Preview' }).click();
  await seek(page, 1.8);
  const current = page.locator('.lyrics-view [aria-current]');
  await expect(current).toHaveText('Second line here');
  await expect(current.locator('.lyrics-upcoming')).toHaveText('here'); // "Second line" sung, "here" not yet

  const { name, text } = await downloadText(page);
  expect(name).toBe('song.lrc');
  for (const l of ['First line', 'Third line', 'Fourth line']) expect(text).toMatch(new RegExp(`^\\[\\d\\d:\\d\\d\\.\\d{2,3}\\]${l}$`, 'm'));
  expect(text).toMatch(/^\[00:01\.50\]<00:01\.50>Second <00:01\.70>line <00:01\.90>here\n\n\[/m); // stanza break kept
});

test('Save menu: Share… sends the .lrc (cancelling keeps "unsaved changes"); Copy puts the LRC on the clipboard', async ({ page }) => {
  // Stub file sharing (the test sets data-cancel to cancel the sheet) and the clipboard.
  await page.addInitScript(() => {
    navigator.canShare = () => true;
    navigator.share = async (data) => {
      const f = data!.files![0];
      document.body.dataset.shared = `${f.name} ${f.type}`;
      if (document.body.dataset.cancel) throw new DOMException('Share canceled', 'AbortError');
    };
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t: string) => void (document.body.dataset.copied = t) } });
  });
  await load(page);
  await page.getByRole('tab', { name: 'Edit' }).click();
  await page.getByRole('button', { name: /^Re-stamp/ }).click();
  const save = page.getByRole('button', { name: /^Save \.lrc/ });
  const share = page.getByRole('button', { name: /^Share…/ });
  await expect(save).toContainText('unsaved changes');

  await save.click();
  await page.getByRole('button', { name: 'Copy the LRC text' }).click();
  await expect(page.getByRole('button', { name: 'Copied ✓' })).toBeVisible();
  await expect(page.locator('body')).toHaveAttribute('data-copied', /^\[ti:Tone\]\n\[00:00\.00\]First line\n/);
  await expect(save).toContainText('unsaved changes'); // the clipboard isn't a save

  await page.evaluate(() => (document.body.dataset.cancel = '1'));
  await share.click();
  await expect(page.locator('body')).toHaveAttribute('data-shared', 'song.lrc application/octet-stream');
  await expect(share).toBeHidden(); // a choice closes the menu
  await expect(save).toContainText('unsaved changes'); // cancelled: still unsaved
  await page.evaluate(() => delete document.body.dataset.cancel);
  await save.click();
  await share.click();
  await expect(save).not.toContainText('unsaved changes');
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

  await page.getByRole('tab', { name: 'Edit' }).click();
  for (const el of await page.locator('.lyrics-editor button, .demo-tabs button, .demo-tabs summary, .demo-transport button').all()) {
    const box = (await el.boundingBox())!;
    expect(Math.min(box.width, box.height), await el.evaluate((e) => e.outerHTML)).toBeGreaterThanOrEqual(44);
  }
  expect(parseFloat(await css('.lyrics-editor-hint', 'font-size'))).toBeGreaterThanOrEqual(12);
});

test('peaks load (waveform drawn across the canvas) and zoom redraws it', async ({ page }) => {
  const warnings: string[] = [];
  page.on('console', (m) => m.type() === 'warning' && warnings.push(m.text()));
  await load(page);
  await page.getByRole('tab', { name: 'Edit' }).click();
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

test('S stamps while a tab button has focus; unsaved edits trigger the beforeunload guard', async ({ page }) => {
  await load(page);
  await page.getByRole('tab', { name: 'Edit' }).click();
  await page.getByRole('tab', { name: 'Edit' }).focus();
  await page.keyboard.press('s');
  await expect(page.locator('.lyrics-editor-time').first()).toHaveText('00:00.00');
  await expect(page.getByRole('button', { name: /^Save \.lrc/ })).toContainText('unsaved changes'); // dirty

  const dialog = new Promise<string>((resolve) => page.once('dialog', (d) => (resolve(d.type()), d.dismiss())));
  await page.close({ runBeforeUnload: true });
  expect(await dialog).toBe('beforeunload');
});

test('tap-along on a phone: the selected line stays clear of the Stamp bar, and Stamp of the pinned audio', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 600 });
  await page.goto('/');
  await loadAudio(page);
  await loadLyrics(page, 'l.txt', Array.from({ length: 20 }, (_, i) => `Line number ${i + 1}`).join('\n'));
  const stamp = page.getByRole('button', { name: /^(Re-s|S)tamp/ });
  const transport = (await page.locator('.demo-transport').boundingBox())!;
  for (let i = 0; i < 19; i++) {
    await stamp.click();
    const sel = (await page.locator('.lyrics-editor-row[aria-current] .lyrics-editor-line').boundingBox())!;
    const btn = (await stamp.boundingBox())!;
    expect(sel.y + sel.height, `after stamp ${i + 1}`).toBeLessThanOrEqual(btn.y);
    expect(btn.y + btn.height, `after stamp ${i + 1}`).toBeLessThanOrEqual(transport.y);
    // Step tabs stick right under the Preview/Edit bar, and the selected line stays below them.
    const nav = (await page.locator('.demo-tabs').boundingBox())!;
    const tabs = (await page.locator('.lyrics-editor-tabs').boundingBox())!;
    expect(Math.abs(tabs.y - (nav.y + nav.height)), `after stamp ${i + 1}`).toBeLessThan(2);
    expect(sel.y, `after stamp ${i + 1}`).toBeGreaterThanOrEqual(tabs.y + tabs.height);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390); // no sideways scroll
});

test('waveform: drag left scrubs forward and seeks once on release; a tap still seeks', async ({ page }) => {
  await load(page);
  await page.getByRole('tab', { name: 'Edit' }).click();
  await seek(page, 1);
  await expect(page.getByLabel('Playback position')).toHaveText('00:01.00'); // the drag starts from what's shown
  const canvas = page.locator('.lyrics-wave canvas');
  const box = (await canvas.boundingBox())!;
  const y = box.y + box.height / 2;
  const x = box.x + box.width * 0.7;
  const pixels = () => canvas.evaluate((c: HTMLCanvasElement) => c.toDataURL());
  const before = await pixels();
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - box.width * 0.2, y, { steps: 5 }); // 20% of the 10 s view = 2 s
  await expect.poll(pixels).not.toBe(before); // the view follows the drag...
  expect(await audioTime(page)).toBeCloseTo(1, 2); // ...but nothing is seeked yet
  await page.mouse.up();
  await expect.poll(() => audioTime(page)).toBeCloseTo(3, 1);

  // Tap without moving: the view spans 0–10 s around 3 s, so 25% across is 2.5 s.
  await page.mouse.click(box.x + box.width * 0.25, y);
  await expect.poll(() => audioTime(page)).toBeCloseTo(2.5, 1);
});

test('waveform: a horizontal touch drag on a phone scrubs (touch-action: pan-y)', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Playwright drives touch drags through CDP, Chromium only');
  await page.setViewportSize({ width: 390, height: 844 });
  await load(page);
  await page.getByRole('tab', { name: 'Edit' }).click();
  await seek(page, 1);
  await expect(page.getByLabel('Playback position')).toHaveText('00:01.00');
  const box = (await page.locator('.lyrics-wave canvas').boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true });
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', x: number) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: type === 'touchEnd' ? [] : [{ x: Math.round(x), y: Math.round(box.y + box.height / 2) }],
    });
  const x = box.x + box.width * 0.7;
  await touch('touchStart', x);
  for (let k = 1; k <= 5; k++) await touch('touchMove', x - (box.width * 0.2 * k) / 5);
  expect(await audioTime(page)).toBeCloseTo(1, 2);
  await touch('touchEnd', 0);
  await expect.poll(() => audioTime(page)).toBeCloseTo(3, 1);
});

test('slow down: 0.5× sets the audio rate and stamps land on the audible time', async ({ page }) => {
  await page.goto('/');
  await loadAudio(page);
  await loadLyrics(page, 'l.txt', 'One\nTwo\n');
  await page.getByLabel('Playback speed').selectOption('0.5');
  await expect.poll(() => page.locator('audio').evaluate((a: HTMLAudioElement) => a.playbackRate)).toBe(0.5);
  await page.locator('audio').evaluate((a: HTMLAudioElement) => (a.muted = true));
  await page.getByRole('button', { name: '▶ Play' }).click();
  await expect.poll(() => audioTime(page)).toBeGreaterThan(1);
  // Stamp and read the audio clock in the same task, so the only slack is the clock's interpolation.
  const [t0, t1] = await page.evaluate(() => {
    const a = document.querySelector('audio')!;
    const t0 = a.currentTime;
    document.querySelector<HTMLButtonElement>('.lyrics-editor-stamp')!.click();
    return [t0, a.currentTime];
  });
  await page.getByRole('button', { name: '❚❚ Pause' }).click();
  const [m, s] = (await page.locator('.lyrics-editor-time').first().textContent())!.split(':').map(Number);
  expect(m * 60 + s).toBeGreaterThanOrEqual(t0 - 0.08);
  expect(m * 60 + s).toBeLessThanOrEqual(t1 + 0.08);
});

test('pasting LRC into the Lyrics box keeps its timing and says so', async ({ page }) => {
  await page.goto('/');
  await loadAudio(page);
  const box = page.getByLabel('Lyrics text');
  await pasteOver(box, LRC);
  await expect(box).toHaveValue('First line\nSecond line\nThird line');
  await expect(page.getByRole('status')).toContainText('Kept the timing of 3 pasted lines ✓');
  await page.getByRole('button', { name: 'Next: check the timing →' }).click();
  await expect(page.locator('.lyrics-editor-time')).toHaveText(['00:00.50', '00:02.00', '00:03.50']);
});

const mute = (page: Page) => page.locator('audio').evaluate((a: HTMLAudioElement) => (a.muted = true)); // headless WebKit won't play unmuted
const paused = (page: Page) => page.locator('audio').evaluate((a: HTMLAudioElement) => a.paused);

test('editor: tapping a stamped line seeks to its exact stamp, same as ▶ Play from here', async ({ page }) => {
  await load(page);
  await page.getByRole('tab', { name: 'Edit' }).click();
  await seek(page, 4.5);
  await page.getByRole('button', { name: /Second line/ }).click();
  await expect.poll(() => audioTime(page)).toBeCloseTo(2, 2); // no rewind
  await seek(page, 4.5);
  await page.getByRole('button', { name: '▶ Play from here' }).click();
  await expect.poll(() => audioTime(page)).toBeCloseTo(2, 2);
});

test('word step: a timed word chip seeks to its stamp; Loop line jumps back to the line start, off = plays on', async ({ page }) => {
  await page.goto('/');
  await loadAudio(page);
  await loadLyrics(page, 'w.lrc', '[00:00.50]First line\n[00:02.00]<00:02.00>Second <00:02.60>line\n[00:03.50]Third line\n');
  await page.getByRole('tab', { name: 'Edit' }).click();
  await page.getByRole('tab', { name: 'Sync words' }).click();
  await page.getByRole('button', { name: /Second line/ }).click();
  await expect.poll(() => audioTime(page)).toBeCloseTo(2, 2);
  await page.locator('.lyrics-editor-chip', { hasText: 'line' }).click();
  await expect.poll(() => audioTime(page)).toBeCloseTo(2.6, 2);

  const loop = page.getByLabel('Loop line');
  await expect(loop).toBeChecked(); // on by default
  await mute(page);
  await seek(page, 3.2);
  await page.locator('.demo-play').click();
  // The line runs 2.0–3.5 s: the only way below 3.2 s is the loop's seek back to 2.0 s.
  await expect.poll(() => audioTime(page), { intervals: [50] }).toBeLessThan(3.2);
  await page.locator('.demo-play').click();

  await loop.uncheck();
  await seek(page, 3.2);
  await page.locator('.demo-play').click();
  await expect.poll(() => audioTime(page)).toBeGreaterThan(3.9); // past the line end, no jump back
  await page.locator('.demo-play').click();
});

test('shortcuts: a clicked button or slider does not swallow S, Enter, ↑/↓, Space; Tab then Enter presses; select and textarea keep keys', async ({ page, browserName }) => {
  await page.goto('/');
  await loadAudio(page);
  await loadLyrics(page, 'l.txt', Array.from({ length: 8 }, (_, i) => `Line ${i + 1}`).join('\n'));
  await mute(page);
  const stamped = page.locator('.lyrics-editor-time', { hasNotText: '—' });
  const current = page.locator('.lyrics-editor-row[aria-current] .lyrics-editor-text');
  const targets = [
    page.getByRole('button', { name: 'Zoom in' }), // the editor's own toolbar
    page.locator('.demo-play'), // the host's Play (starts playback)
    page.getByLabel('Seek'), // slider: native arrows would move it
  ];
  let n = 0;
  for (const target of targets) {
    await target.click();
    const t = await audioTime(page);
    await page.keyboard.press('s');
    await expect(stamped).toHaveCount(++n);
    await expect(current).toHaveText(`Line ${n + 1}`);
    await page.keyboard.press('ArrowUp');
    await expect(current).toHaveText(`Line ${n}`);
    await page.keyboard.press('ArrowDown');
    await expect(current).toHaveText(`Line ${n + 1}`);
    if (await paused(page)) expect(await audioTime(page)).toBeCloseTo(t, 2); // the slider didn't move
    await page.keyboard.press('Enter');
    await expect(stamped).toHaveCount(++n);
    const was = await paused(page);
    await page.keyboard.press(' ');
    await expect.poll(() => paused(page)).toBe(!was);
    await page.keyboard.press(' ');
    await expect.poll(() => paused(page)).toBe(was);
  }
  if (!(await paused(page))) await page.keyboard.press(' ');
  await expect.poll(() => paused(page)).toBe(true);

  // A <select> counts as typing (its keys pick an option): no stamp, no line change.
  const speed = page.getByLabel('Playback speed');
  await speed.focus();
  await page.keyboard.press('s');
  await page.keyboard.press('ArrowUp');
  await expect(stamped).toHaveCount(n);
  await expect(current).toHaveText(`Line ${n + 1}`);
  await speed.selectOption('1');

  // Tab to a button, then Enter activates it (not Stamp): +0.1 s by mouse, then Tab from the row to −0.1 s, Enter.
  // (WebKit doesn't focus a clicked button, so the Tab starts from the row, focused by script.)
  const row = page.getByRole('button', { name: /Line 1/ });
  await row.click();
  const time = page.locator('.lyrics-editor-row[aria-current] .lyrics-editor-time');
  const before = await time.textContent();
  await page.getByRole('button', { name: '+0.1 s' }).click();
  await expect(time).not.toHaveText(before!);
  await row.focus();
  // macOS WebKit (like Safari) only Tabs to buttons with Option held; Linux WebKit takes Alt+Tab as Tab.
  await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab');
  await expect(page.getByRole('button', { name: '−0.1 s' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(time).toHaveText(before!);
  await expect(stamped).toHaveCount(n);

  // Typing in the Lyrics box types.
  await page.getByRole('tab', { name: 'Lyrics', exact: true }).click();
  const box = page.getByLabel('Lyrics text');
  await box.click();
  // Caret to the end by script: Ctrl+End isn't "end of text" on macOS.
  await box.evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(el.value.length, el.value.length));
  await page.keyboard.type('s ');
  await expect(box).toHaveValue(/Line 8s $/);
  expect(await paused(page)).toBe(true);
});

test('preview karaoke: mid-word the active word is part-filled and the current line is enlarged (not under reduced motion)', async ({ page }) => {
  await page.goto('/');
  await loadAudio(page);
  await loadLyrics(page, 'k.lrc', '[00:00.50]First line\n[00:02.00]<00:02.00>Second <00:03.00>line\n[00:04.00]Third line\n');
  await seek(page, 2.5);
  const active = page.locator('.lyrics-view [aria-current] .lyrics-active');
  await expect(active).toHaveText('Second');
  const fill = () => active.evaluate((el) => parseFloat(el.style.getPropertyValue('--lyrics-fill')) / 100);
  await expect.poll(fill).toBeGreaterThan(0.3);
  expect(await fill()).toBeLessThan(0.7);
  expect(await active.evaluate((el) => getComputedStyle(el).backgroundClip || getComputedStyle(el).getPropertyValue('-webkit-background-clip'))).toBe('text');

  const scale = (el: Element) => new DOMMatrix(getComputedStyle(el).transform).a;
  const current = page.locator('.lyrics-view [aria-current]');
  await expect.poll(() => current.evaluate(scale)).toBeGreaterThan(1.03); // word mode
  expect(await page.getByRole('button', { name: 'Third line' }).evaluate(scale)).toBe(1);
  await seek(page, 4.2);
  await expect(current).toHaveText('Third line');
  await expect.poll(() => current.evaluate(scale)).toBeGreaterThan(1.03); // line mode

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await seek(page, 2.5);
  await expect.poll(() => current.evaluate(scale)).toBe(1);
  await expect.poll(fill).toBeGreaterThan(0.3); // the fill still shows progress
});
