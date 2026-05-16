import { describe, it, expect } from 'vitest';
import { computeSortOutputs, validateSortInputs } from '../sort';
import type { LabeledUtxo } from '@/types';

function makeLabeledUtxo(overrides: Partial<LabeledUtxo> & Pick<LabeledUtxo, 'label' | 'source' | 'value'>): LabeledUtxo {
  return {
    txid: 'a'.repeat(64),
    vout: 0,
    status: { confirmed: true },
    ...overrides,
  };
}

describe('computeSortOutputs', () => {
  it('moves a rune UTXO from payment to taproot with 546 sats', () => {
    const utxos: LabeledUtxo[] = [
      makeLabeledUtxo({ label: 'rune', source: 'payment', value: 546 }),
    ];
    const outputs = computeSortOutputs(utxos, 'bc1ptaproot', 'bc1qpayment');
    expect(outputs).toEqual([
      { address: 'bc1ptaproot', value: 546n },
    ]);
  });

  it('moves a plain UTXO from taproot to payment', () => {
    const utxos: LabeledUtxo[] = [
      makeLabeledUtxo({ label: 'plain', source: 'taproot', value: 50000 }),
    ];
    const outputs = computeSortOutputs(utxos, 'bc1ptaproot', 'bc1qpayment');
    expect(outputs).toEqual([
      { address: 'bc1qpayment', value: 50000n },
    ]);
  });

  it('creates separate outputs for each rune/inscription UTXO (no consolidation)', () => {
    const utxos: LabeledUtxo[] = [
      makeLabeledUtxo({ label: 'rune', source: 'payment', value: 546, txid: 'a'.repeat(64), vout: 0 }),
      makeLabeledUtxo({ label: 'inscription', source: 'payment', value: 546, txid: 'b'.repeat(64), vout: 1 }),
    ];
    const outputs = computeSortOutputs(utxos, 'bc1ptaproot', 'bc1qpayment');
    expect(outputs).toHaveLength(2);
    expect(outputs[0]).toEqual({ address: 'bc1ptaproot', value: 546n });
    expect(outputs[1]).toEqual({ address: 'bc1ptaproot', value: 546n });
  });

  it('consolidates plain UTXOs into a single output', () => {
    const utxos: LabeledUtxo[] = [
      makeLabeledUtxo({ label: 'plain', source: 'taproot', value: 30000, txid: 'a'.repeat(64) }),
      makeLabeledUtxo({ label: 'plain', source: 'taproot', value: 20000, txid: 'b'.repeat(64) }),
    ];
    const outputs = computeSortOutputs(utxos, 'bc1ptaproot', 'bc1qpayment');
    expect(outputs).toHaveLength(1);
    expect(outputs[0]).toEqual({ address: 'bc1qpayment', value: 50000n });
  });
});

describe('validateSortInputs', () => {
  it('returns error when no plain sats available for fee', () => {
    const utxos: LabeledUtxo[] = [
      makeLabeledUtxo({ label: 'rune', source: 'payment', value: 546 }),
    ];
    const result = validateSortInputs(utxos, [], 10);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Not enough plain sats');
  });

  it('returns valid when plain sats cover fee', () => {
    const utxos: LabeledUtxo[] = [
      makeLabeledUtxo({ label: 'rune', source: 'payment', value: 546 }),
    ];
    const feeUtxos: LabeledUtxo[] = [
      makeLabeledUtxo({ label: 'plain', source: 'payment', value: 50000, txid: 'f'.repeat(64) }),
    ];
    const result = validateSortInputs(utxos, feeUtxos, 10);
    expect(result.valid).toBe(true);
  });
});
