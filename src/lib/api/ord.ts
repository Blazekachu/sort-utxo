import type { OrdOutputResponse } from '@/types';

const ORD_BASE = 'https://ordinals.com';
const FETCH_TIMEOUT_MS = 15000;
const TXID_RE = /^[0-9a-f]{64}$/i;

function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

export type OrdLabel =
  | { label: 'plain' }
  | { label: 'inscription'; inscriptionId: string }
  | { label: 'rune'; runeName: string };

export function labelFromOrdOutput(output: OrdOutputResponse): OrdLabel {
  if (output.inscriptions.length > 0) {
    return { label: 'inscription', inscriptionId: output.inscriptions[0] };
  }
  const runeNames = Object.keys(output.runes);
  if (runeNames.length > 0) {
    return { label: 'rune', runeName: runeNames[0] };
  }
  return { label: 'plain' };
}

export async function fetchOrdOutput(txid: string, vout: number): Promise<OrdOutputResponse> {
  if (!TXID_RE.test(txid)) throw new Error(`Invalid txid: ${txid}`);
  if (!Number.isInteger(vout) || vout < 0) throw new Error(`Invalid vout: ${vout}`);
  const res = await fetchWithTimeout(`${ORD_BASE}/output/${encodeURIComponent(txid)}:${vout}`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Ord API error for ${txid}:${vout}: ${res.status}`);
  return res.json();
}

const RATE_LIMIT_MS = 100;

export async function labelUtxosViaOrd(
  utxos: Array<{ txid: string; vout: number }>,
  onProgress?: (scanned: number) => void,
): Promise<Map<string, OrdLabel>> {
  const labels = new Map<string, OrdLabel>();

  for (let i = 0; i < utxos.length; i++) {
    const utxo = utxos[i];
    const key = `${utxo.txid}:${utxo.vout}`;
    const output = await fetchOrdOutput(utxo.txid, utxo.vout);
    labels.set(key, labelFromOrdOutput(output));
    onProgress?.(i + 1);
    if (i < utxos.length - 1) {
      await new Promise((r) => setTimeout(r, RATE_LIMIT_MS));
    }
  }

  return labels;
}
