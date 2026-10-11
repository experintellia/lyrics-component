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
  "@experintellia/lyrics": "github:experintellia/lyrics-component#v0.1.1"
}
```

React 19 is a peer dependency. There are no other runtime dependencies.

```ts
import { LyricsView, LyricsEditor, peaksFromAudio } from '@experintellia/lyrics';
import '@experintellia/lyrics/style.css';
import { parseLrc, serializeLrc, lineWords, joinWords } from '@experintellia/lyrics/lrc'; // no React
import { serializeTtml } from '@experintellia/lyrics/ttml'; // no React
```

## TTML export

`serializeTtml(parseLrc(lrc), { durationMs, lang })` turns synced lyrics into [TTML](https://www.w3.org/TR/ttml2/)
in the shape Apple Music uses (export only; there is no TTML import):

- `<tt itunes:timing="Word">` if any line has word tags, else `"Line"`; `xml:lang` from `lang` (empty if not given).
  `[ti:]` becomes `<ttm:title>` and `[ar:]` a `<ttm:agent>` in `<head><metadata>`; other tags are dropped.
- One `<div>` per section, by the same rules as the waveform bands. A label line such as `[Chorus]` becomes
  `itunes:song-part="Chorus"` (namespace `http://music.apple.com/lyric-ttml-internal`, Apple's own).
- One `<p begin end>` per stamped line, ending at the next stamp (a stamped gap ends it and is not written), the
  last one at `durationMs`. Without `durationMs` the last line ends at its trailing word tag, or has no `end`
  (runs to the end of the media). Unstamped lines are skipped; a document with no stamped line throws.
- In a word-timed line, one `<span begin end>` per timed word or syllable, ending at the next one, the trailing
  end tag, or the line's end. Untimed words join the timed span before them (phrase timing); untimed words
  before the first tag start with the line.
- Times are `HH:MM:SS.mmm` (TTML's full clock-time form; Apple's own files often use the shorter `M:SS.mmm`) and
  absolute at every level, as in Apple's files. A strict TTML reader takes a child's `begin` as relative to its
  parent (`par` time containment), so it would place spans late. Out-of-order word tags are clamped into their
  line, so nothing ends before it begins. Characters XML 1.0 can't hold (control characters) are dropped.

Limits: no duet or background-vocal agents per line, no translations, no styling. The demo's ⚙ panel has
"Download .ttml".

## What it shows

`<LyricsView>` picks the display mode from the lyrics themselves, per file and per line. There is no prop:

- **Plain text** (no time tags): scrollable text, nothing highlighted.
- **Line-synced** (`[mm:ss.xx]Line`): the current line is highlighted and kept in view; tapping a line seeks.
- **Word/phrase-synced** (enhanced LRC, `[00:12.00]<00:12.00>Carry <00:12.40>me <00:12.70>home`):
  karaoke inside the current line. Words already sung take the accent colour, upcoming words stay
  muted, and the word being sung fills with the accent from its start edge (right to left in RTL
  text) over its duration: up to the next word's stamp, the trailing end tag (`…home <00:13.50>`),
  the next line's stamp, or for the song's last word `durationMs`. An untimed word goes with the
  timed word before it, so tagging only some words gives phrase timing.

The current line is larger than the others (in both modes; more so in a box 600 px or wider, where all
lyrics get 1.75× the font size) and the word being sung scales up a little from its start and eases back.
Sung lines fade more than upcoming ones. Under `prefers-reduced-motion: reduce` nothing scales or animates; the fill
still shows progress.

A blank line shows as a stanza gap in every mode (in LRC, one blank line after a lyric line is kept).

## Editing

`<LyricsEditor>` walks the user through three steps (tabs at the top):

1. **Lyrics**: one text box, one line per row, a blank line between verses. Opens here when `lrc` is empty.
   Pasting LRC (any line starts with a time tag) works like loading the file: the pasted lines go in at
   the caret (or replace the selection) with their stamps and word tags, its metadata is merged, and a
   notice says "Kept the timing of N pasted lines". One undo step. Plain-text pastes are untouched.
   **↺ 5 s** (bottom bar) seeks back 5 seconds of listening to hear the last bit again while transcribing:
   at `position.rate` 0.5 it reads "↺ 2.5 s" and jumps 2.5 s of the song. Tapping it keeps the caret in
   the text box.
2. **Sync lines**: press play (host transport), then tap **Stamp** as each highlighted line starts.
   The Stamp button names its target ("Stamp line 3", or "Re-stamp line 3" for a line that has a
   time). Tapping a timed line selects it, seeks (via `onSeek`) to its exact stamp, like "▶ Play from
   here", and shows nudge (±0.1 s), "play from here", "back to the first unsynced line" and clear tools.
   A stamp that is too late is fixed by dragging the waveform back or nudging −0.1 s. While the host is
   paused, Stamp is drawn outlined so the host's Play stands out; a stamp that would land out of order
   is flagged (allowed, with a warning). Stamping the last untimed line replaces Stamp with a "done"
   card (back to the start, or on to word timing) until a line is tapped again.
   Opens here when `lrc` has lines, so plain text goes straight to syncing.
3. **Sync words** (optional): tap a line, then Stamp each word as it starts; after the last word the
   next line comes up ("Next line →" skips). Every line shows its progress ("0/7 words", "3/7 words",
   "words ✓"). Tapping a timed word chip selects it and seeks to its stamp (Stamp then re-times it); the play
   button names its target: "▶ Play from “home”" for a timed selected word, else "▶ Play line", and ±0.1 s nudges the selected
   word (nudging the first word also moves the line time). Here the waveform fits the selected line
   (its stamp to the next, plus 0.5 s each side; the zoom buttons only widen it) and shows the words:
   a marker per timed word with an outlined label chip (shortened with "…" or left out when its span is
   too narrow), the untimed words after it as faint text, alternate word spans lightly shaded, the next
   word outlined (or, untimed, flagged at the playhead). **↻ Loop line** (on by default, word step only)
   seeks back to the line start whenever playback passes the line's end; while on, the waveform brackets
   the line and dims the rest, and the status reads "↻ Line 5: …".

**Keyboard shortcuts:** S or Enter stamps, ↑/↓ choose a line (a word in step 3), ←/→ nudge the selected
line (word in step 3) by ±10 ms and Shift+←/→ by ±100 ms (finer than the buttons), Ctrl/⌘+Z undoes,
Ctrl/⌘+Y or Shift+Ctrl/⌘+Z redoes. The rule is "shortcuts work anywhere except while typing": they
are ignored only in a text entry (textarea, text or number input, contenteditable) and in a `<select>`,
whose letters, arrows, Space and Enter all pick an option. A button or slider that was clicked or
tapped doesn't swallow them (they are handled in the capture phase and `preventDefault`ed). Only on a
control reached with the keyboard (`:focus-visible`, e.g. via Tab) do Enter and Space keep their usual
meaning and press it. The same rule is exported as `isShortcut(event)` for the host's own keys; the
demo uses it for Space = play/pause:

```ts
window.addEventListener('keydown', (e) => {
  if (e.key !== ' ' || !isShortcut(e)) return;
  e.preventDefault();
  if (!e.repeat) togglePlay();
}, true); // capture phase, like the editor
```

Editing a line's text in step 1 keeps the stamps of unchanged lines. Undo/redo covers every step.
The sticky bottom bar holds Undo/Redo, Stamp and a status line (playhead, "paused" while the host is
not playing, and progress such as "6 of 16 lines synced" or "Line 5: word 4 of 7"), so it stays
clear where you are. The step tabs are sticky too: if your page has its own sticky header, set
`--lyrics-sticky-top` to its height so the tabs stick right under it. On phones in landscape (viewport ≤ 450px
tall) only the waveform stays pinned and the tabs slide up under that header, so give the header `z-index` ≥ 2. The component has no play button (the host
owns transport): put yours right under it. On phones, set `--lyrics-sticky-bottom` to the height of
any transport bar you pin at the bottom so the Stamp bar sits above it.

In the line steps the waveform stays centred on the playhead and marks each stamp with its line number. Tap it to jump
to that spot, or drag it sideways to scrub like tape (drag left = forward); `onSeek` fires once, on
release. Vertical swipes still scroll the page. Sections are drawn as alternating coloured bands: a
section starts at the first line, after a blank line, or at an unstamped label line such as `[Chorus]`
(the label is shown on the band). The selected line's span (its stamp to the next) is tinted with the
accent colour. For precise stamps, let the user slow playback down and report it as `position.rate`.

## Host contract

```ts
interface LyricsProps {
  lrc: string;                         // LRC or plain text; "" = none
  onChange?: (lrc: string) => void;    // editor only; absent = read-only
  position: { timeMs: number; playing: boolean; durationMs: number; rate?: number }; // rate: default 1
  onSeek: (timeMs: number) => void;    // a request; may take up to ~1 s to apply
  peaks?: { min: Float32Array; max: Float32Array; msPerBucket: number };
  offsetMs?: number;                   // output latency compensation, per device
}
```

- **Remount on track change** with `key={trackId}`: it resets undo, scroll and timing state.
- **Position:** send a new value when it changes (a few times per second while playing, once
  when paused, once when a seek lands). The components interpolate between ticks with
  `requestAnimationFrame` at `rate` × wall time, hold a seek target until the host catches up (or
  1 s passes), and never run backwards on a slightly late tick. Send `rate` if you offer slow-down
  (e.g. `audio.playbackRate`); the speed control is yours, like Play.
- **Offset:** `offsetMs` is latency in wall time, so at playback rate `r` highlighting and stamping
  use `position − offsetMs × r` and seeks request `lineTime + offsetMs × r`. `offsetMs` is never
  written to the LRC.
- **onChange** fires immediately for stamps, nudges, clears and undo, and for text after blur,
  500 ms idle, unmount, `pagehide` or the tab going hidden. Store the result wherever you like; passing it back as `lrc` does not reset the
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
| `--lyrics-section-1` … `-4` | editor's section colours, cycling past 4: waveform bands (made translucent), label chips (white label) and verse edges (as given) | orange, green, purple, yellow |
| `--lyrics-sticky-bottom` | editor's sticky Stamp bar offset from the viewport bottom | `0px` |
| `--lyrics-sticky-top` | editor's sticky head (step tabs, waveform) offset from the viewport top | `0px` |

Fonts are inherited. Auto-scroll is not smooth under `prefers-reduced-motion: reduce`.

In a word-synced current line, words are wrapped in `.lyrics-sung`, `.lyrics-active` and
`.lyrics-upcoming` spans (other lines are plain text). The active word's progress is the
`--lyrics-fill` percentage, written on that span every frame by the component; it's an output to
style against, not a setting. Likewise `--lyrics-head-h` (the editor's sticky head height, written on
`.lyrics-editor` before scrolling a row into view) is set by the component, not by the host.

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
