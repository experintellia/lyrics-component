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
import { parseLrc, serializeLrc, lineWords, joinWords } from '@experintellia/lyrics/lrc'; // no React
```

## What it shows

`<LyricsView>` picks the display mode from the lyrics themselves, per file and per line. There is no prop:

- **Plain text** (no time tags): scrollable text, nothing highlighted.
- **Line-synced** (`[mm:ss.xx]Line`): the current line is highlighted and kept in view; tapping a line seeks.
- **Word/phrase-synced** (enhanced LRC, `[00:12.00]<00:12.00>Carry <00:12.40>me <00:12.70>home`):
  inside the current line, words already sung take the accent colour and the rest stay muted. An
  untimed word goes with the timed word before it, so tagging only some words gives phrase timing.

A blank line shows as a stanza gap in every mode (in LRC, one blank line after a lyric line is kept).

## Editing

`<LyricsEditor>` walks the user through three steps (tabs at the top):

1. **Lyrics**: one text box, one line per row, a blank line between verses. Opens here when `lrc` is empty.
2. **Sync lines**: press play (host transport), then tap **Stamp** as each highlighted line starts.
   The Stamp button names its target ("Stamp line 3", or "Re-stamp line 3" for a line that has a
   time). Tapping a timed line selects it, rewinds (via `onSeek`) to just before it, and shows nudge
   (±0.1 s), "play from here", "back to the first unsynced line" and clear tools. While the host is
   paused, Stamp is drawn outlined so the host's Play stands out; a stamp that would land out of order
   is flagged (allowed, with a warning). Stamping the last untimed line replaces Stamp with a "done"
   card (back to the start, or on to word timing) until a line is tapped again.
   Keys: S or Enter stamps, ↑/↓ select, Ctrl/⌘+Z undoes. Opens here when `lrc` has lines, so plain
   text goes straight to syncing.
3. **Sync words** (optional): tap a line, then Stamp each word as it starts; after the last word the
   next line comes up ("Next line →" skips). Tap a word chip to re-time from there. Every line shows
   its progress ("0/7 words", "3/7 words", "words ✓").

Editing a line's text in step 1 keeps the stamps of unchanged lines. Undo/redo covers every step.
The sticky bottom bar holds Undo/Redo, Stamp and a status line (playhead, "paused" while the host is
not playing, and progress such as "6 of 16 lines synced" or "Line 5: word 4 of 7"), so it stays
clear where you are. The step tabs are sticky too: if your page has its own sticky header, set
`--lyrics-sticky-top` to its height so the tabs stick right under it. The component has no play button (the host
owns transport): put yours right under it. On phones, set `--lyrics-sticky-bottom` to the height of
any transport bar you pin at the bottom so the Stamp bar sits above it. The waveform marks each
stamp with its line number.

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
| `--lyrics-sticky-bottom` | editor's sticky Stamp bar offset from the viewport bottom | `0px` |
| `--lyrics-sticky-top` | editor's sticky step tabs offset from the viewport top | `0px` |

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
pnpm screenshots  # PNGs of the key UI states (390×844 WebKit, 1280×800 Chromium) -> screenshots/
```

CI runs all of the above on Linux and uploads `screenshots/` as an artifact. On pushes to `main`,
`v*` tags and manual runs, a macOS job also runs the WebKit e2e project and a smoke test in real
**Safari** (`safaridriver`, driven by `e2e/safari.mjs` over plain W3C WebDriver HTTP).

## Release

1. Bump `version` in `package.json`.
2. `pnpm build` and commit `dist/` (CI fails if `dist/` is stale).
3. `git tag vX.Y.Z` and push the tag.

There is no `prepare` script on purpose: pnpm 10 hosts don't run dependency build scripts.

## License

MIT OR Apache-2.0, at your option. See `LICENSE-MIT` and `LICENSE-APACHE`.
