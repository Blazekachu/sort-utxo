import * as bitcoin from 'bitcoinjs-lib';
import type { FeeRates, Utxo } from '@/types';

export function bitcoinNetworkForAddress(address?: string): bitcoin.Network {
  if (address && (address.startsWith('tb1') || address.startsWith('2') || address.startsWith('m') || address.startsWith('n'))) {
    return bitcoin.networks.testnet;
  }
  return bitcoin.networks.bitcoin;
}

function isTestnetAddress(address: string): boolean {
  return address.startsWith('tb1') || address.startsWith('2') || address.startsWith('m') || address.startsWith('n');
}

export function mempoolTxUrl(address: string): string {
  if (isTestnetAddress(address)) return 'https://mempool.space/testnet4/tx';
  return 'https://mempool.space/tx';
}

// Esplora providers per network. Each speaks the identical Esplora REST API.
// Ordered by reachability: mempool.space frequently rate-limits / bans
// residential IPs, so testnet4 leads with the community mirrors (emzy, memepool)
// and keeps mempool.space last as a best-effort. blockstream.info is excluded —
// it has no testnet4.
const PROVIDERS_MAINNET = [
  'https://mempool.space/api',
  'https://mempool.emzy.de/api',
];
const PROVIDERS_TESTNET4 = [
  'https://mempool.emzy.de/testnet4/api',
  'https://memepool.space/testnet4/api',
  'https://mempool.space/testnet4/api',
];

let activeProviders: string[] = PROVIDERS_MAINNET;
let lastGoodIndex = 0;

// Kept async for caller compatibility (callers `await setMempoolNetwork`).
export async function setMempoolNetwork(address: string): Promise<void> {
  activeProviders = isTestnetAddress(address) ? PROVIDERS_TESTNET4 : PROVIDERS_MAINNET;
  lastGoodIndex = 0;
}

export function getMempoolBase(): string {
  return activeProviders[lastGoodIndex] ?? activeProviders[0];
}

const FETCH_TIMEOUT_MS = 15000;
const TXID_RE = /^[0-9a-f]{64}$/i;
const ADDRESS_RE = /^[a-zA-Z0-9]{26,90}$/;
const TX_HEX_RE = /^[0-9a-f]+$/i;

function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

/**
 * Try each active provider in turn, starting from the last known-good one, until
 * one answers without a connectivity / 5xx failure. A 4xx is a REAL answer
 * (e.g. a 400/404) and is returned as-is — only network errors and 5xx advance
 * to the next provider. Remembers the last good provider so a banned/down
 * primary isn't retried (and timed out on) for every subsequent call.
 */
async function tryProviders(path: string, init?: RequestInit): Promise<Response> {
  const order = [
    ...activeProviders.slice(lastGoodIndex),
    ...activeProviders.slice(0, lastGoodIndex),
  ];
  let lastErr: unknown = null;
  for (const base of order) {
    try {
      const res = await fetchWithTimeout(`${base}${path}`, init);
      if (res.status >= 500) { lastErr = new Error(`${base} returned ${res.status}`); continue; }
      lastGoodIndex = activeProviders.indexOf(base);
      return res;
    } catch (err) {
      lastErr = err; // network error / timeout — fall through to the next provider
    }
  }
  throw new Error(
    `All Esplora providers unreachable: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`
  );
}

function validateTxid(txid: string): void {
  if (!TXID_RE.test(txid)) throw new Error(`Invalid txid: ${txid}`);
}

function validateAddress(address: string): void {
  if (!ADDRESS_RE.test(address)) throw new Error(`Invalid address format: ${address}`);
}

export async function fetchFeeRates(): Promise<FeeRates> {
  const res = await tryProviders(`/v1/fees/recommended`);
  if (!res.ok) throw new Error(`Failed to fetch fee rates: ${res.status}`);
  const data = await res.json();
  for (const key of ['fastestFee', 'halfHourFee', 'hourFee', 'economyFee', 'minimumFee']) {
    const v = data[key];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 1 || v > 10000) {
      throw new Error(`Invalid fee rate from API: ${key}=${v}`);
    }
  }
  if (data.fastestFee > 500) {
    data._feeWarning = `Unusually high fee environment: ${data.fastestFee} sat/vB. Verify before proceeding.`;
  }
  return data;
}

export async function fetchUtxos(address: string): Promise<Utxo[]> {
  validateAddress(address);
  const res = await tryProviders(`/address/${encodeURIComponent(address)}/utxo`);
  if (!res.ok) throw new Error(`Failed to fetch UTXOs: ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error('Invalid UTXO response: expected array');
  for (const u of data) {
    if (typeof u.txid !== 'string' || !TXID_RE.test(u.txid)) throw new Error(`Invalid UTXO txid: ${u.txid}`);
    if (typeof u.vout !== 'number' || !Number.isInteger(u.vout) || u.vout < 0) throw new Error(`Invalid UTXO vout: ${u.vout}`);
    if (typeof u.value !== 'number' || !Number.isFinite(u.value) || u.value < 0) throw new Error(`Invalid UTXO value: ${u.value}`);
  }
  return data;
}

export async function fetchTx(txid: string): Promise<Record<string, unknown>> {
  validateTxid(txid);
  const res = await tryProviders(`/tx/${txid}`);
  if (!res.ok) throw new Error(`Failed to fetch TX: ${res.status}`);
  return res.json();
}

export async function broadcastTx(txHex: string): Promise<string> {
  if (!TX_HEX_RE.test(txHex)) throw new Error('Invalid transaction hex');
  const res = await tryProviders(`/tx`, { method: 'POST', body: txHex });
  if (!res.ok) {
    const errorText = await res.text();
    const safeError = errorText.replace(/[<>&"']/g, '').slice(0, 200);
    throw new Error(`Broadcast failed: ${safeError}`);
  }
  return res.text();
}
