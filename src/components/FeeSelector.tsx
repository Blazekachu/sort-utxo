'use client';

import { useSortStore } from '@/store/sortStore';

const tiers = [
  { key: 'fastestFee', label: 'Fast', desc: '~10 min' },
  { key: 'halfHourFee', label: 'Medium', desc: '~30 min' },
  { key: 'hourFee', label: 'Economy', desc: '~60 min' },
] as const;

export default function FeeSelector() {
  const feeRates = useSortStore((s) => s.feeRates);
  const selectedFeeRate = useSortStore((s) => s.selectedFeeRate);
  const setSelectedFeeRate = useSortStore((s) => s.setSelectedFeeRate);
  const selectedKeys = useSortStore((s) => s.selectedKeys);

  if (!feeRates || selectedKeys.size === 0) return null;

  return (
    <div className="w-full flex flex-col gap-3">
      <p className="text-xs text-gray-500">Fee Rate</p>
      <div className="flex gap-2">
        {tiers.map(({ key, label, desc }) => {
          const rate = feeRates[key];
          const isActive = selectedFeeRate === rate;
          return (
            <button
              key={key}
              onClick={() => setSelectedFeeRate(rate)}
              className={`flex-1 rounded-lg border px-3 py-2 text-center transition-colors ${
                isActive
                  ? 'border-orange-500 bg-orange-950/30 text-orange-400'
                  : 'border-gray-700 bg-gray-900 text-gray-400 hover:border-gray-600'
              }`}
            >
              <p className="text-sm font-medium">{label}</p>
              <p className="text-xs text-gray-500">{rate} sat/vB</p>
              <p className="text-xs text-gray-600">{desc}</p>
            </button>
          );
        })}
      </div>
      {feeRates._feeWarning && (
        <p className="text-xs text-yellow-400">{feeRates._feeWarning}</p>
      )}
    </div>
  );
}
