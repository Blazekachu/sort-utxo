import { create } from 'zustand';
import type { WalletState, LabeledUtxo, FeeRates, ScanStatus, SortStatus } from '@/types';
import { classifyPlacement } from '@/types';

export interface SortStore {
  wallet: WalletState;
  setWallet: (wallet: WalletState) => void;

  utxos: LabeledUtxo[];
  setUtxos: (utxos: LabeledUtxo[]) => void;

  selectedKeys: Set<string>;
  toggleSelection: (key: string) => void;
  selectAllMisplaced: () => void;
  deselectAll: () => void;

  scanStatus: ScanStatus;
  setScanStatus: (status: ScanStatus) => void;
  unconfirmedCount: number;
  setUnconfirmedCount: (count: number) => void;

  feeRates: FeeRates | null;
  setFeeRates: (rates: FeeRates) => void;
  selectedFeeRate: number;
  setSelectedFeeRate: (rate: number) => void;

  sortStatus: SortStatus;
  setSortStatus: (status: SortStatus) => void;

  misplacedUtxos: () => LabeledUtxo[];
  selectedUtxos: () => LabeledUtxo[];

  reset: () => void;
}

const defaultWallet: WalletState = {
  connected: false,
  taprootAddress: '',
  paymentAddress: '',
  publicKey: '',
};

export const useSortStore = create<SortStore>((set, get) => ({
  wallet: defaultWallet,
  setWallet: (wallet) => set({ wallet }),

  utxos: [],
  setUtxos: (utxos) => {
    const misplacedKeys = new Set(
      utxos.filter((u) => classifyPlacement(u) === 'misplaced').map((u) => `${u.txid}:${u.vout}`),
    );
    set({ utxos, selectedKeys: misplacedKeys });
  },

  selectedKeys: new Set(),
  toggleSelection: (key) => set((state) => {
    const next = new Set(state.selectedKeys);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return { selectedKeys: next };
  }),
  selectAllMisplaced: () => set((state) => {
    const keys = new Set(
      state.utxos.filter((u) => classifyPlacement(u) === 'misplaced').map((u) => `${u.txid}:${u.vout}`),
    );
    return { selectedKeys: keys };
  }),
  deselectAll: () => set({ selectedKeys: new Set() }),

  scanStatus: { state: 'idle' },
  setScanStatus: (scanStatus) => set({ scanStatus }),
  unconfirmedCount: 0,
  setUnconfirmedCount: (unconfirmedCount) => set({ unconfirmedCount }),

  feeRates: null,
  setFeeRates: (feeRates) => set({ feeRates, selectedFeeRate: feeRates.halfHourFee }),
  selectedFeeRate: 1,
  setSelectedFeeRate: (selectedFeeRate) => set({ selectedFeeRate }),

  sortStatus: { state: 'idle' },
  setSortStatus: (sortStatus) => set({ sortStatus }),

  misplacedUtxos: () => get().utxos.filter((u) => classifyPlacement(u) === 'misplaced'),
  selectedUtxos: () => {
    const keys = get().selectedKeys;
    return get().utxos.filter((u) => keys.has(`${u.txid}:${u.vout}`));
  },

  reset: () => set({
    wallet: defaultWallet,
    utxos: [],
    selectedKeys: new Set(),
    scanStatus: { state: 'idle' },
    unconfirmedCount: 0,
    feeRates: null,
    selectedFeeRate: 1,
    sortStatus: { state: 'idle' },
  }),
}));
