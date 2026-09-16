'use client';

import { useComposeStore } from '@/store/composeStore';

export default function OutputRows() {
  const wallet = useComposeStore((s) => s.wallet);
  const rows = useComposeStore((s) => s.outputRows);
  const setOutputRows = useComposeStore((s) => s.setOutputRows);

  function addRow(value: number, address: string) {
    setOutputRows([...rows, { id: crypto.randomUUID(), value, address }]);
  }

  function update(id: string, patch: { value?: number; address?: string }) {
    setOutputRows(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function remove(id: string) {
    setOutputRows(rows.filter((r) => r.id !== id));
  }

  return (
    <div className="w-full flex flex-col gap-3">
      <p className="text-xs text-gray-500">Outputs (FIFO order). Presets 330 / 546 put a sat at offset 0 of that row if the previous rows consume everything before it.</p>
      {rows.map((row, i) => (
        <div key={row.id} className="flex flex-wrap gap-2 items-center">
          <span className="text-xs text-gray-600 w-6">{i}</span>
          <input
            type="number"
            min={1}
            value={row.value}
            onChange={(e) => update(row.id, { value: Number(e.target.value) })}
            className="w-28 rounded-lg border border-gray-700 bg-gray-900 px-2 py-1.5 text-sm text-white"
          />
          <input
            value={row.address}
            onChange={(e) => update(row.id, { address: e.target.value.trim() })}
            className="flex-1 min-w-48 rounded-lg border border-gray-700 bg-gray-900 px-2 py-1.5 text-xs font-mono text-white"
          />
          <button onClick={() => remove(row.id)} className="text-xs text-red-400">Remove</button>
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        <button onClick={() => addRow(330, wallet.taprootAddress)} className="rounded border border-gray-700 px-2 py-1 text-xs text-gray-300 hover:border-orange-500">+ 330 taproot</button>
        <button onClick={() => addRow(546, wallet.taprootAddress)} className="rounded border border-gray-700 px-2 py-1 text-xs text-gray-300 hover:border-orange-500">+ 546 taproot</button>
        <button onClick={() => addRow(1000, wallet.paymentAddress)} className="rounded border border-gray-700 px-2 py-1 text-xs text-gray-300 hover:border-orange-500">+ custom payment</button>
      </div>
    </div>
  );
}
