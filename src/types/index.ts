// --- Wallet ---

export interface WalletState {
  connected: boolean;
  taprootAddress: string;
  paymentAddress: string;
  publicKey: string;
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

export type UtxoLabel = 'plain' | 'inscription' | 'rune';

export interface LabeledUtxo extends Utxo {
  label: UtxoLabel;
  /** Which wallet address this UTXO belongs to */
  source: 'taproot' | 'payment';
  /** Rune name if label is 'rune' */
  runeName?: string;
  /** Inscription ID if label is 'inscription' */
  inscriptionId?: string;
}

export type UtxoPlacement = 'misplaced' | 'correct';

/** Returns whether a UTXO is in the correct address type */
export function classifyPlacement(utxo: LabeledUtxo): UtxoPlacement {
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
