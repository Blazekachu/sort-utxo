export function verifySignedTx(params: {
  signedTxid: string;
  plannedTxid: string;
  vanityTarget?: { prefix: string; suffix: string };
}): void {
  if (params.signedTxid !== params.plannedTxid) {
    throw new Error(`Signed TXID ${params.signedTxid} does not match planned ${params.plannedTxid}. Not broadcasting.`);
  }
  const target = params.vanityTarget;
  if (!target || (!target.prefix && !target.suffix)) return;
  const txid = params.signedTxid.toLowerCase();
  const prefix = target.prefix.toLowerCase();
  const suffix = target.suffix.toLowerCase();
  if ((prefix && !txid.startsWith(prefix)) || (suffix && !txid.endsWith(suffix))) {
    throw new Error(`Final TXID ${params.signedTxid} does not match the locked vanity target. Not broadcasting.`);
  }
}
