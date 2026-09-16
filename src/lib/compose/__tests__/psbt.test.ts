import { describe, it, expect } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import { buildComposePsbt } from '../psbt';
import { encodeOpReturn } from '../opreturn';

bitcoin.initEccLib(ecc);

const TAPROOT = 'bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr';
const SEGWIT = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';
const INTERNAL = new Uint8Array(32).fill(2);
const PAYMENT_PUBKEY = Uint8Array.from(
  Buffer.from('0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798', 'hex'),
);

const nested = bitcoin.payments.p2sh({
  redeem: bitcoin.payments.p2wpkh({ pubkey: PAYMENT_PUBKEY, network: bitcoin.networks.bitcoin }),
  network: bitcoin.networks.bitcoin,
});

describe('buildComposePsbt', () => {
  it('adds tapInternalKey on taproot inputs and lists every input in inputsToSign', () => {
    const { psbt, inputsToSign } = buildComposePsbt({
      inputs: [
        { txid: 'a'.repeat(64), vout: 0, value: 10000, address: TAPROOT },
        { txid: 'b'.repeat(64), vout: 1, value: 5000, address: SEGWIT },
      ],
      outputs: [
        { address: TAPROOT, value: 330 },
        { address: SEGWIT, value: 14000 },
      ],
      taprootInternalKey: INTERNAL,
      network: bitcoin.networks.bitcoin,
    });
    expect(psbt.txInputs).toHaveLength(2);
    expect(psbt.data.inputs[0].tapInternalKey).toEqual(INTERNAL);
    expect(inputsToSign).toEqual([
      { index: 0, address: TAPROOT },
      { index: 1, address: SEGWIT },
    ]);
  });

  it('adds redeemScript for nested p2sh-p2wpkh when payment pubkey is present', () => {
    const { psbt } = buildComposePsbt({
      inputs: [{ txid: 'a'.repeat(64), vout: 0, value: 10000, address: nested.address! }],
      outputs: [{ address: SEGWIT, value: 9000 }],
      taprootInternalKey: INTERNAL,
      paymentPublicKey: PAYMENT_PUBKEY,
      network: bitcoin.networks.bitcoin,
    });
    expect(psbt.data.inputs[0].redeemScript).toBeDefined();
    expect(psbt.data.inputs[0].witnessUtxo).toBeDefined();
  });

  it('throws on nested input without payment pubkey', () => {
    expect(() => buildComposePsbt({
      inputs: [{ txid: 'a'.repeat(64), vout: 0, value: 10000, address: nested.address! }],
      outputs: [{ address: SEGWIT, value: 9000 }],
      taprootInternalKey: INTERNAL,
      network: bitcoin.networks.bitcoin,
    })).toThrow(/payment public key/i);
  });

  it('includes a 0-value OP_RETURN as the last output', () => {
    const script = encodeOpReturn('hello')!;
    const { psbt } = buildComposePsbt({
      inputs: [{ txid: 'a'.repeat(64), vout: 0, value: 10000, address: SEGWIT }],
      outputs: [{ address: SEGWIT, value: 9000 }],
      opReturnScript: script,
      taprootInternalKey: INTERNAL,
      network: bitcoin.networks.bitcoin,
    });
    expect(psbt.txOutputs).toHaveLength(2);
    expect(psbt.txOutputs[1].value).toBe(0n);
    expect(psbt.txOutputs[1].script).toEqual(script);
  });

  it('does not set sighash type on inputs (ALL default)', () => {
    const { psbt } = buildComposePsbt({
      inputs: [{ txid: 'a'.repeat(64), vout: 0, value: 10000, address: SEGWIT }],
      outputs: [{ address: SEGWIT, value: 9000 }],
      taprootInternalKey: INTERNAL,
      network: bitcoin.networks.bitcoin,
    });
    expect(psbt.data.inputs[0].sighashType).toBeUndefined();
  });
});
