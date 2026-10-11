import { type LrcDoc } from './lrc';
/** One <div> per waveform section (label → itunes:song-part), one <p> per stamped line, one <span> per timed word.
 *  Unstamped lines and stamped gaps are not written (a gap only ends the line before it). Throws if nothing is stamped. */
export declare function serializeTtml(doc: LrcDoc, opts?: {
    durationMs?: number;
    lang?: string;
}): string;
