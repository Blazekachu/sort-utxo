'use client';

import { useRef, useState } from 'react';
import { useComposeStore } from '@/store/composeStore';
import { useWalletStore } from '@/store/walletStore';
import { useComposePlan } from './useComposePlan';
import { buildComposePsbt } from '@/lib/compose/psbt';
import { bitcoinNetworkForChain, parseWalletNetworkName } from '@/lib/compose/network';
import { VanityGrinder } from '@/lib/compose/vanity/grinder';
import { assertVanityHex } from '@/lib/compose/vanity/locktime';
import { serializeForTxid } from '@/lib/compose/txid';

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function u32le(bytes: Uint8Array): number {
  return (bytes[0] | (bytes[1] << 8) | (bytes[2] << 16) | (bytes[3] << 24)) >>> 0;
}

export default function VanityField() {
  const wallet = useWalletStore((s) => s.wallet);
  const prefix = useComposeStore((s) => s.vanityPrefix);
  const suffix = useComposeStore((s) => s.vanitySuffix);
  const setPrefix = useComposeStore((s) => s.setVanityPrefix);
  const setSuffix = useComposeStore((s) => s.setVanitySuffix);
  const vanityTxid = useComposeStore((s) => s.vanityTxid);
  const setVanityTxid = useComposeStore((s) => s.setVanityTxid);
  const setVanityLocktime = useComposeStore((s) => s.setVanityLocktime);
  const plan = useComposePlan();
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
    if (!plan.ok) {
      setError(plan.error ?? 'Plan is not buildable.');
      return;
    }
    const chain = parseWalletNetworkName(wallet.network, wallet.paymentAddress);
    const network = bitcoinNetworkForChain(chain);
    const fullPubkey = hexToBytes(wallet.publicKey);
    const internalPubkey = fullPubkey.length === 33 ? fullPubkey.slice(1) : fullPubkey;
    const paymentPublicKey = wallet.paymentPublicKey ? hexToBytes(wallet.paymentPublicKey) : undefined;
    const { psbt } = buildComposePsbt({
      inputs: plan.inputs.map((i) => ({
        txid: i.utxo.txid, vout: i.utxo.vout, value: i.utxo.value, address: i.utxo.address,
      })),
      outputs: plan.outputs.map((o) => ({ address: o.address, value: o.value })),
      opReturnScript: plan.opReturnScript,
      taprootInternalKey: internalPubkey,
      paymentPublicKey,
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
      <p className="text-xs text-gray-500">Vanity TXID (optional) — click Grind. Typing prefix/suffix does not change the tx until a match is locked.</p>
      <div className="flex gap-2">
        <input value={prefix} onChange={(e) => setPrefix(e.target.value.trim())} placeholder="prefix" className="w-24 rounded-lg border border-gray-700 bg-gray-900 px-2 py-1.5 text-xs font-mono text-white" />
        <input value={suffix} onChange={(e) => setSuffix(e.target.value.trim())} placeholder="suffix" className="w-24 rounded-lg border border-gray-700 bg-gray-900 px-2 py-1.5 text-xs font-mono text-white" />
        {running ? (
          <button onClick={stop} className="text-xs text-red-400">Stop</button>
        ) : (
          <button onClick={start} className="text-xs text-orange-400">Grind</button>
        )}
      </div>
      <p className="text-xs text-gray-600">{difficulty.description}</p>
      {pending && <p className="text-xs text-yellow-500">Not locked — this sign will use a normal TXID, not {prefix}…{suffix}.</p>}
      {progress && <p className="text-xs font-mono text-gray-400">{progress}</p>}
      {vanityTxid && <p className="text-xs font-mono text-green-400">locked {vanityTxid}</p>}
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
