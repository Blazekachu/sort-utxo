'use client';

import { useCallback } from 'react';
import Link from 'next/link';
import { useComposeStore } from '@/store/composeStore';
import { parseWalletNetworkName } from '@/lib/compose/network';
import { setComposeMempoolNetwork, fetchComposeUtxos, fetchComposeFeeRates } from '@/lib/compose/mempool';
import { scanComposeUtxos } from '@/lib/compose/scan';
import ComposeWalletBar from '@/components/compose/ComposeWalletBar';
import UtxoPicker from '@/components/compose/UtxoPicker';
import OutputRows from '@/components/compose/OutputRows';
import SatPreview from '@/components/compose/SatPreview';
import OpReturnField from '@/components/compose/OpReturnField';
import VanityField from '@/components/compose/VanityField';
import ComposeSignButton from '@/components/compose/ComposeSignButton';

export default function ComposePage() {
  const wallet = useComposeStore((s) => s.wallet);
  const scanStatus = useComposeStore((s) => s.scanStatus);
  const setScanStatus = useComposeStore((s) => s.setScanStatus);
  const setUtxos = useComposeStore((s) => s.setUtxos);
  const setFeeRates = useComposeStore((s) => s.setFeeRates);
  const feeRates = useComposeStore((s) => s.feeRates);
  const selectedFeeRate = useComposeStore((s) => s.selectedFeeRate);
  const setSelectedFeeRate = useComposeStore((s) => s.setSelectedFeeRate);

  const chain = parseWalletNetworkName(wallet.network, wallet.paymentAddress);

  const runScan = useCallback(async () => {
    const w = useComposeStore.getState().wallet;
    if (!w.connected) return;
    const sessionChain = parseWalletNetworkName(w.network, w.paymentAddress);
    try {
      setScanStatus({ state: 'scanning', scanned: 0, total: 0 });
      setComposeMempoolNetwork(sessionChain);
      const [taprootUtxos, paymentUtxos] = await Promise.all([
        fetchComposeUtxos(w.taprootAddress),
        fetchComposeUtxos(w.paymentAddress),
      ]);
      const raw = [
        ...taprootUtxos.map((u) => ({ ...u, address: w.taprootAddress, source: 'taproot' as const })),
        ...paymentUtxos.map((u) => ({ ...u, address: w.paymentAddress, source: 'payment' as const })),
      ];
      setScanStatus({ state: 'scanning', scanned: 0, total: raw.length });
      const labeled = await scanComposeUtxos(raw, sessionChain, (scanned, total) => {
        setScanStatus({ state: 'scanning', scanned, total });
      });
      setUtxos(labeled);
      const fees = await fetchComposeFeeRates();
      setFeeRates(fees);
      setScanStatus({ state: 'done' });
    } catch (err) {
      setScanStatus({ state: 'error', message: err instanceof Error ? err.message : 'Scan failed', failedCount: 0 });
    }
  }, [setScanStatus, setUtxos, setFeeRates]);

  return (
    <main className="flex flex-col items-center min-h-screen p-6 md:p-8">
      <div className="w-full max-w-3xl flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-white">UTXO Composer</h1>
          <div className="flex items-center gap-3">
            <Link href="/" className="text-xs text-orange-400 hover:underline">Sort</Link>
            <Link href="/consolidate" className="text-xs text-orange-400 hover:underline">Consolidate</Link>
            {wallet.connected && (
              <span className={`text-xs font-medium px-2 py-1 rounded ${
                chain === 'signet'
                  ? 'bg-yellow-900/50 text-yellow-400 border border-yellow-700'
                  : 'bg-green-900/50 text-green-400 border border-green-700'
              }`}>
                {chain === 'signet' ? 'Signet' : 'Mainnet'}
              </span>
            )}
          </div>
        </div>
        <ComposeWalletBar onConnected={runScan} />
        {scanStatus.state === 'scanning' && (
          <p className="text-sm text-gray-400">Scanning {scanStatus.scanned}/{scanStatus.total}…</p>
        )}
        {scanStatus.state === 'error' && (
          <p className="text-sm text-red-400">{scanStatus.message}</p>
        )}
        {scanStatus.state === 'done' && (
          <>
            <UtxoPicker />
            <OutputRows />
            {feeRates && (
              <div className="flex items-center gap-2 text-xs text-gray-400">
                <span>Fee rate</span>
                <input
                  type="number"
                  min={1}
                  value={selectedFeeRate}
                  onChange={(e) => setSelectedFeeRate(Number(e.target.value))}
                  className="w-20 rounded-lg border border-gray-700 bg-gray-900 px-2 py-1 text-white"
                />
                <span>sat/vB (medium {feeRates.halfHourFee})</span>
              </div>
            )}
            <OpReturnField />
            <VanityField />
            <SatPreview />
            <ComposeSignButton />
          </>
        )}
      </div>
    </main>
  );
}
