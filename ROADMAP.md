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
