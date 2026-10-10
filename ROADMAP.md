# Roadmap

The spec is `HANDOFF.md`, and it wins over anything here. This file splits it into steps
and fixes the internal contracts so the steps can be built in parallel.

## Principles

- Ponytail: build the least code that meets the spec. No speculative options, no
  abstractions with one user. When a shortcut is deliberate, mark it with a `// ponytail:`
  comment.
- **No new dependencies.** Runtime dependencies: none (React is a peer). Dev dependencies
  are already installed (react, react-dom, typescript, vite 6, vitest 3, jsdom,
  @playwright/test). Do not add more, including @testing-library and
  @vitejs/plugin-react. Component tests use `createRoot` and `act` from React directly.
- Plain CSS with `--lyrics-*` variables. No Tailwind, no CSS-in-JS.
- Tests sit next to the code (`src/foo.test.ts`). Every rule in the handoff gets a test.
- Must pass: `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm e2e` (Chromium and WebKit).

## Shared contracts (do not change without updating this file)

`src/types.ts` holds `Position`, `Peaks`, and `LyricsProps` (already written).

`src/lrc.ts` has no React and no DOM:
```ts
export interface LrcLine { timeMs: number | null; text: string }   // text keeps raw <mm:ss.xx> word tags
export interface LrcDoc { meta: { key: string; value: string }[]; lines: LrcLine[] }
export function parseLrc(input: string): LrcDoc;
export function serializeLrc(doc: LrcDoc): string;
export function displayText(text: string): string;                 // strips word tags
export function setLineTime(line: LrcLine, timeMs: number | null): LrcLine; // shifts word tags by the delta
export function formatTime(ms: number): string;                    // "mm:ss.xx" or "mm:ss.xxx"
```

`src/clock.ts` implements the handoff's timing rules:
```ts
export function usePlaybackTime(position: Position, offsetMs: number, onSeek: (ms: number) => void):
  { audibleMs: number; seek: (audibleTargetMs: number) => void };
// seek(t) calls onSeek(t + offsetMs) and holds the display at t (see "Timing rules").
```
Keep the logic a pure state machine (exported, unit-tested with fake time) plus a thin
hook that drives it with requestAnimationFrame and `visibilitychange`.

`src/peaks.ts`: `peaksFromAudio(src: Blob | ArrayBuffer, msPerBucket = 10): Promise<Peaks>`.
It rejects on decode failure; callers fall back to no peaks.

`src/LyricsView.tsx` and `src/LyricsEditor.tsx` both take `LyricsProps`. Each component
owns its own CSS file (`src/view.css`, `src/editor.css`). `src/styles.ts` imports both as a
separate lib entry, and the Vite lib build emits them as `dist/lyrics.css` (export `./style.css`).
`src/index.ts` has no CSS imports, so the published `.d.ts` stays free of them.

`src/index.ts` exports everything above plus the types.

`demo/` is the standalone app. `demo/decodeText.ts` handles encoding sniffing (BOM, then
UTF-8 fatal, then a windows-1252 fallback).

## Steps

1. **Core** (in parallel)
   - [x] 1a `lrc.ts` and tests for every LRC rule
   - [x] 1b `clock.ts` and tests for every timing rule
   - [x] 1c `peaks.ts` and `demo/decodeText.ts`, with tests
2. **Components** (in parallel, after 1)
   - [x] 2a `<LyricsView>` and `view.css`, with tests
   - [x] 2b `<LyricsEditor>`, the canvas waveform, and `editor.css`, with tests
3. **App and delivery**
   - [x] Demo app: load audio and optionally `.lrc`/`.txt`; `<audio>` wired via `LyricsProps`;
         view/edit toggle; offset setting; export `.lrc`; `beforeunload` guard
   - [x] Playwright e2e on Chromium and WebKit (generate a WAV fixture in the test; don't
         commit binaries)
   - [x] GitHub Actions: typecheck, test, build, check `dist/` is up to date, e2e, deploy the
         demo to Pages from main
   - [x] README: install as a pinned git dependency, host contract, CSS variables
4. [x] **Review**: check spec compliance and over-engineering, fix the findings, rebuild `dist/`.

## Release

`pnpm build`, then commit `dist/`, then `git tag vX.Y.Z`. CI fails if `dist/` is stale.
There is no `prepare` script, because pnpm 10 hosts don't run dependency build scripts.

## v2: understandable editor, word timing, mobile (requested 2026-10-10)

User feedback on v1: "The edit UI doesn't make it clear how it works; I can't get it to work, and I don't
know what to do or how to annotate more than one line." Adding more lines was hidden behind Enter in a
one-row input. v2 overrides the handoff's "karaoke word-by-word display is out of scope": the user wants
all three modes.

### Display modes (`<LyricsView>`), detected per file and per line, with no prop
- **Plain text** (no stamps): scrollable text, no highlight.
- **Line-synced**: as in v1.
- **Word/phrase-synced**: lines with `<mm:ss.xx>` word tags. Inside the current line, words already sung
  get the accent colour and later words stay muted (no per-frame gradient). Untimed words go with the
  timed word before them, which is how phrase timing works. Use `lineWords()` from `lrc.ts`. The line
  still highlights as a whole, as in line mode.

### Editor (`<LyricsEditor>`): explicit steps
A step switcher at the top (a tab bar with ≥44px targets): **1 Lyrics · 2 Sync lines · 3 Sync words (optional)**.
It opens on Lyrics when `lrc` is empty, otherwise on Sync lines.
- **1 Lyrics**: one big `<textarea>`: "Type or paste the lyrics — one line per row; blank line between
  verses." This is where text is edited. On blur or after 500 ms idle, the text becomes lines. Lines whose
  display text is unchanged keep their stamps and word tags (match them with a line LCS/diff, so inserting
  a line doesn't shift every stamp). Each blur or idle period is one undo step. A primary "Next: sync to
  the music →" button.
- **2 Sync lines**: tap-along. A short instruction banner ("Press play, then tap **Stamp** the moment
  each highlighted line starts"). The list of lines, read-only text, each with its time or "—". The *next
  line to stamp* is clearly selected and kept in view. Tapping a line selects it. Selected-line tools
  (−/+ 100 ms, −/+ 10 ms, clear, ▶ play from here) sit next to the selection, not in a far toolbar.
  A large sticky Stamp button whose label names the target ("Stamp line 3"). The waveform is above, with
  line markers. Keys: S or Enter stamps, ↑/↓ select, Ctrl/⌘+Z undo; there are no text fields in this
  step, so shortcuts always work. Show progress ("5 of 23 lines synced"). A plain-text file opens here
  with the banner explaining that it has no timing yet.
- **3 Sync words** (optional): pick a stamped line. Its words are shown as chips. Stamp times the next
  word; finishing a line moves to the next line. Stamping word 0 sets the line time too (word 0's tag =
  line time). Per-line "clear word timing". Use `lineWords`/`joinWords`.
- Undo/redo works across all steps (stamps, nudges and clears: one step each).
- The host contract is unchanged (`LyricsProps`). No play/pause in the component: the host owns
  transport.

### Mobile
Phone width (390 px) first: no horizontal scroll; Stamp and the host's transport reachable with a thumb.
The demo pins its `<audio>` controls and the Stamp button at the bottom on small screens.

### Demo
- **Empty state**: "1 Pick an audio file you own · 2 Optionally pick a .lrc/.txt, or type the lyrics in
  the editor."
- A Preview | Edit tab switch instead of a checkbox. It opens on Edit when there are no lyrics or they
  are plain text.

### Verification
- e2e: plain text → sync every line → sync words on one line → preview highlights the right line and
  word, on Chromium and WebKit.
- `pnpm screenshots` (a Playwright spec, not part of `pnpm e2e`) writes PNGs of the key states at 390×844
  and 1280×800 to `screenshots/` (gitignored, uploaded as a CI artifact). Reviewers look at them for
  first-time-user clarity.
- CI on macOS: on pushes to main, `v*` tags and workflow_dispatch, run the Playwright WebKit project on
  macos-latest, plus a real **Safari** smoke test via `safaridriver` driven over raw W3C WebDriver HTTP
  with `fetch` (no new deps).
