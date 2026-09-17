import { create } from 'zustand';
import type { WalletState, FeeRates, ScanStatus } from '@/types';
import type { ComposeUtxo } from '@/lib/compose/types';
import { canComposeSpend } from '@/lib/compose/gates';

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
  /** Selected outpoints in vin order (click order). Last must be plain payment. */
  inputOrder: string[];
  toggleInput: (key: string) => void;
  moveInput: (key: string, dir: 'up' | 'down') => void;
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
  vanityLocktime: number | null;
  setVanityLocktime: (n: number | null) => void;
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
  setUtxos: (utxos) => set({ utxos, inputOrder: [] }),
  inputOrder: [],
  toggleInput: (key) => {
    const utxo = get().utxos.find((u) => keyOf(u) === key);
    if (!utxo || !canComposeSpend(utxo)) return;
    const inputOrder = [...get().inputOrder];
    const idx = inputOrder.indexOf(key);
    if (idx >= 0) inputOrder.splice(idx, 1);
    else inputOrder.push(key);
    set({ inputOrder, vanityTxid: null, vanityLocktime: null });
  },
  moveInput: (key, dir) => {
    const inputOrder = [...get().inputOrder];
    const idx = inputOrder.indexOf(key);
    if (idx < 0) return;
    const swap = dir === 'up' ? idx - 1 : idx + 1;
    if (swap < 0 || swap >= inputOrder.length) return;
    [inputOrder[idx], inputOrder[swap]] = [inputOrder[swap], inputOrder[idx]];
    set({ inputOrder, vanityTxid: null, vanityLocktime: null });
  },
  outputRows: [],
  setOutputRows: (outputRows) => set({ outputRows, vanityTxid: null, vanityLocktime: null }),
  opReturnText: '',
  setOpReturnText: (opReturnText) => set({ opReturnText, vanityTxid: null, vanityLocktime: null }),
  vanityPrefix: '',
  vanitySuffix: '',
  setVanityPrefix: (vanityPrefix) => set({ vanityPrefix, vanityTxid: null, vanityLocktime: null }),
  setVanitySuffix: (vanitySuffix) => set({ vanitySuffix, vanityTxid: null, vanityLocktime: null }),
  vanityTxid: null,
  setVanityTxid: (vanityTxid) => set({ vanityTxid }),
  vanityLocktime: null,
  setVanityLocktime: (vanityLocktime) => set({ vanityLocktime }),
  scanStatus: { state: 'idle' },
  setScanStatus: (scanStatus) => set({ scanStatus }),
  feeRates: null,
  setFeeRates: (feeRates) => set({ feeRates, selectedFeeRate: feeRates.halfHourFee }),
  selectedFeeRate: 1,
  setSelectedFeeRate: (selectedFeeRate) => set({ selectedFeeRate, vanityTxid: null, vanityLocktime: null }),
  buildStatus: { state: 'idle' },
  setBuildStatus: (buildStatus) => set({ buildStatus }),
  reset: () => set({
    wallet: defaultWallet,
    utxos: [],
    inputOrder: [],
    outputRows: [],
    opReturnText: '',
    vanityPrefix: '',
    vanitySuffix: '',
    vanityTxid: null,
    vanityLocktime: null,
    scanStatus: { state: 'idle' },
    feeRates: null,
    selectedFeeRate: 1,
    buildStatus: { state: 'idle' },
  }),
}));
