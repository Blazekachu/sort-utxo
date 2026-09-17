import type { ComposeChain } from './network';

const FETCH_TIMEOUT_MS = 15000;
const TXID_RE = /^[0-9a-f]{64}$/i;

export function composeOrdBase(chain: ComposeChain): string {
  if (chain === 'signet') {
    return (process.env.NEXT_PUBLIC_ORD_BASE_SIGNET
      || process.env.NEXT_PUBLIC_ORD_BASE_TESTNET
      || 'http://127.0.0.1:8080').replace(/\/+$/, '');
  }
  return (process.env.NEXT_PUBLIC_ORD_BASE_MAINNET || 'https://ordinals.com').replace(/\/+$/, '');
}

function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

export type ComposeOrdStatus =
  | { ok: true; height: number; chain: string; satIndex: boolean }
  | { ok: false; reason: 'wedged'; height: number; chain: string };

export function parseComposeOrdStatus(raw: {
  height: number;
  chain: string;
  unrecoverably_reorged: boolean;
  sat_index?: boolean;
}): ComposeOrdStatus {
  if (raw.unrecoverably_reorged) return { ok: false, reason: 'wedged', height: raw.height, chain: raw.chain };
  return { ok: true, height: raw.height, chain: raw.chain, satIndex: raw.sat_index === true };
}

export async function assertComposeOrdHealthy(chain: ComposeChain): Promise<void> {
  if (chain !== 'signet') return;
  const base = composeOrdBase(chain);
  const res = await fetchWithTimeout(`${base}/status`, { headers: { Accept: 'application/json' } })
    .catch((err) => {
      throw new Error(`Local signet ord is unreachable at ${base} — start it before scanning. (${err instanceof Error ? err.message : String(err)})`);
    });
  if (!res.ok) throw new Error(`Local signet ord is unreachable at ${base} (HTTP ${res.status}) — start it before scanning.`);
  const status = parseComposeOrdStatus(await res.json());
  if (!status.ok) throw new Error(`Local signet ord is wedged on a reorg (block ${status.height}). Recover ord before scanning; its labels can't be trusted.`);
}

export function offsetFromSatpoint(satpoint: string): number {
  const parts = satpoint.split(':');
  const offset = Number(parts[parts.length - 1]);
  if (!Number.isFinite(offset) || offset < 0) throw new Error(`Bad satpoint offset: ${satpoint}`);
  return offset;
}

export async function getComposeInscriptionOffset(chain: ComposeChain, id: string): Promise<number> {
  const res = await fetchWithTimeout(`${composeOrdBase(chain)}/inscription/${encodeURIComponent(id)}`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`ord /inscription/${id} ${res.status}`);
  const info = (await res.json()) as { satpoint: string };
  return offsetFromSatpoint(info.satpoint);
}

export interface ComposeOrdOutput {
  inscriptions?: string[];
  runes?: Record<string, { amount: number; divisibility: number }>;
  value?: number;
  sat_ranges?: [number, number][] | null;
}

export async function fetchComposeOrdOutput(chain: ComposeChain, txid: string, vout: number): Promise<ComposeOrdOutput> {
  if (!TXID_RE.test(txid)) throw new Error(`Invalid txid: ${txid}`);
  if (!Number.isInteger(vout) || vout < 0) throw new Error(`Invalid vout: ${vout}`);
  const res = await fetchWithTimeout(`${composeOrdBase(chain)}/output/${encodeURIComponent(txid)}:${vout}`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Ord API error for ${txid}:${vout}: ${res.status}`);
  return res.json();
}
