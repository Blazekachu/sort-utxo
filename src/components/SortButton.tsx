'use client';

import { useSortStore } from '@/store/sortStore';
import { buildSortPsbt, validateSortInputs } from '@/lib/tx/sort';
import { signPsbt } from '@/lib/wallet/xverse';
import { broadcastTx, bitcoinNetworkForAddress, mempoolTxUrl } from '@/lib/api/mempool';
import { classifyPlacement } from '@/types';
import * as bitcoin from 'bitcoinjs-lib';

export default function SortButton() {
  const wallet = useSortStore((s) => s.wallet);
  const utxos = useSortStore((s) => s.utxos);
  const selectedKeys = useSortStore((s) => s.selectedKeys);
  const selectedFeeRate = useSortStore((s) => s.selectedFeeRate);
  const sortStatus = useSortStore((s) => s.sortStatus);
  const setSortStatus = useSortStore((s) => s.setSortStatus);

  if (selectedKeys.size === 0) return null;

  const selectedUtxos = utxos.filter((u) => selectedKeys.has(`${u.txid}:${u.vout}`));

  const feeUtxos = utxos.filter(
    (u) => classifyPlacement(u) === 'correct' && u.label === 'plain' && !selectedKeys.has(`${u.txid}:${u.vout}`),
  );

  const validation = validateSortInputs(selectedUtxos, feeUtxos, selectedFeeRate);

  async function handleSort() {
    if (!validation.valid) return;

    try {
      setSortStatus({ state: 'building' });

      const network = bitcoinNetworkForAddress(wallet.paymentAddress);
      const fullPubkey = Buffer.from(wallet.publicKey, 'hex');
      const internalPubkey = fullPubkey.length === 33 ? fullPubkey.subarray(1) : fullPubkey;

      const selectedPlainTotal = selectedUtxos
        .filter((u) => u.label === 'plain')
        .reduce((sum, u) => sum + BigInt(u.value), 0n);

      const dustOutputCount = selectedUtxos.filter((u) => u.label !== 'plain').length;
      const estimatedFee = BigInt(validation.estimatedFee ?? 0);
      const dustCost = BigInt(dustOutputCount) * 546n;
      const needsExtraFunding = selectedPlainTotal < dustCost + estimatedFee;

      const additionalFeeUtxos = needsExtraFunding && feeUtxos.length > 0
        ? [feeUtxos.sort((a, b) => b.value - a.value)[0]]
        : [];

      const { psbt, inputsToSign } = buildSortPsbt({
        selectedUtxos,
        additionalFeeUtxos,
        taprootAddress: wallet.taprootAddress,
        paymentAddress: wallet.paymentAddress,
        internalPubkey,
        feeRate: selectedFeeRate,
        network,
      });

      setSortStatus({ state: 'signing' });
      const signedBase64 = await signPsbt(psbt.toBase64(), inputsToSign);

      const signedPsbt = bitcoin.Psbt.fromBase64(signedBase64, { network });
      signedPsbt.finalizeAllInputs();
      const txHex = signedPsbt.extractTransaction().toHex();

      setSortStatus({ state: 'broadcasting' });
      const txid = await broadcastTx(txHex);

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
      {!validation.valid && (
        <p className="text-sm text-red-400">{validation.error}</p>
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
        disabled={!validation.valid || isLoading || sortStatus.state === 'done'}
        className="w-full rounded-lg bg-orange-600 px-6 py-3 text-sm font-semibold text-white hover:bg-orange-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isLoading ? loadingLabel : `Sort ${selectedKeys.size} UTXO${selectedKeys.size > 1 ? 's' : ''}`}
      </button>

      {validation.estimatedFee && sortStatus.state !== 'done' && sortStatus.state !== 'error' && (
        <p className="text-xs text-gray-500 text-center">
          Estimated fee: ~{validation.estimatedFee.toLocaleString()} sats
        </p>
      )}
    </div>
  );
}
