'use client';

import { useComposeStore } from '@/store/composeStore';

export default function OpReturnField() {
  const text = useComposeStore((s) => s.opReturnText);
  const setText = useComposeStore((s) => s.setOpReturnText);
  const bytes = new TextEncoder().encode(text).length;

  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-gray-500">OP_RETURN (optional, ≤ 80 bytes, 0 sats)</label>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={80}
        placeholder="optional message"
        className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white"
      />
      <p className={`text-xs ${bytes > 80 ? 'text-red-400' : 'text-gray-600'}`}>{bytes}/80 bytes</p>
    </div>
  );
}
