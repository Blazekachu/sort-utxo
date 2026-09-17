import { create } from 'zustand';
import type { LabeledUtxo, FeeRates, ScanStatus, SortStatus } from '@/types';
import { classifyPlacement } from '@/types';

export interface SortStore {
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

  vanityPrefix: string;
  vanitySuffix: string;
  setVanityPrefix: (prefix: string) => void;
  setVanitySuffix: (suffix: string) => void;
  vanityTxid: string | null;
  setVanityTxid: (txid: string | null) => void;
  vanityLocktime: number | null;
  setVanityLocktime: (locktime: number | null) => void;

  misplacedUtxos: () => LabeledUtxo[];
  selectedUtxos: () => LabeledUtxo[];

  reset: () => void;
}

const clearVanity = {
  vanityTxid: null as string | null,
  vanityLocktime: null as number | null,
};

export const useSortStore = create<SortStore>((set, get) => ({
  utxos: [],
  setUtxos: (utxos) => {
    const misplacedKeys = new Set(
      utxos.filter((u) => classifyPlacement(u) === 'misplaced').map((u) => `${u.txid}:${u.vout}`),
    );
    set({ utxos, selectedKeys: misplacedKeys, ...clearVanity });
  },

  selectedKeys: new Set(),
  toggleSelection: (key) => set((state) => {
    const next = new Set(state.selectedKeys);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return { selectedKeys: next, ...clearVanity };
  }),
  selectAllMisplaced: () => set((state) => {
    const keys = new Set(
      state.utxos.filter((u) => classifyPlacement(u) === 'misplaced').map((u) => `${u.txid}:${u.vout}`),
    );
    return { selectedKeys: keys, ...clearVanity };
  }),
  deselectAll: () => set({ selectedKeys: new Set(), ...clearVanity }),

  scanStatus: { state: 'idle' },
  setScanStatus: (scanStatus) => set({ scanStatus }),
  unconfirmedCount: 0,
  setUnconfirmedCount: (unconfirmedCount) => set({ unconfirmedCount }),

  feeRates: null,
  setFeeRates: (feeRates) => set({ feeRates, selectedFeeRate: feeRates.halfHourFee, ...clearVanity }),
  selectedFeeRate: 1,
  setSelectedFeeRate: (selectedFeeRate) => set({ selectedFeeRate, ...clearVanity }),

  sortStatus: { state: 'idle' },
  setSortStatus: (sortStatus) => set({ sortStatus }),

  vanityPrefix: '',
  vanitySuffix: '',
  setVanityPrefix: (vanityPrefix) => set({ vanityPrefix, ...clearVanity }),
  setVanitySuffix: (vanitySuffix) => set({ vanitySuffix, ...clearVanity }),
  vanityTxid: null,
  setVanityTxid: (vanityTxid) => set({ vanityTxid }),
  vanityLocktime: null,
  setVanityLocktime: (vanityLocktime) => set({ vanityLocktime }),

  misplacedUtxos: () => get().utxos.filter((u) => classifyPlacement(u) === 'misplaced'),
  selectedUtxos: () => {
    const keys = get().selectedKeys;
    return get().utxos.filter((u) => keys.has(`${u.txid}:${u.vout}`));
  },

  reset: () => set({
    utxos: [],
    selectedKeys: new Set(),
    scanStatus: { state: 'idle' },
    unconfirmedCount: 0,
    feeRates: null,
    selectedFeeRate: 1,
    sortStatus: { state: 'idle' },
    vanityPrefix: '',
    vanitySuffix: '',
    ...clearVanity,
  }),
}));
