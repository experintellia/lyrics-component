import type { Peaks } from './types';
/** Min/max across all channels per bucket of `msPerBucket` ms. Pure; unit-tested. */
export declare function bucketize(channels: Float32Array[], sampleRate: number, msPerBucket: number): Peaks;
/**
 * Decode audio with Web Audio and reduce it to peaks; the decoded PCM is dropped on return.
 * Rejects if the engine can't decode it (codec support differs on WebKit) —
 * callers fall back to no peaks. Note: an ArrayBuffer argument gets detached by decodeAudioData.
 */
export declare function peaksFromAudio(src: Blob | ArrayBuffer, msPerBucket?: number): Promise<Peaks>;
