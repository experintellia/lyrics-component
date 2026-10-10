# Handoff: Lyrics display + editor component

A reusable React component (plus a small standalone web app built on it) for
**showing** lyrics in sync with playback and **writing/syncing** them yourself
against a waveform. A music player app will embed it; it must not depend on
that app.

## What it does

1. **Display** — plain or synced lyrics. Synced: highlight the current line,
   auto-scroll to keep it in view, tap/click a line to seek there. Plain:
   just scrollable text. Pauses auto-scroll while the user scrolls manually,
   resumes after a few seconds.
2. **Editor** — the user transcribes and syncs a song they own:
   - waveform with playhead, zoom, click-to-seek
   - type or paste the text, one line per row
   - "stamp" button (big, thumb-reachable) + keyboard shortcut: sets the
     **selected** line's time to the playhead and selects the next line.
     Stamp-and-advance while listening *is* the tap-along mode
   - nudge a line's time (±10 / ±100 ms), clear a stamp, play from a line
   - import: paste text or load a `.lrc` / `.txt` file; export/save as LRC
3. **LRC parse/serialize** as a plain TS module, usable without React.

## Hard constraints

- **No lyrics fetching. Ever.** No online lookup, no default provider, no
  "search lyrics" button. Lyrics only come from the user (typed, pasted,
  loaded file) or from the host (which reads tags/sidecar files itself).
  This is a legal and app-store requirement, not a missing feature.
- **The component does not own audio.** In the host, playback is native
  (outside the WebView) and the WebView has no audio URL. The host passes
  position in and receives seek requests out — see *Host contract*.
- **The host owns storage.** The component reports edits; the host decides
  where they go (it keeps the file's original lyrics untouched and stores
  edits as a separate user copy — not the component's concern, but don't
  design around overwriting).
- **Runtimes:** desktop browsers, WebKitGTK, iOS WKWebView, Android WebView.
  Test on WebKit, not just Chromium.
- **Minimal dependencies.** React is a peer dependency. Draw the waveform on
  a `<canvas>` yourself; waveform libraries generally want to own the audio
  element.

## Host contract (the important part)

```ts
interface LyricsProps {
  lrc: string;                         // LRC or plain text; "" = none
  onChange?: (lrc: string) => void;    // editor only; absent = read-only
  position: { timeMs: number; playing: boolean; durationMs: number };
  onSeek: (timeMs: number) => void;    // a request; may take up to ~1 s to apply
  peaks?: { min: Float32Array; max: Float32Array; msPerBucket: number };
  offsetMs?: number;                   // output latency compensation, per device
}
// Host remounts with key={trackId} on track change: resets undo, scroll, timing state.
```

The host converts every lyrics source (including binary-timed ID3 `SYLT`) to
LRC text with millisecond stamps before passing it in.

### Position — facts about the real host

- Updates arrive **at most ~4×/s and only while playing**. Paused: one value,
  then nothing. After a seek: **nothing for up to ~1 s** until the seek
  lands. In a browser-based host (`<audio>` `timeupdate`) the rate varies by
  engine (~4×/s typical).
- The native position is a **clock estimate**: it ignores output latency
  (Bluetooth can be hundreds of ms), and after a seek on the streaming path
  it leads the audio by another ~100–200 ms.
- On mobile, WebView JS is **suspended in the background**; on return the
  host pushes fresh state, so expect a large jump.

### Timing rules

- `audibleMs = position − offsetMs`. Highlight and stamp at audible time;
  seek with `onSeek(lineTimeMs + offsetMs)`. `offsetMs` is a per-device
  setting and is **never written to the file**.
- Interpolate with `requestAnimationFrame` while `playing`:
  `t = lastTick + (now − tickArrival)`, capped at `lastTick + 500 ms` in case
  ticks stall. On a new tick: snap if it differs by > 300 ms; if it's behind
  by less, hold instead of running backwards. Paused: use the value exactly.
  Assume playback rate 1.0.
- After `onSeek`, show the target immediately and **hold it** until a tick
  lands within 300 ms of it or 1 s passes — a stale in-flight tick must not
  snap the display back.
- On `visibilitychange` → visible, drop interpolation state and take the
  next value as-is.

### Waveform

`peaks` is the host's path (it computes them natively). If absent, the editor
still works with a plain time ruler. Export a separate
`peaksFromAudio(src): Promise<Peaks>` helper (Web Audio `decodeAudioData`,
downsample, discard PCM) for the standalone app and browser-based hosts. A
5-minute stereo track is ~100 MB decoded and codec support differs on WebKit,
so fail softly. Render only the visible range.

## LRC format

Parse:

- Time tags `[mm:ss]`, `[mm:ss.x]`, `[mm:ss.xx]`, `[mm:ss.xxx]`, and the
  `[mm:ss:xx]` colon variant. Fraction is read by digit count (`.5` =
  `.50` = `.500` = 500 ms). Minutes may exceed 99.
- A file is LRC if at least one line starts with a valid time tag; otherwise
  it's plain text (all lines unstamped).
- Metadata only for lines matching `^\[[a-z#]+:.*\]$` (`ar`, `ti`, `al`,
  `by`, `length`, `offset`, …). Keep unknown tags in order. `[Chorus]`,
  `[Verse 1]` etc. are **text**, not metadata — common in pasted lyrics.
- `[offset:N]`: positive N = lyrics appear earlier (effective = stamp − N).
  Bake it into the times (clamp ≥ 0); the serializer omits the tag.
- Several time tags on one line (repeated chorus) → one line per tag. Not
  merged back on save.
- A time tag with empty text is an **instrumental gap**: clears the
  highlight. Not a blank line to drop.
- Sort stamped lines by time on parse; an unstamped line stays after the
  stamped line that preceded it.
- Enhanced word tags `<mm:ss.xx>`: strip for display, keep in the model.
  When a line's time changes, shift its word tags by the same delta.
- Equal times (duets) → highlight all matching lines.
- `[length:]` is informational; keep it, don't act on it.

Serialize: metadata first, then lines **in model order** (no re-sort while
editing). Write `.xx` when the ms value is a multiple of 10, else `.xxx`, so
no precision is lost. `serialize(parse(x))` must be idempotent (not
necessarily byte-identical to the original file).

Encoding is the standalone app's job (the component takes a string): sniff
BOM (UTF-8, UTF-16 LE/BE), `TextDecoder('utf-8', {fatal: true})`, fall back
to windows-1252. GBK/Shift-JIS are out of scope.

## Editor behaviour

- Keep the parsed model in state; re-parse `lrc` only when it differs from
  the last value the editor emitted. Never round-trip through the string on
  every keystroke.
- Shortcuts only act when no text field has focus (or: separate text and
  sync modes). The stamp button uses `preventDefault` on `pointerdown` so it
  doesn't steal focus or pop up the iOS keyboard.
- Undo/redo: one step per stamp, nudge, or clear; typing grouped per line.
- `onChange`: immediately for stamps/nudges/clears; text after blur or
  ~500 ms idle. The standalone app adds a `beforeunload` guard.
- Stamps beyond `durationMs` are kept but flagged (`durationMs` may be 0
  while loading — don't flag then).

## UI rules

- Touch first: tap targets ≥ 44px; minimum font size 12px.
- Lines: wrap long text (`overflow-wrap: anywhere`), `dir="auto"` per line
  for RTL. Lines are buttons; the current one gets `aria-current`. No
  `aria-live` (it would chatter).
- Empty `lrc` in the display renders nothing; the host owns empty states.
- **Styling: plain CSS, not Tailwind classes** (a host's Tailwind won't scan
  the package). Use namespaced variables with defaults — `--lyrics-accent`,
  `--lyrics-bg`, `--lyrics-fg`, `--lyrics-muted`, `--lyrics-radius` — and let
  the host map them. Radius may be 0. Inherit `font-family`. Scope hover
  styles to `@media (hover: hover)` (touch WebViews leave tapped buttons
  stuck in hover).
- Respect `prefers-reduced-motion` (no smooth auto-scroll).

## Deliverables

1. `lrc.ts` — parse/serialize, with tests for every rule above.
2. `<LyricsView>` — display.
3. `<LyricsEditor>` — editor.
4. `peaksFromAudio()` helper.
5. Standalone Vite app: load an audio file + optional `.lrc`, edit, export.
   It plays through its own `<audio>` element wired up via the same props
   contract — the dev harness and a usable tool in its own right.

Stack to match the host: React 19, TypeScript, Vite 6. ESM build, React as
peer dependency.

## Out of scope (v1)

Fetching lyrics, reading audio file tags, storage/sync, translations,
karaoke word-by-word display, dragging markers on the waveform (nudge +
re-stamp covers it; touch drag vs scroll/zoom is the costliest UI piece).

## License & distribution

- Dual-licensed **MIT OR Apache-2.0**: ship `LICENSE-MIT` and
  `LICENSE-APACHE`, set `"license": "MIT OR Apache-2.0"` in `package.json`.
- Consumed as a **git dependency** (pinned to a tag). **Commit the built
  `dist/`** at each tag, with `exports`/`types` pointing at it. Don't rely
  on a `prepare` script: the host uses pnpm 10, which doesn't run dependency
  build scripts unless they're allowlisted.
