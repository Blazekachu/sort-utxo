import { describe, it, expect } from 'vitest';
import { planLedgerSort } from '../ledgerSort';
import type { LabeledUtxo } from '@/types';

const TAPROOT = 'tb1ptaproot';
const SEGWIT = 'tb1qsegwit';

function utxo(p: Partial<LabeledUtxo> & Pick<LabeledUtxo, 'label' | 'source' | 'value'>): LabeledUtxo {
  return { txid: 'a'.repeat(64), vout: 0, status: { confirmed: true }, assets: [], ...p };
}

describe('planLedgerSort', () => {
  it('plans the parent rescue', () => {
    const parent = utxo({
      label: 'inscription', source: 'payment', value: 13685, txid: 'd'.repeat(64), vout: 3,
      assets: [{ kind: 'inscription', id: '7c16f5d1'.repeat(8) + 'i0', offset: 4126 }],
    });
    const res = planLedgerSort({
      selectedUtxos: [parent], availableFeeUtxos: [], feeRate: 1,
      taprootAddress: TAPROOT, paymentAddress: SEGWIT,
    });
    expect(res.ok).toBe(true);
    expect(res.ledger.assetOutputIndices).toEqual([1]);
    expect(res.ledger.outputs[1]).toEqual({ address: TAPROOT, value: 546, kind: 'inscription' });
  });

  it('blocks selected rune UTXOs (deferred to Plan 2b)', () => {
    const rune = utxo({
      label: 'rune', source: 'payment', value: 546,
      assets: [{ kind: 'rune', name: 'DUMMY', amount: 1000n, divisibility: 0 }],
    });
    const res = planLedgerSort({
      selectedUtxos: [rune], availableFeeUtxos: [], feeRate: 1,
      taprootAddress: TAPROOT, paymentAddress: SEGWIT,
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/rune/i);
  });

  it('orders inputs [assets, plain, fee] and appends fee UTXOs last', () => {
    const insc = utxo({
      label: 'inscription', source: 'payment', value: 600, txid: 'd'.repeat(64),
      assets: [{ kind: 'inscription', id: 'a'.repeat(64) + 'i0', offset: 0 }],
    });
    const fee = utxo({ label: 'plain', source: 'payment', value: 50000, txid: 'e'.repeat(64) });
    const res = planLedgerSort({
      selectedUtxos: [insc], availableFeeUtxos: [fee], feeRate: 1,
      taprootAddress: TAPROOT, paymentAddress: SEGWIT,
    });
    expect(res.ok).toBe(true);
    expect(res.inputs[0].txid).toBe('d'.repeat(64)); // asset first
    expect(res.inputs[res.inputs.length - 1].txid).toBe('e'.repeat(64)); // fee last
    expect(res.feeUtxos).toHaveLength(1);
  });
});
