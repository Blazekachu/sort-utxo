import { describe, it, expect } from 'vitest';
import { bitcoinNetworkForAddress, mempoolTxUrl } from '../mempool';

describe('bitcoinNetworkForAddress', () => {
  it('returns testnet for tb1 addresses', () => {
    const net = bitcoinNetworkForAddress('tb1qqg6r556kx3rdg9jv4gu680averf53y6p8ue5ph');
    expect(net.bech32).toBe('tb');
  });

  it('returns mainnet for bc1 addresses', () => {
    const net = bitcoinNetworkForAddress('bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh');
    expect(net.bech32).toBe('bc');
  });

  it('returns mainnet for undefined', () => {
    const net = bitcoinNetworkForAddress(undefined);
    expect(net.bech32).toBe('bc');
  });
});

describe('mempoolTxUrl', () => {
  it('returns testnet4 URL for tb1 address', () => {
    expect(mempoolTxUrl('tb1qqg6r556kx3rdg9jv4gu680averf53y6p8ue5ph'))
      .toBe('https://mempool.space/testnet4/tx');
  });

  it('returns mainnet URL for bc1 address', () => {
    expect(mempoolTxUrl('bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh'))
      .toBe('https://mempool.space/tx');
  });

  it('returns mainnet URL for empty string', () => {
    expect(mempoolTxUrl('')).toBe('https://mempool.space/tx');
  });
});
