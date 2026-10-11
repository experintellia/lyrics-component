export interface LrcLine {
    timeMs: number | null;
    text: string;
}
export interface LrcDoc {
    meta: {
        key: string;
        value: string;
    }[];
    lines: LrcLine[];
}
export declare function formatTime(ms: number): string;
export declare function displayText(text: string): string;
export interface LrcWord {
    timeMs: number | null;
    text: string;
}
export declare function lineWords(text: string): LrcWord[];
export declare function joinWords(words: LrcWord[]): string;
export declare function setLineTime(line: LrcLine, timeMs: number | null): LrcLine;
/** `from`/`to`: the section's line indices [from, to).
 *  @internal */
export interface Section {
    startMs: number;
    endMs: number;
    label: string;
    from: number;
    to: number;
}
/** Sections start at the first line, after blank lines, or at a label line; each runs from its first stamp
 *  to the next stamp after its lines (the next section's, or a stamped gap's). Sections without stamps are dropped.
 *  @internal */
export declare function sections(lines: LrcLine[], durationMs?: number): Section[];
/** The time a stamped line covers: its stamp up to the next stamp (or the end).
 *  @internal */
export declare function lineSpan(lines: LrcLine[], i: number, durationMs?: number): [number, number] | null;
export declare function parseLrc(input: string): LrcDoc;
export declare function serializeLrc(doc: LrcDoc): string;
