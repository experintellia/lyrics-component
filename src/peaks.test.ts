import { describe, expect, it } from 'vitest';
import { bucketize, peaksFromAudio } from './peaks';

// The decode path needs real Web Audio; the e2e covers it.
describe('bucketize', () => {
  it('takes min/max across all channels per bucket', () => {
    // 1000 Hz, 2 ms buckets → 2 samples per bucket; 5 samples → 3 buckets (last partial)
    const left = new Float32Array([0.1, 0.5, -0.2, 0.0, 0.3]);
    const right = new Float32Array([-0.4, 0.2, 0.9, 0.1, 0.25]);
    const p = bucketize([left, right], 1000, 2);
    expect(p.msPerBucket).toBe(2);
    expect(Array.from(p.min)).toEqual([-0.4, -0.2, 0.25].map(Math.fround));
    expect(Array.from(p.max)).toEqual([0.5, 0.9, 0.3].map(Math.fround));
  });

  it('handles fractional samples per bucket without gaps', () => {
    // 44100 Hz, 10 ms → 441 samples; 22050 Hz, 10 ms → 220.5 samples
    const ch = new Float32Array(1000).map((_, i) => i / 1000);
    const p = bucketize([ch], 22050, 10);
    expect(p.min.length).toBe(Math.ceil(1000 / 220.5));
    expect(p.min[0]).toBe(0);
    expect(p.min[1]).toBe(Math.fround(220 / 1000));
    expect(p.max[p.max.length - 1]).toBe(Math.fround(999 / 1000));
  });

  it('returns empty peaks for empty audio', () => {
    expect(bucketize([], 44100, 10).min.length).toBe(0);
  });
});

describe('peaksFromAudio', () => {
  it('rejects when decoding is impossible', async () => {
    await expect(peaksFromAudio(new ArrayBuffer(4))).rejects.toThrow();
  });
});
