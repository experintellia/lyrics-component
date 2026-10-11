import { StrictMode, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LyricsEditor, LyricsView, displayText, formatTime, isShortcut, parseLrc, peaksFromAudio, type Peaks, type Position } from '../src/index';
// Like a host importing '@experintellia/lyrics/style.css' (src/index.ts has no CSS imports).
import '../src/view.css';
import '../src/editor.css';
import { serializeTtml } from '../src/ttml';
import { decodeText } from './decodeText';
import './demo.css';

declare const __COMMIT__: { hash: string; subject: string };

const OFFSET_KEY = 'lyrics-demo-offset';
// Unsaved lyrics per song, keyed by audio identity (the audio itself isn't kept: re-pick it after a reload).
// Key '' = lyrics typed before any audio was picked. No undo history.
const DRAFTS_KEY = 'lyrics-demo-drafts';
type Draft = { name: string; lrc: string; at: number }; // name: the audio file's
const audioKey = (f: File) => `${f.name}|${f.size}|${f.lastModified}`;
// localStorage may throw (iOS private mode, blocked storage): fail softly.
const tryStorage = <T,>(f: () => T, fallback: T) => {
  try {
    return f();
  } catch {
    return fallback;
  }
};
const readDrafts = (): Record<string, Draft> => tryStorage(() => JSON.parse(localStorage.getItem(DRAFTS_KEY) ?? '{}') || {}, {});
const ago = (t: number) => {
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
};
const isPlain = (lrc: string) => parseLrc(lrc).lines.every((l) => l.timeMs === null);
const clock = (ms: number) => formatTime(ms).slice(0, 5); // mm:ss

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
  const [offsetMs, setOffsetMs] = useState(() => tryStorage(() => Number(localStorage.getItem(OFFSET_KEY)) || 0, 0));
  const [drafts, setDrafts] = useState(readDrafts);
  const newest = Object.entries(drafts).sort(([, a], [, b]) => b.at - a.at);
  const [offer, setOffer] = useState<string | null>(newest[0]?.[0] ?? null); // draft key the Restore prompt offers
  const [restored, setRestored] = useState<string | null>(null); // restored draft's key, until its audio is picked
  const [noStorage, setNoStorage] = useState(false);
  const asking = offer !== null && !!drafts[offer]; // the Restore prompt replaces the editor until answered
  const draftKey = file ? audioKey(file) : (restored ?? '');
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

  // Autosave. ponytail: no debounce of our own: the editor already emits typing after ~500 ms idle, and a
  // stamp is one small write. Never over a draft the Restore prompt still offers (the editor is hidden meanwhile).
  useEffect(() => {
    if (offer === draftKey || !dirty || !lrc.trim() || drafts[draftKey]?.lrc === lrc) return;
    updateDrafts((d) => ({ ...d, [draftKey]: { name: file?.name ?? drafts[draftKey]?.name ?? '', lrc, at: Date.now() } }));
  }, [lrc, draftKey, offer]);
  // Read-modify-write on the stored drafts, not our copy: another tab may have saved one since.
  const updateDrafts = (f: (d: Record<string, Draft>) => Record<string, Draft>) => {
    const d = f(readDrafts());
    setDrafts(d);
    setNoStorage(!tryStorage(() => (localStorage.setItem(DRAFTS_KEY, JSON.stringify(d)), true), false));
  };
  const dropDraft = (k: string) => {
    updateDrafts(({ [k]: _, ...rest }) => rest);
    setOffer((o) => (o === k ? null : o));
  };

  const pickAudio = (f: File) => {
    const k = audioKey(f);
    const conflict = drafts[k] && drafts[k].lrc !== lrc;
    setFile(f);
    setRestored(null); // the restored draft's own file attaches: its draft equals the lyrics, so no offer
    setOffer(conflict ? k : null);
    // Lyrics typed without audio move to this song (autosave writes them under its key).
    if (!conflict && draftKey === '' && drafts['']?.lrc === lrc) dropDraft('');
  };
  const restore = (k: string) => {
    const text = drafts[k].lrc;
    if (file && audioKey(file) !== k) {
      setFile(null); // another song's lyrics: detach this audio, ask for theirs
      setUrl('');
    }
    setLrc(text);
    setSaved(''); // not on disk
    setLyricsName('');
    setLoads((n) => n + 1);
    setTab(isPlain(text) ? 'edit' : 'preview');
    setRestored(k);
    setOffer(null);
  };

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

  const save = (text: string, ext: string, type: string) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
    a.download = (file ? file.name.replace(/\.[^.]*$/, '') : 'lyrics') + ext;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const download = () => {
    save(lrc, '.lrc', 'text/plain');
    setSaved(lrc);
    if (drafts[draftKey]?.lrc === lrc) dropDraft(draftKey); // on disk now
  };
  // An export, not a save: TTML can't be loaded back, so the LRC stays "unsaved".
  const downloadTtml = () => save(serializeTtml(parseLrc(lrc), { durationMs: position.durationMs }), '.ttml', 'application/ttml+xml');

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
              onChange={(e) => e.target.files?.[0] && pickAudio(e.target.files[0])} />
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
        <button
          type="button"
          className="demo-download"
          data-primary={(lines.length > 0 && stamped === lines.length) || undefined}
          disabled={!stamped}
          title={stamped ? undefined : 'Sync at least one line first'}
          onClick={download}
        >
          Download .lrc
          {dirty && stamped > 0 && <small>unsaved changes</small>}
        </button>
        {/* ponytail: offset is a rare per-device setting and TTML a rare export, so they hide behind a disclosure. */}
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
                  tryStorage(() => localStorage.setItem(OFFSET_KEY, String(v)), undefined);
                }}
              />
            </label>
            <small>Positive if the lyrics run ahead of what you hear (e.g. Bluetooth headphones).</small>
            {/* Here, not next to Download .lrc: the nav has no room for it on phones. */}
            <button type="button" disabled={!stamped} onClick={downloadTtml}>Download .ttml</button>
            <small>Timed Text, e.g. for Apple Music. Export only: keep the .lrc to edit later.</small>
            {newest.length > 0 && <small>Unsaved drafts, on this device only:</small>}
            {newest.length > 0 && (
              <ul className="demo-drafts" aria-label="Unsaved drafts">
                {newest.map(([k, d]) => (
                  <li key={k}>
                    <span>{d.name || 'Lyrics without audio'} · {ago(d.at)}</span>
                    <button type="button" aria-label={`Restore draft: ${d.name || 'lyrics without audio'}`} onClick={() => restore(k)}>↺</button>
                    <button type="button" aria-label={`Delete draft: ${d.name || 'lyrics without audio'}`} onClick={() => dropDraft(k)}>✕</button>
                  </li>
                ))}
              </ul>
            )}
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
        {offer !== null && drafts[offer] && (
          <div className="demo-cta">
            <p>
              Restore your lyrics{drafts[offer].name ? <> for <i>{drafts[offer].name}</i></> : ''} (edited {ago(drafts[offer].at)})?
            </p>
            <div className="demo-actions">
              <button type="button" onClick={() => restore(offer)}>Restore</button>
              <button type="button" onClick={() => dropDraft(offer)}>Discard</button>
            </div>
          </div>
        )}
        {!file && restored && drafts[restored] && (
          <p className="demo-hint">Choose <i>{drafts[restored].name}</i> again to play along. The lyrics are restored.</p>
        )}
        {noStorage && <p className="demo-hint">This browser won't save drafts (private mode?): download to keep your work.</p>}
        {/* key: remount on new audio or a loaded lyrics file resets undo, scroll and step, like a host's key={trackId}. */}
        {asking ? null : tab === 'edit' ? (
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
