import { describe, it, expect, vi, afterEach } from 'vitest';
import { labelFromOrdOutput, setOrdNetwork, ordBase, parseOrdStatus } from '../ord';

afterEach(() => vi.restoreAllMocks());

describe('labelFromOrdOutput', () => {
  it('returns "inscription" when inscriptions array is non-empty', () => {
    const output = { address: 'bc1p...', inscriptions: ['abc123i0'], runes: {}, value: 546 };
    expect(labelFromOrdOutput(output)).toEqual({ label: 'inscription', inscriptionId: 'abc123i0' });
  });

  it('returns "rune" when runes object is non-empty', () => {
    const output = { address: 'bc1p...', inscriptions: [], runes: { 'ZOBU': { amount: 1000, divisibility: 0 } }, value: 546 };
    expect(labelFromOrdOutput(output)).toEqual({ label: 'rune', runeName: 'ZOBU' });
  });

  it('returns "inscription" primary with runeName when both inscriptions and runes present', () => {
    const output = {
      address: 'bc1p...',
      inscriptions: ['abc123i0'],
      runes: { 'ZOBU': { amount: 1000, divisibility: 0 } },
      value: 546,
    };
    expect(labelFromOrdOutput(output)).toEqual({
      label: 'inscription',
      inscriptionId: 'abc123i0',
      runeName: 'ZOBU',
    });
  });

  it('returns "plain" when both empty', () => {
    const output = { address: 'bc1p...', inscriptions: [], runes: {}, value: 50000 };
    expect(labelFromOrdOutput(output)).toEqual({ label: 'plain' });
  });
});

describe('ord base routing', () => {
  it('uses local ord for a tb1 (testnet) address', () => {
    setOrdNetwork('tb1qqg6r556kx3rdg9jv4gu680averf53y6p8ue5ph');
    expect(ordBase()).toBe('http://127.0.0.1:8080');
  });
  it('uses public ord for a bc1 (mainnet) address', () => {
    setOrdNetwork('bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh');
    expect(ordBase()).toBe('https://ordinals.com');
  });
});

describe('parseOrdStatus', () => {
  it('flags wedged when unrecoverably_reorged', () => {
    expect(parseOrdStatus({ height: 137465, chain: 'testnet4', unrecoverably_reorged: true }))
      .toEqual({ ok: false, reason: 'wedged', height: 137465, chain: 'testnet4' });
  });
  it('reports healthy otherwise', () => {
    expect(parseOrdStatus({ height: 137465, chain: 'testnet4', unrecoverably_reorged: false }))
      .toEqual({ ok: true, height: 137465, chain: 'testnet4' });
  });
});
