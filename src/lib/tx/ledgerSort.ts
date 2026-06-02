import type { LabeledUtxo } from '@/types';
import { planSatLedger, type LedgerInput, type SatLedgerPlan } from './satLedger';

export interface LedgerSortResult {
  ok: boolean;
  error?: string;
  /** Ordered inputs used (same order the ledger assumed). */
  inputs: LedgerInput[];
  /** Plain UTXOs pulled in purely to fund the fee. */
  feeUtxos: LabeledUtxo[];
  ledger: SatLedgerPlan;
}

function toLedgerInput(u: LabeledUtxo): LedgerInput {
  return {
    txid: u.txid, vout: u.vout, value: u.value, source: u.source,
    inscriptionOffsets: u.assets.filter((a) => a.kind === 'inscription').map((a) => (a as { offset: number }).offset),
  };
}

const EMPTY_LEDGER: SatLedgerPlan = { ok: false, outputs: [], fee: 0, estimatedVBytes: 0, assetOutputIndices: [] };

/**
 * Select fee UTXOs and order inputs for a sat-aware sort, then plan the ledger.
 * Inputs are ordered [asset UTXOs, plain selected, fee UTXOs]; fee UTXOs are
 * appended largest-first until the ledger is fundable. Rune-bearing selections
 * are blocked here (deferred to Plan 2b) so a rune is never mis-routed.
 */
export function planLedgerSort(params: {
  selectedUtxos: LabeledUtxo[];
  availableFeeUtxos: LabeledUtxo[];
  feeRate: number;
  taprootAddress: string;
  paymentAddress: string;
}): LedgerSortResult {
  const { selectedUtxos, availableFeeUtxos, feeRate, taprootAddress, paymentAddress } = params;

  const fail = (error: string): LedgerSortResult =>
    ({ ok: false, error, inputs: [], feeUtxos: [], ledger: EMPTY_LEDGER });

  if (selectedUtxos.length === 0) return fail('No UTXOs selected.');

  // Plan 2 scope: block runes (Plan 2b adds runestone edicts).
  const runeUtxo = selectedUtxos.find((u) => u.assets.some((a) => a.kind === 'rune'));
  if (runeUtxo) {
    return fail('Moving rune-bearing UTXOs is not supported yet (needs runestone edicts — Plan 2b). Deselect rune UTXOs.');
  }

  const assetUtxos = selectedUtxos.filter((u) => u.assets.length > 0);
  const plainSelected = selectedUtxos.filter((u) => u.assets.length === 0);
  const sortedFeeUtxos = [...availableFeeUtxos].sort((a, b) => b.value - a.value);

  const chosenFee: LabeledUtxo[] = [];
  for (let i = 0; ; i++) {
    const ordered = [...assetUtxos, ...plainSelected, ...chosenFee];
    const inputs = ordered.map(toLedgerInput);
    const ledger = planSatLedger({ inputs, taprootAddress, paymentAddress, feeRate });
    if (ledger.ok) {
      return { ok: true, inputs, feeUtxos: [...chosenFee], ledger };
    }
    const next = sortedFeeUtxos[i];
    if (!next) {
      return { ok: false, error: ledger.error ?? 'Cannot fund the sort.', inputs, feeUtxos: [...chosenFee], ledger };
    }
    chosenFee.push(next);
  }
}
