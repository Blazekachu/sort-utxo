'use client';

import { useCallback } from 'react';
import { useSortStore } from '@/store/sortStore';
import { setMempoolNetwork, fetchUtxos, fetchFeeRates } from '@/lib/api/mempool';
import { scanAndLabelUtxos } from '@/lib/scanner/label';
import { classifyPlacement } from '@/types';
import type { Utxo } from '@/types';
import WalletBar from '@/components/WalletBar';
import ScanProgress from '@/components/ScanProgress';
import StatusBanner from '@/components/StatusBanner';
import UtxoTable from '@/components/UtxoTable';
import FeeSelector from '@/components/FeeSelector';
import SortButton from '@/components/SortButton';

function isTestnetAddress(address: string): boolean {
  return address.startsWith('tb1') || address.startsWith('2') || address.startsWith('m') || address.startsWith('n');
}

export default function Home() {
  const wallet = useSortStore((s) => s.wallet);
  const utxos = useSortStore((s) => s.utxos);
  const setUtxos = useSortStore((s) => s.setUtxos);
  const scanStatus = useSortStore((s) => s.scanStatus);
  const setScanStatus = useSortStore((s) => s.setScanStatus);
  const setFeeRates = useSortStore((s) => s.setFeeRates);
  const unconfirmedCount = useSortStore((s) => s.unconfirmedCount);
  const setUnconfirmedCount = useSortStore((s) => s.setUnconfirmedCount);
  const sortStatus = useSortStore((s) => s.sortStatus);

  const isTestnet = wallet.connected && isTestnetAddress(wallet.paymentAddress);

  const runScan = useCallback(async () => {
    // Read wallet directly from store to avoid stale closure
    const w = useSortStore.getState().wallet;
    if (!w.connected) return;

    try {
      setScanStatus({ state: 'scanning', scanned: 0, total: 0 });

      await setMempoolNetwork(w.paymentAddress);

      const [taprootUtxos, paymentUtxos] = await Promise.all([
        fetchUtxos(w.taprootAddress),
        fetchUtxos(w.paymentAddress),
      ]);

      const allRaw: Array<Utxo & { source: 'taproot' | 'payment' }> = [];
      let unconfirmed = 0;

      for (const u of taprootUtxos) {
        if (u.status.confirmed) allRaw.push({ ...u, source: 'taproot' });
        else unconfirmed++;
      }
      for (const u of paymentUtxos) {
        if (u.status.confirmed) allRaw.push({ ...u, source: 'payment' });
        else unconfirmed++;
      }

      setUnconfirmedCount(unconfirmed);

      if (allRaw.length === 0) {
        setUtxos([]);
        setScanStatus({ state: 'done' });
        return;
      }

      setScanStatus({ state: 'scanning', scanned: 0, total: allRaw.length });

      const labeled = await scanAndLabelUtxos(
        allRaw,
        isTestnetAddress(w.paymentAddress),
        (scanned, total) => setScanStatus({ state: 'scanning', scanned, total }),
      );

      setUtxos(labeled);

      const fees = await fetchFeeRates();
      setFeeRates(fees);

      setScanStatus({ state: 'done' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Scan failed';
      setScanStatus({ state: 'error', message: msg, failedCount: 0 });
    }
  }, [setScanStatus, setUtxos, setFeeRates, setUnconfirmedCount]);

  const misplacedCount = utxos.filter((u) => classifyPlacement(u) === 'misplaced').length;
  const allCorrect = scanStatus.state === 'done' && utxos.length > 0 && misplacedCount === 0;
  const noUtxos = scanStatus.state === 'done' && utxos.length === 0;

  return (
    <main className="flex flex-col items-center min-h-screen p-6 md:p-8">
      <div className="w-full max-w-2xl flex flex-col gap-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-white">Sort UTXO</h1>
          {wallet.connected && (
            <span className={`text-xs font-medium px-2 py-1 rounded ${
              isTestnet ? 'bg-yellow-900/50 text-yellow-400 border border-yellow-700' : 'bg-green-900/50 text-green-400 border border-green-700'
            }`}>
              {isTestnet ? 'Testnet4' : 'Mainnet'}
            </span>
          )}
        </div>

        {/* Wallet */}
        <WalletBar onConnected={runScan} />

        {/* Scan Progress */}
        <ScanProgress />

        {/* Status Banners */}
        {scanStatus.state === 'error' && (
          <StatusBanner
            variant="error"
            message={`Could not identify UTXOs — ${scanStatus.message}. Come back later.`}
          />
        )}
        {noUtxos && <StatusBanner variant="info" message="No UTXOs found." />}
        {allCorrect && <StatusBanner variant="success" message="All UTXOs are already sorted correctly!" />}
        {unconfirmedCount > 0 && scanStatus.state === 'done' && (
          <StatusBanner
            variant="warning"
            message={`${unconfirmedCount} unconfirmed UTXO${unconfirmedCount > 1 ? 's' : ''} skipped — wait for confirmation.`}
          />
        )}

        {/* UTXO Table */}
        {scanStatus.state === 'done' && <UtxoTable />}

        {/* Fee Selector */}
        {scanStatus.state === 'done' && <FeeSelector />}

        {/* Sort Button */}
        {scanStatus.state === 'done' && <SortButton />}
      </div>
    </main>
  );
}
