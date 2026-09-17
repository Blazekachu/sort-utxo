import { useMemo } from 'react';
import { useComposeStore } from '@/store/composeStore';
import { useWalletStore } from '@/store/walletStore';
import { orderComposeInputs, planCompose, type ComposePlan } from '@/lib/compose/plan';

export function useComposePlan(): ComposePlan {
  const utxos = useComposeStore((s) => s.utxos);
  const inputOrder = useComposeStore((s) => s.inputOrder);
  const outputRows = useComposeStore((s) => s.outputRows);
  const selectedFeeRate = useComposeStore((s) => s.selectedFeeRate);
  const opReturnText = useComposeStore((s) => s.opReturnText);
  const paymentAddress = useWalletStore((s) => s.wallet.paymentAddress);

  return useMemo(() => {
    const inputs = orderComposeInputs(utxos, inputOrder);
    if (inputs.length === 0) {
      return { ok: false, error: 'Select at least one input.', inputs: [], outputs: [], fee: 0, estimatedVBytes: 0 };
    }
    return planCompose({
      inputs,
      outputRows: outputRows.map((r) => ({ value: r.value, address: r.address })),
      feeRate: selectedFeeRate,
      opReturnText,
      changeAddress: paymentAddress,
    });
  }, [utxos, inputOrder, outputRows, selectedFeeRate, opReturnText, paymentAddress]);
}
