import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import type { LabeledUtxo } from '@/types';

bitcoin.initEccLib(ecc);

const DUST_LIMIT = 546n;

// Per-component vByte estimates, shared by planSort and buildSortPsbt so the
// fee shown to the user and the fee in the built PSBT are always consistent.
const TX_OVERHEAD_VB = 10.5;
const P2TR_INPUT_VB = 57.5;
const P2WPKH_INPUT_VB = 68;
const OUTPUT_VB = 43;

function estimateVBytes(taprootInputs: number, segwitInputs: number, outputs: number): number {
  return Math.ceil(
    TX_OVERHEAD_VB
      + taprootInputs * P2TR_INPUT_VB
      + segwitInputs * P2WPKH_INPUT_VB
      + outputs * OUTPUT_VB,
  );
}

export interface SortOutput {
  address: string;
  value: bigint;
}

/**
 * The fixed dust outputs of a sort: one 546-sat taproot output per
 * rune/inscription UTXO. Each asset gets its own output — never consolidated
 * — so the rune/inscription binding is preserved.
 *
 * Plain UTXOs produce no output here: their value is folded into the single
 * consolidated segwit output that buildSortPsbt computes, which is also where
 * the fee is drawn from.
 */
export function computeDustOutputs(
  selectedUtxos: LabeledUtxo[],
  taprootAddress: string,
): SortOutput[] {
  return selectedUtxos
    .filter((u) => u.label === 'rune' || u.label === 'inscription')
    .map(() => ({ address: taprootAddress, value: DUST_LIMIT }));
}

export interface SortPlan {
  ok: boolean;
  error?: string;
  /** Extra plain fee UTXOs to add as inputs, in the order they should be added. */
  feeUtxos: LabeledUtxo[];
  estimatedFee: number;
  estimatedVBytes: number;
}

/**
 * Plan a sort: pick the minimal set of extra fee UTXOs needed to fund the
 * transaction, and report the resulting fee.
 *
 * This is the single source of truth. buildSortPsbt MUST be called with the
 * feeUtxos this returns — that guarantees the validation result, the fee
 * shown to the user, and the fee inside the built PSBT all agree.
 *
 * The fee is funded from the moved plain sats first; extra fee UTXOs are only
 * pulled in (largest-first) when the selection cannot cover the fee itself.
 */
export function planSort(params: {
  selectedUtxos: LabeledUtxo[];
  availableFeeUtxos: LabeledUtxo[];
  feeRate: number;
}): SortPlan {
  const { selectedUtxos, availableFeeUtxos, feeRate } = params;

  if (selectedUtxos.length === 0) {
    return { ok: false, error: 'No UTXOs selected.', feeUtxos: [], estimatedFee: 0, estimatedVBytes: 0 };
  }

  const numDustOutputs = selectedUtxos.filter((u) => u.label !== 'plain').length;
  // dust outputs + one consolidated segwit output
  const numOutputs = numDustOutputs + 1;
  const dustCost = BigInt(numDustOutputs) * DUST_LIMIT;
  // When there are no dust outputs, the consolidated segwit output is the
  // only output — it must itself clear the dust limit for a valid TX.
  const minLeftover = numDustOutputs === 0 ? DUST_LIMIT : 0n;
  const required = dustCost + minLeftover;

  // Copy before sorting — never mutate the caller's array.
  const sortedFeeUtxos = [...availableFeeUtxos].sort((a, b) => b.value - a.value);
  const chosen: LabeledUtxo[] = [];

  // A fee UTXO only adds spendable funds if its value clears its own input cost.
  const marginalInputCost = Math.ceil(P2WPKH_INPUT_VB * feeRate);

  for (let i = 0; ; i++) {
    const inputs = [...selectedUtxos, ...chosen];
    const taprootInputs = inputs.filter((u) => u.source === 'taproot').length;
    const segwitInputs = inputs.length - taprootInputs;
    const vbytes = estimateVBytes(taprootInputs, segwitInputs, numOutputs);
    const fee = BigInt(Math.ceil(vbytes * feeRate));
    const totalInput = inputs.reduce((sum, u) => sum + BigInt(u.value), 0n);

    if (totalInput >= required + fee) {
      return { ok: true, feeUtxos: chosen, estimatedFee: Number(fee), estimatedVBytes: vbytes };
    }

    const next = sortedFeeUtxos[i];
    if (!next || next.value <= marginalInputCost) {
      // No fee UTXOs left, or the largest remaining one can't even pay for
      // its own input — adding it would only make the shortfall worse.
      const shortfall = required + fee - totalInput;
      return {
        ok: false,
        error: `Not enough plain sats to cover the fee. Need ~${shortfall} more sats.`,
        feeUtxos: chosen,
        estimatedFee: Number(fee),
        estimatedVBytes: vbytes,
      };
    }
    chosen.push(next);
  }
}

/**
 * Build a PSBT that sorts the selected UTXOs.
 *
 * additionalFeeUtxos must be the feeUtxos returned by planSort for the same
 * selectedUtxos/feeRate, otherwise the fee will not match what was validated.
 */
export function buildSortPsbt(params: {
  selectedUtxos: LabeledUtxo[];
  additionalFeeUtxos: LabeledUtxo[];
  taprootAddress: string;
  paymentAddress: string;
  internalPubkey: Uint8Array;
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

  const dustOutputs = computeDustOutputs(selectedUtxos, taprootAddress);
  for (const out of dustOutputs) {
    psbt.addOutput({ address: out.address, value: out.value });
  }

  const totalInput = allInputUtxos.reduce((sum, u) => sum + BigInt(u.value), 0n);
  const dustTotal = dustOutputs.reduce((sum, o) => sum + o.value, 0n);

  const numTaprootInputs = allInputUtxos.filter((u) => u.source === 'taproot').length;
  const numSegwitInputs = allInputUtxos.length - numTaprootInputs;
  const numOutputs = dustOutputs.length + 1; // dust outputs + consolidated segwit output
  const estimatedVBytes = estimateVBytes(numTaprootInputs, numSegwitInputs, numOutputs);
  const fee = BigInt(Math.ceil(estimatedVBytes * feeRate));

  // Everything not locked into a dust output and not spent on fees is
  // consolidated into a single segwit output. The fee is therefore drawn
  // from the moved plain sats and any fee UTXOs alike.
  const consolidated = totalInput - dustTotal - fee;
  if (consolidated < 0n) {
    throw new Error(`Insufficient funds. Need ${dustTotal + fee} sats, have ${totalInput} sats.`);
  }
  if (dustOutputs.length === 0 && consolidated < DUST_LIMIT) {
    throw new Error('Sort would leave no spendable output. Select more value or lower the fee rate.');
  }
  if (consolidated >= DUST_LIMIT) {
    psbt.addOutput({ address: paymentAddress, value: consolidated });
  }

  return { psbt, inputsToSign };
}
