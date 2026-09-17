import { describe, it, expect } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import { buildComposePsbt } from '../psbt';
import { plannedTxid, unsignedTxFromPsbt, serializeForTxid } from '../txid';
import { encodeOpReturn } from '../opreturn';

bitcoin.initEccLib(ecc);

const SEGWIT = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';
const INTERNAL = new Uint8Array(32).fill(2);
const PAYMENT_PUBKEY = Uint8Array.from(
  Buffer.from('0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798', 'hex'),
);

const nested = bitcoin.payments.p2sh({
  redeem: bitcoin.payments.p2wpkh({ pubkey: PAYMENT_PUBKEY, network: bitcoin.networks.testnet }),
  network: bitcoin.networks.testnet,
});

describe('plannedTxid', () => {
  it('does not use extractTransaction on an unsigned nested PSBT', () => {
    const { psbt } = buildComposePsbt({
      inputs: [{ txid: 'a'.repeat(64), vout: 0, value: 4449, address: nested.address! }],
      outputs: [
        { address: nested.address!, value: 1000 },
        { address: nested.address!, value: 1000 },
        { address: nested.address!, value: 1000 },
      ],
      opReturnScript: encodeOpReturn('Slice Test') ?? undefined,
      taprootInternalKey: INTERNAL,
      paymentPublicKey: PAYMENT_PUBKEY,
      network: bitcoin.networks.testnet,
    });
    expect(() => psbt.extractTransaction(true)).toThrow(/finalized/i);
    expect(plannedTxid(psbt)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('includes the nested redeem script so the planned txid is not the empty-scriptSig cache id', () => {
    const { psbt } = buildComposePsbt({
      inputs: [{ txid: 'a'.repeat(64), vout: 0, value: 4000, address: nested.address! }],
      outputs: [{ address: nested.address!, value: 1000 }],
      taprootInternalKey: INTERNAL,
      paymentPublicKey: PAYMENT_PUBKEY,
      network: bitcoin.networks.testnet,
    });
    const cached = unsignedTxFromPsbt(psbt);
    const emptyId = (psbt as unknown as { __CACHE: { __TX: bitcoin.Transaction } }).__CACHE.__TX.getId();
    expect(cached.getId()).not.toBe(emptyId);
    expect(cached.ins[0].script.length).toBeGreaterThan(0);
  });

  it('grind template is non-witness and ends with nLockTime', () => {
    const { psbt } = buildComposePsbt({
      inputs: [{ txid: 'a'.repeat(64), vout: 0, value: 4449, address: nested.address! }],
      outputs: [{ address: nested.address!, value: 1000 }],
      taprootInternalKey: INTERNAL,
      paymentPublicKey: PAYMENT_PUBKEY,
      network: bitcoin.networks.testnet,
      nLockTime: 0x01020304,
    });
    const template = serializeForTxid(psbt);
    expect(template.slice(-4)).toEqual(Uint8Array.from([0x04, 0x03, 0x02, 0x01]));
    expect(plannedTxid(psbt)).toBe(unsignedTxFromPsbt(psbt).getId());
  });

  it('matches the unsigned cache txid for native segwit (empty scriptSig)', () => {
    const { psbt } = buildComposePsbt({
      inputs: [{ txid: 'a'.repeat(64), vout: 0, value: 4000, address: SEGWIT }],
      outputs: [{ address: SEGWIT, value: 1000 }],
      taprootInternalKey: INTERNAL,
      network: bitcoin.networks.bitcoin,
    });
    const emptyId = (psbt as unknown as { __CACHE: { __TX: bitcoin.Transaction } }).__CACHE.__TX.getId();
    expect(plannedTxid(psbt)).toBe(emptyId);
  });
});
