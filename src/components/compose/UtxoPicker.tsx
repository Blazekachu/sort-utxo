'use client';

import { useMemo } from 'react';
import { useComposeStore } from '@/store/composeStore';
import { canComposeFee, canComposeSpend } from '@/lib/compose/gates';
import { orderComposeInputs } from '@/lib/compose/plan';
import type { ComposeUtxo } from '@/lib/compose/types';

function kindChip(kind: ComposeUtxo['kind']): string {
  if (kind === 'inscription') return 'Inscription';
  if (kind === 'rune') return 'Rune';
  if (kind === 'unknown') return 'Unknown';
  return 'Plain';
}

function skipReason(u: ComposeUtxo): string | null {
  if (!u.confirmed) return 'unconfirmed';
  if (u.kind === 'rune') return 'rune — v1 will not spend';
  if (u.kind === 'unknown') return 'ord label failed';
  return null;
}

export default function UtxoPicker() {
  const utxos = useComposeStore((s) => s.utxos);
  const inputOrder = useComposeStore((s) => s.inputOrder);
  const toggleInput = useComposeStore((s) => s.toggleInput);
  const moveInput = useComposeStore((s) => s.moveInput);

  const vinOf = useMemo(() => {
    const map = new Map<string, number>();
    orderComposeInputs(utxos, inputOrder).forEach((item, i) => {
      map.set(`${item.utxo.txid}:${item.utxo.vout}`, i);
    });
    return map;
  }, [utxos, inputOrder]);

  const lastKey = inputOrder.length > 0 ? inputOrder[inputOrder.length - 1] : null;
  const lastUtxo = lastKey
    ? utxos.find((u) => `${u.txid}:${u.vout}` === lastKey)
    : undefined;
  const lastOk = lastUtxo ? canComposeFee(lastUtxo) : false;

  if (utxos.length === 0) return null;

  return (
    <div className="w-full overflow-x-auto">
      <p className="text-xs text-gray-500 mb-2">
        Select adds to the end of the vin list (click order). Use ↑↓ to rearrange.
        The last vin must be a plain payment UTXO — it pays the network fee and receives change.
      </p>
      {inputOrder.length > 0 && !lastOk && (
        <p className="text-xs text-red-400 mb-2">
          Last selected input is not a plain payment UTXO. Move a payment UTXO to the end, or select one last.
        </p>
      )}
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-800 text-left text-xs text-gray-500">
            <th className="pb-2 pr-2">vin</th>
            <th className="pb-2 pr-2">Select</th>
            <th className="pb-2 pr-2">Order</th>
            <th className="pb-2 pr-2">Outpoint</th>
            <th className="pb-2 pr-2">Kind</th>
            <th className="pb-2 pr-2">Addr</th>
            <th className="pb-2 pr-2">Value</th>
            <th className="pb-2">Offsets</th>
          </tr>
        </thead>
        <tbody>
          {utxos.map((u) => {
            const key = `${u.txid}:${u.vout}`;
            const reason = skipReason(u);
            const vin = vinOf.get(key);
            const selected = vin !== undefined;
            const isLast = selected && key === lastKey;
            return (
              <tr key={key} className="border-b border-gray-900 text-gray-300 align-top">
                <td className="py-2 pr-2 font-mono text-xs text-orange-400">
                  {selected ? vin : '—'}
                  {isLast && <span className="block text-[10px] text-yellow-500">fee+change</span>}
                </td>
                <td className="py-2 pr-2">
                  <input
                    type="checkbox"
                    disabled={!canComposeSpend(u)}
                    checked={selected}
                    onChange={() => toggleInput(key)}
                    className="h-4 w-4 cursor-pointer accent-orange-500 disabled:cursor-not-allowed"
                  />
                </td>
                <td className="py-2 pr-2">
                  {selected ? (
                    <div className="flex gap-1">
                      <button
                        type="button"
                        onClick={() => moveInput(key, 'up')}
                        disabled={vin === 0}
                        className="text-xs text-gray-400 hover:text-white disabled:opacity-30"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        onClick={() => moveInput(key, 'down')}
                        disabled={vin === inputOrder.length - 1}
                        className="text-xs text-gray-400 hover:text-white disabled:opacity-30"
                      >
                        ↓
                      </button>
                    </div>
                  ) : (
                    <span className="text-xs text-gray-700">—</span>
                  )}
                </td>
                <td className="py-2 pr-2 font-mono text-xs">
                  {u.txid.slice(0, 8)}…:{u.vout}
                  {reason && <span className="block text-yellow-500">{reason}</span>}
                </td>
                <td className="py-2 pr-2 text-xs">{kindChip(u.kind)}</td>
                <td className="py-2 pr-2 text-xs">{u.source === 'taproot' ? 'Taproot' : u.addressKind}</td>
                <td className="py-2 pr-2 font-mono text-xs">{u.value.toLocaleString()}</td>
                <td className="py-2 text-xs font-mono text-gray-400">
                  {u.satRanges === null && <div>@0–{u.value}</div>}
                  {u.satRanges?.map((r, i) => (
                    <div key={i}>
                      @{r.offset} {r.start.toString()}–{r.endExclusive.toString()}
                      {r.rarityTags.length > 0 && ` [${r.rarityTags.map((t) => t.rarity).join(',')}]`}
                    </div>
                  ))}
                  {u.assets.filter((a) => a.kind === 'inscription').map((a) => (
                    a.kind === 'inscription' ? (
                      <div key={a.id} className="text-orange-400">insc @{a.offset} {a.id.slice(0, 12)}…</div>
                    ) : null
                  ))}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
