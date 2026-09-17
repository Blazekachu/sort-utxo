'use client';

import { useRef, useState } from 'react';
import { useSortStore } from '@/store/sortStore';
import { useWalletStore } from '@/store/walletStore';
import { useSortPlan } from './useSortPlan';
import { buildSortPsbtFromLedger } from '@/lib/tx/satLedger';
import { bitcoinNetworkForAddress } from '@/lib/api/mempool';
import { VanityGrinder } from '@/lib/compose/vanity/grinder';
import { assertVanityHex } from '@/lib/compose/vanity/locktime';
import { serializeForTxid } from '@/lib/compose/txid';

function u32le(bytes: Uint8Array): number {
  return (bytes[0] | (bytes[1] << 8) | (bytes[2] << 16) | (bytes[3] << 24)) >>> 0;
}

export default function SortVanityField() {
  const wallet = useWalletStore((s) => s.wallet);
  const prefix = useSortStore((s) => s.vanityPrefix);
  const suffix = useSortStore((s) => s.vanitySuffix);
  const setPrefix = useSortStore((s) => s.setVanityPrefix);
  const setSuffix = useSortStore((s) => s.setVanitySuffix);
  const vanityTxid = useSortStore((s) => s.vanityTxid);
  const setVanityTxid = useSortStore((s) => s.setVanityTxid);
  const setVanityLocktime = useSortStore((s) => s.setVanityLocktime);
  const { result } = useSortPlan();
  const grinderRef = useRef<VanityGrinder | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState<string | null>(null);

  function stop() {
    grinderRef.current?.stop();
    setRunning(false);
  }

  function start() {
    setError(null);
    try {
      assertVanityHex(prefix, suffix);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return;
    }
    if (!prefix && !suffix) {
      setError('Enter a hex prefix and/or suffix (max 6).');
      return;
    }
    if (!result.ok) {
      setError(result.error ?? 'Sort plan is not buildable.');
      return;
    }

    const network = bitcoinNetworkForAddress(wallet.paymentAddress);
    const fullPubkey = Buffer.from(wallet.publicKey, 'hex');
    const internalPubkey = fullPubkey.length === 33 ? fullPubkey.subarray(1) : fullPubkey;
    const { psbt } = buildSortPsbtFromLedger({
      inputs: result.inputs,
      outputs: result.ledger.outputs,
      taprootAddress: wallet.taprootAddress,
      paymentAddress: wallet.paymentAddress,
      internalPubkey,
      network,
      nLockTime: 0,
    });
    const template = serializeForTxid(psbt);
    const nonceOffset = template.length - 4;
    const grinder = new VanityGrinder();
    grinderRef.current = grinder;
    setRunning(true);
    setVanityTxid(null);
    setVanityLocktime(null);
    grinder.start({
      txTemplate: template,
      nonceOffset,
      nonceLength: 4,
      config: { prefix: prefix.toLowerCase(), suffix: suffix.toLowerCase() },
      onProgress: (p) => setProgress(`${p.attempts.toLocaleString()} · ${p.speed}/s · best ${p.bestMatch.slice(0, 8)}…`),
      onFound: (nonce, txid) => {
        setVanityLocktime(u32le(nonce));
        setVanityTxid(txid);
        setRunning(false);
        setProgress(`locked ${txid}`);
      },
      onError: (message) => {
        setError(message);
        setRunning(false);
      },
    });
  }

  const difficulty = VanityGrinder.estimateDifficulty(prefix, suffix);
  const pending = Boolean((prefix || suffix) && !vanityTxid && !running);

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-gray-500">
        Vanity TXID (optional) — Grind locks an nLockTime into the same sort plan. Selection/fee changes clear the lock.
      </p>
      <div className="flex gap-2">
        <input
          value={prefix}
          onChange={(e) => setPrefix(e.target.value.trim())}
          placeholder="prefix"
          className="w-24 rounded-lg border border-gray-700 bg-gray-900 px-2 py-1.5 text-xs font-mono text-white"
        />
        <input
          value={suffix}
          onChange={(e) => setSuffix(e.target.value.trim())}
          placeholder="suffix"
          className="w-24 rounded-lg border border-gray-700 bg-gray-900 px-2 py-1.5 text-xs font-mono text-white"
        />
        {running ? (
          <button type="button" onClick={stop} className="text-xs text-red-400">Stop</button>
        ) : (
          <button type="button" onClick={start} disabled={!result.ok} className="text-xs text-orange-400 disabled:opacity-40">
            Grind
          </button>
        )}
      </div>
      <p className="text-xs text-gray-600">{difficulty.description}</p>
      {pending && (
        <p className="text-xs text-yellow-500">
          Not locked — this sign will use a normal TXID, not {prefix}…{suffix}.
        </p>
      )}
      {progress && <p className="text-xs font-mono text-gray-400">{progress}</p>}
      {vanityTxid && <p className="text-xs font-mono text-green-400">locked {vanityTxid}</p>}
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
