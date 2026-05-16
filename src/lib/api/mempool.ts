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

const MEMPOOL_MAINNET = 'https://mempool.space/api';
const MEMPOOL_TESTNET4 = 'https://mempool.space/testnet4/api';

let MEMPOOL_BASE = MEMPOOL_MAINNET;

export async function setMempoolNetwork(address: string): Promise<void> {
  if (isTestnetAddress(address)) {
    try {
      const res = await fetch(`${MEMPOOL_TESTNET4}/address/${encodeURIComponent(address)}/utxo`, { signal: AbortSignal.timeout(5000) });
      if (res.ok) { MEMPOOL_BASE = MEMPOOL_TESTNET4; return; }
    } catch { /* fall through */ }
    MEMPOOL_BASE = MEMPOOL_TESTNET4;
    return;
  }
  MEMPOOL_BASE = MEMPOOL_MAINNET;
}

export function getMempoolBase(): string {
  return MEMPOOL_BASE;
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

function validateTxid(txid: string): void {
  if (!TXID_RE.test(txid)) throw new Error(`Invalid txid: ${txid}`);
}

function validateAddress(address: string): void {
  if (!ADDRESS_RE.test(address)) throw new Error(`Invalid address format: ${address}`);
}

export async function fetchFeeRates(): Promise<FeeRates> {
  const res = await fetchWithTimeout(`${MEMPOOL_BASE}/v1/fees/recommended`);
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
  const res = await fetchWithTimeout(`${MEMPOOL_BASE}/address/${encodeURIComponent(address)}/utxo`);
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
  const res = await fetchWithTimeout(`${MEMPOOL_BASE}/tx/${txid}`);
  if (!res.ok) throw new Error(`Failed to fetch TX: ${res.status}`);
  return res.json();
}

export async function broadcastTx(txHex: string): Promise<string> {
  if (!TX_HEX_RE.test(txHex)) throw new Error('Invalid transaction hex');
  const res = await fetchWithTimeout(`${MEMPOOL_BASE}/tx`, { method: 'POST', body: txHex });
  if (!res.ok) {
    const errorText = await res.text();
    const safeError = errorText.replace(/[<>&"']/g, '').slice(0, 200);
    throw new Error(`Broadcast failed: ${safeError}`);
  }
  return res.text();
}
