import { describe, it, expect } from 'vitest';
import type { WalletState } from '@/types';

describe('WalletState compose fields', () => {
  it('optional compose fields are additive', () => {
    const w: WalletState = { connected: false, taprootAddress: '', paymentAddress: '', publicKey: '' };
    expect(w.paymentPublicKey).toBeUndefined();
    expect(w.network).toBeUndefined();
  });
});
