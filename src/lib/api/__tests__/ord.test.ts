import { describe, it, expect } from 'vitest';
import { labelFromOrdOutput } from '../ord';

describe('labelFromOrdOutput', () => {
  it('returns "inscription" when inscriptions array is non-empty', () => {
    const output = { address: 'bc1p...', inscriptions: ['abc123i0'], runes: {}, value: 546 };
    expect(labelFromOrdOutput(output)).toEqual({ label: 'inscription', inscriptionId: 'abc123i0' });
  });

  it('returns "rune" when runes object is non-empty', () => {
    const output = { address: 'bc1p...', inscriptions: [], runes: { 'ZOBU': { amount: 1000, divisibility: 0 } }, value: 546 };
    expect(labelFromOrdOutput(output)).toEqual({ label: 'rune', runeName: 'ZOBU' });
  });

  it('returns "inscription" when both inscriptions and runes present', () => {
    const output = {
      address: 'bc1p...',
      inscriptions: ['abc123i0'],
      runes: { 'ZOBU': { amount: 1000, divisibility: 0 } },
      value: 546,
    };
    expect(labelFromOrdOutput(output)).toEqual({ label: 'inscription', inscriptionId: 'abc123i0' });
  });

  it('returns "plain" when both empty', () => {
    const output = { address: 'bc1p...', inscriptions: [], runes: {}, value: 50000 };
    expect(labelFromOrdOutput(output)).toEqual({ label: 'plain' });
  });
});
