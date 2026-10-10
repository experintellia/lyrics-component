import { describe, expect, it } from 'vitest';
import { decodeText } from './decodeText';

const buf = (...bytes: number[]) => new Uint8Array(bytes).buffer;

describe('decodeText', () => {
  it('UTF-8 with BOM (BOM stripped)', () => {
    expect(decodeText(buf(0xef, 0xbb, 0xbf, 0x68, 0xc3, 0xa9))).toBe('hé');
  });
  it('UTF-16LE with BOM', () => {
    expect(decodeText(buf(0xff, 0xfe, 0x68, 0x00, 0xe9, 0x00))).toBe('hé');
  });
  it('UTF-16BE with BOM', () => {
    expect(decodeText(buf(0xfe, 0xff, 0x00, 0x68, 0x00, 0xe9))).toBe('hé');
  });
  it('UTF-8 without BOM', () => {
    expect(decodeText(buf(0x68, 0xc3, 0xa9, 0xe2, 0x82, 0xac))).toBe('hé€');
  });
  it('invalid UTF-8 falls back to windows-1252', () => {
    // 0xE9 alone is invalid UTF-8; é in windows-1252. (Node maps 0x80–0x9F like latin1, browsers per WHATWG; avoid that range here.)
    expect(decodeText(buf(0x68, 0xe9))).toBe('hé');
  });
  it('empty input', () => {
    expect(decodeText(new ArrayBuffer(0))).toBe('');
  });
});
