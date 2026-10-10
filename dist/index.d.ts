export type * from './types';
export { LyricsView } from './LyricsView';
export { LyricsEditor, isShortcut } from './LyricsEditor';
export { peaksFromAudio } from './peaks';
export { usePlaybackTime } from './clock';
export { parseLrc, serializeLrc, displayText, setLineTime, formatTime, lineWords, joinWords, type LrcLine, type LrcDoc, type LrcWord, } from './lrc';
