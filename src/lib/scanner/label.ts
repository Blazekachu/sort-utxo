import type { Utxo, LabeledUtxo, UtxoLabel, Asset } from '@/types';
import { assertOrdHealthy, fetchOrdOutput, getInscriptionOffset, outputToAssets } from '@/lib/api/ord';

/** Derive the summary `label` from an asset list. */
function deriveLabel(assets: Asset[]): UtxoLabel {
  if (assets.length === 0) return 'plain';
  if (assets.some((a) => a.kind === 'inscription')) return 'inscription';
  return 'rune';
}

/**
 * Scan + label every UTXO authoritatively via ord (both networks). On testnet4,
 * ord must be healthy first (fail-closed). A per-UTXO ord failure yields the
 * `unknown` label (excluded from sorting) — never a silent `plain`.
 */
export async function scanAndLabelUtxos(
  utxos: Array<Utxo & { source: 'taproot' | 'payment' }>,
  isTestnet: boolean,
  onProgress?: (scanned: number, total: number) => void,
): Promise<LabeledUtxo[]> {
  if (isTestnet) await assertOrdHealthy();

  const total = utxos.length;
  const labeled: LabeledUtxo[] = [];
  let scanned = 0;

  for (const utxo of utxos) {
    let assets: Asset[] = [];
    let label: UtxoLabel;
    try {
      const output = await fetchOrdOutput(utxo.txid, utxo.vout);
      const offsets = new Map<string, number>();
      for (const id of output.inscriptions) offsets.set(id, await getInscriptionOffset(id));
      assets = outputToAssets(output, (id) => offsets.get(id) ?? 0);
      label = deriveLabel(assets);
    } catch {
      assets = [];
      label = 'unknown';
    }

    const inscription = assets.find((a) => a.kind === 'inscription');
    const rune = assets.find((a) => a.kind === 'rune');
    labeled.push({
      ...utxo,
      label,
      assets,
      runeName: rune && rune.kind === 'rune' ? rune.name : undefined,
      inscriptionId: inscription && inscription.kind === 'inscription' ? inscription.id : undefined,
      hasInscription: inscription ? true : undefined,
    });

    scanned++;
    onProgress?.(scanned, total);
  }

  return labeled;
}
