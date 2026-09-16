'use client';

import type { ConsolidationAccount } from '@/store/consolidateStore';

function short(address: string): string {
  return `${address.slice(0, 10)}…${address.slice(-6)}`;
}

export default function AccountList({
  accounts,
  onRemove,
}: {
  accounts: ConsolidationAccount[];
  onRemove: (id: string) => void;
}) {
  if (accounts.length === 0) return <p className="text-sm text-gray-400">No accounts collected yet.</p>;

  return (
    <div className="flex flex-col gap-2">
      {accounts.map((account, index) => (
        <div key={account.id} className="rounded-lg border border-gray-800 bg-gray-900 px-3 py-2 text-xs text-gray-300 flex items-center justify-between gap-3">
          <span>Account {index + 1}: {short(account.paymentAddress)} / {short(account.taprootAddress)}</span>
          <button onClick={() => onRemove(account.id)} className="text-red-400 hover:text-red-300">Remove</button>
        </div>
      ))}
    </div>
  );
}
