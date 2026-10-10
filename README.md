# @experintellia/lyrics

React components for **showing** lyrics in sync with playback (`<LyricsView>`) and
**writing and syncing** them against a waveform (`<LyricsEditor>`), plus a React-free LRC
parser/serializer.

**No lyrics fetching, ever.** There is no online lookup and no provider. Lyrics come only from
the user (typed, pasted, loaded file) or from the host. The components don't own audio either:
the host passes the playback position in and receives seek requests out.

Demo (a usable editor in its own right): https://experintellia.github.io/lyrics-component/

## Install

Consumed as a git dependency pinned to a tag (the built `dist/` is committed):

```json
"dependencies": {
  "@experintellia/lyrics": "github:experintellia/lyrics-component#v0.1.0"
}
```

React 19 is a peer dependency. There are no other runtime dependencies.

```ts
import { LyricsView, LyricsEditor, peaksFromAudio } from '@experintellia/lyrics';
import '@experintellia/lyrics/style.css';
import { parseLrc, serializeLrc } from '@experintellia/lyrics/lrc'; // no React
```

## Host contract

```ts
interface LyricsProps {
  lrc: string;                         // LRC or plain text; "" = none
  onChange?: (lrc: string) => void;    // editor only; absent = read-only
  position: { timeMs: number; playing: boolean; durationMs: number };
  onSeek: (timeMs: number) => void;    // a request; may take up to ~1 s to apply
  peaks?: { min: Float32Array; max: Float32Array; msPerBucket: number };
  offsetMs?: number;                   // output latency compensation, per device
}
```

- **Remount on track change** with `key={trackId}`: it resets undo, scroll and timing state.
- **Position:** send a new value when it changes (a few times per second while playing, once
  when paused, once when a seek lands). The components interpolate between ticks with
  `requestAnimationFrame`, hold a seek target until the host catches up (or 1 s passes), and
  never run backwards on a slightly late tick.
- **Offset:** highlighting and stamping use `position − offsetMs`; seeks request
  `lineTime + offsetMs`. `offsetMs` is never written to the LRC.
- **onChange** fires immediately for stamps, nudges, clears and undo, and for text after blur or
  500 ms idle. Store the result wherever you like; passing it back as `lrc` does not reset the
  editor.
- **Peaks** are optional (the editor falls back to a plain time ruler). Browser hosts can use
  `peaksFromAudio(blobOrArrayBuffer)`, which rejects if the engine can't decode the file.
- Convert every lyrics source (including ID3 `SYLT`) to LRC text with millisecond stamps.
  Decoding file bytes to a string is up to you.
- `<LyricsView>` is its own scroll container: give `.lyrics-view` (or its parent) a height.
  An empty `lrc` renders nothing, so the empty state is yours to show.

## Styling

Plain CSS. Set any of these on an ancestor:

| Variable | Used for | Default |
| --- | --- | --- |
| `--lyrics-accent` | current line, stamp button (white label) | inherited text colour / `#2a7ae2` |
| `--lyrics-fg` | text | inherited |
| `--lyrics-bg` | background | transparent |
| `--lyrics-muted` | other lines, borders, hints | `#767676` / `#888` |
| `--lyrics-radius` | corners (0 is fine) | `8px` / `6px` |

Fonts are inherited. Auto-scroll is not smooth under `prefers-reduced-motion: reduce`.

## Development

```sh
pnpm install
pnpm dev          # demo app at localhost:5173
pnpm typecheck
pnpm test         # vitest (jsdom)
pnpm build        # library -> dist/ (committed)
pnpm build:demo   # demo -> demo-dist/
pnpm e2e          # Playwright on Chromium and WebKit, against the built demo
```

## Release

1. Bump `version` in `package.json`.
2. `pnpm build` and commit `dist/` (CI fails if `dist/` is stale).
3. `git tag vX.Y.Z` and push the tag.

There is no `prepare` script on purpose: pnpm 10 hosts don't run dependency build scripts.

## License

MIT OR Apache-2.0, at your option. See `LICENSE-MIT` and `LICENSE-APACHE`.
