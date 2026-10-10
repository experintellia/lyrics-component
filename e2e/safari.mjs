// Real-Safari smoke test over raw W3C WebDriver HTTP (no deps). Run by the CI macos job:
//   sudo safaridriver --enable; vite preview --port 4173 &; safaridriver -p 4444 &; node e2e/safari.mjs
// Not a Playwright spec (no .spec suffix), so `pnpm e2e` ignores it.
const WD = process.env.WEBDRIVER_URL ?? 'http://localhost:4444';
const APP = process.env.APP_URL ?? 'http://localhost:4173/';
const ELEMENT = 'element-6066-11e4-a52e-4f735466cecf'; // W3C web element reference key

const LRC = [
  '[00:00.50]First line',
  '[00:01.50]Second line',
  '[00:02.50]<00:02.50>Third <00:03.00>line words',
  '[00:03.50]Fourth line',
].join('\n');

// Builds a 4 s WAV (16-bit PCM mono 8 kHz, 440 Hz with varying amplitude) and hands it and the LRC
// to the demo's file inputs, found by their <label> text ("Audio", "Lyrics").
const LOAD_FILES = `
  const rate = 8000, n = rate * 4, v = new DataView(new ArrayBuffer(44 + n * 2));
  const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVEfmt '); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const amp = 0.1 + 0.8 * Math.abs(Math.sin((Math.PI * i) / rate));
    v.setInt16(44 + i * 2, Math.round(amp * 32767 * Math.sin((2 * Math.PI * 440 * i) / rate)), true);
  }
  const put = (label, file) => {
    const l = [...document.querySelectorAll('label')].find((l) => l.textContent.trim().startsWith(label));
    const input = l && (l.control || l.querySelector('input[type=file]'));
    if (!input) throw new Error('no file input in a <label> starting with "' + label + '"');
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };
  put('Audio', new File([v.buffer], 'tone.wav', { type: 'audio/wav' }));
  put('Lyrics', new File([arguments[0]], 'song.lrc', { type: 'text/plain' }));
`;

let s = ''; // '/session/<id>' once created
async function wd(method, path, body) {
  const res = await fetch(WD + path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body && JSON.stringify(body),
  });
  const { value } = await res.json();
  if (!res.ok) throw new Error(`${method} ${path} -> ${value?.error}: ${value?.message}`);
  return value;
}
const exec = (script, args = []) => wd('POST', s + '/execute/sync', { script, args });
const click = (el) => wd('POST', `${s}/element/${el[ELEMENT]}/click`, {});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Polls `script` (returns true when done, anything else is reported on timeout) for up to 10 s.
async function until(what, script, args) {
  let last;
  for (const end = Date.now() + 10_000; Date.now() < end; await sleep(200)) {
    if ((last = await exec(script, args)) === true) return console.log(`ok - ${what}`);
  }
  throw new Error(`timed out: ${what} (last value: ${JSON.stringify(last)})`);
}

async function main() {
  s = '/session/' + (await wd('POST', '/session', { capabilities: { alwaysMatch: { browserName: 'safari' } } })).sessionId;
  await wd('POST', s + '/url', { url: APP });
  await until('demo rendered its file inputs', `return document.querySelectorAll('label input[type=file]').length >= 2`);
  await exec(LOAD_FILES, [LRC]);

  await until('Safari decoded the WAV (duration ≈ 4 s)',
    `const d = document.querySelector('audio')?.duration; return Math.abs(d - 4) < 0.1 || String(d)`);

  const tab = await exec(`return [...document.querySelectorAll('[role=tab]')].find((t) => t.textContent.trim().startsWith('Preview')) || null`);
  if (tab) await click(tab);
  const LINES = '.lyrics-view button.lyrics-line';
  await until('preview shows 4 lyric lines', `return document.querySelectorAll('${LINES}').length === 4 || document.querySelectorAll('${LINES}').length`);

  const lines = await wd('POST', s + '/elements', { using: 'css selector', value: LINES });
  await click(lines[1]);
  await until('clicking line 2 seeks to ≈1.5 s',
    `const t = document.querySelector('audio').currentTime; return Math.abs(t - 1.5) <= 0.3 || t`);

  await exec(`document.querySelector('audio').currentTime = 2.75`);
  await until('word-tagged line is current at 2.75 s',
    `const c = document.querySelector('.lyrics-view [aria-current]'); return !!c?.textContent.includes('Third') || (c ? c.textContent : null)`);
}

try {
  await main();
  console.log('Safari smoke test passed');
} catch (e) {
  console.error(`Safari smoke test FAILED: ${e.message}`);
  process.exitCode = 1;
} finally {
  if (s) await wd('DELETE', s).catch((e) => console.error(`could not delete session: ${e.message}`));
}
