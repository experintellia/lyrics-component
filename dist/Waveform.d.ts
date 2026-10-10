import { type LrcLine } from './lrc';
import type { Peaks } from './types';
/** Canvas waveform (or a plain time ruler without peaks), centred on the audible playhead. */
export declare function Waveform({ peaks, timeMs, lines, onSeek }: {
    peaks?: Peaks;
    timeMs: number;
    lines: LrcLine[];
    onSeek: (audibleMs: number) => void;
}): import("react").JSX.Element;
