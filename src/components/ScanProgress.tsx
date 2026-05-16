'use client';

import { useSortStore } from '@/store/sortStore';

export default function ScanProgress() {
  const scanStatus = useSortStore((s) => s.scanStatus);

  if (scanStatus.state !== 'scanning') return null;

  const percent = scanStatus.total > 0
    ? Math.round((scanStatus.scanned / scanStatus.total) * 100)
    : 0;

  return (
    <div className="w-full flex flex-col gap-2">
      <div className="flex justify-between text-xs text-gray-400">
        <span>Scanning UTXOs...</span>
        <span>{scanStatus.scanned} / {scanStatus.total}</span>
      </div>
      <div className="w-full h-2 rounded-full bg-gray-800 overflow-hidden">
        <div
          className="h-full bg-orange-500 rounded-full transition-all duration-300"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
