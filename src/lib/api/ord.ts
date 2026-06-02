import type { OrdOutputResponse } from '@/types';

const PUBLIC_ORD_DEFAULT = 'https://ordinals.com';
const ORD_BASE_MAINNET = (process.env.NEXT_PUBLIC_ORD_BASE_MAINNET || PUBLIC_ORD_DEFAULT).replace(/\/+$/, '');
const ORD_BASE_TESTNET = (process.env.NEXT_PUBLIC_ORD_BASE_TESTNET || 'http://127.0.0.1:8080').replace(/\/+$/, '');
const FETCH_TIMEOUT_MS = 15000;

let _isTestnet = false;
export function setOrdNetwork(address: string): void {
  _isTestnet = address.startsWith('tb1') || address.startsWith('2') || address.startsWith('m') || address.startsWith('n');
}
export function ordBase(): string {
  return _isTestnet ? ORD_BASE_TESTNET : ORD_BASE_MAINNET;
}
export function isOrdTestnet(): boolean {
  return _isTestnet;
}

export type OrdStatus =
  | { ok: true; height: number; chain: string }
  | { ok: false; reason: 'wedged'; height: number; chain: string };

export function parseOrdStatus(raw: { height: number; chain: string; unrecoverably_reorged: boolean }): OrdStatus {
  if (raw.unrecoverably_reorged) return { ok: false, reason: 'wedged', height: raw.height, chain: raw.chain };
  return { ok: true, height: raw.height, chain: raw.chain };
}

/** Throws a clear error if ord is unreachable or wedged. Call before a testnet4 scan. */
export async function assertOrdHealthy(): Promise<void> {
  const res = await fetchWithTimeout(`${ordBase()}/status`, { headers: { Accept: 'application/json' } })
    .catch((err) => {
      throw new Error(`Local ord is unreachable at ${ordBase()} — start it (/btcfullord) before scanning. (${err instanceof Error ? err.message : String(err)})`);
    });
  if (!res.ok) throw new Error(`Local ord is unreachable at ${ordBase()} (HTTP ${res.status}) — start it before scanning.`);
  const status = parseOrdStatus(await res.json());
  if (!status.ok) throw new Error(`Local ord is wedged on a reorg (block ${status.height}). Recover ord before scanning; its labels can't be trusted.`);
}
const TXID_RE = /^[0-9a-f]{64}$/i;

function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

export type OrdLabel =
  | { label: 'plain' }
  | { label: 'inscription'; inscriptionId: string; runeName?: string }
  | { label: 'rune'; runeName: string; inscriptionId?: string };

export function labelFromOrdOutput(output: OrdOutputResponse): OrdLabel {
  const inscriptionId = output.inscriptions[0];
  const runeName = Object.keys(output.runes)[0];

  if (inscriptionId) return { label: 'inscription', inscriptionId, runeName };
  if (runeName) return { label: 'rune', runeName };
  return { label: 'plain' };
}

export async function fetchOrdOutput(txid: string, vout: number): Promise<OrdOutputResponse> {
  if (!TXID_RE.test(txid)) throw new Error(`Invalid txid: ${txid}`);
  if (!Number.isInteger(vout) || vout < 0) throw new Error(`Invalid vout: ${vout}`);
  const res = await fetchWithTimeout(`${ordBase()}/output/${encodeURIComponent(txid)}:${vout}`, {
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
