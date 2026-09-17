import Wallet, { AddressPurpose, RpcErrorCode } from 'sats-connect';
import type { WalletState } from '@/types';
import { parseWalletNetworkName } from '@/lib/compose/network';

export type WalletProvider = 'sats-connect' | 'leather';

const PROVIDER_KEY = 'sort-utxo-wallet-provider';

function loadProvider(): WalletProvider {
  if (typeof window === 'undefined') return 'sats-connect';
  const stored = localStorage.getItem(PROVIDER_KEY);
  return stored === 'leather' ? 'leather' : 'sats-connect';
}

let activeProvider: WalletProvider = loadProvider();
export function getActiveProvider(): WalletProvider { return activeProvider; }

export async function connectWallet(provider: WalletProvider = 'sats-connect'): Promise<WalletState> {
  activeProvider = provider;
  if (typeof window !== 'undefined') localStorage.setItem(PROVIDER_KEY, provider);

  if (provider === 'leather') return connectLeather();

  // Xverse 2.3+ rejects the legacy `getAddresses` RPC with ACCESS_DENIED unless
  // a `wallet_connect` permission was granted first. `wallet_connect` is the
  // one-shot replacement that requests permissions and returns addresses.
  const response = await Wallet.request('wallet_connect', {
    addresses: [AddressPurpose.Ordinals, AddressPurpose.Payment],
    message: 'Connect to Sort UTXO',
  });

  if (response.status === 'error') {
    const code = (response.error as { code?: number }).code;
    if (code === RpcErrorCode.USER_REJECTION) throw new Error('User cancelled wallet connection');
    throw new Error((response.error as { message?: string }).message ?? 'Failed to connect wallet');
  }

  const { addresses, network } = response.result as typeof response.result & {
    network?: { bitcoin?: { name?: string } };
  };
  const ordinalsAddr = addresses.find((a) => a.purpose === AddressPurpose.Ordinals);
  const paymentAddr = addresses.find((a) => a.purpose === AddressPurpose.Payment);

  if (!ordinalsAddr || !paymentAddr) throw new Error('Missing taproot or payment address');

  const tapAddr = ordinalsAddr.address;
  const payAddr = paymentAddr.address;
  const pubKey = ordinalsAddr.publicKey;
  const paymentPubKey = paymentAddr.publicKey;

  if (!tapAddr || !/^(bc1p|tb1p)[a-z0-9]{58}$/i.test(tapAddr)) {
    throw new Error(`Invalid taproot address from wallet: ${tapAddr?.slice(0, 20)}`);
  }
  if (!payAddr || payAddr.length < 20 || payAddr.length > 90) {
    throw new Error(`Invalid payment address from wallet: ${payAddr?.slice(0, 20)}`);
  }
  if (!pubKey || !/^[0-9a-f]{64,66}$/i.test(pubKey)) {
    throw new Error('Invalid public key from wallet: expected 32-33 byte hex');
  }

  return {
    connected: true,
    taprootAddress: tapAddr,
    paymentAddress: payAddr,
    publicKey: pubKey,
    paymentPublicKey: paymentPubKey,
    network: parseWalletNetworkName(network?.bitcoin?.name, tapAddr),
  };
}

export interface SignResult {
  /** Present when the wallet broadcast the transaction through its own backend. */
  txid?: string;
  /** Signed PSBT (base64), present when the wallet returns it for a fallback broadcast. */
  signedPsbt?: string;
}

export async function signPsbt(
  psbtBase64: string,
  inputsToSign: Array<{ index: number; address: string }>
): Promise<SignResult> {
  return signPsbtWithBroadcast(psbtBase64, inputsToSign, true);
}

/** Signs a partial PSBT without broadcasting so several wallet accounts can sign it in turn. */
export async function signPsbtForConsolidation(
  psbtBase64: string,
  inputsToSign: Array<{ index: number; address: string }>
): Promise<SignResult> {
  return signPsbtWithBroadcast(psbtBase64, inputsToSign, false);
}

/** Signs without broadcasting so Compose can verify txid and layout first. */
export async function signPsbtForCompose(
  psbtBase64: string,
  inputsToSign: Array<{ index: number; address: string }>,
): Promise<SignResult> {
  return signPsbtForConsolidation(psbtBase64, inputsToSign);
}

/** Signs without broadcasting so Sort can verify txid and layout first. */
export async function signPsbtForSort(
  psbtBase64: string,
  inputsToSign: Array<{ index: number; address: string }>,
): Promise<SignResult> {
  return signPsbtForConsolidation(psbtBase64, inputsToSign);
}

async function signPsbtWithBroadcast(
  psbtBase64: string,
  inputsToSign: Array<{ index: number; address: string }>,
  broadcast: boolean,
): Promise<SignResult> {
  const signInputs: Record<string, number[]> = {};
  for (const { address, index } of inputsToSign) {
    if (!signInputs[address]) signInputs[address] = [];
    signInputs[address].push(index);
  }

  if (activeProvider === 'leather') return signPsbtLeather(psbtBase64, signInputs, broadcast);

  const response = await Wallet.request('signPsbt', {
    psbt: psbtBase64,
    signInputs,
    broadcast,
  });

  if (response.status === 'error') {
    const code = (response.error as { code?: number }).code;
    if (code === RpcErrorCode.USER_REJECTION) throw new Error('User cancelled signing');
    throw new Error((response.error as { message?: string }).message ?? 'Failed to sign PSBT');
  }

  const result = response.result as { psbt?: string; txid?: string };
  return { txid: result.txid, signedPsbt: result.psbt };
}

export function disconnectWallet(): WalletState {
  if (activeProvider === 'sats-connect') {
    Wallet.disconnect().catch((err) => {
      console.warn('[wallet] disconnect failed:', err instanceof Error ? err.message : err);
    });
  }
  activeProvider = 'sats-connect';
  if (typeof window !== 'undefined') localStorage.removeItem(PROVIDER_KEY);
  return { connected: false, taprootAddress: '', paymentAddress: '', publicKey: '' };
}

// --- Leather ---

interface LeatherProvider {
  request(method: string, params?: unknown): Promise<unknown>;
}

function getLeatherProvider(): LeatherProvider {
  const provider =
    (window as unknown as Record<string, unknown>).LeatherProvider ??
    (window as unknown as Record<string, unknown>).BitcoinProvider;
  if (!provider) throw new Error('Leather wallet not found. Please install it from leather.io');
  return provider as LeatherProvider;
}

async function connectLeather(): Promise<WalletState> {
  const provider = getLeatherProvider();
  const result = await provider.request('getAddresses') as {
    result: {
      addresses: Array<{ symbol: string; type: string; address: string; publicKey: string; derivationPath?: string }>;
    };
  };

  const addresses = result.result.addresses;
  let taprootAddr = addresses.find((a) => a.type === 'p2tr');
  let paymentAddr = addresses.find((a) => a.type === 'p2wpkh');

  if (!taprootAddr) taprootAddr = addresses.find((a) => a.address.startsWith('bc1p') || a.address.startsWith('tb1p'));
  if (!paymentAddr) {
    paymentAddr = addresses.find((a) =>
      (a.address.startsWith('bc1q') || a.address.startsWith('tb1q') ||
       a.address.startsWith('3') || a.address.startsWith('2') ||
       a.address.startsWith('m') || a.address.startsWith('n')) &&
      a !== taprootAddr
    );
  }

  if (!taprootAddr && paymentAddr) {
    throw new Error('Wallet did not return a taproot address. Sorting requires both taproot and segwit addresses.');
  }
  if (!taprootAddr) {
    throw new Error(`Wallet did not return a usable address. Got: ${addresses.map((a) => `${a.type}=${a.address.slice(0, 12)}`).join(', ')}`);
  }
  if (!paymentAddr) paymentAddr = taprootAddr;

  const tapAddr = taprootAddr.address;
  const payAddr = paymentAddr.address;
  const pubKey = taprootAddr.publicKey;

  if (!tapAddr || tapAddr.length < 20 || tapAddr.length > 90) throw new Error(`Invalid address from wallet: ${tapAddr?.slice(0, 20)}`);
  if (!payAddr || payAddr.length < 20 || payAddr.length > 90) throw new Error(`Invalid payment address from wallet: ${payAddr?.slice(0, 20)}`);
  if (!pubKey || !/^[0-9a-f]{64,66}$/i.test(pubKey)) throw new Error('Invalid public key from wallet: expected 32-33 byte hex');

  return {
    connected: true,
    taprootAddress: tapAddr,
    paymentAddress: payAddr,
    publicKey: pubKey,
    paymentPublicKey: paymentAddr.publicKey,
    network: parseWalletNetworkName(undefined, tapAddr),
  };
}

async function signPsbtLeather(
  psbtBase64: string,
  signInputs: Record<string, number[]>,
  broadcast: boolean,
): Promise<SignResult> {
  const provider = getLeatherProvider();
  const result = await provider.request('signPsbt', {
    hex: hexFromBase64(psbtBase64),
    signAtIndex: Object.values(signInputs).flat(),
    broadcast,
  }) as { result: { hex?: string; txid?: string } };
  const { hex, txid } = result.result;
  return { txid, signedPsbt: hex ? base64FromHex(hex) : undefined };
}

function hexFromBase64(b64: string): string {
  const binary = atob(b64);
  let hex = '';
  for (let i = 0; i < binary.length; i++) hex += binary.charCodeAt(i).toString(16).padStart(2, '0');
  return hex;
}

function base64FromHex(hex: string): string {
  let binary = '';
  for (let i = 0; i < hex.length; i += 2) binary += String.fromCharCode(parseInt(hex.substring(i, i + 2), 16));
  return btoa(binary);
}
