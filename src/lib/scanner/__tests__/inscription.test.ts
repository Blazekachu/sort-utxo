import { describe, it, expect } from 'vitest';
import { hasInscriptionEnvelope } from '../inscription';

describe('hasInscriptionEnvelope', () => {
  it('detects inscription envelope in witness hex array', () => {
    const witnessWithEnvelope = [
      'deadbeef',
      '20' + 'aa'.repeat(32) + 'ac' + '0063' + '03' + '6f7264' + '01' + '09' + '746578742f706c61696e' + '00' + '05' + '68656c6c6f' + '68',
      'c0' + 'bb'.repeat(32),
    ];
    expect(hasInscriptionEnvelope(witnessWithEnvelope)).toBe(true);
  });

  it('returns false for witness without envelope', () => {
    const witness = ['304402aabb', '02' + 'aa'.repeat(33)];
    expect(hasInscriptionEnvelope(witness)).toBe(false);
  });

  it('returns false for empty witness', () => {
    expect(hasInscriptionEnvelope([])).toBe(false);
  });
});
