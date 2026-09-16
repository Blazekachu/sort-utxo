import { create } from 'zustand';
import type { WalletState, FeeRates, ScanStatus } from '@/types';
import type { ComposeUtxo } from '@/lib/compose/types';

export interface ComposeOutputRow {
  id: string;
  value: number;
  address: string;
}

export type ComposeBuildStatus =
  | { state: 'idle' }
  | { state: 'building' }
  | { state: 'signing' }
  | { state: 'broadcasting' }
  | { state: 'done'; txid: string }
  | { state: 'error'; message: string };

function keyOf(u: ComposeUtxo): string {
  return `${u.txid}:${u.vout}`;
}

function canSpend(u: ComposeUtxo): boolean {
  return u.confirmed && u.satRanges !== null && u.kind !== 'rune' && u.kind !== 'unknown';
}

function canFee(u: ComposeUtxo): boolean {
  return canSpend(u) && u.source === 'payment' && u.kind === 'plain';
}

const defaultWallet: WalletState = {
  connected: false,
  taprootAddress: '',
  paymentAddress: '',
  publicKey: '',
};

export interface ComposeStore {
  wallet: WalletState;
  setWallet: (wallet: WalletState) => void;
  utxos: ComposeUtxo[];
  setUtxos: (utxos: ComposeUtxo[]) => void;
  spendKeys: Set<string>;
  feeKeys: Set<string>;
  toggleSpend: (key: string) => void;
  toggleFee: (key: string) => void;
  outputRows: ComposeOutputRow[];
  setOutputRows: (rows: ComposeOutputRow[]) => void;
  opReturnText: string;
  setOpReturnText: (text: string) => void;
  vanityPrefix: string;
  vanitySuffix: string;
  setVanityPrefix: (v: string) => void;
  setVanitySuffix: (v: string) => void;
  vanityTxid: string | null;
  setVanityTxid: (txid: string | null) => void;
  scanStatus: ScanStatus;
  setScanStatus: (status: ScanStatus) => void;
  feeRates: FeeRates | null;
  setFeeRates: (rates: FeeRates) => void;
  selectedFeeRate: number;
  setSelectedFeeRate: (rate: number) => void;
  buildStatus: ComposeBuildStatus;
  setBuildStatus: (status: ComposeBuildStatus) => void;
  reset: () => void;
}

export const useComposeStore = create<ComposeStore>((set, get) => ({
  wallet: defaultWallet,
  setWallet: (wallet) => set({ wallet }),
  utxos: [],
  setUtxos: (utxos) => set({ utxos, spendKeys: new Set(), feeKeys: new Set() }),
  spendKeys: new Set(),
  feeKeys: new Set(),
  toggleSpend: (key) => {
    const utxo = get().utxos.find((u) => keyOf(u) === key);
    if (!utxo || !canSpend(utxo)) return;
    const spendKeys = new Set(get().spendKeys);
    const feeKeys = new Set(get().feeKeys);
    if (spendKeys.has(key)) spendKeys.delete(key);
    else {
      spendKeys.add(key);
      feeKeys.delete(key);
    }
    set({ spendKeys, feeKeys, vanityTxid: null });
  },
  toggleFee: (key) => {
    const utxo = get().utxos.find((u) => keyOf(u) === key);
    if (!utxo || !canFee(utxo)) return;
    const spendKeys = new Set(get().spendKeys);
    const feeKeys = new Set(get().feeKeys);
    if (feeKeys.has(key)) feeKeys.delete(key);
    else {
      feeKeys.add(key);
      spendKeys.delete(key);
    }
    set({ spendKeys, feeKeys, vanityTxid: null });
  },
  outputRows: [],
  setOutputRows: (outputRows) => set({ outputRows, vanityTxid: null }),
  opReturnText: '',
  setOpReturnText: (opReturnText) => set({ opReturnText, vanityTxid: null }),
  vanityPrefix: '',
  vanitySuffix: '',
  setVanityPrefix: (vanityPrefix) => set({ vanityPrefix, vanityTxid: null }),
  setVanitySuffix: (vanitySuffix) => set({ vanitySuffix, vanityTxid: null }),
  vanityTxid: null,
  setVanityTxid: (vanityTxid) => set({ vanityTxid }),
  scanStatus: { state: 'idle' },
  setScanStatus: (scanStatus) => set({ scanStatus }),
  feeRates: null,
  setFeeRates: (feeRates) => set({ feeRates, selectedFeeRate: feeRates.halfHourFee }),
  selectedFeeRate: 1,
  setSelectedFeeRate: (selectedFeeRate) => set({ selectedFeeRate, vanityTxid: null }),
  buildStatus: { state: 'idle' },
  setBuildStatus: (buildStatus) => set({ buildStatus }),
  reset: () => set({
    wallet: defaultWallet,
    utxos: [],
    spendKeys: new Set(),
    feeKeys: new Set(),
    outputRows: [],
    opReturnText: '',
    vanityPrefix: '',
    vanitySuffix: '',
    vanityTxid: null,
    scanStatus: { state: 'idle' },
    feeRates: null,
    selectedFeeRate: 1,
    buildStatus: { state: 'idle' },
  }),
}));
