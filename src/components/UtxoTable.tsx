'use client';

import { useSortStore } from '@/store/sortStore';
import { useSortPlan } from './useSortPlan';
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

type RowKind = 'misplaced' | 'fee' | 'correct';

export default function UtxoTable() {
  const utxos = useSortStore((s) => s.utxos);
  const selectedKeys = useSortStore((s) => s.selectedKeys);
  const toggleSelection = useSortStore((s) => s.toggleSelection);
  const { feeUtxoKeys } = useSortPlan();

  if (utxos.length === 0) return null;

  const rowKind = (utxo: LabeledUtxo): RowKind => {
    if (classifyPlacement(utxo) === 'misplaced') return 'misplaced';
    if (feeUtxoKeys.has(`${utxo.txid}:${utxo.vout}`)) return 'fee';
    return 'correct';
  };

  // Misplaced first, then fee inputs, then untouched correct UTXOs.
  const order: Record<RowKind, number> = { misplaced: 0, fee: 1, correct: 2 };
  const sorted = [...utxos].sort((a, b) => order[rowKind(a)] - order[rowKind(b)]);

  return (
    <div className="w-full flex flex-col gap-2">
      <div className="overflow-x-auto">
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
              const kind = rowKind(utxo);
              const isMisplaced = kind === 'misplaced';
              const isFee = kind === 'fee';
              const isSelected = selectedKeys.has(key);

              const rowText = isMisplaced ? 'text-white' : isFee ? 'text-gray-300' : 'text-gray-600';

              return (
                <tr key={key} className={`border-b border-gray-900 ${rowText}`}>
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
                    <span
                      className={`text-xs font-medium ${
                        isMisplaced ? 'text-red-400' : isFee ? 'text-orange-400' : 'text-green-400'
                      }`}
                    >
                      {isMisplaced ? 'Misplaced' : isFee ? 'Fee input' : 'Correct'}
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

      {feeUtxoKeys.size > 0 && (
        <p className="text-xs text-orange-400/80">
          Fee input — a correctly-placed plain UTXO that will be spent to pay the network fee.
        </p>
      )}
    </div>
  );
}
