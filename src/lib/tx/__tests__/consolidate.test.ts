import { describe, expect, it } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';
import {
  buildConsolidationPsbt,
  groupSigningInputsByAccount,
  planConsolidation,
  validateAccountNetworks,
  validateConsolidationDestinations,
  type ConsolidationInput,
} from '../consolidate';

const TAPROOT = 'bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr';
const SEGWIT = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';
const OTHER_TAPROOT = TAPROOT;

function input(overrides: Partial<ConsolidationInput> = {}): ConsolidationInput {
  return {
    txid: 'a'.repeat(64),
    vout: 0,
    value: 10_000,
    source: 'payment',
    sourceAddress: SEGWIT,
    accountId: 'account-1',
    inscriptionOffsets: [],
    hasRunes: false,
    ...overrides,
  };
}

describe('planConsolidation', () => {
  it('consolidates plain sats into the payment destination', () => {
    const result = planConsolidation({
      inputs: [input(), input({ txid: 'b'.repeat(64), value: 20_000 })],
      feeRate: 1,
      taprootAddress: TAPROOT,
      paymentAddress: SEGWIT,
    });

    expect(result.ok).toBe(true);
    expect(result.outputs).toHaveLength(1);
    expect(result.outputs[0]).toMatchObject({ address: SEGWIT, kind: 'change' });
  });

  it('preserves inscriptions from multiple accounts as individual taproot outputs', () => {
    const result = planConsolidation({
      inputs: [
        input({ source: 'taproot', sourceAddress: TAPROOT, inscriptionOffsets: [0], accountId: 'account-1' }),
        input({ txid: 'b'.repeat(64), source: 'taproot', sourceAddress: OTHER_TAPROOT, inscriptionOffsets: [0], accountId: 'account-2' }),
        input({ txid: 'c'.repeat(64), value: 30_000 }),
      ],
      feeRate: 1,
      taprootAddress: TAPROOT,
      paymentAddress: SEGWIT,
    });

    expect(result.ok).toBe(true);
    expect(result.outputs.filter((output) => output.kind === 'inscription')).toHaveLength(2);
    expect(result.outputs.filter((output) => output.kind === 'inscription').every((output) => output.address === TAPROOT)).toBe(true);
  });

  it('puts a taproot rune anchor at output zero', () => {
    const result = planConsolidation({
      inputs: [
        input({ source: 'taproot', sourceAddress: TAPROOT, hasRunes: true, value: 2_000 }),
        input({ txid: 'b'.repeat(64), value: 20_000 }),
      ],
      feeRate: 1,
      taprootAddress: TAPROOT,
      paymentAddress: SEGWIT,
    });

    expect(result.ok).toBe(true);
    expect(result.outputs[0]).toEqual({ address: TAPROOT, value: 2_000, kind: 'rune-anchor' });
  });

  it('excludes rune and inscription combinations that cannot retain both assets safely', () => {
    const result = planConsolidation({
      inputs: [
        input({ source: 'taproot', sourceAddress: TAPROOT, hasRunes: true, inscriptionOffsets: [0] }),
        input({ txid: 'b'.repeat(64), value: 20_000 }),
      ],
      feeRate: 1,
      taprootAddress: TAPROOT,
      paymentAddress: SEGWIT,
    });

    expect(result.ok).toBe(true);
    expect(result.excluded).toHaveLength(1);
    expect(result.excluded[0].reason).toMatch(/rune.*inscription/i);
    expect(result.inputs.every((candidate) => !candidate.hasRunes)).toBe(true);
  });

  it('reports fee shortfall and dust-only failures', () => {
    const shortfall = planConsolidation({
      inputs: [input({ value: 100 })],
      feeRate: 10,
      taprootAddress: TAPROOT,
      paymentAddress: SEGWIT,
    });
    expect(shortfall.ok).toBe(false);
    expect(shortfall.error).toMatch(/cover|dust/i);
  });
});

describe('consolidation validation and PSBT construction', () => {
  it('rejects collected accounts from mixed networks', () => {
    expect(() => validateAccountNetworks([SEGWIT, 'tb1qfmz3h0jp5f34m2g9r2jnu9u0w69c0tfd27e3pq'])).toThrow(/same network/i);
  });

  it('rejects mixed-network destinations', () => {
    expect(() => validateConsolidationDestinations({
      paymentAddress: SEGWIT,
      taprootAddress: 'tb1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxq54sg6u',
      network: bitcoin.networks.bitcoin,
    })).toThrow(/network/i);
  });

  it('uses each taproot input account pubkey and groups signing indices by account', () => {
    const inputs = [
      input({ source: 'taproot', sourceAddress: TAPROOT, accountId: 'one', internalPubkey: new Uint8Array(32).fill(1) }),
      input({ txid: 'b'.repeat(64), source: 'taproot', sourceAddress: OTHER_TAPROOT, accountId: 'two', internalPubkey: new Uint8Array(32).fill(2) }),
      input({ txid: 'c'.repeat(64), accountId: 'one' }),
    ];
    const built = buildConsolidationPsbt({
      inputs,
      outputs: [{ address: SEGWIT, value: 28_000, kind: 'change' }],
      network: bitcoin.networks.bitcoin,
    });

    expect(built.psbt.data.inputs[0].tapInternalKey).toEqual(new Uint8Array(32).fill(1));
    expect(built.psbt.data.inputs[1].tapInternalKey).toEqual(new Uint8Array(32).fill(2));
    expect(groupSigningInputsByAccount(built.inputsToSign)).toEqual([
      { accountId: 'one', inputs: [{ index: 0, address: TAPROOT }, { index: 2, address: SEGWIT }] },
      { accountId: 'two', inputs: [{ index: 1, address: OTHER_TAPROOT }] },
    ]);
  });
});
