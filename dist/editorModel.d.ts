import { type LrcDoc, type LrcLine } from './lrc';
export type Step = 'lyrics' | 'lines' | 'words';
export type Action = {
    t: 'load';
    doc: LrcDoc;
} | {
    t: 'draft';
    text: string;
} | {
    t: 'commit';
} | {
    t: 'step';
    step: Step;
} | {
    t: 'select';
    i: number;
} | {
    t: 'move';
    d: 1 | -1;
} | {
    t: 'stamp';
    ms: number;
} | {
    t: 'stampWord';
    ms: number;
} | {
    t: 'pickWord';
    w: number;
} | {
    t: 'nudge';
    d: number;
} | {
    t: 'clear';
} | {
    t: 'clearWords';
} | {
    t: 'undo';
} | {
    t: 'redo';
};
export interface State {
    doc: LrcDoc;
    past: LrcDoc[];
    future: LrcDoc[];
    step: Step;
    sel: number;
    word: number;
    draft: string;
    emit: boolean;
}
export declare const hasText: (l: LrcLine | undefined) => boolean;
export declare const docText: (doc: LrcDoc) => string;
/** Words to stamp: lineWords minus a trailing end tag (an empty word, only ever last). */
export declare const words: (l: LrcLine | undefined) => import("./lrc").LrcWord[];
export declare const hasWordTimes: (l: LrcLine) => boolean;
export declare function initState(doc: LrcDoc): State;
/**
 * Textarea text → lines. Lines whose display text is unchanged keep their object (stamp and word tags),
 * matched with an LCS so inserting or removing a line doesn't shift every stamp. In a run of changed
 * lines, an edited line inherits the line time of the old line it replaces (in order), not its word tags.
 * ponytail: O(n·m) LCS table; fine for song-length lyrics.
 */
export declare function applyText(old: LrcLine[], text: string): LrcLine[];
export declare function reducer(s: State, a: Action): State;
