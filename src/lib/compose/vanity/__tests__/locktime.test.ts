import { describe, it, expect } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import { assertVanityHex } from '../locktime';
import { buildComposePsbt } from '../../psbt';

bitcoin.initEccLib(ecc);

const SEGWIT = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';

describe('assertVanityHex', () => {
  it('rejects prefix longer than 6 hex chars', () => {
    expect(() => assertVanityHex('abcdef0', '')).toThrow(/6/);
  });
});

describe('buildComposePsbt nSequence', () => {
  it('is 0xffffffff on every input', () => {
    const { psbt } = buildComposePsbt({
      inputs: [{ txid: 'a'.repeat(64), vout: 0, value: 10000, address: SEGWIT }],
      outputs: [{ address: SEGWIT, value: 9000 }],
      taprootInternalKey: new Uint8Array(32).fill(2),
      network: bitcoin.networks.bitcoin,
    });
    expect(psbt.txInputs[0].sequence).toBe(0xffffffff);
  });
});
