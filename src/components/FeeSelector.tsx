'use client';

import { useState } from 'react';
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

  // Empty while a tier is active; holds the typed value once the user enters one.
  const [customInput, setCustomInput] = useState('');

  if (!feeRates || selectedKeys.size === 0) return null;

  function applyTier(rate: number) {
    setSelectedFeeRate(rate);
    setCustomInput('');
  }

  function handleCustomChange(value: string) {
    setCustomInput(value);
    const parsed = Number(value);
    if (value.trim() !== '' && Number.isFinite(parsed) && parsed > 0) {
      setSelectedFeeRate(parsed);
    }
  }

  const customActive = customInput.trim() !== '';
  const customInvalid = customActive && !(Number.isFinite(Number(customInput)) && Number(customInput) > 0);

  return (
    <div className="w-full flex flex-col gap-3">
      <p className="text-xs text-gray-500">Fee Rate</p>

      <div className="flex gap-2">
        {tiers.map(({ key, label, desc }) => {
          const rate = feeRates[key];
          const isActive = !customActive && selectedFeeRate === rate;
          return (
            <button
              key={key}
              onClick={() => applyTier(rate)}
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

      <div className="flex items-center gap-2">
        <label htmlFor="custom-fee" className="text-xs text-gray-500 shrink-0">
          Custom
        </label>
        <input
          id="custom-fee"
          type="number"
          inputMode="decimal"
          min="0"
          step="any"
          placeholder="e.g. 1.5"
          value={customInput}
          onChange={(e) => handleCustomChange(e.target.value)}
          className={`w-28 rounded-lg border bg-gray-900 px-2 py-1.5 text-sm transition-colors ${
            customInvalid
              ? 'border-red-500 text-red-400'
              : customActive
                ? 'border-orange-500 text-orange-400'
                : 'border-gray-700 text-white'
          }`}
        />
        <span className="text-xs text-gray-500">sat/vB</span>
      </div>

      {customInvalid && (
        <p className="text-xs text-red-400">Enter a fee rate greater than 0.</p>
      )}
      {feeRates._feeWarning && (
        <p className="text-xs text-yellow-400">{feeRates._feeWarning}</p>
      )}
    </div>
  );
}
