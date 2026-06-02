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
}): SatLedgerPlan {
  const { inputs, taprootAddress, paymentAddress, feeRate } = params;

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
  const taprootInputs = inputs.filter((u) => u.source === 'taproot').length;
  const segwitInputs = inputs.length - taprootInputs;
  const estimatedVBytes = estimateVBytes(taprootInputs, segwitInputs, outputs.length + 1);
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
