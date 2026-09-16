import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';

bitcoin.initEccLib(ecc);

export interface ComposePsbtInput {
  txid: string;
  vout: number;
  value: number;
  address: string;
}

export interface ComposePsbtOutput {
  address: string;
  value: number;
}

function isTaproot(address: string): boolean {
  return address.startsWith('bc1p') || address.startsWith('tb1p');
}

function isNestedSegwit(address: string): boolean {
  return address.startsWith('3') || address.startsWith('2');
}

function isNativeSegwit(address: string): boolean {
  return address.startsWith('bc1q') || address.startsWith('tb1q');
}

function isLegacyP2pkh(address: string): boolean {
  return address.startsWith('1') || address.startsWith('m') || address.startsWith('n');
}

function toKey(bytes: Uint8Array): Uint8Array {
  return bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
}

export function buildComposePsbt(params: {
  inputs: ComposePsbtInput[];
  outputs: ComposePsbtOutput[];
  opReturnScript?: Uint8Array;
  taprootInternalKey: Uint8Array;
  paymentPublicKey?: Uint8Array;
  network: bitcoin.Network;
  nLockTime?: number;
}): { psbt: bitcoin.Psbt; inputsToSign: Array<{ index: number; address: string }> } {
  const {
    inputs, outputs, opReturnScript, taprootInternalKey, paymentPublicKey, network, nLockTime = 0,
  } = params;

  const totalIn = inputs.reduce((s, i) => s + i.value, 0);
  const totalOut = outputs.reduce((s, o) => s + o.value, 0);
  if (totalOut > totalIn) throw new Error(`Outputs (${totalOut}) exceed inputs (${totalIn}).`);

  const psbt = new bitcoin.Psbt({ network });
  if (nLockTime) psbt.setLocktime(nLockTime);
  const inputsToSign: Array<{ index: number; address: string }> = [];

  for (let i = 0; i < inputs.length; i++) {
    const u = inputs[i];
    if (isLegacyP2pkh(u.address)) {
      throw new Error('Legacy P2PKH payment UTXOs are not supported.');
    }
    if (isNestedSegwit(u.address)) {
      if (!paymentPublicKey) {
        throw new Error('P2SH payment UTXO requires payment public key from wallet.');
      }
      const p2wpkh = bitcoin.payments.p2wpkh({ pubkey: toKey(paymentPublicKey), network });
      const p2sh = bitcoin.payments.p2sh({ redeem: p2wpkh, network });
      if (!p2sh.output || !p2wpkh.output) throw new Error('Failed to derive P2SH redeem script for payment UTXO.');
      psbt.addInput({
        hash: u.txid,
        index: u.vout,
        witnessUtxo: { script: p2sh.output, value: BigInt(u.value) },
        redeemScript: p2wpkh.output,
        sequence: 0xffffffff,
      });
    } else {
      const outputScript = bitcoin.address.toOutputScript(u.address, network);
      const psbtInput: Record<string, unknown> = {
        hash: u.txid,
        index: u.vout,
        witnessUtxo: { script: outputScript, value: BigInt(u.value) },
        sequence: 0xffffffff,
      };
      if (isTaproot(u.address)) psbtInput.tapInternalKey = toKey(taprootInternalKey);
      else if (!isNativeSegwit(u.address)) {
        throw new Error(`Unsupported funding address type: ${u.address.slice(0, 16)}`);
      }
      psbt.addInput(psbtInput as unknown as Parameters<typeof psbt.addInput>[0]);
    }
    inputsToSign.push({ index: i, address: u.address });
  }

  for (const o of outputs) {
    psbt.addOutput({ address: o.address, value: BigInt(o.value) });
  }
  if (opReturnScript && opReturnScript.length > 0) {
    psbt.addOutput({ script: toKey(opReturnScript), value: 0n });
  }

  return { psbt, inputsToSign };
}
