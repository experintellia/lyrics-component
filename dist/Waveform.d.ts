import { type LrcLine } from './lrc';
import type { Peaks } from './types';
/** Section k's colour; the editor's line list uses it (stronger) to tie each verse to its band. */
export declare const bandColor: (k: number, alpha?: number) => string;
/** `from`/`to`: the section's line indices [from, to). */
export interface Section {
    startMs: number;
    endMs: number;
    label: string;
    from: number;
    to: number;
}
/** Sections start at the first line, after blank lines, or at a label line; each runs from its first stamp
 *  to the next stamp after its lines (the next section's, or a stamped gap's). Sections without stamps are dropped. */
export declare function sections(lines: LrcLine[], durationMs?: number): Section[];
/** The time a stamped line covers: its stamp up to the next stamp (or the end). */
export declare function lineSpan(lines: LrcLine[], i: number, durationMs?: number): [number, number] | null;
/** Canvas waveform (or a plain time ruler without peaks), centred on the audible playhead. */
export declare function Waveform({ peaks, timeMs, lines, onSeek, selected }: {
    peaks?: Peaks;
    timeMs: number;
    lines: LrcLine[];
    onSeek: (audibleMs: number) => void;
    selected?: number;
}): import("react").JSX.Element;
