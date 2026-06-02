import { useSortStore } from '@/store/sortStore';
import { planSort } from '@/lib/tx/sort';
import type { SortPlan } from '@/lib/tx/sort';
import { classifyPlacement } from '@/types';
import type { LabeledUtxo } from '@/types';

export interface SortPlanView {
  plan: SortPlan;
  selectedUtxos: LabeledUtxo[];
  /** `txid:vout` keys of the UTXOs the plan consumes purely to fund the fee. */
  feeUtxoKeys: Set<string>;
}

/**
 * Derive the current sort plan from store state. Shared by SortButton (to
 * build/validate the transaction) and UtxoTable (to show which UTXOs fund the
 * fee) so both render from exactly the same plan.
 *
 * Fee UTXOs are plain, correctly-placed sats not already selected. Detection is
 * authoritative via ord on both networks (an unknown/asset UTXO is never 'plain'),
 * so no heuristic size floor is needed to keep an asset out of the fee pool.
 */
export function useSortPlan(): SortPlanView {
  const utxos = useSortStore((s) => s.utxos);
  const selectedKeys = useSortStore((s) => s.selectedKeys);
  const feeRate = useSortStore((s) => s.selectedFeeRate);

  const selectedUtxos = utxos.filter((u) => selectedKeys.has(`${u.txid}:${u.vout}`));

  const availableFeeUtxos = utxos.filter((u) => {
    if (classifyPlacement(u) !== 'correct' || u.label !== 'plain') return false;
    if (selectedKeys.has(`${u.txid}:${u.vout}`)) return false;
    return true;
  });

  const plan = planSort({ selectedUtxos, availableFeeUtxos, feeRate });
  const feeUtxoKeys = new Set(plan.feeUtxos.map((u) => `${u.txid}:${u.vout}`));

  return { plan, selectedUtxos, feeUtxoKeys };
}
