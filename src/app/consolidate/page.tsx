'use client';

import { useState } from 'react';
import * as bitcoin from 'bitcoinjs-lib';
import AccountList from '@/components/consolidate/AccountList';
import { connectWallet, signPsbtForConsolidation } from '@/lib/wallet/xverse';
import { useWalletStore } from '@/store/walletStore';
import { broadcastTx, bitcoinNetworkForAddress, fetchFeeRates, fetchUtxos, mempoolTxUrl, setMempoolNetwork } from '@/lib/api/mempool';
import { setOrdNetwork } from '@/lib/api/ord';
import { scanAndLabelUtxos } from '@/lib/scanner/label';
import {
  buildConsolidationPsbt,
  groupSigningInputsByAccount,
  hasNewSignatures,
  planConsolidation,
  validateAccountNetworks,
  validateConsolidationDestinations,
  type ConsolidationInput,
  type ConsolidationSigningInput,
} from '@/lib/tx/consolidate';
import { useConsolidateStore, type ConsolidationAccount } from '@/store/consolidateStore';

function short(address: string): string {
  return `${address.slice(0, 10)}…${address.slice(-6)}`;
}

function isTestnet(address: string): boolean {
  return bitcoinNetworkForAddress(address) === bitcoin.networks.testnet;
}

export default function ConsolidatePage() {
  const accounts = useConsolidateStore((state) => state.accounts);
  const addAccount = useConsolidateStore((state) => state.addAccount);
  const removeAccount = useConsolidateStore((state) => state.removeAccount);
  const utxos = useConsolidateStore((state) => state.utxos);
  const setUtxos = useConsolidateStore((state) => state.setUtxos);
  const status = useConsolidateStore((state) => state.status);
  const setStatus = useConsolidateStore((state) => state.setStatus);
  const feeRates = useConsolidateStore((state) => state.feeRates);
  const setFeeRates = useConsolidateStore((state) => state.setFeeRates);
  const feeRate = useConsolidateStore((state) => state.feeRate);
  const setFeeRate = useConsolidateStore((state) => state.setFeeRate);
  const unconfirmedCount = useConsolidateStore((state) => state.unconfirmedCount);
  const setUnconfirmedCount = useConsolidateStore((state) => state.setUnconfirmedCount);
  const [paymentDestination, setPaymentDestination] = useState('');
  const [taprootDestination, setTaprootDestination] = useState('');
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState<{
    psbt: string;
    network: bitcoin.Network;
    groups: ReturnType<typeof groupSigningInputsByAccount>;
    inputs: ConsolidationSigningInput[];
  } | null>(null);

  async function addActiveAccount() {
    try {
      const shared = useWalletStore.getState().wallet;
      const wallet = shared.connected
        ? shared
        : await connectWallet().then((state) => {
            useWalletStore.getState().setWallet(state);
            return state;
          });
      if (accounts.some((account) => account.paymentAddress === wallet.paymentAddress || account.taprootAddress === wallet.taprootAddress)) {
        throw new Error('That Xverse account has already been collected.');
      }
      validateAccountNetworks([...accounts.flatMap((account) => [account.paymentAddress, account.taprootAddress]), wallet.paymentAddress, wallet.taprootAddress]);
      addAccount({
        id: wallet.paymentAddress,
        paymentAddress: wallet.paymentAddress,
        taprootAddress: wallet.taprootAddress,
        taprootPublicKey: wallet.publicKey,
      });
      setMessage('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not add the active account.');
    }
  }

  async function scan() {
    if (accounts.length === 0) return;
    try {
      validateAccountNetworks(accounts.flatMap((account) => [account.paymentAddress, account.taprootAddress]));
      setStatus({ state: 'scanning', scanned: 0, total: accounts.length * 2 });
      await setMempoolNetwork(accounts[0].paymentAddress);
      setOrdNetwork(accounts[0].paymentAddress);
      const responses = await Promise.all(accounts.flatMap(async (account) => {
        const [payment, taproot] = await Promise.all([fetchUtxos(account.paymentAddress), fetchUtxos(account.taprootAddress)]);
        return [
          ...payment.map((utxo) => ({ ...utxo, source: 'payment' as const, sourceAddress: account.paymentAddress, accountId: account.id })),
          ...taproot.map((utxo) => ({ ...utxo, source: 'taproot' as const, sourceAddress: account.taprootAddress, accountId: account.id })),
        ];
      }));
      const raw = responses.flat();
      const confirmed = raw.filter((utxo) => utxo.status.confirmed);
      setUnconfirmedCount(raw.length - confirmed.length);
      const labeled = await scanAndLabelUtxos(confirmed, isTestnet(accounts[0].paymentAddress), (scanned, total) => {
        setStatus({ state: 'scanning', scanned, total });
      });
      setUtxos(labeled.map((utxo, index) => ({ ...utxo, accountId: confirmed[index].accountId, sourceAddress: confirmed[index].sourceAddress })));
      setFeeRates(await fetchFeeRates());
      setStatus({ state: 'ready' });
      setMessage('');
    } catch (error) {
      setStatus({ state: 'error', message: error instanceof Error ? error.message : 'Scan failed.' });
    }
  }

  function build() {
    try {
      if (accounts.length === 0 || utxos.length === 0) throw new Error('Collect accounts and scan confirmed UTXOs first.');
      const network = bitcoinNetworkForAddress(accounts[0].paymentAddress);
      validateConsolidationDestinations({ paymentAddress: paymentDestination, taprootAddress: taprootDestination, network });
      const accountMap = new Map(accounts.map((account) => [account.id, account]));
      const inputs: ConsolidationInput[] = utxos
        .filter((utxo) => utxo.label !== 'unknown')
        .map((utxo) => {
          const account = accountMap.get(utxo.accountId);
          if (!account) throw new Error('A scanned UTXO is missing its account.');
          const fullKey = Buffer.from(account.taprootPublicKey, 'hex');
          return {
            txid: utxo.txid,
            vout: utxo.vout,
            value: utxo.value,
            source: utxo.source,
            sourceAddress: utxo.sourceAddress,
            accountId: utxo.accountId,
            inscriptionOffsets: utxo.assets.filter((asset) => asset.kind === 'inscription').map((asset) => asset.offset),
            hasRunes: utxo.assets.some((asset) => asset.kind === 'rune'),
            internalPubkey: fullKey.length === 33 ? fullKey.subarray(1) : fullKey,
          };
        });
      const plan = planConsolidation({ inputs, feeRate, taprootAddress: taprootDestination, paymentAddress: paymentDestination });
      if (!plan.ok) throw new Error(plan.error);
      const built = buildConsolidationPsbt({ inputs: plan.inputs, outputs: plan.outputs, network });
      const groups = groupSigningInputsByAccount(built.inputsToSign);
      setPending({ psbt: built.psbt.toBase64(), network, groups, inputs: built.inputsToSign });
      setStatus({ state: 'signing', pass: 0, total: groups.length });
      setMessage(plan.excluded.length > 0 ? `${plan.excluded.length} rune + inscription UTXO(s) were excluded for safety.` : '');
    } catch (error) {
      setStatus({ state: 'error', message: error instanceof Error ? error.message : 'Could not build consolidation.' });
    }
  }

  async function signCurrentPass() {
    if (!pending || status.state !== 'signing') return;
    try {
      const group = pending.groups[status.pass];
      const before = bitcoin.Psbt.fromBase64(pending.psbt, { network: pending.network });
      const signed = await signPsbtForConsolidation(pending.psbt, group.inputs);
      if (!signed.signedPsbt) throw new Error('Wallet did not return the partially signed PSBT.');
      const after = bitcoin.Psbt.fromBase64(signed.signedPsbt, { network: pending.network });
      if (!hasNewSignatures(before, after, group.inputs.map((input) => input.index))) {
        throw new Error('No signatures were added. Switch Xverse to the requested account, then retry this signing pass.');
      }
      if (status.pass + 1 < pending.groups.length) {
        setPending({ ...pending, psbt: signed.signedPsbt });
        setStatus({ state: 'signing', pass: status.pass + 1, total: pending.groups.length });
        return;
      }
      setStatus({ state: 'broadcasting' });
      try {
        after.finalizeAllInputs();
      } catch {
        // Some wallets return already-finalized inputs; extractTransaction validates the result.
      }
      const txid = await broadcastTx(after.extractTransaction().toHex());
      setStatus({ state: 'done', txid });
      setPending(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Signing failed.');
    }
  }

  const currentGroup = pending && status.state === 'signing' ? pending.groups[status.pass] : null;
  const summary = accounts.map((account) => {
    const accountUtxos = utxos.filter((utxo) => utxo.accountId === account.id);
    return {
      account,
      plain: accountUtxos.filter((utxo) => utxo.assets.length === 0).reduce((sum, utxo) => sum + utxo.value, 0),
      inscriptions: accountUtxos.filter((utxo) => utxo.assets.some((asset) => asset.kind === 'inscription')).length,
      runes: accountUtxos.filter((utxo) => utxo.assets.some((asset) => asset.kind === 'rune')).length,
    };
  });

  return (
    <main className="flex min-h-screen flex-col items-center p-6 md:p-8">
      <div className="w-full max-w-3xl flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Multi-account consolidation</h1>
          <p className="text-sm text-gray-400">One transaction, signed once by each contributing Xverse account.</p>
        </div>
        <section className="rounded-lg border border-gray-800 bg-gray-900/60 p-4 flex flex-col gap-3">
          <h2 className="font-semibold text-white">1. Collect accounts</h2>
          <p className="text-sm text-gray-400">Switch the active account in Xverse, then add it here. Repeat for every account.</p>
          <AccountList accounts={accounts} onRemove={removeAccount} />
          <button onClick={addActiveAccount} className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-500">Add active Xverse account</button>
        </section>
        <section className="rounded-lg border border-gray-800 bg-gray-900/60 p-4 flex flex-col gap-3">
          <h2 className="font-semibold text-white">2. Scan all collected addresses</h2>
          <button disabled={accounts.length === 0 || status.state === 'scanning'} onClick={scan} className="rounded-lg border border-orange-600 px-4 py-2 text-sm text-orange-400 disabled:opacity-50">Scan confirmed UTXOs</button>
          {status.state === 'scanning' && <p className="text-sm text-gray-400">Scanning {status.scanned}/{status.total}…</p>}
          {unconfirmedCount > 0 && <p className="text-sm text-yellow-400">{unconfirmedCount} unconfirmed UTXO(s) skipped.</p>}
          {utxos.length > 0 && <div className="overflow-x-auto"><table className="w-full text-sm text-gray-300"><thead className="text-left text-gray-500"><tr><th>Account</th><th>Plain sats</th><th>Inscriptions</th><th>Runes</th></tr></thead><tbody>{summary.map(({ account, plain, inscriptions, runes }, index) => <tr key={account.id} className="border-t border-gray-800"><td className="py-2">{index + 1} · {short(account.paymentAddress)}</td><td>{plain.toLocaleString()}</td><td>{inscriptions}</td><td>{runes}</td></tr>)}</tbody></table></div>}
        </section>
        <section className="rounded-lg border border-gray-800 bg-gray-900/60 p-4 flex flex-col gap-3">
          <h2 className="font-semibold text-white">3. Destinations and fee</h2>
          <input value={paymentDestination} onChange={(event) => setPaymentDestination(event.target.value.trim())} placeholder="Destination payment address (bc1q / tb1q / …)" className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white" />
          <input value={taprootDestination} onChange={(event) => setTaprootDestination(event.target.value.trim())} placeholder="Destination taproot address (bc1p / tb1p)" className="rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white" />
          {feeRates && <div className="flex flex-wrap gap-2">{[feeRates.economyFee, feeRates.hourFee, feeRates.halfHourFee, feeRates.fastestFee].map((rate) => <button key={rate} onClick={() => setFeeRate(rate)} className={`rounded px-3 py-1 text-xs ${feeRate === rate ? 'bg-orange-600 text-white' : 'bg-gray-800 text-gray-300'}`}>{rate} sat/vB</button>)}</div>}
          <button onClick={build} disabled={status.state === 'scanning' || status.state === 'broadcasting'} className="rounded-lg bg-orange-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">Build consolidation PSBT</button>
        </section>
        {currentGroup && status.state === 'signing' && <section className="rounded-lg border border-orange-700 bg-orange-950/30 p-4 flex flex-col gap-3"><h2 className="font-semibold text-white">4. Sign for account {status.pass + 1} of {status.total}</h2><p className="text-sm text-gray-300">Switch Xverse to the account with {short(currentGroup.inputs[0].address)}, then sign this pass.</p><button onClick={signCurrentPass} className="rounded-lg bg-orange-600 px-4 py-3 text-sm font-semibold text-white">Sign current account</button></section>}
        {message && <p className="rounded-lg border border-yellow-800 bg-yellow-950/40 p-3 text-sm text-yellow-300">{message}</p>}
        {status.state === 'error' && <p className="rounded-lg border border-red-800 bg-red-950/40 p-3 text-sm text-red-300">{status.message}</p>}
        {status.state === 'broadcasting' && <p className="text-sm text-gray-400">Finalizing and broadcasting…</p>}
        {status.state === 'done' && <a className="rounded-lg border border-green-700 bg-green-950/40 p-3 text-sm text-green-300 hover:underline" target="_blank" rel="noopener noreferrer" href={`${mempoolTxUrl(accounts[0]?.paymentAddress ?? paymentDestination)}/${status.txid}`}>Broadcast complete: {status.txid}</a>}
      </div>
    </main>
  );
}
