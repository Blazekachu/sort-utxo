import { describe, it, expect } from 'vitest';
import { planSatLedger, type LedgerInput } from '../satLedger';

const TAPROOT = 'tb1ptaproot';
const SEGWIT = 'tb1qsegwit';

function input(partial: Partial<LedgerInput> & Pick<LedgerInput, 'value' | 'source'>): LedgerInput {
  return { txid: 'a'.repeat(64), vout: 0, inscriptionOffsets: [], ...partial };
}

describe('planSatLedger — single inscription', () => {
  it('extracts the parent: pre-pad segwit, 546 taproot at the inscription sat, segwit change', () => {
    const plan = planSatLedger({
      inputs: [input({ value: 13685, source: 'payment', inscriptionOffsets: [4126] })],
      taprootAddress: TAPROOT, paymentAddress: SEGWIT, feeRate: 1,
    });
    expect(plan.ok).toBe(true);
    expect(plan.outputs).toEqual([
      { address: SEGWIT, value: 4126, kind: 'prepad' },
      { address: TAPROOT, value: 546, kind: 'inscription' },
      { address: SEGWIT, value: 13685 - 4126 - 546 - plan.fee, kind: 'change' },
    ]);
    expect(plan.assetOutputIndices).toEqual([1]);
    // conservation: inputs - outputs === fee
    const out = plan.outputs.reduce((s, o) => s + o.value, 0);
    expect(13685 - out).toBe(plan.fee);
  });

  it('offset 0 needs no pre-pad: 546 taproot then segwit change', () => {
    const plan = planSatLedger({
      inputs: [
        input({ value: 546, source: 'payment', inscriptionOffsets: [0] }),
        input({ value: 50000, source: 'payment', txid: 'b'.repeat(64) }),
      ],
      taprootAddress: TAPROOT, paymentAddress: SEGWIT, feeRate: 1,
    });
    expect(plan.ok).toBe(true);
    expect(plan.outputs[0]).toEqual({ address: TAPROOT, value: 546, kind: 'inscription' });
    expect(plan.outputs[1].kind).toBe('change');
    expect(plan.assetOutputIndices).toEqual([0]);
  });
});
