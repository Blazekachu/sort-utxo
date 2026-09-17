'use client';

import * as bitcoin from 'bitcoinjs-lib';
import { useComposeStore } from '@/store/composeStore';
import { useWalletStore } from '@/store/walletStore';
import { useComposePlan } from './useComposePlan';
import { buildComposePsbt } from '@/lib/compose/psbt';
import { bitcoinNetworkForChain, mempoolExplorerTxBase, parseWalletNetworkName } from '@/lib/compose/network';
import { broadcastComposeTx } from '@/lib/compose/mempool';
import { signPsbtForCompose } from '@/lib/wallet/xverse';
import { verifySignedTx } from '@/lib/compose/signVerify';
import { plannedTxid } from '@/lib/compose/txid';

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export default function ComposeSignButton() {
  const wallet = useWalletStore((s) => s.wallet);
  const plan = useComposePlan();
  const status = useComposeStore((s) => s.buildStatus);
  const setStatus = useComposeStore((s) => s.setBuildStatus);
  const vanityTxid = useComposeStore((s) => s.vanityTxid);
  const vanityLocktime = useComposeStore((s) => s.vanityLocktime);
  const vanityPrefix = useComposeStore((s) => s.vanityPrefix);
  const vanitySuffix = useComposeStore((s) => s.vanitySuffix);

  async function handleSign() {
    if (!plan.ok) return;
    try {
      setStatus({ state: 'building' });
      const chain = parseWalletNetworkName(wallet.network, wallet.paymentAddress);
      const network = bitcoinNetworkForChain(chain);
      const fullPubkey = hexToBytes(wallet.publicKey);
      const internalPubkey = fullPubkey.length === 33 ? fullPubkey.slice(1) : fullPubkey;
      const paymentPublicKey = wallet.paymentPublicKey ? hexToBytes(wallet.paymentPublicKey) : undefined;
      const { psbt, inputsToSign } = buildComposePsbt({
        inputs: plan.inputs.map((i) => ({
          txid: i.utxo.txid, vout: i.utxo.vout, value: i.utxo.value, address: i.utxo.address,
        })),
        outputs: plan.outputs.map((o) => ({ address: o.address, value: o.value })),
        opReturnScript: plan.opReturnScript,
        taprootInternalKey: internalPubkey,
        paymentPublicKey,
        network,
        nLockTime: vanityLocktime ?? 0,
      });
      const planned = plannedTxid(psbt);
      setStatus({ state: 'signing' });
      const signed = await signPsbtForCompose(psbt.toBase64(), inputsToSign);
      if (!signed.signedPsbt) throw new Error('Wallet did not return a signed PSBT. Not broadcasting.');
      const signedPsbt = bitcoin.Psbt.fromBase64(signed.signedPsbt, { network });
      try { signedPsbt.finalizeAllInputs(); } catch { /* already final */ }
      const tx = signedPsbt.extractTransaction();
      const signedTxid = tx.getId();
      verifySignedTx({
        signedTxid,
        plannedTxid: planned,
        vanityTarget: vanityTxid ? { prefix: vanityPrefix, suffix: vanitySuffix } : undefined,
      });
      for (let i = 0; i < plan.outputs.length; i++) {
        if (Number(tx.outs[i].value) !== plan.outputs[i].value) {
          throw new Error('Signed outputs do not match the plan. Not broadcasting.');
        }
      }
      setStatus({ state: 'broadcasting' });
      await broadcastComposeTx(tx.toHex());
      setStatus({ state: 'done', txid: signedTxid });
    } catch (err) {
      setStatus({ state: 'error', message: err instanceof Error ? err.message : 'Compose failed' });
    }
  }

  const chain = parseWalletNetworkName(wallet.network, wallet.paymentAddress);
  const loading = status.state === 'building' || status.state === 'signing' || status.state === 'broadcasting';

  return (
    <div className="w-full flex flex-col gap-3">
      {status.state === 'error' && <p className="text-sm text-red-400">{status.message}</p>}
      {status.state === 'done' && (
        <a
          href={`${mempoolExplorerTxBase(chain)}/${status.txid}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-orange-400 hover:underline font-mono break-all"
        >
          {status.txid}
        </a>
      )}
      <button
        onClick={handleSign}
        disabled={!plan.ok || loading || status.state === 'done'}
        className="w-full rounded-lg bg-orange-600 px-6 py-3 text-sm font-semibold text-white hover:bg-orange-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? status.state : 'Sign in Xverse'}
      </button>
      {plan.ok && <p className="text-xs text-gray-500 text-center">Xverse will show every input and output. We broadcast after verifying the signed tx.</p>}
    </div>
  );
}
