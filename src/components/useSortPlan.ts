import { useSortStore } from '@/store/sortStore';
import { planSort } from '@/lib/tx/sort';
import type { SortPlan } from '@/lib/tx/sort';
import { classifyPlacement } from '@/types';
import type { LabeledUtxo } from '@/types';

/**
 * Testnet4 fee-UTXO floor. Testnet4 UTXO labels are heuristic — a transferred
 * rune/inscription cannot be detected and may be mislabeled 'plain'. A real
 * asset UTXO is dust-sized (~546 sats), so excluding small UTXOs from the
 * auto fee pool keeps a mislabeled asset from being silently spent as fee.
 * Mainnet uses the ord indexer, so its 'plain' labels are authoritative.
 */
const TESTNET_SAFE_FEE_UTXO_MIN = 1000;

function isTestnetAddress(address: string): boolean {
  return address.startsWith('tb1') || address.startsWith('2') || address.startsWith('m') || address.startsWith('n');
}

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
 */
export function useSortPlan(): SortPlanView {
  const wallet = useSortStore((s) => s.wallet);
  const utxos = useSortStore((s) => s.utxos);
  const selectedKeys = useSortStore((s) => s.selectedKeys);
  const feeRate = useSortStore((s) => s.selectedFeeRate);

  const selectedUtxos = utxos.filter((u) => selectedKeys.has(`${u.txid}:${u.vout}`));
  const isTestnet = isTestnetAddress(wallet.paymentAddress);

  const availableFeeUtxos = utxos.filter((u) => {
    if (classifyPlacement(u) !== 'correct' || u.label !== 'plain') return false;
    if (selectedKeys.has(`${u.txid}:${u.vout}`)) return false;
    if (isTestnet && u.value < TESTNET_SAFE_FEE_UTXO_MIN) return false;
    return true;
  });

  const plan = planSort({ selectedUtxos, availableFeeUtxos, feeRate });
  const feeUtxoKeys = new Set(plan.feeUtxos.map((u) => `${u.txid}:${u.vout}`));

  return { plan, selectedUtxos, feeUtxoKeys };
}
