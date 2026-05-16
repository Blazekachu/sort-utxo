'use client';

import { useSortStore } from '@/store/sortStore';
import { classifyPlacement } from '@/types';
import type { LabeledUtxo } from '@/types';

function truncateTxid(txid: string): string {
  return `${txid.slice(0, 8)}...${txid.slice(-6)}`;
}

function typeLabel(utxo: LabeledUtxo): string {
  if (utxo.label === 'rune') return utxo.runeName ? `Rune (${utxo.runeName})` : 'Rune';
  if (utxo.label === 'inscription') return utxo.inscriptionId ? `Inscription (${utxo.inscriptionId.slice(0, 12)}...)` : 'Inscription';
  return 'Plain';
}

function sourceLabel(source: 'taproot' | 'payment'): string {
  return source === 'taproot' ? 'Taproot' : 'Segwit';
}

function shouldBeLabel(utxo: LabeledUtxo): string {
  return utxo.label === 'plain' ? 'Segwit' : 'Taproot';
}

export default function UtxoTable() {
  const utxos = useSortStore((s) => s.utxos);
  const selectedKeys = useSortStore((s) => s.selectedKeys);
  const toggleSelection = useSortStore((s) => s.toggleSelection);

  if (utxos.length === 0) return null;

  const sorted = [...utxos].sort((a, b) => {
    const aPlace = classifyPlacement(a) === 'misplaced' ? 0 : 1;
    const bPlace = classifyPlacement(b) === 'misplaced' ? 0 : 1;
    return aPlace - bPlace;
  });

  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-800 text-left text-xs text-gray-500">
            <th className="pb-2 pr-3 w-8"></th>
            <th className="pb-2 pr-3">Status</th>
            <th className="pb-2 pr-3">UTXO</th>
            <th className="pb-2 pr-3">Type</th>
            <th className="pb-2 pr-3">Current</th>
            <th className="pb-2 pr-3">Should Be</th>
            <th className="pb-2 text-right">Value</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((utxo) => {
            const key = `${utxo.txid}:${utxo.vout}`;
            const placement = classifyPlacement(utxo);
            const isMisplaced = placement === 'misplaced';
            const isSelected = selectedKeys.has(key);

            return (
              <tr
                key={key}
                className={`border-b border-gray-900 ${isMisplaced ? 'text-white' : 'text-gray-600'}`}
              >
                <td className="py-2 pr-3">
                  {isMisplaced && (
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelection(key)}
                      className="accent-orange-500"
                    />
                  )}
                </td>
                <td className="py-2 pr-3">
                  <span className={`text-xs font-medium ${isMisplaced ? 'text-red-400' : 'text-green-400'}`}>
                    {isMisplaced ? 'Misplaced' : 'Correct'}
                  </span>
                </td>
                <td className="py-2 pr-3 font-mono text-xs">
                  {truncateTxid(utxo.txid)}:{utxo.vout}
                </td>
                <td className="py-2 pr-3 text-xs">{typeLabel(utxo)}</td>
                <td className="py-2 pr-3 text-xs">{sourceLabel(utxo.source)}</td>
                <td className="py-2 pr-3 text-xs">{shouldBeLabel(utxo)}</td>
                <td className="py-2 text-right font-mono text-xs">
                  {utxo.value.toLocaleString()} sats
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
