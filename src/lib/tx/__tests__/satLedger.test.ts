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

describe('planSatLedger — edge cases', () => {
  it('folds a sub-dust pre-pad into the inscription output (offset 300)', () => {
    const plan = planSatLedger({
      inputs: [input({ value: 50000, source: 'payment', inscriptionOffsets: [300] })],
      taprootAddress: TAPROOT, paymentAddress: SEGWIT, feeRate: 1,
    });
    expect(plan.ok).toBe(true);
    // No standalone pre-pad output; the inscription output starts at sat 0 and is 300 + 546 = 846.
    expect(plan.outputs[0]).toEqual({ address: TAPROOT, value: 846, kind: 'inscription' });
    expect(plan.outputs.every((o) => o.kind !== 'prepad')).toBe(true);
  });

  it('folds sub-dust leftover change into the last inscription output', () => {
    // value 800, offset 0, feeRate 1: finalChange = 800 - 546 - 165 = 89 (in (0,546)) -> folds.
    const plan = planSatLedger({
      inputs: [input({ value: 800, source: 'payment', inscriptionOffsets: [0] })],
      taprootAddress: TAPROOT, paymentAddress: SEGWIT, feeRate: 1,
    });
    expect(plan.ok).toBe(true);
    expect(plan.outputs).toHaveLength(1); // dust only, leftover folded in
    expect(plan.outputs[0].kind).toBe('inscription');
    expect(plan.outputs[0].value).toBeGreaterThanOrEqual(546);
    expect(800 - plan.outputs[0].value).toBe(plan.fee);
  });

  it('deduplicates two inscriptions on the same sat (reinscription) to one output', () => {
    const plan = planSatLedger({
      inputs: [input({ value: 50000, source: 'payment', inscriptionOffsets: [0, 0] })],
      taprootAddress: TAPROOT, paymentAddress: SEGWIT, feeRate: 1,
    });
    expect(plan.ok).toBe(true);
    expect(plan.assetOutputIndices).toHaveLength(1);
  });

  it('fails when the inscription lacks 546 sats of postage to end-of-inputs', () => {
    const plan = planSatLedger({
      inputs: [input({ value: 13685, source: 'payment', inscriptionOffsets: [13684] })],
      taprootAddress: TAPROOT, paymentAddress: SEGWIT, feeRate: 1,
    });
    expect(plan.ok).toBe(false);
    expect(plan.error).toMatch(/postage/i);
  });

  it('fails when funds cannot cover postage + fee', () => {
    const plan = planSatLedger({
      inputs: [input({ value: 600, source: 'payment', inscriptionOffsets: [0] })],
      taprootAddress: TAPROOT, paymentAddress: SEGWIT, feeRate: 50,
    });
    expect(plan.ok).toBe(false);
    expect(plan.error).toMatch(/cover postage/i);
  });
});

describe('planSatLedger — multi-input', () => {
  it('consolidates multiple plain inputs into one segwit change', () => {
    const plan = planSatLedger({
      inputs: [
        input({ value: 20000, source: 'taproot', inscriptionOffsets: [0] }),
        input({ value: 30000, source: 'payment', txid: 'b'.repeat(64) }),
        input({ value: 10000, source: 'payment', txid: 'c'.repeat(64) }),
      ],
      taprootAddress: TAPROOT, paymentAddress: SEGWIT, feeRate: 1,
    });
    expect(plan.ok).toBe(true);
    expect(plan.outputs.filter((o) => o.kind === 'inscription')).toHaveLength(1);
    expect(plan.outputs.filter((o) => o.kind === 'change')).toHaveLength(1);
  });

  it('handles two inscriptions in different inputs, interleaving pre-pad + dust', () => {
    const plan = planSatLedger({
      inputs: [
        input({ value: 10000, source: 'payment', inscriptionOffsets: [5000] }),
        input({ value: 10000, source: 'payment', txid: 'b'.repeat(64), inscriptionOffsets: [2000] }),
      ],
      taprootAddress: TAPROOT, paymentAddress: SEGWIT, feeRate: 1,
    });
    expect(plan.ok).toBe(true);
    // positions: 5000 (input0) and 10000+2000=12000 (input1) → two dust outputs
    expect(plan.assetOutputIndices).toHaveLength(2);
    plan.assetOutputIndices.forEach((i) => {
      expect(plan.outputs[i].address).toBe(TAPROOT);
      expect(plan.outputs[i].kind).toBe('inscription');
    });
  });
});
