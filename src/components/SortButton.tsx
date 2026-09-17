'use client';

import { useSortStore } from '@/store/sortStore';
import { useWalletStore } from '@/store/walletStore';
import { useSortPlan } from './useSortPlan';
import { buildSortPsbtFromLedger } from '@/lib/tx/satLedger';
import { signPsbtForSort } from '@/lib/wallet/xverse';
import { broadcastTx, bitcoinNetworkForAddress, mempoolTxUrl } from '@/lib/api/mempool';
import { plannedTxid } from '@/lib/compose/txid';
import { verifySignedTx } from '@/lib/compose/signVerify';
import * as bitcoin from 'bitcoinjs-lib';

export default function SortButton() {
  const wallet = useWalletStore((s) => s.wallet);
  const selectedKeys = useSortStore((s) => s.selectedKeys);
  const sortStatus = useSortStore((s) => s.sortStatus);
  const setSortStatus = useSortStore((s) => s.setSortStatus);
  const vanityTxid = useSortStore((s) => s.vanityTxid);
  const vanityLocktime = useSortStore((s) => s.vanityLocktime);
  const vanityPrefix = useSortStore((s) => s.vanityPrefix);
  const vanitySuffix = useSortStore((s) => s.vanitySuffix);

  // Hooks must run unconditionally — call useSortPlan before any early return.
  const { result } = useSortPlan();

  if (selectedKeys.size === 0) return null;

  async function handleSort() {
    if (!result.ok) return;

    try {
      setSortStatus({ state: 'building' });

      const network = bitcoinNetworkForAddress(wallet.paymentAddress);
      const fullPubkey = Buffer.from(wallet.publicKey, 'hex');
      const internalPubkey = fullPubkey.length === 33 ? fullPubkey.subarray(1) : fullPubkey;

      // result.inputs / result.ledger.outputs are the exact sat-ledger layout the
      // user is shown, so the built PSBT matches the validated plan.
      const { psbt, inputsToSign } = buildSortPsbtFromLedger({
        inputs: result.inputs,
        outputs: result.ledger.outputs,
        taprootAddress: wallet.taprootAddress,
        paymentAddress: wallet.paymentAddress,
        internalPubkey,
        network,
        nLockTime: vanityLocktime ?? 0,
      });
      const planned = plannedTxid(psbt);

      setSortStatus({ state: 'signing' });
      // broadcast:false — we verify planned TXID + output values, then broadcast ourselves.
      const signed = await signPsbtForSort(psbt.toBase64(), inputsToSign);
      if (!signed.signedPsbt) {
        throw new Error('Wallet did not return a signed PSBT. Not broadcasting.');
      }

      const signedPsbt = bitcoin.Psbt.fromBase64(signed.signedPsbt, { network });
      try {
        signedPsbt.finalizeAllInputs();
      } catch {
        // The wallet may have already finalized the inputs; extractTransaction
        // below still surfaces a real problem if they genuinely are not final.
      }
      const tx = signedPsbt.extractTransaction();
      const signedTxid = tx.getId();
      verifySignedTx({
        signedTxid,
        plannedTxid: planned,
        vanityTarget: vanityTxid ? { prefix: vanityPrefix, suffix: vanitySuffix } : undefined,
      });
      for (let i = 0; i < result.ledger.outputs.length; i++) {
        if (Number(tx.outs[i].value) !== result.ledger.outputs[i].value) {
          throw new Error('Signed outputs do not match the plan. Not broadcasting.');
        }
      }

      setSortStatus({ state: 'broadcasting' });
      const txid = await broadcastTx(tx.toHex());
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
      {!result.ok && (
        <p className="text-sm text-red-400">{result.error}</p>
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
        disabled={!result.ok || isLoading || sortStatus.state === 'done'}
        className="w-full rounded-lg bg-orange-600 px-6 py-3 text-sm font-semibold text-white hover:bg-orange-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isLoading ? loadingLabel : `Sort ${selectedKeys.size} UTXO${selectedKeys.size > 1 ? 's' : ''}`}
      </button>

      {result.ok && result.ledger.fee > 0 && sortStatus.state !== 'done' && sortStatus.state !== 'error' && (
        <p className="text-xs text-gray-500 text-center">
          Estimated fee: ~{result.ledger.fee.toLocaleString()} sats
          {result.feeUtxos.length > 0 && ` (+${result.feeUtxos.length} fee input${result.feeUtxos.length > 1 ? 's' : ''})`}
        </p>
      )}
      {result.ok && sortStatus.state !== 'done' && (
        <p className="text-xs text-gray-500 text-center">
          Wallet signs only — we broadcast after verifying the signed tx matches the plan.
        </p>
      )}
    </div>
  );
}
