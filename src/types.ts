export interface Position {
  timeMs: number;
  playing: boolean;
  durationMs: number;
  /** Playback rate the host is playing at (e.g. 0.5 for slow-down while syncing). Default 1; 0 while paused counts as 1. */
  rate?: number;
}

export interface Peaks {
  min: Float32Array;
  max: Float32Array;
  msPerBucket: number;
}

export interface LyricsProps {
  /** LRC or plain text; "" = none. */
  lrc: string;
  /** Editor only; absent = read-only. */
  onChange?: (lrc: string) => void;
  position: Position;
  /** A request; may take up to ~1 s to apply. */
  onSeek: (timeMs: number) => void;
  peaks?: Peaks;
  /** Output latency compensation, per device. Never written to the file. */
  offsetMs?: number;
}
