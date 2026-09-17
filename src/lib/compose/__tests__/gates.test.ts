import { describe, it, expect } from 'vitest';
import { canComposeFee, canComposeSpend } from '../gates';
import type { ComposeUtxo } from '../types';

function utxo(partial: Partial<ComposeUtxo> & Pick<ComposeUtxo, 'kind' | 'source'>): ComposeUtxo {
  return {
    txid: 'a'.repeat(64),
    vout: 0,
    value: 1000,
    confirmed: true,
    address: 'tb1qtest',
    addressKind: 'p2wpkh',
    assets: [],
    satRanges: null,
    ...partial,
  };
}

describe('canComposeSpend', () => {
  it('allows a confirmed plain UTXO even when satRanges are missing', () => {
    expect(canComposeSpend(utxo({ kind: 'plain', source: 'payment', satRanges: null }))).toBe(true);
  });

  it('allows a confirmed inscription UTXO without satRanges', () => {
    expect(canComposeSpend(utxo({ kind: 'inscription', source: 'taproot', satRanges: null }))).toBe(true);
  });

  it('refuses rune, unknown, and unconfirmed UTXOs', () => {
    expect(canComposeSpend(utxo({ kind: 'rune', source: 'taproot' }))).toBe(false);
    expect(canComposeSpend(utxo({ kind: 'unknown', source: 'taproot' }))).toBe(false);
    expect(canComposeSpend(utxo({ kind: 'plain', source: 'payment', confirmed: false }))).toBe(false);
  });
});

describe('canComposeFee', () => {
  it('allows a plain payment UTXO without satRanges', () => {
    expect(canComposeFee(utxo({ kind: 'plain', source: 'payment', satRanges: null }))).toBe(true);
  });

  it('refuses taproot even when plain', () => {
    expect(canComposeFee(utxo({ kind: 'plain', source: 'taproot' }))).toBe(false);
  });
});
