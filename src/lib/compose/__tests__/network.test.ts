import { describe, it, expect } from 'vitest';
import * as bitcoin from 'bitcoinjs-lib';
import {
  parseWalletNetworkName,
  bitcoinNetworkForChain,
  mempoolExplorerTxBase,
} from '../network';

describe('parseWalletNetworkName', () => {
  it('maps Signet from wallet name', () => {
    expect(parseWalletNetworkName('Signet', 'tb1qqg6r556kx3rdg9jv4gu680averf53y6p8ue5ph')).toBe('signet');
  });
  it('maps Mainnet from wallet name', () => {
    expect(parseWalletNetworkName('Mainnet', 'bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh')).toBe('mainnet');
  });
  it('routes legacy Testnet4 and Testnet wallet names to signet', () => {
    expect(parseWalletNetworkName('Testnet4', 'tb1qqg6r556kx3rdg9jv4gu680averf53y6p8ue5ph')).toBe('signet');
    expect(parseWalletNetworkName('Testnet', 'tb1qqg6r556kx3rdg9jv4gu680averf53y6p8ue5ph')).toBe('signet');
  });
  it('does not treat tb1 prefix alone as a chain id — missing name + tb1 still signet (dev default), never a testnet4 token', () => {
    expect(parseWalletNetworkName(undefined, 'tb1qqg6r556kx3rdg9jv4gu680averf53y6p8ue5ph')).toBe('signet');
  });
});

describe('bitcoinNetworkForChain', () => {
  it('uses bitcoinjs testnet params for signet', () => {
    expect(bitcoinNetworkForChain('signet')).toBe(bitcoin.networks.testnet);
    expect(bitcoinNetworkForChain('mainnet')).toBe(bitcoin.networks.bitcoin);
  });
});

describe('mempoolExplorerTxBase', () => {
  it('uses signet explorer, not testnet4', () => {
    expect(mempoolExplorerTxBase('signet')).toBe('https://mempool.space/signet/tx');
    expect(mempoolExplorerTxBase('mainnet')).toBe('https://mempool.space/tx');
    expect(mempoolExplorerTxBase('signet')).not.toMatch(/testnet4/);
  });
});
