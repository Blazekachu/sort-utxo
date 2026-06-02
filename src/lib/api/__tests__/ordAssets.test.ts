import { describe, it, expect } from 'vitest';
import { offsetFromSatpoint, outputToAssets } from '../ord';

describe('offsetFromSatpoint', () => {
  it('parses txid:vout:offset', () => {
    expect(offsetFromSatpoint('ea1cf4c7586eb19171b5205c0827cc3fc905d5682267e84ebc2339ac9779c377:0:0')).toBe(0);
    expect(offsetFromSatpoint('420acce8...:3:4126')).toBe(4126);
  });
});

describe('outputToAssets', () => {
  it('maps an inscription with its offset', () => {
    const out = { value: 13685, inscriptions: ['7c16f5d1...i0'], runes: {} };
    const assets = outputToAssets(out, () => 4126);
    expect(assets).toEqual([{ kind: 'inscription', id: '7c16f5d1...i0', offset: 4126 }]);
  });
  it('maps a rune with amount + divisibility', () => {
    const out = { value: 546, inscriptions: [], runes: { DUMMY: { amount: 1000000000, divisibility: 0, symbol: 'd' } } };
    const assets = outputToAssets(out, () => 0);
    expect(assets).toEqual([{ kind: 'rune', name: 'DUMMY', amount: 1000000000n, divisibility: 0 }]);
  });
  it('maps a co-located rune + inscription', () => {
    const out = { value: 546, inscriptions: ['abc...i0'], runes: { PIZZA: { amount: 5, divisibility: 2, symbol: 'p' } } };
    const assets = outputToAssets(out, () => 0);
    expect(assets).toContainEqual({ kind: 'inscription', id: 'abc...i0', offset: 0 });
    expect(assets).toContainEqual({ kind: 'rune', name: 'PIZZA', amount: 5n, divisibility: 2 });
  });
  it('returns [] for a plain output', () => {
    expect(outputToAssets({ inscriptions: [], runes: {} }, () => 0)).toEqual([]);
  });
});
