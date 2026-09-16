import * as bitcoin from 'bitcoinjs-lib';

export type ComposeChain = 'mainnet' | 'signet';

export function parseWalletNetworkName(name: string | undefined, address?: string): ComposeChain {
  if (name === 'Mainnet') return 'mainnet';
  if (name === 'Signet' || name === 'Testnet4' || name === 'Testnet') return 'signet';
  if (address && (address.startsWith('tb1') || address.startsWith('2') || address.startsWith('m') || address.startsWith('n'))) {
    return 'signet';
  }
  return 'mainnet';
}

export function bitcoinNetworkForChain(chain: ComposeChain): bitcoin.Network {
  return chain === 'mainnet' ? bitcoin.networks.bitcoin : bitcoin.networks.testnet;
}

export function mempoolExplorerTxBase(chain: ComposeChain): string {
  return chain === 'signet' ? 'https://mempool.space/signet/tx' : 'https://mempool.space/tx';
}

export function ordChainName(chain: ComposeChain): 'bitcoin' | 'signet' {
  return chain === 'signet' ? 'signet' : 'bitcoin';
}
