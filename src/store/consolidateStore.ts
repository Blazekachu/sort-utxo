import { create } from 'zustand';
import type { FeeRates, LabeledUtxo } from '@/types';

export interface ConsolidationAccount {
  id: string;
  paymentAddress: string;
  taprootAddress: string;
  taprootPublicKey: string;
  paymentPublicKey?: string;
}

export interface AccountUtxo extends LabeledUtxo {
  accountId: string;
  sourceAddress: string;
}

export type ConsolidateStatus =
  | { state: 'idle' }
  | { state: 'scanning'; scanned: number; total: number }
  | { state: 'ready' }
  | { state: 'signing'; pass: number; total: number }
  | { state: 'broadcasting' }
  | { state: 'done'; txid: string }
  | { state: 'error'; message: string };

interface ConsolidateStore {
  accounts: ConsolidationAccount[];
  addAccount: (account: ConsolidationAccount) => void;
  removeAccount: (id: string) => void;
  utxos: AccountUtxo[];
  setUtxos: (utxos: AccountUtxo[]) => void;
  feeRates: FeeRates | null;
  setFeeRates: (rates: FeeRates) => void;
  feeRate: number;
  setFeeRate: (rate: number) => void;
  unconfirmedCount: number;
  setUnconfirmedCount: (count: number) => void;
  status: ConsolidateStatus;
  setStatus: (status: ConsolidateStatus) => void;
}

export const useConsolidateStore = create<ConsolidateStore>((set) => ({
  accounts: [],
  addAccount: (account) => set((state) => ({ accounts: [...state.accounts, account] })),
  removeAccount: (id) => set((state) => ({
    accounts: state.accounts.filter((account) => account.id !== id),
    utxos: state.utxos.filter((utxo) => utxo.accountId !== id),
  })),
  utxos: [],
  setUtxos: (utxos) => set({ utxos }),
  feeRates: null,
  setFeeRates: (feeRates) => set({ feeRates, feeRate: feeRates.halfHourFee }),
  feeRate: 1,
  setFeeRate: (feeRate) => set({ feeRate }),
  unconfirmedCount: 0,
  setUnconfirmedCount: (unconfirmedCount) => set({ unconfirmedCount }),
  status: { state: 'idle' },
  setStatus: (status) => set({ status }),
}));
