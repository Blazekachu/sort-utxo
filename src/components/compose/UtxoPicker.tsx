'use client';

import { useComposeStore } from '@/store/composeStore';
import type { ComposeUtxo } from '@/lib/compose/types';

function kindChip(kind: ComposeUtxo['kind']): string {
  if (kind === 'inscription') return 'Inscription';
  if (kind === 'rune') return 'Rune';
  if (kind === 'unknown') return 'Unknown';
  return 'Plain';
}

function selectableSpend(u: ComposeUtxo): boolean {
  return u.confirmed && u.satRanges !== null && u.kind !== 'rune' && u.kind !== 'unknown';
}

function selectableFee(u: ComposeUtxo): boolean {
  return selectableSpend(u) && u.source === 'payment' && u.kind === 'plain';
}

export default function UtxoPicker() {
  const utxos = useComposeStore((s) => s.utxos);
  const spendKeys = useComposeStore((s) => s.spendKeys);
  const feeKeys = useComposeStore((s) => s.feeKeys);
  const toggleSpend = useComposeStore((s) => s.toggleSpend);
  const toggleFee = useComposeStore((s) => s.toggleFee);

  if (utxos.length === 0) return null;

  return (
    <div className="w-full overflow-x-auto">
      <p className="text-xs text-gray-500 mb-2">
        Spend inputs first. Fee/padding must be a plain payment UTXO (native or nested). Rune UTXOs cannot be spent.
      </p>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-800 text-left text-xs text-gray-500">
            <th className="pb-2 pr-2">Spend</th>
            <th className="pb-2 pr-2">Fee</th>
            <th className="pb-2 pr-2">Outpoint</th>
            <th className="pb-2 pr-2">Kind</th>
            <th className="pb-2 pr-2">Addr</th>
            <th className="pb-2 pr-2">Value</th>
            <th className="pb-2">Ranges</th>
          </tr>
        </thead>
        <tbody>
          {utxos.map((u) => {
            const key = `${u.txid}:${u.vout}`;
            return (
              <tr key={key} className="border-b border-gray-900 text-gray-300 align-top">
                <td className="py-2 pr-2">
                  <input
                    type="checkbox"
                    disabled={!selectableSpend(u)}
                    checked={spendKeys.has(key)}
                    onChange={() => toggleSpend(key)}
                    className="accent-orange-500"
                  />
                </td>
                <td className="py-2 pr-2">
                  <input
                    type="checkbox"
                    disabled={!selectableFee(u)}
                    checked={feeKeys.has(key)}
                    onChange={() => toggleFee(key)}
                    className="accent-orange-500"
                  />
                </td>
                <td className="py-2 pr-2 font-mono text-xs">
                  {u.txid.slice(0, 8)}…:{u.vout}
                  {!u.confirmed && <span className="block text-yellow-500">unconfirmed</span>}
                </td>
                <td className="py-2 pr-2 text-xs">{kindChip(u.kind)}</td>
                <td className="py-2 pr-2 text-xs">{u.source === 'taproot' ? 'Taproot' : u.addressKind}</td>
                <td className="py-2 pr-2 font-mono text-xs">{u.value.toLocaleString()}</td>
                <td className="py-2 text-xs font-mono text-gray-400">
                  {u.satRanges === null && 'ranges unknown'}
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
