'use client';

import { useComposePlan } from './useComposePlan';

export default function SatPreview() {
  const plan = useComposePlan();

  if (!plan.ok) {
    return <p className="text-sm text-red-400">{plan.error}</p>;
  }

  return (
    <div className="w-full rounded-lg border border-gray-800 bg-gray-900 px-4 py-3 flex flex-col gap-2">
      <p className="text-xs text-gray-500">Sat-line preview</p>
      {plan.outputs.map((o, i) => (
        <div key={i} className="text-xs text-gray-300 font-mono">
          vout{i} {o.value.toLocaleString()} sats → {o.address.slice(0, 12)}… [{o.satStart},{o.satEnd})
          {o.startsWithTaggedSat ? ' offset0-tagged' : ''}
          {o.inscriptions.map((ins) => (
            <span key={ins.id} className="text-orange-400"> insc@{ins.outputOffset} {ins.id.slice(0, 10)}…</span>
          ))}
        </div>
      ))}
      {plan.opReturnScript && <p className="text-xs text-gray-500">OP_RETURN 0 sats — not on the sat line</p>}
      <p className="text-xs text-gray-500">Fee tail {plan.fee.toLocaleString()} sats · ~{plan.estimatedVBytes} vB</p>
    </div>
  );
}
