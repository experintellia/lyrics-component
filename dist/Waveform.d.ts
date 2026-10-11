import { type LrcLine } from './lrc';
import type { Peaks } from './types';
/** Section k's colour for the editor's line list (ties each verse to its band): a host's as given, else the
 * default hue, stronger than its band. */
export declare const bandColor: (k: number) => string;
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
/** The visible [start, span]: centred on the playhead, or (word step) fitted to a line's span plus a margin,
 *  widened by the zoom buttons (`widen` ≥ 1). */
export declare function viewWindow(centreMs: number, spanMs: number, fit?: [number, number] | null, widen?: number): [number, number];
/** One timed word on the waveform: its stamp up to the next word stamp (or the end tag, or `endMs`).
 *  `rest`: the untimed words after it, which share its span (phrase timing, or not stamped yet). */
export interface WordMark {
    startMs: number;
    endMs: number;
    text: string;
    rest: string;
    next: boolean;
}
/** Markers for a line's timed words; `next` flags the word to stamp next (index as in `words()`). */
export declare function wordMarks(text: string, endMs: number, next: number): WordMark[];
/** Canvas waveform (or a plain time ruler without peaks), centred on the audible playhead. */
export declare function Waveform({ peaks, timeMs, lines, onSeek, selected, fit, marks, pending, loop }: {
    peaks?: Peaks;
    timeMs: number;
    lines: LrcLine[];
    onSeek: (audibleMs: number) => void;
    selected?: number;
    fit?: [number, number] | null;
    marks?: WordMark[];
    pending?: string;
    loop?: [number, number] | null;
}): import("react").JSX.Element;
