import { describe, it, expect } from 'vitest';
import { decodeVarint, parseRunestonePointer, isRunestoneOutput } from '../runestone';

describe('decodeVarint', () => {
  it('decodes single-byte varint', () => {
    const buf = new Uint8Array([0x05]);
    const [value, bytesRead] = decodeVarint(buf, 0);
    expect(value).toBe(5n);
    expect(bytesRead).toBe(1);
  });

  it('decodes multi-byte varint', () => {
    const buf = new Uint8Array([0x80, 0x01]);
    const [value, bytesRead] = decodeVarint(buf, 0);
    expect(value).toBe(128n);
    expect(bytesRead).toBe(2);
  });

  it('decodes varint at offset', () => {
    const buf = new Uint8Array([0xff, 0x03, 0x01]);
    const [value, bytesRead] = decodeVarint(buf, 2);
    expect(value).toBe(1n);
    expect(bytesRead).toBe(1);
  });
});

describe('isRunestoneOutput', () => {
  it('returns true for OP_RETURN OP_13 script', () => {
    expect(isRunestoneOutput('6a5d0102')).toBe(true);
  });

  it('returns false for plain OP_RETURN', () => {
    expect(isRunestoneOutput('6a0102')).toBe(false);
  });

  it('returns false for non-OP_RETURN', () => {
    expect(isRunestoneOutput('76a914')).toBe(false);
  });
});

describe('parseRunestonePointer', () => {
  it('extracts pointer from runestone payload', () => {
    const payload = new Uint8Array([0x16, 0x00]);
    const pointer = parseRunestonePointer(payload);
    expect(pointer).toBe(0);
  });

  it('returns null when no pointer tag present', () => {
    const payload = new Uint8Array([0x02, 0x01]);
    const pointer = parseRunestonePointer(payload);
    expect(pointer).toBeNull();
  });

  it('extracts pointer value of 1', () => {
    const payload = new Uint8Array([0x16, 0x01]);
    const pointer = parseRunestonePointer(payload);
    expect(pointer).toBe(1);
  });

  it('handles payload with multiple tags before pointer', () => {
    const payload = new Uint8Array([0x02, 0x01, 0x04, 0x00, 0x16, 0x02]);
    const pointer = parseRunestonePointer(payload);
    expect(pointer).toBe(2);
  });
});
