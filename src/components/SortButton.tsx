'use client';

import { useSortStore } from '@/store/sortStore';
import { useSortPlan } from './useSortPlan';
import { buildSortPsbt } from '@/lib/tx/sort';
import { signPsbt } from '@/lib/wallet/xverse';
import { broadcastTx, bitcoinNetworkForAddress, mempoolTxUrl } from '@/lib/api/mempool';
import * as bitcoin from 'bitcoinjs-lib';

export default function SortButton() {
  const wallet = useSortStore((s) => s.wallet);
  const selectedKeys = useSortStore((s) => s.selectedKeys);
  const selectedFeeRate = useSortStore((s) => s.selectedFeeRate);
  const sortStatus = useSortStore((s) => s.sortStatus);
  const setSortStatus = useSortStore((s) => s.setSortStatus);

  // Hooks must run unconditionally — call useSortPlan before any early return.
  const { plan, selectedUtxos } = useSortPlan();

  if (selectedKeys.size === 0) return null;

  async function handleSort() {
    if (!plan.ok) return;

    try {
      setSortStatus({ state: 'building' });

      const network = bitcoinNetworkForAddress(wallet.paymentAddress);
      const fullPubkey = Buffer.from(wallet.publicKey, 'hex');
      const internalPubkey = fullPubkey.length === 33 ? fullPubkey.subarray(1) : fullPubkey;

      // plan.feeUtxos is the exact fee-UTXO set planSort validated against,
      // so the fee inside the PSBT matches the fee shown to the user.
      const { psbt, inputsToSign } = buildSortPsbt({
        selectedUtxos,
        additionalFeeUtxos: plan.feeUtxos,
        taprootAddress: wallet.taprootAddress,
        paymentAddress: wallet.paymentAddress,
        internalPubkey,
        feeRate: selectedFeeRate,
        network,
      });

      setSortStatus({ state: 'signing' });
      const signed = await signPsbt(psbt.toBase64(), inputsToSign);

      let txid: string;
      if (signed.txid) {
        // The wallet signed and broadcast the transaction through its own backend.
        txid = signed.txid;
      } else if (signed.signedPsbt) {
        // Wallet signed but did not broadcast — fall back to mempool.space.
        setSortStatus({ state: 'broadcasting' });
        const signedPsbt = bitcoin.Psbt.fromBase64(signed.signedPsbt, { network });
        try {
          signedPsbt.finalizeAllInputs();
        } catch {
          // The wallet may have already finalized the inputs; extractTransaction
          // below still surfaces a real problem if they genuinely are not final.
        }
        const txHex = signedPsbt.extractTransaction().toHex();
        txid = await broadcastTx(txHex);
      } else {
        throw new Error('Wallet returned neither a txid nor a signed transaction. Please try again.');
      }

      setSortStatus({ state: 'done', txid });
    } catch (err) {
      setSortStatus({
        state: 'error',
        message: err instanceof Error ? err.message : 'Sort failed',
      });
    }
  }

  const isLoading = sortStatus.state === 'building' || sortStatus.state === 'signing' || sortStatus.state === 'broadcasting';
  const loadingLabel =
    sortStatus.state === 'building' ? 'Building...' :
    sortStatus.state === 'signing' ? 'Sign in wallet...' :
    sortStatus.state === 'broadcasting' ? 'Broadcasting...' : '';

  return (
    <div className="w-full flex flex-col gap-3">
      {!plan.ok && (
        <p className="text-sm text-red-400">{plan.error}</p>
      )}

      {sortStatus.state === 'done' && (
        <div className="rounded-lg border border-green-700 bg-green-950/50 px-4 py-3 flex flex-col gap-2">
          <p className="text-sm text-green-300">UTXOs sorted successfully!</p>
          <a
            href={`${mempoolTxUrl(wallet.paymentAddress)}/${sortStatus.txid}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-orange-400 hover:underline font-mono break-all"
          >
            {sortStatus.txid}
          </a>
        </div>
      )}

      {sortStatus.state === 'error' && (
        <p className="text-sm text-red-400">{sortStatus.message}</p>
      )}

      <button
        onClick={handleSort}
        disabled={!plan.ok || isLoading || sortStatus.state === 'done'}
        className="w-full rounded-lg bg-orange-600 px-6 py-3 text-sm font-semibold text-white hover:bg-orange-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isLoading ? loadingLabel : `Sort ${selectedKeys.size} UTXO${selectedKeys.size > 1 ? 's' : ''}`}
      </button>

      {plan.ok && plan.estimatedFee > 0 && sortStatus.state !== 'done' && sortStatus.state !== 'error' && (
        <p className="text-xs text-gray-500 text-center">
          Estimated fee: ~{plan.estimatedFee.toLocaleString()} sats
          {plan.feeUtxos.length > 0 && ` (+${plan.feeUtxos.length} fee input${plan.feeUtxos.length > 1 ? 's' : ''})`}
        </p>
      )}
    </div>
  );
}
