import { useSortStore } from '@/store/sortStore';
import { useWalletStore } from '@/store/walletStore';
import { classifyPlacement } from '@/types';
import type { LabeledUtxo } from '@/types';
import { planLedgerSort, type LedgerSortResult } from '@/lib/tx/ledgerSort';

export interface SortPlanView {
  result: LedgerSortResult;
  selectedUtxos: LabeledUtxo[];
  /** `txid:vout` keys of UTXOs consumed purely to fund the fee. */
  feeUtxoKeys: Set<string>;
}

/**
 * Derive the current sat-ledger sort from store state. Shared by SortButton (to
 * build/validate the PSBT) and UtxoTable (to show which UTXOs fund the fee) so
 * both render from exactly the same plan.
 *
 * Fee UTXOs are plain, correctly-placed sats not already selected (ord-authoritative
 * labels mean a 'plain' UTXO is safe to spend as fee).
 */
export function useSortPlan(): SortPlanView {
  const wallet = useWalletStore((s) => s.wallet);
  const utxos = useSortStore((s) => s.utxos);
  const selectedKeys = useSortStore((s) => s.selectedKeys);
  const feeRate = useSortStore((s) => s.selectedFeeRate);

  const selectedUtxos = utxos.filter((u) => selectedKeys.has(`${u.txid}:${u.vout}`));
  const availableFeeUtxos = utxos.filter((u) => {
    if (classifyPlacement(u) !== 'correct' || u.label !== 'plain') return false;
    if (selectedKeys.has(`${u.txid}:${u.vout}`)) return false;
    return true;
  });

  const result = planLedgerSort({
    selectedUtxos, availableFeeUtxos, feeRate,
    taprootAddress: wallet.taprootAddress, paymentAddress: wallet.paymentAddress,
  });
  const feeUtxoKeys = new Set(result.feeUtxos.map((u) => `${u.txid}:${u.vout}`));
  return { result, selectedUtxos, feeUtxoKeys };
}
