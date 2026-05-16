import type { Utxo, LabeledUtxo, UtxoLabel } from '@/types';
import { labelUtxosViaOrd } from '@/lib/api/ord';
import { fetchTx } from '@/lib/api/mempool';
import { isRunestoneOutput, extractRunestonePayload, parseRunestonePointer } from './runestone';
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
 * Checks for Runestone pointer match and inscription envelope.
 */
export function labelUtxoFromTx(
  tx: Record<string, unknown>,
  vout: number,
): { label: UtxoLabel; runeName?: string; inscriptionId?: string } {
  const outputs = tx.vout as TxVout[];
  const inputs = tx.vin as TxVin[];

  // 1. Check for Runestone OP_RETURN → extract pointer
  for (const out of outputs) {
    if (isRunestoneOutput(out.scriptpubkey)) {
      const payload = extractRunestonePayload(out.scriptpubkey);
      if (payload) {
        const pointer = parseRunestonePointer(payload);
        if (pointer !== null && pointer === vout) {
          return { label: 'rune' };
        }
        // Default pointer: runes go to output 0
        if (pointer === null && vout === 0) {
          return { label: 'rune' };
        }
      }
    }
  }

  // 2. Check for inscription envelope in witness data
  for (const vin of inputs) {
    if (vin.witness && hasInscriptionEnvelope(vin.witness)) {
      // Inscription output is typically the first non-OP_RETURN output (vout 0)
      if (vout === 0) {
        return { label: 'inscription' };
      }
    }
  }

  // 3. Default: plain sats
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
