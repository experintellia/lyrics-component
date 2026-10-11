import type { Position } from './types';
/** All times are in the host's position domain (offset is applied by the hook). */
export interface ClockState {
    tickMs: number;
    arrival: number;
    playing: boolean;
    rate: number;
    floorMs: number;
    seekMs: number | null;
    seekUntil: number;
    fresh: boolean;
}
/** The host's playback rate; 0, NaN or absent count as 1 (e.g. a native player reporting rate 0 while paused). */
export declare const rateOf: (p: Position) => number;
export declare function clockTime(s: ClockState, now: number): number;
export declare function startClock(p: Position, now: number): ClockState;
export declare function tick(s: ClockState, p: Position, now: number): ClockState;
export declare function seekClock(s: ClockState, targetMs: number, now: number): ClockState;
export declare function visibleClock(s: ClockState): ClockState;
export declare function usePlaybackTime(position: Position, offsetMs: number, onSeek: (ms: number) => void): {
    audibleMs: number;
    seek: (audibleTargetMs: number) => void;
};
