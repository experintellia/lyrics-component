// `pnpm screenshots`: walks a first-time user's path and saves each key state to screenshots/.
import { expect, test, type Page } from '@playwright/test';
import { SONG, audioTime, loadAudio, loadLyrics, pasteOver, seek as seekAudio, songLrc, tag } from './fixtures';

// Seek, then wait until the page shows it (the editor's position display, if any) so a stamp lands there.
async function seek(page: Page, s: number) {
  await seekAudio(page, s);
  const now = page.getByLabel('Playback position');
  if (await now.count()) await expect(now).toHaveText(tag(s));
}

const STATES = {
  '01-empty': 'Nothing loaded: audio and optional lyrics pickers, editor step 1 with Next disabled and why.',
  '02-lyrics-step-empty': 'Audio loaded, no lyrics: Edit tab, step 1 Lyrics with an empty text box.',
  '03-lyrics-step-filled': 'Step 1 Lyrics with 16 typed lines in four stanzas.',
  '03b-pasted-lrc': 'Step 1 Lyrics right after pasting a 16-line .lrc over the text: a green notice replaces the how-to and says the timing was kept; Next reads "check the timing".',
  '04-sync-start-plaintext': 'Step 2 Sync lines right after Next: no line has timing yet, line 1 selected, playhead at 0.',
  '05-sync-midway': 'Step 2 Sync lines with lines 1–6 stamped, line 7 selected, playhead at 0:11.6.',
  '05b-sync-fix-line': 'Step 2 Sync lines: the user tapped stamped line 3 to fix it; the playhead rewound to just before it, and its nudge / play / back-to-line-7 / clear tools show.',
  '05c-sync-done': 'Step 2 Sync lines right after stamping the last line: a done card replaces Stamp, Download is primary.',
  '05d-sync-slow': 'Step 2 Sync lines at 0.5× speed after tapping line 6 to fix it: the pinned waveform shows coloured stanza bands (matching the rows\' left edges) and line 6\'s span tinted in the accent colour; line 6\'s tools are in view below.',
  '05e-waveform-drag': 'Same as 05d, mid-drag: the waveform was dragged left (forward in time); a time bubble on the playhead shows where it will land; the seek happens on release.',
  '06-sync-words': 'Step 3 Sync words on line 5: its first three words timed, the fourth next, playhead at 0:08.8.',
  '07-preview-line-synced': 'Preview of line-synced lyrics at 0:09.9: line 6 highlighted.',
  '08-preview-word-synced-midline': 'Preview of word-synced lyrics at 0:10.5: line 6 current, its first four words sung, the last three upcoming.',
  '09-preview-plaintext': 'Preview of plain-text lyrics (no timing): text only, no highlight, with a "Start syncing" call to action.',
};

async function shot(page: Page, state: keyof typeof STATES, mouseAway = true) {
  if (mouseAway) await page.mouse.move(0, 0); // no stray hover highlight from the last click
  await page.screenshot({ path: `screenshots/${state}-${test.info().project.name}.png` });
}

test('key states', async ({ page }) => {
  test.setTimeout(120_000);
  // ponytail: no @types/node; a non-literal specifier keeps tsc from resolving node:fs.
  const { writeFileSync, mkdirSync } = await import('node:' + 'fs');
  mkdirSync('screenshots', { recursive: true });
  writeFileSync(
    'screenshots/INDEX.md',
    Object.entries(STATES)
      .flatMap(([k, v]) => ['phone', 'desktop'].map((p) => `- \`${k}-${p}.png\` (${p === 'phone' ? '390×844' : '1280×800'}): ${v}`))
      .join('\n') + '\n',
  );
  const stamp = page.locator('.lyrics-editor-stamp');

  await page.goto('/');
  await shot(page, '01-empty');

  await loadAudio(page, 30, true);
  await expect(page.getByLabel('Lyrics text')).toBeVisible();
  await shot(page, '02-lyrics-step-empty');

  await page.getByLabel('Lyrics text').fill(SONG);
  await page.getByLabel('Lyrics text').blur();
  await expect(page.locator('.lyrics-editor-progress')).toHaveText('16 lines');
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, '03-lyrics-step-filled');

  await page.getByRole('button', { name: /^Next: sync/ }).click();
  await expect(stamp).toHaveText('Stamp line 1');
  await expect(page.locator('.lyrics-wave canvas')).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, '04-sync-start-plaintext');

  for (let k = 0; k < 6; k++) {
    await seek(page, 1 + 1.75 * k);
    await stamp.click();
  }
  await seek(page, 11.6);
  await expect(stamp).toHaveText('Stamp line 7');
  await shot(page, '05-sync-midway');

  await page.getByRole('button', { name: /I left my coat/ }).click();
  await expect(stamp).toHaveText('Re-stamp line 3');
  await shot(page, '05b-sync-fix-line');

  await page.getByRole('button', { name: /Every road I took/ }).click();
  for (let k = 6; k < 16; k++) {
    await seek(page, 1 + 1.75 * k);
    await stamp.click();
  }
  await expect(page.getByText('All 16 lines synced ✓')).toBeVisible();
  await shot(page, '05c-sync-done');

  await page.getByRole('button', { name: /Leave the lantern burning/ }).click();
  await expect(stamp).toHaveText('Re-stamp line 6');
  await expect.poll(() => audioTime(page)).toBeCloseTo(8, 1); // rewound to line 5
  await page.getByLabel('Playback speed').selectOption('0.5');
  await shot(page, '05d-sync-slow'); // no scroll to top: the pinned waveform and line 6's tools show together

  const box = (await page.locator('.lyrics-wave canvas').boundingBox())!;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * 0.7, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.45, y, { steps: 5 });
  await shot(page, '05e-waveform-drag', false); // moving the mouse away would drag on
  await page.mouse.up();
  await page.getByLabel('Playback speed').selectOption('1');

  await page.getByRole('tab', { name: 'Sync words' }).click();
  await page.getByRole('button', { name: /Carry me home on the evening tide/ }).click();
  for (const t of [8, 8.3, 8.6]) {
    await seek(page, t);
    await stamp.click();
  }
  await seek(page, 8.8);
  await expect(stamp).toHaveText('Stamp “on”');
  await shot(page, '06-sync-words');

  await loadLyrics(page, 'song.lrc', songLrc());
  await seek(page, 9.9);
  await expect(page.locator('.lyrics-view [aria-current]')).toHaveText('Leave the lantern burning by the door');
  await page.waitForTimeout(500); // smooth auto-scroll
  await shot(page, '07-preview-line-synced');

  await loadLyrics(page, 'song-words.lrc', songLrc(true));
  await seek(page, 10.5);
  await expect(page.locator('.lyrics-view [aria-current] .lyrics-upcoming')).toBeVisible();
  await page.waitForTimeout(500);
  await shot(page, '08-preview-word-synced-midline');

  await loadLyrics(page, 'song.txt', SONG);
  await page.getByRole('tab', { name: 'Preview' }).click();
  await expect(page.locator('.lyrics-view')).toBeVisible();
  await shot(page, '09-preview-plaintext');

  // Paste a synced .lrc over the plain text in step 1.
  await page.getByRole('tab', { name: 'Edit' }).click();
  await page.getByRole('tab', { name: 'Lyrics', exact: true }).click();
  await pasteOver(page.getByLabel('Lyrics text'), songLrc());
  await expect(page.getByRole('status')).toContainText('Kept the timing of 16 pasted lines ✓');
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, '03b-pasted-lrc');
});
