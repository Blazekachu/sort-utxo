import type { Utxo, LabeledUtxo, UtxoLabel } from '@/types';
import { labelUtxosViaOrd } from '@/lib/api/ord';
import { fetchTx } from '@/lib/api/mempool';
import { isRunestoneOutput, extractRunestonePayload, parseRunestone } from './runestone';
import { hasInscriptionEnvelope } from './inscription';

interface TxVout {
  scriptpubkey: string;
  value: number;
  scriptpubkey_type: string;
}

interface TxVin {
  witness: string[];
}

/**
 * Label a single UTXO by analyzing its creating transaction (for testnet4).
 *
 * This is best-effort: it can positively identify assets in the immediate
 * creating TX (a rune etch/mint/transfer, an inscription reveal), but it
 * CANNOT detect an asset that was transferred by an ordinary key-path spend
 * — a transferred inscription leaves no envelope in its parent TX. Callers
 * must therefore never treat a testnet4 'plain' label as authoritative for
 * spending decisions (see the fee-UTXO safety threshold in SortButton).
 */
export function labelUtxoFromTx(
  tx: Record<string, unknown>,
  vout: number,
): { label: UtxoLabel; runeName?: string; inscriptionId?: string } {
  const outputs = tx.vout as TxVout[];
  const inputs = tx.vin as TxVin[];

  // 1. Runestone: a rune-bearing output is the Pointer output, the default
  //    output (first non-OP_RETURN) when no Pointer is set, or any output
  //    referenced by an edict. Over-labeling as 'rune' is safe (the asset
  //    just goes to taproot); missing one risks it being spent as fee.
  for (let i = 0; i < outputs.length; i++) {
    if (!isRunestoneOutput(outputs[i].scriptpubkey)) continue;

    const payload = extractRunestonePayload(outputs[i].scriptpubkey);
    if (!payload) continue;

    const runestoneIndex = i;
    const { pointer, edictOutputs } = parseRunestone(payload);
    const runeOutputs = new Set<number>();

    if (pointer !== null) {
      runeOutputs.add(pointer);
    } else {
      const defaultOutput = outputs.findIndex((_, idx) => idx !== runestoneIndex);
      if (defaultOutput !== -1) runeOutputs.add(defaultOutput);
    }

    for (const o of edictOutputs) {
      if (o >= outputs.length) {
        // Edict targets "all outputs" (or is a cenotaph) — treat every
        // non-Runestone output as a possible rune carrier.
        for (let k = 0; k < outputs.length; k++) {
          if (k !== runestoneIndex) runeOutputs.add(k);
        }
      } else {
        runeOutputs.add(o);
      }
    }

    if (vout !== runestoneIndex && runeOutputs.has(vout)) {
      return { label: 'rune' };
    }
  }

  // 2. Inscription envelope in witness data. Only the reveal transaction can
  //    be identified this way; a transferred inscription is undetectable.
  for (const vin of inputs) {
    if (vin.witness && hasInscriptionEnvelope(vin.witness)) {
      // Reveal inscriptions land on the first output by default.
      if (vout === 0) {
        return { label: 'inscription' };
      }
    }
  }

  // 3. Default: plain sats (best-effort — see the doc comment above).
  return { label: 'plain' };
}

/**
 * Scan and label all UTXOs. Uses ord API on mainnet, TX decoding on testnet4.
 * Throws if any UTXO cannot be labeled.
 */
export async function scanAndLabelUtxos(
  utxos: Array<Utxo & { source: 'taproot' | 'payment' }>,
  isTestnet: boolean,
  onProgress?: (scanned: number, total: number) => void,
): Promise<LabeledUtxo[]> {
  const total = utxos.length;
  const labeled: LabeledUtxo[] = [];

  if (!isTestnet) {
    // Mainnet: use ord API
    const ordLabels = await labelUtxosViaOrd(
      utxos.map((u) => ({ txid: u.txid, vout: u.vout })),
      (scanned) => onProgress?.(scanned, total),
    );

    for (const utxo of utxos) {
      const key = `${utxo.txid}:${utxo.vout}`;
      const ordLabel = ordLabels.get(key);
      if (!ordLabel) throw new Error(`Failed to label UTXO ${key}`);
      labeled.push({
        ...utxo,
        label: ordLabel.label,
        runeName: ordLabel.label === 'rune' ? (ordLabel as { runeName: string }).runeName : undefined,
        inscriptionId: ordLabel.label === 'inscription' ? (ordLabel as { inscriptionId: string }).inscriptionId : undefined,
      });
    }
  } else {
    // Testnet4: fetch each TX and decode
    const txCache = new Map<string, Record<string, unknown>>();
    let scanned = 0;

    for (const utxo of utxos) {
      let tx = txCache.get(utxo.txid);
      if (!tx) {
        try {
          tx = await fetchTx(utxo.txid);
          txCache.set(utxo.txid, tx);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          throw new Error(`Failed to fetch TX ${utxo.txid.slice(0, 16)}...: ${msg}`);
        }
      }

      const result = labelUtxoFromTx(tx, utxo.vout);
      labeled.push({
        ...utxo,
        label: result.label,
        runeName: result.runeName,
        inscriptionId: result.inscriptionId,
      });

      scanned++;
      onProgress?.(scanned, total);
    }
  }

  return labeled;
}
