import { useMemo } from 'react';
import { useComposeStore } from '@/store/composeStore';
import { planCompose, type ComposePlan } from '@/lib/compose/plan';

export function useComposePlan(): ComposePlan {
  const utxos = useComposeStore((s) => s.utxos);
  const spendKeys = useComposeStore((s) => s.spendKeys);
  const feeKeys = useComposeStore((s) => s.feeKeys);
  const outputRows = useComposeStore((s) => s.outputRows);
  const selectedFeeRate = useComposeStore((s) => s.selectedFeeRate);
  const opReturnText = useComposeStore((s) => s.opReturnText);

  return useMemo(() => {
    const byKey = new Map(utxos.map((u) => [`${u.txid}:${u.vout}`, u]));
    const inputs = [
      ...[...spendKeys].flatMap((k) => {
        const u = byKey.get(k);
        return u ? [{ utxo: u, role: 'spend' as const }] : [];
      }),
      ...[...feeKeys].flatMap((k) => {
        const u = byKey.get(k);
        return u ? [{ utxo: u, role: 'fee' as const }] : [];
      }),
    ];
    if (inputs.length === 0) {
      return { ok: false, error: 'Select at least one input.', inputs: [], outputs: [], fee: 0, estimatedVBytes: 0 };
    }
    return planCompose({
      inputs,
      outputRows: outputRows.map((r) => ({ value: r.value, address: r.address })),
      feeRate: selectedFeeRate,
      opReturnText,
    });
  }, [utxos, spendKeys, feeKeys, outputRows, selectedFeeRate, opReturnText]);
}
