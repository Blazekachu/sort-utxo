import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import type { LabeledUtxo } from '@/types';

bitcoin.initEccLib(ecc);

const DUST_LIMIT = 546n;

export interface SortOutput {
  address: string;
  value: bigint;
}

/**
 * Compute the outputs needed to sort the selected UTXOs.
 * - Each rune/inscription UTXO gets its own 546-sat output to taprootAddress
 * - Plain UTXOs are consolidated into a single output to paymentAddress
 */
export function computeSortOutputs(
  selectedUtxos: LabeledUtxo[],
  taprootAddress: string,
  paymentAddress: string,
): SortOutput[] {
  const outputs: SortOutput[] = [];
  let plainTotal = 0n;

  for (const utxo of selectedUtxos) {
    if (utxo.label === 'rune' || utxo.label === 'inscription') {
      outputs.push({ address: taprootAddress, value: DUST_LIMIT });
    } else {
      plainTotal += BigInt(utxo.value);
    }
  }

  if (plainTotal > 0n) {
    outputs.push({ address: paymentAddress, value: plainTotal });
  }

  return outputs;
}

/**
 * Validate that the sort can be funded.
 * The fee must come from plain sats — never from dust/rune/inscription outputs.
 */
export function validateSortInputs(
  selectedUtxos: LabeledUtxo[],
  additionalFeeUtxos: LabeledUtxo[],
  feeRate: number,
): { valid: boolean; error?: string; estimatedFee?: number } {
  const numInputs = selectedUtxos.length + additionalFeeUtxos.length;
  const numDustOutputs = selectedUtxos.filter((u) => u.label !== 'plain').length;
  const hasPlainOutput = selectedUtxos.some((u) => u.label === 'plain');
  const numOutputs = numDustOutputs + (hasPlainOutput ? 1 : 0) + 1; // +1 for change

  const estimatedVBytes = Math.ceil(10.5 + numInputs * 68 + numOutputs * 43);
  const estimatedFee = Math.ceil(estimatedVBytes * feeRate);

  const totalInput = selectedUtxos.reduce((sum, u) => sum + BigInt(u.value), 0n)
    + additionalFeeUtxos.reduce((sum, u) => sum + BigInt(u.value), 0n);

  const dustCost = BigInt(numDustOutputs) * DUST_LIMIT;
  const plainFromSelected = selectedUtxos
    .filter((u) => u.label === 'plain')
    .reduce((sum, u) => sum + BigInt(u.value), 0n);

  const totalOutput = dustCost + plainFromSelected;

  if (totalInput < totalOutput + BigInt(estimatedFee)) {
    return {
      valid: false,
      error: `Not enough plain sats to cover fee. Need ~${estimatedFee} sats for fees.`,
      estimatedFee,
    };
  }

  return { valid: true, estimatedFee };
}

/**
 * Build a PSBT that sorts the selected UTXOs.
 */
export function buildSortPsbt(params: {
  selectedUtxos: LabeledUtxo[];
  additionalFeeUtxos: LabeledUtxo[];
  taprootAddress: string;
  paymentAddress: string;
  internalPubkey: Buffer;
  feeRate: number;
  network: bitcoin.Network;
}): { psbt: bitcoin.Psbt; inputsToSign: Array<{ index: number; address: string }> } {
  const {
    selectedUtxos, additionalFeeUtxos, taprootAddress, paymentAddress,
    internalPubkey, feeRate, network,
  } = params;

  const psbt = new bitcoin.Psbt({ network });
  const inputsToSign: Array<{ index: number; address: string }> = [];

  const allInputUtxos = [...selectedUtxos, ...additionalFeeUtxos];
  for (let i = 0; i < allInputUtxos.length; i++) {
    const utxo = allInputUtxos[i];
    const address = utxo.source === 'taproot' ? taprootAddress : paymentAddress;
    const isTaproot = address.startsWith('bc1p') || address.startsWith('tb1p');

    const input: Record<string, unknown> = {
      hash: utxo.txid,
      index: utxo.vout,
      witnessUtxo: {
        script: bitcoin.address.toOutputScript(address, network),
        value: BigInt(utxo.value),
      },
    };
    if (isTaproot) input.tapInternalKey = internalPubkey;
    psbt.addInput(input as unknown as Parameters<typeof psbt.addInput>[0]);
    inputsToSign.push({ index: i, address });
  }

  const sortOutputs = computeSortOutputs(selectedUtxos, taprootAddress, paymentAddress);
  for (const out of sortOutputs) {
    psbt.addOutput({ address: out.address, value: out.value });
  }

  const totalInput = allInputUtxos.reduce((sum, u) => sum + BigInt(u.value), 0n);
  const totalOutput = sortOutputs.reduce((sum, o) => sum + o.value, 0n);

  const numTaprootInputs = allInputUtxos.filter((u) => u.source === 'taproot').length;
  const numSegwitInputs = allInputUtxos.length - numTaprootInputs;
  const numOutputs = sortOutputs.length + 1;
  const estimatedVBytes = Math.ceil(10.5 + numTaprootInputs * 57.5 + numSegwitInputs * 68 + numOutputs * 43);
  const fee = BigInt(Math.ceil(estimatedVBytes * feeRate));

  const changeValue = totalInput - totalOutput - fee;
  if (changeValue < 0n) {
    throw new Error(`Insufficient funds. Need ${totalOutput + fee} sats, have ${totalInput} sats.`);
  }
  if (changeValue >= DUST_LIMIT) {
    psbt.addOutput({ address: paymentAddress, value: changeValue });
  }

  return { psbt, inputsToSign };
}
