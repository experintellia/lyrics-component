import type { Peaks } from './types';

/** Min/max across all channels per bucket of `msPerBucket` ms. Pure; unit-tested. */
export function bucketize(channels: Float32Array[], sampleRate: number, msPerBucket: number): Peaks {
  const len = channels[0]?.length ?? 0;
  // ponytail: assumes a bucket holds >= 1 sample (msPerBucket * sampleRate >= 1000); true for any real audio.
  const spb = (sampleRate * msPerBucket) / 1000;
  const n = Math.ceil(len / spb);
  const min = new Float32Array(n);
  const max = new Float32Array(n);
  for (let b = 0; b < n; b++) {
    const start = Math.floor(b * spb);
    const end = Math.min(len, Math.floor((b + 1) * spb));
    let lo = Infinity;
    let hi = -Infinity;
    for (const ch of channels) {
      for (let i = start; i < end; i++) {
        const v = ch[i];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    min[b] = lo;
    max[b] = hi;
  }
  return { min, max, msPerBucket };
}

/**
 * Decode audio with Web Audio and reduce it to peaks; the decoded PCM is dropped on return.
 * Rejects if the engine can't decode it (codec support differs on WebKit) —
 * callers fall back to no peaks. Note: an ArrayBuffer argument gets detached by decodeAudioData.
 */
export async function peaksFromAudio(src: Blob | ArrayBuffer, msPerBucket = 10): Promise<Peaks> {
  const bytes = src instanceof Blob ? await src.arrayBuffer() : src;
  // ponytail: unprefixed OfflineAudioContext only (Safari >= 14.1); no webkitOfflineAudioContext.
  // Decoding resamples to the context's rate; fine for peaks since we bucket by time.
  const audio = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(bytes);
  const channels = Array.from({ length: audio.numberOfChannels }, (_, i) => audio.getChannelData(i));
  return bucketize(channels, audio.sampleRate, msPerBucket);
}
