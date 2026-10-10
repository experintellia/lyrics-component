import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LyricsEditor, LyricsView, peaksFromAudio, type Peaks, type Position } from '../src/index';
// Like a host importing '@experintellia/lyrics/style.css' (src/index.ts has no CSS imports).
import '../src/view.css';
import '../src/editor.css';
import { decodeText } from './decodeText';
import './demo.css';

const OFFSET_KEY = 'lyrics-demo-offset';

function App() {
  const audio = useRef<HTMLAudioElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState('');
  const [peaks, setPeaks] = useState<Peaks>();
  const [position, setPosition] = useState<Position>({ timeMs: 0, playing: false, durationMs: 0 });
  const [lrc, setLrc] = useState('');
  const [saved, setSaved] = useState(''); // what's on disk (loaded or downloaded); differs = unsaved edits
  const [edit, setEdit] = useState(false);
  const [offsetMs, setOffsetMs] = useState(() => Number(localStorage.getItem(OFFSET_KEY)) || 0);
  const dirty = lrc !== saved;

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
    setPosition({ timeMs: a.currentTime * 1000, playing: !a.paused, durationMs: a.duration * 1000 || 0 });
  };
  const onSeek = (ms: number) => {
    if (audio.current) audio.current.currentTime = ms / 1000;
  };

  const loadLyrics = async (f: File) => {
    const text = decodeText(await f.arrayBuffer());
    setLrc(text);
    setSaved(text);
  };

  const download = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([lrc], { type: 'text/plain;charset=utf-8' }));
    a.download = (file ? file.name.replace(/\.[^.]*$/, '') : 'lyrics') + '.lrc';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    setSaved(lrc);
  };

  const props = { lrc, position, onSeek, peaks, offsetMs };
  return (
    <>
      <header className="demo-bar">
        <label>
          Audio <input type="file" accept="audio/*" onChange={(e) => e.target.files?.[0] && setFile(e.target.files[0])} />
        </label>
        <label>
          Lyrics <input type="file" accept=".lrc,.txt,text/plain" onChange={(e) => e.target.files?.[0] && loadLyrics(e.target.files[0])} />
        </label>
        <label>
          <input type="checkbox" checked={edit} onChange={(e) => setEdit(e.target.checked)} /> Edit
        </label>
        <label>
          Offset (ms){' '}
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
        <button type="button" disabled={!lrc} onClick={download}>
          Download .lrc{dirty ? ' *' : ''}
        </button>
      </header>
      <audio ref={audio} controls src={url || undefined} onTimeUpdate={sync} onPlay={sync} onPause={sync}
        onSeeked={sync} onDurationChange={sync} />
      <main className="demo-main">
        {/* key: remount on new audio resets undo, scroll and timing state, like a host's key={trackId}. */}
        {edit ? (
          <LyricsEditor key={url} {...props} onChange={setLrc} />
        ) : lrc.trim() ? (
          <div className="demo-view">
            <LyricsView key={url} {...props} />
          </div>
        ) : (
          <p className="demo-empty">Load lyrics, or switch to Edit to type or paste them.</p>
        )}
      </main>
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
