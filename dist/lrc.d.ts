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
export declare function setLineTime(line: LrcLine, timeMs: number | null): LrcLine;
export declare function parseLrc(input: string): LrcDoc;
export declare function serializeLrc(doc: LrcDoc): string;
