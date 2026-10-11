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

## v2.1: precise syncing (requested 2026-10-10)

- **Drag to seek in the waveform ("tape scrub").** The view stays centred on the playhead. Dragging moves
  the waveform under it, so dragging left goes forward in time, like a mobile audio editor. While dragging,
  the display follows the finger. `onSeek` fires once, on release (host seeks are slow), and the clock's
  seek hold covers the gap. A tap without movement still seeks to the tapped spot. Use pointer events with
  pointer capture. `touch-action: pan-y` keeps vertical page scrolling on touch. The aria-label and title
  explain both gestures.
- **Slow down.** `Position.rate?: number` (default 1) is the only contract change, and it is additive. The
  host owns playback and therefore the speed control, the same way it owns Play.
  - Clock: interpolate at `rate` (`t = lastTick + (now − arrival) × rate`). The cap is still 500 ms of
    wall time.
  - Offset: `offsetMs` is latency in wall time, so `audible = position − offsetMs × rate` and
    `seek → onSeek(t + offsetMs × rate)`.
  - Demo: a speed control in the bottom play bar (1×, 0.75×, 0.5×) sets `audio.playbackRate` (pitch is
    preserved by default) and reports `rate`. The sync step's instruction mentions slowing down for
    precision.
- **Pasting synced lyrics into the Lyrics step works like importing.** If the pasted text is LRC (a line
  starts with a time tag), parse it with `parseLrc` and splice the parsed lines in at the selection,
  keeping their stamps and word tags. Merge its metadata; `[offset]` is baked in by the parser. There is
  no dialog: pasting into an empty box (or over everything selected) is a full import. Show an inline
  notice ("Kept the timing of 12 pasted lines") and make it one undo step. Plain-text pastes behave as
  before.
- **Coloured sections in the waveform.** A section starts at the first line, after a blank line, or at an
  unstamped label line such as `[Chorus]`. It runs from the first stamp in the section to the first
  stamp of the next one (or the end). Draw translucent background bands in a few alternating hues that
  work in light and dark, with the label text (if any) at the top of the band. Also tint the selected
  line's span (its stamp up to the next stamp) with the accent colour, so it's clear which part of the
  song a line covers.

## v2.2: user feedback round 3 (2026-10-10)

1. **Tapping a line seeks to its exact stamp**, the same as "▶ Play from here". Remove the 3 s rewind
   and its hint text ("it rewinds to just before the line"). A stamp that is too late is fixed by dragging
   the waveform back or nudging −0.1 s.
2. **The waveform stays visible while the list scrolls.** Done in v2.1, pinned under the tabs. Keep it
   that way, and keep the selected row scrolling clear of it.
3. **The word step focuses on the selected line's audio.**
   - The waveform view fits the line span (its stamp to the next stamp, plus a small margin) instead of
     the global zoom. The zoom buttons may still widen it.
   - A "Loop line" toggle, on by default and only in the word step: while playing, once audible time
     passes the line's end, `seek(line start)`. Seek only once per pass: the seek hold covers the wait
     for the host.
   - The word-step instruction mentions slowing down.
4. **Words on the waveform** in the word step:
   - each timed word gets a marker labelled with the word;
   - the span between two word stamps is lightly shaded;
   - the next word to stamp is outlined or highlighted.
   - The line step keeps line markers.
5. **Play from a word.** Tapping a timed word chip selects it and seeks to its exact stamp, consistent
   with lines. "▶ Play from here" plays from the selected word, or from the line start if the selected
   word has no timing. ±0.1 s nudges work on the selected word; nudging word 0 also moves the line time.
6. **Shortcuts don't depend on focus.**
   - One rule: shortcuts always work except while typing in a text entry (textarea, text or number
     input, contenteditable).
   - A button or slider focused by a mouse or touch click must not swallow S, Enter, Space or ↑/↓:
     handle these in a capture-phase window listener and `preventDefault` them.
   - Exception: if the focused element `:focus-visible` (reached with the keyboard, via Tab), Enter and
     Space activate it as usual.
   - Keys: S and Enter stamp, ↑/↓ choose a line (or a word in the word step), ←/→ nudge it ±10 ms
     (Shift: ±100 ms; like ↑/↓ they beat a clicked slider's native arrows), Ctrl/⌘+Z undo, Ctrl/⌘+Y
     or Shift+Ctrl/⌘+Z redo. Space plays or pauses in the demo, under the same rule.
   - The hint says "Shortcuts work anywhere except while typing."
   - e2e on both engines covers: after clicking any button or the slider, the keys act as shortcuts;
     Tab then Enter still activates the focused button.
7. **Karaoke word display (`LyricsView`).**
   - Fill: the word being sung fills with the accent from the inline start to the inline end over its
     duration, which runs to the next word's stamp, the trailing end tag, or the next line's stamp.
     Implement it with `background-clip: text` (and `-webkit-` for WebKit) plus a CSS variable for
     progress, set on the active word only via a ref, with no per-frame re-render of the list. In RTL
     text the fill runs right to left.
   - Sung words: fully lit.
   - Upcoming words: muted.
   - Size: the active word scales up slightly (inline-block, transform) and eases back. The current line
     is slightly larger than the others in both line and word mode.
   - `prefers-reduced-motion`: no scale or transitions; the fill still shows progress.
