import type { FeeRates, Utxo } from '@/types';
import type { ComposeChain } from './network';

const PROVIDERS: Record<ComposeChain, string[]> = {
  mainnet: [
    'https://mempool.emzy.de/api',
    'https://memepool.space/api',
    'https://mempool.space/api',
    'https://blockstream.info/api',
  ],
  signet: [
    'https://mempool.emzy.de/signet/api',
    'https://memepool.space/signet/api',
    'https://mempool.space/signet/api',
    'https://blockstream.info/signet/api',
  ],
};

let activeBases: string[] = PROVIDERS.mainnet;
let lastGoodIndex = 0;

const FETCH_TIMEOUT_MS = 15000;
const TXID_RE = /^[0-9a-f]{64}$/i;
const ADDRESS_RE = /^[a-zA-Z0-9]{26,90}$/;
const TX_HEX_RE = /^[0-9a-f]+$/i;

export function setComposeMempoolNetwork(chain: ComposeChain): void {
  activeBases = PROVIDERS[chain];
  lastGoodIndex = 0;
}

export function getComposeMempoolBases(): string[] {
  return [...activeBases];
}

function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

async function tryProviders(path: string, init?: RequestInit): Promise<Response> {
  const order = [
    ...activeBases.slice(lastGoodIndex),
    ...activeBases.slice(0, lastGoodIndex),
  ];
  let lastErr: unknown = null;
  for (const base of order) {
    try {
      const res = await fetchWithTimeout(`${base}${path}`, init);
      if (res.status >= 500) { lastErr = new Error(`${base} returned ${res.status}`); continue; }
      lastGoodIndex = activeBases.indexOf(base);
      return res;
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(
    `All Esplora providers unreachable: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
  );
}

function validateAddress(address: string): void {
  if (!ADDRESS_RE.test(address)) throw new Error(`Invalid address format: ${address}`);
}

export async function fetchComposeFeeRates(): Promise<FeeRates> {
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

export async function fetchComposeUtxos(address: string): Promise<Utxo[]> {
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

export async function broadcastComposeTx(txHex: string): Promise<string> {
  if (!TX_HEX_RE.test(txHex)) throw new Error('Invalid transaction hex');
  const res = await tryProviders(`/tx`, { method: 'POST', body: txHex });
  if (!res.ok) {
    const errorText = await res.text();
    const safeError = errorText.replace(/[<>&"']/g, '').slice(0, 200);
    throw new Error(`Broadcast failed: ${safeError}`);
  }
  return res.text();
}
