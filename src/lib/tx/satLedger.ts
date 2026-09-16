import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import { estimateVBytes } from './sort';

const DUST = 546;

export interface LedgerInput {
  txid: string;
  vout: number;
  value: number;
  source: 'taproot' | 'payment';
  /** sat offsets of inscriptions within THIS utxo (need not be sorted). [] if none. */
  inscriptionOffsets: number[];
}

export type LedgerOutputKind = 'prepad' | 'inscription' | 'change';

export interface LedgerOutput {
  address: string;
  value: number;
  kind: LedgerOutputKind;
}

export interface SatLedgerPlan {
  ok: boolean;
  error?: string;
  outputs: LedgerOutput[];
  fee: number;
  estimatedVBytes: number;
  /** indices into `outputs` carrying an inscription (taproot) — rune-edict targets in Plan 2b. */
  assetOutputIndices: number[];
}

/**
 * Plan a sort transaction's outputs by walking the concatenated input sat line.
 * Inputs MUST already be ordered (caller's responsibility): typically
 * [asset UTXOs, plain UTXOs, fee UTXOs]. Outputs are emitted in sat order so
 * each inscription's sat lands on its own 546 taproot output; plain sats (pre-pad
 * + leftover) return to segwit; the fee is the unassigned tail.
 */
export function planSatLedger(params: {
  inputs: LedgerInput[];
  taprootAddress: string;
  paymentAddress: string;
  feeRate: number;
  /** Extra outputs emitted by a caller before this ledger's sat walk. */
  additionalOutputCount?: number;
  /** Override input counts when a caller has value-neutral prefixed inputs. */
  feeInputCounts?: { taproot: number; segwit: number };
}): SatLedgerPlan {
  const {
    inputs, taprootAddress, paymentAddress, feeRate,
    additionalOutputCount = 0,
    feeInputCounts,
  } = params;

  const fail = (error: string): SatLedgerPlan =>
    ({ ok: false, error, outputs: [], fee: 0, estimatedVBytes: 0, assetOutputIndices: [] });

  if (inputs.length === 0) return fail('No inputs.');

  // 1. Absolute inscription positions across the concatenated input sat line.
  const positions: number[] = [];
  let start = 0;
  for (const inp of inputs) {
    for (const offset of inp.inscriptionOffsets) positions.push(start + offset);
    start += inp.value;
  }
  const totalIn = start;
  const sortedPositions = [...new Set(positions)].sort((a, b) => a - b);

  // 2. Walk the sat line, emitting outputs in sat order.
  const outputs: LedgerOutput[] = [];
  const assetOutputIndices: number[] = [];
  let cursor = 0;
  for (const p of sortedPositions) {
    if (p < cursor) return fail('Overlapping inscription postage — cannot isolate cleanly.');
    const gap = p - cursor;
    let dustStart = p;
    if (gap >= DUST) {
      outputs.push({ address: paymentAddress, value: gap, kind: 'prepad' });
      cursor = p;
    } else if (gap > 0) {
      // Sub-dust pre-pad: fold it into the inscription output (a few plain sats
      // ride to taproot rather than emit an invalid <546 output).
      dustStart = cursor;
    }
    outputs.push({ address: taprootAddress, value: (p + DUST) - dustStart, kind: 'inscription' });
    assetOutputIndices.push(outputs.length - 1);
    cursor = p + DUST;
  }

  if (cursor > totalIn) {
    return fail('Inscription lacks 546 sats of postage to end-of-inputs. Add a funding/padding UTXO.');
  }

  // 3. Fee (sized assuming one change output) + final change.
  const taprootInputs = feeInputCounts?.taproot ?? inputs.filter((u) => u.source === 'taproot').length;
  const segwitInputs = feeInputCounts?.segwit ?? inputs.length - taprootInputs;
  const estimatedVBytes = estimateVBytes(taprootInputs, segwitInputs, outputs.length + 1 + additionalOutputCount);
  const fee = Math.ceil(estimatedVBytes * feeRate);
  const finalChange = totalIn - cursor - fee;

  if (finalChange < 0) return fail(`Not enough sats to cover postage + fee. Need ~${-finalChange} more sats.`);
  if (finalChange >= DUST) {
    outputs.push({ address: paymentAddress, value: finalChange, kind: 'change' });
  } else if (finalChange > 0) {
    if (assetOutputIndices.length === 0) return fail('Sub-dust change with no asset output to fold into.');
    outputs[assetOutputIndices[assetOutputIndices.length - 1]].value += finalChange;
  }
  // finalChange === 0: exact, no change output.

  return { ok: true, outputs, fee, estimatedVBytes, assetOutputIndices };
}

bitcoin.initEccLib(ecc);

/**
 * Assemble a PSBT from a sat-ledger layout. The `inputs` MUST be the SAME ordered
 * list passed to planSatLedger (sat positions depend on input order). Outputs are
 * added verbatim; the fee is implicit (sum(inputs) - sum(outputs)).
 */
export function buildSortPsbtFromLedger(params: {
  inputs: LedgerInput[];
  outputs: LedgerOutput[];
  taprootAddress: string;
  paymentAddress: string;
  internalPubkey: Uint8Array;
  network: bitcoin.Network;
}): { psbt: bitcoin.Psbt; inputsToSign: Array<{ index: number; address: string }> } {
  const { inputs, outputs, taprootAddress, paymentAddress, internalPubkey, network } = params;

  const totalIn = inputs.reduce((s, u) => s + u.value, 0);
  const totalOut = outputs.reduce((s, o) => s + o.value, 0);
  if (totalOut > totalIn) throw new Error(`Outputs (${totalOut}) exceed inputs (${totalIn}).`);

  const psbt = new bitcoin.Psbt({ network });
  const inputsToSign: Array<{ index: number; address: string }> = [];

  for (let i = 0; i < inputs.length; i++) {
    const u = inputs[i];
    const address = u.source === 'taproot' ? taprootAddress : paymentAddress;
    const isTaproot = address.startsWith('bc1p') || address.startsWith('tb1p');
    const psbtInput: Record<string, unknown> = {
      hash: u.txid,
      index: u.vout,
      witnessUtxo: { script: bitcoin.address.toOutputScript(address, network), value: BigInt(u.value) },
    };
    if (isTaproot) psbtInput.tapInternalKey = internalPubkey;
    psbt.addInput(psbtInput as unknown as Parameters<typeof psbt.addInput>[0]);
    inputsToSign.push({ index: i, address });
  }

  for (const o of outputs) {
    psbt.addOutput({ address: o.address, value: BigInt(o.value) });
  }

  return { psbt, inputsToSign };
}
