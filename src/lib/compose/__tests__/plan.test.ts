import { describe, it, expect } from 'vitest';
import { planCompose } from '../plan';
import type { ComposeUtxo } from '../types';

const TAPROOT = 'bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr';
const SEGWIT = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';

function makeUtxo(partial: Partial<ComposeUtxo> & Pick<ComposeUtxo, 'value' | 'source' | 'kind'>): ComposeUtxo {
  const value = partial.value;
  const start = 0n;
  return {
    txid: partial.txid ?? 'a'.repeat(64),
    vout: partial.vout ?? 0,
    value,
    confirmed: partial.confirmed ?? true,
    address: partial.address ?? (partial.source === 'taproot' ? TAPROOT : SEGWIT),
    addressKind: partial.source === 'taproot' ? 'taproot' : 'p2wpkh',
    source: partial.source,
    kind: partial.kind,
    assets: partial.assets ?? [],
    satRanges: partial.satRanges === undefined
      ? [{ start, endExclusive: start + BigInt(value), offset: 0, length: value, rarityTags: [] }]
      : partial.satRanges,
  };
}

describe('planCompose', () => {
  it('puts a mid-UTXO sat at output offset 0 when the pre-pad row equals that offset', () => {
    const spend = makeUtxo({
      value: 62000,
      source: 'taproot',
      kind: 'inscription',
      assets: [{ kind: 'inscription', id: 'abci0', offset: 6000 }],
    });
    const fee = makeUtxo({ value: 20000, source: 'payment', kind: 'plain', txid: 'b'.repeat(64) });
    const plan = planCompose({
      inputs: [
        { utxo: spend, role: 'spend' },
        { utxo: fee, role: 'fee' },
      ],
      outputRows: [
        { value: 6000, address: SEGWIT },
        { value: 330, address: TAPROOT },
        { value: 55000, address: SEGWIT },
      ],
      feeRate: 1,
    });
    expect(plan.ok).toBe(true);
    expect(plan.outputs[1].inscriptions).toEqual([{ id: 'abci0', outputOffset: 0 }]);
    expect(plan.outputs[1].satStart).toBe(6000);
    expect(plan.outputs[1].satEnd).toBe(6330);
  });

  it('does not use payment sats as postage for offset 6000 when following sats exist in the same UTXO', () => {
    const spend = makeUtxo({
      value: 62000,
      source: 'taproot',
      kind: 'inscription',
      assets: [{ kind: 'inscription', id: 'abci0', offset: 6000 }],
    });
    const fee = makeUtxo({ value: 20000, source: 'payment', kind: 'plain', txid: 'b'.repeat(64) });
    const plan = planCompose({
      inputs: [
        { utxo: spend, role: 'spend' },
        { utxo: fee, role: 'fee' },
      ],
      outputRows: [
        { value: 6000, address: SEGWIT },
        { value: 330, address: TAPROOT },
        { value: 55000, address: SEGWIT },
      ],
      feeRate: 1,
    });
    expect(plan.ok).toBe(true);
    expect(plan.outputs[1].satEnd).toBeLessThanOrEqual(62000);
  });

  it('refuses a near-end extract that runs past spend inputs until a fee UTXO is appended', () => {
    const spend = makeUtxo({
      value: 62000,
      source: 'taproot',
      kind: 'inscription',
      assets: [{ kind: 'inscription', id: 'abci0', offset: 61900 }],
    });
    const withoutFee = planCompose({
      inputs: [{ utxo: spend, role: 'spend' }],
      outputRows: [
        { value: 61900, address: SEGWIT },
        { value: 330, address: TAPROOT },
      ],
      feeRate: 1,
    });
    expect(withoutFee.ok).toBe(false);
    expect(withoutFee.error).toMatch(/payment/i);
  });

  it('after a fee UTXO is appended, payment sats continue the line', () => {
    const spend = makeUtxo({
      value: 62000,
      source: 'taproot',
      kind: 'inscription',
      assets: [{ kind: 'inscription', id: 'abci0', offset: 61900 }],
    });
    const fee = makeUtxo({ value: 10000, source: 'payment', kind: 'plain', txid: 'b'.repeat(64) });
    const plan = planCompose({
      inputs: [
        { utxo: spend, role: 'spend' },
        { utxo: fee, role: 'fee' },
      ],
      outputRows: [
        { value: 61900, address: SEGWIT },
        { value: 330, address: TAPROOT },
        { value: 9000, address: SEGWIT },
      ],
      feeRate: 1,
    });
    expect(plan.ok).toBe(true);
    expect(plan.outputs[1].satStart).toBe(61900);
    expect(plan.outputs[1].satEnd).toBe(62230);
    expect(plan.outputs[1].satEnd).toBeGreaterThan(62000);
  });

  it('OP_RETURN does not shift inscription output offsets', () => {
    const spend = makeUtxo({
      value: 20000,
      source: 'taproot',
      kind: 'inscription',
      assets: [{ kind: 'inscription', id: 'abci0', offset: 0 }],
    });
    const fee = makeUtxo({ value: 10000, source: 'payment', kind: 'plain', txid: 'b'.repeat(64) });
    const rows = [
      { value: 330, address: TAPROOT },
      { value: 19000, address: SEGWIT },
    ];
    const without = planCompose({ inputs: [{ utxo: spend, role: 'spend' }, { utxo: fee, role: 'fee' }], outputRows: rows, feeRate: 1 });
    const withMsg = planCompose({ inputs: [{ utxo: spend, role: 'spend' }, { utxo: fee, role: 'fee' }], outputRows: rows, feeRate: 1, opReturnText: 'hello' });
    expect(without.ok).toBe(true);
    expect(withMsg.ok).toBe(true);
    expect(withMsg.outputs[0].inscriptions).toEqual(without.outputs[0].inscriptions);
    expect(withMsg.opReturnScript).toBeDefined();
  });

  it('refuses rune spend inputs', () => {
    const rune = makeUtxo({ value: 10000, source: 'taproot', kind: 'rune' });
    const plan = planCompose({
      inputs: [{ utxo: rune, role: 'spend' }],
      outputRows: [{ value: 10000, address: TAPROOT }],
      feeRate: 1,
    });
    expect(plan.ok).toBe(false);
    expect(plan.error).toMatch(/rune/i);
  });

  it('refuses missing satRanges', () => {
    const u = makeUtxo({ value: 10000, source: 'payment', kind: 'plain', satRanges: null });
    const plan = planCompose({
      inputs: [{ utxo: u, role: 'spend' }],
      outputRows: [{ value: 10000, address: SEGWIT }],
      feeRate: 1,
    });
    expect(plan.ok).toBe(false);
    expect(plan.error).toMatch(/range/i);
  });

  it('refuses a 1-sat taproot output', () => {
    const u = makeUtxo({ value: 10000, source: 'payment', kind: 'plain' });
    const plan = planCompose({
      inputs: [{ utxo: u, role: 'spend' }],
      outputRows: [{ value: 1, address: TAPROOT }],
      feeRate: 1,
    });
    expect(plan.ok).toBe(false);
    expect(plan.error).toMatch(/dust/i);
  });

  it('refuses taproot in the fee role', () => {
    const spend = makeUtxo({ value: 10000, source: 'payment', kind: 'plain' });
    const tapFee = makeUtxo({ value: 5000, source: 'taproot', kind: 'plain', txid: 'b'.repeat(64) });
    const plan = planCompose({
      inputs: [
        { utxo: spend, role: 'spend' },
        { utxo: tapFee, role: 'fee' },
      ],
      outputRows: [{ value: 10000, address: SEGWIT }],
      feeRate: 1,
    });
    expect(plan.ok).toBe(false);
    expect(plan.error).toMatch(/payment/i);
  });

  it('fee equals unassigned tail', () => {
    const spend = makeUtxo({ value: 20000, source: 'payment', kind: 'plain' });
    const feeUtxo = makeUtxo({ value: 10000, source: 'payment', kind: 'plain', txid: 'b'.repeat(64) });
    const plan = planCompose({
      inputs: [
        { utxo: spend, role: 'spend' },
        { utxo: feeUtxo, role: 'fee' },
      ],
      outputRows: [{ value: 20000, address: SEGWIT }],
      feeRate: 1,
    });
    expect(plan.ok).toBe(true);
    const outSum = plan.outputs.reduce((s, o) => s + o.value, 0);
    expect(30000 - outSum).toBe(plan.fee);
  });
});
