import { describe, it, expect, beforeEach } from 'vitest';
import { useWalletStore } from '../walletStore';

describe('walletStore', () => {
  beforeEach(() => {
    useWalletStore.getState().clearWallet();
  });

  it('keeps one wallet session for the whole app', () => {
    useWalletStore.getState().setWallet({
      connected: true,
      taprootAddress: 'tb1pabc',
      paymentAddress: 'tb1qxyz',
      publicKey: 'ab'.repeat(32),
      paymentPublicKey: 'cd'.repeat(33),
      network: 'signet',
    });
    expect(useWalletStore.getState().wallet.connected).toBe(true);
    expect(useWalletStore.getState().wallet.paymentAddress).toBe('tb1qxyz');
  });
});
