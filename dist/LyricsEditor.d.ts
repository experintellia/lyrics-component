import type { LyricsProps } from './types';
declare const focusVisible: (el: Element) => boolean;
/** The shortcut rule (the demo's Space uses it too): keys are shortcuts anywhere except while typing in a text
 *  entry. A button or slider focused by a click must not swallow them; only on a keyboard-focused
 *  (:focus-visible) control do Enter and Space keep their native meaning (activate it). A focused <select> counts
 *  as typing: its arrow keys, letters, Space and Enter all pick an option, so it keeps every key. */
export declare function isShortcut(e: KeyboardEvent, isFocusVisible?: typeof focusVisible): boolean;
export declare function LyricsEditor(p: LyricsProps): import("react").JSX.Element;
export {};
