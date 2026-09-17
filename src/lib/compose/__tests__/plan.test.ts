import { describe, it, expect } from 'vitest';
import { orderComposeInputs, planCompose } from '../plan';
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
    addressKind: partial.addressKind ?? (partial.source === 'taproot' ? 'taproot' : 'p2wpkh'),
    source: partial.source,
    kind: partial.kind,
    assets: partial.assets ?? [],
    satRanges: partial.satRanges === undefined
      ? [{ start, endExclusive: start + BigInt(value), offset: 0, length: value, rarityTags: [] }]
      : partial.satRanges,
  };
}

describe('orderComposeInputs', () => {
  it('follows selection order, not table order', () => {
    const upper = makeUtxo({ value: 4590, source: 'payment', kind: 'plain', txid: 'aa'.repeat(32), vout: 0 });
    const lower = makeUtxo({ value: 4000, source: 'payment', kind: 'plain', txid: 'bb'.repeat(32), vout: 1 });
    const ordered = orderComposeInputs(
      [upper, lower],
      [`${lower.txid}:${lower.vout}`, `${upper.txid}:${upper.vout}`],
    );
    expect(ordered.map((i) => i.utxo.value)).toEqual([4000, 4590]);
    expect(ordered.map((i) => i.role)).toEqual(['spend', 'fee']);
  });

  it('marks only the last selected UTXO as fee', () => {
    const a = makeUtxo({ value: 1000, source: 'taproot', kind: 'plain', txid: 'aa'.repeat(32) });
    const b = makeUtxo({ value: 2000, source: 'payment', kind: 'plain', txid: 'bb'.repeat(32) });
    const ordered = orderComposeInputs([a, b], [`${a.txid}:${a.vout}`, `${b.txid}:${b.vout}`]);
    expect(ordered.map((i) => i.role)).toEqual(['spend', 'fee']);
  });
});

describe('planCompose last-payment gate', () => {
  it('refuses when the last input is not a plain payment UTXO', () => {
    const pay = makeUtxo({ value: 4000, source: 'payment', kind: 'plain', txid: 'aa'.repeat(32) });
    const tap = makeUtxo({ value: 5000, source: 'taproot', kind: 'plain', txid: 'bb'.repeat(32) });
    const plan = planCompose({
      inputs: [
        { utxo: pay, role: 'spend' },
        { utxo: tap, role: 'fee' },
      ],
      outputRows: [{ value: 1000, address: SEGWIT }],
      feeRate: 1,
      changeAddress: SEGWIT,
    });
    expect(plan.ok).toBe(false);
    expect(plan.error).toMatch(/last input|payment/i);
  });
});

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
        { value: 55670, address: SEGWIT },
      ],
      feeRate: 1,
      changeAddress: SEGWIT,
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
        { value: 55670, address: SEGWIT },
      ],
      feeRate: 1,
      changeAddress: SEGWIT,
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
      changeAddress: SEGWIT,
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
      { value: 19670, address: SEGWIT },
    ];
    const without = planCompose({ inputs: [{ utxo: spend, role: 'spend' }, { utxo: fee, role: 'fee' }], outputRows: rows, feeRate: 1, changeAddress: SEGWIT });
    const withMsg = planCompose({ inputs: [{ utxo: spend, role: 'spend' }, { utxo: fee, role: 'fee' }], outputRows: rows, feeRate: 1, opReturnText: 'hello', changeAddress: SEGWIT });
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

  it('plans by offset when satRanges are missing (ord sat_index off)', () => {
    const spend = makeUtxo({ value: 20000, source: 'payment', kind: 'plain', satRanges: null });
    const feeUtxo = makeUtxo({ value: 10000, source: 'payment', kind: 'plain', txid: 'b'.repeat(64), satRanges: null });
    const plan = planCompose({
      inputs: [
        { utxo: spend, role: 'spend' },
        { utxo: feeUtxo, role: 'fee' },
      ],
      outputRows: [{ value: 20000, address: SEGWIT }],
      feeRate: 1,
      changeAddress: SEGWIT,
    });
    expect(plan.ok).toBe(true);
    expect(plan.outputs[0].satStart).toBe(0);
    expect(plan.outputs[0].satEnd).toBe(20000);
    expect(plan.outputs[0].ranges).toEqual([]);
  });

  it('returns leftover payment sats as change instead of dumping them as fee', () => {
    const pay = '2N9jgeRZJvZuhSLnpbod4WhVTSeoGwCnH59';
    const spend = makeUtxo({
      value: 4449,
      source: 'payment',
      kind: 'plain',
      address: pay,
      addressKind: 'p2sh-p2wpkh',
      satRanges: null,
    });
    const plan = planCompose({
      inputs: [{ utxo: spend, role: 'fee' }],
      outputRows: [
        { value: 1000, address: pay },
        { value: 1500, address: pay },
      ],
      feeRate: 1,
      changeAddress: pay,
    });
    expect(plan.ok).toBe(true);
    expect(plan.outputs).toHaveLength(3);
    expect(plan.outputs[2]?.isChange).toBe(true);
    expect(plan.outputs[2]?.address).toBe(pay);
    expect(plan.outputs[0]).toMatchObject({ satStart: 0, satEnd: 1000 });
    expect(plan.outputs[1]).toMatchObject({ satStart: 1000, satEnd: 2500 });
    const outSum = plan.outputs.reduce((s, o) => s + o.value, 0);
    expect(outSum + plan.fee).toBe(4449);
    expect(plan.fee).toBe(plan.estimatedVBytes);
    expect(plan.fee).toBeLessThan(500);
    expect(plan.outputs[2].value).toBeGreaterThan(546);
  });

  it('still refuses when the fee tail would consume taproot sats', () => {
    const spend = makeUtxo({ value: 4000, source: 'taproot', kind: 'plain', satRanges: null });
    const plan = planCompose({
      inputs: [{ utxo: spend, role: 'spend' }],
      outputRows: [
        { value: 1000, address: SEGWIT },
        { value: 1000, address: SEGWIT },
      ],
      feeRate: 1,
      changeAddress: SEGWIT,
    });
    expect(plan.ok).toBe(false);
    expect(plan.error).toMatch(/payment/i);
  });

  it('refuses a 1-sat taproot output', () => {
    const u = makeUtxo({ value: 10000, source: 'payment', kind: 'plain' });
    const plan = planCompose({
      inputs: [{ utxo: u, role: 'fee' }],
      outputRows: [{ value: 1, address: TAPROOT }],
      feeRate: 1,
      changeAddress: SEGWIT,
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

  it('pays the selected fee rate and returns leftover as payment change', () => {
    const spend = makeUtxo({ value: 20000, source: 'payment', kind: 'plain' });
    const feeUtxo = makeUtxo({ value: 10000, source: 'payment', kind: 'plain', txid: 'b'.repeat(64) });
    const plan = planCompose({
      inputs: [
        { utxo: spend, role: 'spend' },
        { utxo: feeUtxo, role: 'fee' },
      ],
      outputRows: [{ value: 20000, address: SEGWIT }],
      feeRate: 1,
      changeAddress: SEGWIT,
    });
    expect(plan.ok).toBe(true);
    const outSum = plan.outputs.reduce((s, o) => s + o.value, 0);
    expect(30000 - outSum).toBe(plan.fee);
    expect(plan.outputs.some((o) => o.isChange)).toBe(true);
    expect(plan.fee).toBe(plan.estimatedVBytes);
  });
});
