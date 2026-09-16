import { describe, it, expect } from 'vitest';
import { encodeOpReturn } from '../opreturn';

describe('encodeOpReturn', () => {
  it('returns null for an empty string', () => {
    expect(encodeOpReturn('')).toBeNull();
  });
  it('encodes utf8 into an OP_RETURN script', () => {
    expect(encodeOpReturn('hello')!.length).toBeGreaterThan(2);
  });
  it('rejects payloads over 80 bytes', () => {
    expect(() => encodeOpReturn('x'.repeat(81))).toThrow(/80/);
  });
});
