import * as bitcoin from 'bitcoinjs-lib';

function cachedTx(psbt: bitcoin.Psbt): bitcoin.Transaction {
  const tx = (psbt as unknown as { __CACHE: { __TX?: bitcoin.Transaction } }).__CACHE.__TX;
  if (!tx) throw new Error('Could not compute unsigned TXID.');
  return tx;
}

/** Unsigned tx with P2SH redeem scripts already in scriptSig (final TXID shape). */
export function unsignedTxFromPsbt(psbt: bitcoin.Psbt): bitcoin.Transaction {
  const tx = cachedTx(psbt).clone();
  for (let i = 0; i < psbt.data.inputs.length; i++) {
    const redeemScript = psbt.data.inputs[i].redeemScript;
    if (redeemScript && redeemScript.length > 0) {
      tx.setInputScript(i, bitcoin.script.compile([redeemScript]));
    }
  }
  return tx;
}

export function plannedTxid(psbt: bitcoin.Psbt): string {
  return unsignedTxFromPsbt(psbt).getId();
}

/** Non-witness serialization used for TXID (locktime is the last 4 bytes). */
export function serializeForTxid(psbt: bitcoin.Psbt): Uint8Array {
  const tx = unsignedTxFromPsbt(psbt);
  return (tx as unknown as {
    __toBuffer: (buffer?: Uint8Array, initialOffset?: number, allowWitness?: boolean) => Uint8Array;
  }).__toBuffer(undefined, undefined, false);
}
