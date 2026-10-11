import { StrictMode, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LyricsEditor, LyricsView, displayText, formatTime, isShortcut, parseLrc, peaksFromAudio, type Peaks, type Position } from '../src/index';
// Like a host importing '@experintellia/lyrics/style.css' (src/index.ts has no CSS imports).
import '../src/view.css';
import '../src/editor.css';
import { decodeText } from './decodeText';
import './demo.css';

declare const __COMMIT__: { hash: string; subject: string };

const OFFSET_KEY = 'lyrics-demo-offset';
const isPlain = (lrc: string) => parseLrc(lrc).lines.every((l) => l.timeMs === null);
const clock = (ms: number) => formatTime(ms).slice(0, 5); // mm:ss
// octet-stream, not text/plain: a type the browser can't display is always saved. With text/plain, iOS Safari may
// offer "View" or ignore `download` and open the text in this tab (dropping the page and its edits), and it saves
// it as .lrc.txt.
const lrcFile = (text: string, name: string) => new File([text], name, { type: 'application/octet-stream' });
// Share… only where the Web Share API can share files (iOS/macOS Safari; Android Chrome won't share .lrc).
const canShareLrc = !!navigator.canShare?.({ files: [lrcFile('', 'x.lrc')] });
// Save menu icons: strokes in the text colour (glyphs like ⤓ differ by platform; emoji ignore the colour).
const icon = (d: string) => (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

function App() {
  const audio = useRef<HTMLAudioElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState('');
  const [peaks, setPeaks] = useState<Peaks>();
  const [position, setPosition] = useState<Position>({ timeMs: 0, playing: false, durationMs: 0 });
  const [lrc, setLrc] = useState('');
  const [lyricsName, setLyricsName] = useState(''); // loaded lyrics file, '' = typed
  const [saved, setSaved] = useState(''); // what's on disk (loaded or downloaded); differs = unsaved edits
  const [loads, setLoads] = useState(0); // lyrics files loaded; part of the editor key
  const [tab, setTab] = useState<'preview' | 'edit'>('edit'); // no lyrics yet: edit
  const [saveMenu, setSaveMenu] = useState(false);
  const [copied, setCopied] = useState(''); // Copy's result, shown on the button until the menu closes
  const [offsetMs, setOffsetMs] = useState(() => Number(localStorage.getItem(OFFSET_KEY)) || 0);
  const dirty = lrc !== saved;
  const lines = useMemo(() => parseLrc(lrc).lines.filter((l) => displayText(l.text)), [lrc]);
  const stamped = lines.filter((l) => l.timeMs !== null).length;

  // New audio: fresh object URL and peaks in the background. No peaks = plain ruler.
  useEffect(() => {
    setPeaks(undefined);
    if (!file) return;
    const u = URL.createObjectURL(file);
    setUrl(u);
    let live = true;
    peaksFromAudio(file).then(
      (p) => live && setPeaks(p),
      (e) => console.warn(e), // fail softly: the editor works without a waveform
    );
    return () => {
      live = false;
      URL.revokeObjectURL(u);
    };
  }, [file]);

  useEffect(() => {
    if (!dirty) return;
    const guard = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [dirty]);

  const sync = () => {
    const a = audio.current!;
    setPosition({ timeMs: a.currentTime * 1000, playing: !a.paused, durationMs: a.duration * 1000 || 0, rate: a.playbackRate });
  };
  const onSeek = (ms: number) => {
    if (audio.current) audio.current.currentTime = ms / 1000;
  };
  const toggle = () => {
    const a = audio.current!;
    if (a.paused) a.play().catch((e) => console.warn(e));
    else a.pause();
  };
  // Space = play/pause, by the editor's shortcut rule: anywhere except while typing; a keyboard-focused
  // (:focus-visible) button keeps Space. Capture phase, so a clicked button or slider can't take it first.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key !== ' ' || !audio.current?.src || !isShortcut(e)) return;
      e.preventDefault();
      if (!e.repeat) toggle();
    };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, []);

  const loadLyrics = async (f: File) => {
    const text = decodeText(await f.arrayBuffer());
    setLrc(text);
    setSaved(text);
    setLyricsName(f.name);
    setLoads((n) => n + 1);
    setTab(isPlain(text) ? 'edit' : 'preview'); // plain text needs syncing first
  };

  // Save menu: Download, Share… (the share sheet never leaves the page and resolves only once the file went
  // somewhere, so cancelling keeps "unsaved changes"), Copy (the clipboard isn't a save: still unsaved).
  const lrcName = (file ? file.name.replace(/\.[^.]*$/, '') : 'lyrics') + '.lrc';
  const toggleSaveMenu = (open: boolean) => {
    setSaveMenu(open);
    setCopied('');
  };
  const download = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(lrcFile(lrc, lrcName));
    a.download = lrcName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 40_000); // iOS asks "Download?" first; the URL must outlive that
    setSaved(lrc); // ponytail: a link can't tell if that prompt was cancelled; Share can
    toggleSaveMenu(false);
  };
  const share = () => {
    navigator.share({ files: [lrcFile(lrc, lrcName)] }).then(() => setSaved(lrc), (e) => console.warn(e)); // rejected: cancelled
    toggleSaveMenu(false);
  };
  const copy = () => navigator.clipboard.writeText(lrc).then(() => setCopied('Copied ✓'), () => setCopied('Copy failed'));

  const props = { lrc, position, onSeek, peaks, offsetMs };
  // Typing lyrics doesn't end the empty state: collapsing the header on the textarea's blur would move Next
  // out from under the finger between pointerdown and click.
  const fresh = !file && !loads;
  const count = `${lines.length} ${stamped === lines.length ? 'timed ' : lyricsName ? '' : 'typed '}line${lines.length === 1 ? '' : 's'}${
    stamped && stamped < lines.length ? `, ${stamped} timed` : ''}`;
  const lyricsInfo = lyricsName ? `${lyricsName} · ${count}` : lines.length ? count : fresh ? '(optional)' : 'none yet';
  return (
    <>
      {/* Empty state: a short how-to. Once something is loaded it shrinks to one compact row. */}
      <header className="demo-files" data-fresh={fresh || undefined} data-preview={tab === 'preview' || undefined}>
        {fresh && <h1>Sync lyrics to a song</h1>}
        <div className="demo-file">
          <label>
            <span className="demo-file-kind">Audio</span> <span className="demo-file-name">{file ? `♪ ${file.name}` : ''}</span>
            <span className="demo-pick">{file ? 'Change' : 'Choose audio file…'}</span>
            {/* Extensions, not audio/*: iOS Safari maps audio/* to movies only, greying out mp3s in Files. */}
            <input type="file" className="demo-sr" aria-label="Audio file" accept=".mp3,.m4a,.aac,.wav,.ogg,.oga,.opus,.flac"
              onChange={(e) => e.target.files?.[0] && setFile(e.target.files[0])} />
          </label>
          {fresh && <small>An audio file you own. It stays on this device.</small>}
        </div>
        <div className="demo-file">
          <label>
            <span className="demo-file-kind">Lyrics</span> <span className="demo-file-name">{lyricsInfo}</span>
            <span className="demo-pick">{fresh ? 'Load .lrc or .txt…' : 'Load file…'}</span>
            <input type="file" className="demo-sr" aria-label="Lyrics file" accept=".lrc,.txt,text/plain"
              onChange={(e) => e.target.files?.[0] && loadLyrics(e.target.files[0])} />
          </label>
          {fresh && <small>Or type or paste them in the editor below.</small>}
        </div>
      </header>

      <nav className="demo-tabs">
        <div role="tablist" aria-label="Mode">
          {(['preview', 'edit'] as const).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
              {t === 'preview' ? 'Preview' : 'Edit'}
            </button>
          ))}
        </div>
        {/* ponytail: closes on a choice or a second tap, not on a tap elsewhere (like ⚙). */}
        <div className="demo-save">
          <button
            type="button"
            className="demo-download"
            aria-expanded={saveMenu}
            data-primary={(lines.length > 0 && stamped === lines.length) || undefined}
            disabled={!stamped}
            title={stamped ? undefined : 'Sync at least one line first'}
            onClick={() => toggleSaveMenu(!saveMenu)}
          >
            Save .lrc ▾
            {dirty && stamped > 0 && <small>unsaved changes</small>}
          </button>
          {saveMenu && stamped > 0 && ( // hidden too once Save is disabled (e.g. a plain .txt loaded meanwhile)
            <div className="demo-more-panel">
              <button type="button" onClick={download}>
                {icon('M12 3v12m-5-5 5 5 5-5M5 21h14')} Download {lrcName}
              </button>
              {canShareLrc && (
                <button type="button" onClick={share}>
                  {icon('M12 15V3M8 7l4-4 4 4M8 11H6v10h12V11h-2')} Share…
                </button>
              )}
              {navigator.clipboard && (
                <button type="button" onClick={copy}>
                  {icon('M9 9h11v11H9zM5 15H4V4h11v1')} {copied || 'Copy the LRC text'}
                </button>
              )}
            </div>
          )}
        </div>
        {/* ponytail: offset is a rare per-device setting, so it hides behind a disclosure. */}
        <details className="demo-more">
          <summary aria-label="Settings" title="Settings">
            ⚙<span className="demo-wide"> Settings</span>
          </summary>
          <div className="demo-more-panel">
            <label>
              Audio delay (ms){' '}
              <input
                type="number"
                step={10}
                value={offsetMs}
                onChange={(e) => {
                  const v = Number(e.target.value) || 0;
                  setOffsetMs(v);
                  localStorage.setItem(OFFSET_KEY, String(v));
                }}
              />
            </label>
            <small>Positive if the lyrics run ahead of what you hear (e.g. Bluetooth headphones).</small>
            {__COMMIT__.hash && (
              <small>
                Version{' '}
                <a href={`https://github.com/experintellia/lyrics-component/commit/${__COMMIT__.hash}`}>
                  {__COMMIT__.hash.slice(0, 7)}
                </a>
              </small>
            )}
          </div>
        </details>
      </nav>

      <main className="demo-main">
        {/* key: remount on new audio or a loaded lyrics file resets undo, scroll and step, like a host's key={trackId}. */}
        {tab === 'edit' ? (
          <LyricsEditor key={`${url}|${loads}`} {...props} onChange={setLrc} />
        ) : lrc.trim() ? (
          <>
            {isPlain(lrc) && (
              <div className="demo-cta">
                <p>
                  <b>These lyrics aren't synced yet.</b> Sync them to the music to get line-by-line highlighting
                  (word-by-word is optional). It takes one play-through: tap Stamp as each line starts.
                </p>
                <button type="button" onClick={() => setTab('edit')}>Start syncing →</button>
              </div>
            )}
            {!isPlain(lrc) && (
              <p className="demo-hint">Tap a line to jump there. Wrong time? Open Edit and tap that line.</p>
            )}
            <div className="demo-view">
              <LyricsView key={url} {...props} />
            </div>
          </>
        ) : (
          <p className="demo-empty">No lyrics yet. Load a lyrics file, or type them in Edit.</p>
        )}
      </main>
      {/* The host's transport, pinned to the bottom; the editor's sticky Stamp bar sits right above it
          (--lyrics-sticky-bottom). Our own controls: native ones look disabled and hide Play on phones. */}
      <div className="demo-transport" hidden={!url}>
        <audio ref={audio} src={url || undefined} onTimeUpdate={sync} onPlay={sync} onPause={sync}
          onSeeked={sync} onDurationChange={sync} onRateChange={sync} />
        {/* Paused: Play is the primary button (the editor's Stamp steps back), so it's pressed first. */}
        <button type="button" className="demo-play" onClick={toggle} aria-keyshortcuts="Space" title="Play/pause (Space)"
          data-primary={!position.playing || undefined}>
          {position.playing ? '❚❚ Pause' : '▶ Play'}
          <kbd className="demo-key" aria-hidden="true">Space</kbd>
        </button>
        {/* Slow down for precise stamps. Pitch is preserved by default. defaultPlaybackRate too, so the speed
            survives loading another file (a new src resets playbackRate to it). */}
        <select className="demo-speed" aria-label="Playback speed" title="Playback speed" value={position.rate ?? 1}
          data-slow={(position.rate ?? 1) !== 1 || undefined}
          onChange={(e) => {
            const a = audio.current!;
            a.defaultPlaybackRate = a.playbackRate = +e.target.value;
          }}>
          {[1, 0.75, 0.5].map((r) => <option key={r} value={r}>{r}×</option>)}
        </select>
        <input type="range" aria-label="Seek" min={0} max={position.durationMs} step={100} value={position.timeMs}
          onChange={(e) => onSeek(+e.target.value)} />
        <span className="demo-time">{clock(position.timeMs)}<span className="demo-dur"> / {clock(position.durationMs)}</span></span>
      </div>
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
