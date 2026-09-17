import { create } from 'zustand';
import type { WalletState } from '@/types';

const defaultWallet: WalletState = {
  connected: false,
  taprootAddress: '',
  paymentAddress: '',
  publicKey: '',
};

export interface WalletStore {
  wallet: WalletState;
  setWallet: (wallet: WalletState) => void;
  clearWallet: () => void;
}

/** Shared across Sorting, Compose, and Consolidation — one connect for the whole app. */
export const useWalletStore = create<WalletStore>((set) => ({
  wallet: defaultWallet,
  setWallet: (wallet) => set({ wallet }),
  clearWallet: () => set({ wallet: defaultWallet }),
}));

export { defaultWallet };
