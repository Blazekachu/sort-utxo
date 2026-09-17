'use client';

import { useComposePlan } from './useComposePlan';
import { useComposeStore } from '@/store/composeStore';

function satsToBtc(sats: number): string {
  return (sats / 100_000_000).toFixed(8).replace(/0+$/, '').replace(/\.$/, '');
}

export default function SatPreview() {
  const plan = useComposePlan();
  const opReturnText = useComposeStore((s) => s.opReturnText);

  if (!plan.ok) {
    return <p className="text-sm text-red-400">{plan.error}</p>;
  }

  return (
    <div className="w-full rounded-lg border border-gray-800 bg-gray-900 px-4 py-3 flex flex-col gap-3">
      <p className="text-xs text-gray-500">Exact transaction (same vin/vout order as the PSBT / explorer)</p>

      <div className="flex flex-col gap-1">
        <p className="text-xs text-gray-500">Inputs</p>
        {plan.inputs.map((item, i) => (
          <div key={`${item.utxo.txid}:${item.utxo.vout}`} className="text-xs text-gray-300 font-mono">
            vin{i} {item.utxo.value.toLocaleString()} sats ({satsToBtc(item.utxo.value)} BTC) {item.utxo.address.slice(0, 12)}… {item.utxo.txid.slice(0, 8)}…:{item.utxo.vout}
            {item.role === 'fee' ? ' fee+change' : ` ${item.role}`}
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-1">
        <p className="text-xs text-gray-500">Outputs</p>
        {plan.outputs.map((o, i) => (
          <div key={i} className="text-xs text-gray-300 font-mono">
            vout{i} {o.value.toLocaleString()} sats ({satsToBtc(o.value)} BTC) → {o.address.slice(0, 12)}… offsets [{o.satStart},{o.satEnd - 1}]
            {o.isChange ? ' change' : ''}
            {o.startsWithTaggedSat ? ' offset0-tagged' : ''}
            {o.inscriptions.map((ins) => (
              <span key={ins.id} className="text-orange-400"> insc@{ins.outputOffset} {ins.id.slice(0, 10)}…</span>
            ))}
          </div>
        ))}
        {plan.opReturnScript && (
          <p className="text-xs text-gray-400 font-mono">
            vout{plan.outputs.length} OP_RETURN 0 BTC{opReturnText.trim() ? ` — “${opReturnText.trim()}”` : ''}
          </p>
        )}
      </div>

      <p className="text-xs text-gray-500">
        Network fee {plan.fee.toLocaleString()} sats ({satsToBtc(plan.fee)} BTC) · ~{plan.estimatedVBytes} vB
      </p>
    </div>
  );
}
