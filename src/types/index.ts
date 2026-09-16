// --- Wallet ---

export interface WalletState {
  connected: boolean;
  taprootAddress: string;
  paymentAddress: string;
  publicKey: string;
  /** Payment address pubkey from wallet_connect; required to spend nested P2SH. */
  paymentPublicKey?: string;
  /** Wallet-reported chain. Compose uses this; Sort may ignore it. */
  network?: 'mainnet' | 'signet';
}

// --- UTXO ---

export interface Utxo {
  txid: string;
  vout: number;
  value: number;
  status: {
    confirmed: boolean;
    block_height?: number;
  };
}

export type UtxoLabel = 'plain' | 'inscription' | 'rune' | 'unknown';

/** A single on-chain asset carried by a UTXO, as reported by ord. */
export type Asset =
  | { kind: 'inscription'; id: string; offset: number } // offset = sats from output start
  | { kind: 'rune'; name: string; amount: bigint; divisibility: number };

export interface LabeledUtxo extends Utxo {
  /**
   * Derived summary label for existing consumers (UI, fee planning):
   * 'plain' | 'inscription' | 'rune' | 'unknown'. Prefer `assets` for new code;
   * `label` is computed from `assets` (or 'unknown' on a labeling failure).
   */
  label: UtxoLabel;
  /** Which wallet address this UTXO belongs to */
  source: 'taproot' | 'payment';
  /** Authoritative asset list from ord. [] === plain. */
  assets: Asset[];
  /** Rune name if this UTXO carries a rune (derived from `assets`). */
  runeName?: string;
  /** Inscription ID if this UTXO carries one (derived from `assets`). */
  inscriptionId?: string;
  /** True when the UTXO carries an inscription (derived from `assets`). */
  hasInscription?: boolean;
}

export type UtxoPlacement = 'misplaced' | 'correct';

/** Returns whether a UTXO is in the correct address type. Fail-closed: an
 *  `unknown` UTXO (ord could not authoritatively label it) is never moved. */
export function classifyPlacement(utxo: LabeledUtxo): UtxoPlacement {
  if (utxo.label === 'unknown') return 'correct';
  if (utxo.label === 'plain') {
    // Plain sats should be on segwit (payment)
    return utxo.source === 'payment' ? 'correct' : 'misplaced';
  }
  // Runes and inscriptions should be on taproot
  return utxo.source === 'taproot' ? 'correct' : 'misplaced';
}

// --- Fees ---

export interface FeeRates {
  fastestFee: number;
  halfHourFee: number;
  hourFee: number;
  economyFee: number;
  minimumFee: number;
  _feeWarning?: string;
}

// --- Scan ---

export type ScanStatus =
  | { state: 'idle' }
  | { state: 'scanning'; scanned: number; total: number }
  | { state: 'done' }
  | { state: 'error'; message: string; failedCount: number };

// --- Sort ---

export type SortStatus =
  | { state: 'idle' }
  | { state: 'building' }
  | { state: 'signing' }
  | { state: 'broadcasting' }
  | { state: 'done'; txid: string }
  | { state: 'error'; message: string };

// --- Ord API ---

export interface OrdOutputResponse {
  address: string;
  inscriptions: string[];
  runes: Record<string, { amount: number; divisibility: number }>;
  value: number;
}
