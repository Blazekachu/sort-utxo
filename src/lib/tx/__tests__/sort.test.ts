import { describe, it, expect } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';
import { computeDustOutputs, planSort, buildSortPsbt } from '../sort';
import type { LabeledUtxo } from '@/types';

function makeLabeledUtxo(overrides: Partial<LabeledUtxo> & Pick<LabeledUtxo, 'label' | 'source' | 'value'>): LabeledUtxo {
  return {
    txid: 'a'.repeat(64),
    vout: 0,
    status: { confirmed: true },
    assets: [],
    ...overrides,
  };
}

describe('computeDustOutputs', () => {
  it('creates a 546-sat taproot output for a rune UTXO', () => {
    const utxos: LabeledUtxo[] = [
      makeLabeledUtxo({ label: 'rune', source: 'payment', value: 546 }),
    ];
    expect(computeDustOutputs(utxos, 'bc1ptaproot')).toEqual([
      { address: 'bc1ptaproot', value: 546n },
    ]);
  });

  it('creates no output for a plain UTXO (consolidated in the PSBT instead)', () => {
    const utxos: LabeledUtxo[] = [
      makeLabeledUtxo({ label: 'plain', source: 'taproot', value: 50000 }),
    ];
    expect(computeDustOutputs(utxos, 'bc1ptaproot')).toEqual([]);
  });

  it('creates a separate 546-sat output for each rune/inscription UTXO', () => {
    const utxos: LabeledUtxo[] = [
      makeLabeledUtxo({ label: 'rune', source: 'payment', value: 546, txid: 'a'.repeat(64), vout: 0 }),
      makeLabeledUtxo({ label: 'inscription', source: 'payment', value: 546, txid: 'b'.repeat(64), vout: 1 }),
    ];
    const outputs = computeDustOutputs(utxos, 'bc1ptaproot');
    expect(outputs).toEqual([
      { address: 'bc1ptaproot', value: 546n },
      { address: 'bc1ptaproot', value: 546n },
    ]);
  });
});

describe('planSort', () => {
  it('reports not ok when no plain sats are available for fee', () => {
    const utxos: LabeledUtxo[] = [
      makeLabeledUtxo({ label: 'rune', source: 'payment', value: 546 }),
    ];
    const plan = planSort({ selectedUtxos: utxos, availableFeeUtxos: [], feeRate: 10 });
    expect(plan.ok).toBe(false);
    expect(plan.error).toContain('Not enough plain sats');
  });

  it('is ok with no extra fee UTXOs needed when a single one covers the fee', () => {
    const utxos: LabeledUtxo[] = [
      makeLabeledUtxo({ label: 'rune', source: 'payment', value: 546 }),
    ];
    const feeUtxos: LabeledUtxo[] = [
      makeLabeledUtxo({ label: 'plain', source: 'payment', value: 50000, txid: 'f'.repeat(64) }),
    ];
    const plan = planSort({ selectedUtxos: utxos, availableFeeUtxos: feeUtxos, feeRate: 10 });
    expect(plan.ok).toBe(true);
    expect(plan.feeUtxos).toHaveLength(1);
    expect(plan.estimatedFee).toBeGreaterThan(0);
  });

  it('funds the fee from a moved plain UTXO without any separate fee UTXO', () => {
    const utxos: LabeledUtxo[] = [
      makeLabeledUtxo({ label: 'plain', source: 'taproot', value: 50000 }),
    ];
    const plan = planSort({ selectedUtxos: utxos, availableFeeUtxos: [], feeRate: 10 });
    expect(plan.ok).toBe(true);
    expect(plan.feeUtxos).toHaveLength(0);
  });

  it('selects multiple fee UTXOs when one is not enough', () => {
    const utxos: LabeledUtxo[] = [
      makeLabeledUtxo({ label: 'inscription', source: 'payment', value: 546 }),
    ];
    const feeUtxos: LabeledUtxo[] = Array.from({ length: 5 }, (_, i) =>
      makeLabeledUtxo({ label: 'plain', source: 'payment', value: 1500, vout: i }),
    );
    const plan = planSort({ selectedUtxos: utxos, availableFeeUtxos: feeUtxos, feeRate: 10 });
    expect(plan.ok).toBe(true);
    expect(plan.feeUtxos.length).toBeGreaterThan(1);
  });

  it('does not pick fee UTXOs too small to cover their own input cost', () => {
    const utxos: LabeledUtxo[] = [
      makeLabeledUtxo({ label: 'rune', source: 'payment', value: 546 }),
    ];
    // 500-sat UTXOs at 10 sat/vB cost ~680 sats each to spend — they only
    // deepen the shortfall, so planSort must not select them.
    const feeUtxos: LabeledUtxo[] = Array.from({ length: 10 }, (_, i) =>
      makeLabeledUtxo({ label: 'plain', source: 'payment', value: 500, vout: i }),
    );
    const plan = planSort({ selectedUtxos: utxos, availableFeeUtxos: feeUtxos, feeRate: 10 });
    expect(plan.ok).toBe(false);
    expect(plan.feeUtxos).toHaveLength(0);
  });
});

describe('buildSortPsbt', () => {
  // BIP86 / BIP84 mainnet test-vector addresses.
  const TAPROOT = 'bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr';
  const PAYMENT = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';

  it('deducts the fee from a moved plain UTXO with no separate fee UTXO', () => {
    const selected: LabeledUtxo[] = [
      makeLabeledUtxo({ label: 'plain', source: 'taproot', value: 50000 }),
    ];
    const { psbt, inputsToSign } = buildSortPsbt({
      selectedUtxos: selected,
      additionalFeeUtxos: [],
      taprootAddress: TAPROOT,
      paymentAddress: PAYMENT,
      internalPubkey: new Uint8Array(32).fill(2),
      feeRate: 10,
      network: bitcoin.networks.bitcoin,
    });

    expect(inputsToSign).toEqual([{ index: 0, address: TAPROOT }]);
    // A single consolidated segwit output: 50000 - fee. The fee comes out of
    // the moved plain value — no separate fee UTXO was needed.
    expect(psbt.txOutputs).toHaveLength(1);
    expect(psbt.txOutputs[0].address).toBe(PAYMENT);
    expect(psbt.txOutputs[0].value).toBe(48890n);
  });

  it('keeps each rune output as its own 546-sat taproot output', () => {
    const selected: LabeledUtxo[] = [
      makeLabeledUtxo({ label: 'rune', source: 'payment', value: 546, vout: 0 }),
    ];
    const feeUtxo: LabeledUtxo[] = [
      makeLabeledUtxo({ label: 'plain', source: 'payment', value: 50000, txid: 'f'.repeat(64) }),
    ];
    const { psbt } = buildSortPsbt({
      selectedUtxos: selected,
      additionalFeeUtxos: feeUtxo,
      taprootAddress: TAPROOT,
      paymentAddress: PAYMENT,
      internalPubkey: new Uint8Array(32).fill(2),
      feeRate: 10,
      network: bitcoin.networks.bitcoin,
    });

    // Output 0: the rune's own 546-sat taproot output. Output 1: consolidated change.
    expect(psbt.txOutputs).toHaveLength(2);
    expect(psbt.txOutputs[0].address).toBe(TAPROOT);
    expect(psbt.txOutputs[0].value).toBe(546n);
    expect(psbt.txOutputs[1].address).toBe(PAYMENT);
  });
});
