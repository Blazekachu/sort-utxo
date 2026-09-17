'use client';

import { useState } from 'react';
import { useWalletStore } from '@/store/walletStore';
import { useSortStore } from '@/store/sortStore';
import { useComposeStore } from '@/store/composeStore';
import { connectWallet, disconnectWallet } from '@/lib/wallet/xverse';
import type { WalletProvider } from '@/lib/wallet/xverse';

function truncateAddress(addr: string): string {
  if (addr.length <= 16) return addr;
  return `${addr.slice(0, 10)}...${addr.slice(-6)}`;
}

/** Shared wallet bar — one connection for Sorting, Compose, and Consolidation. */
export default function WalletBar({ onConnected }: { onConnected?: () => void }) {
  const wallet = useWalletStore((s) => s.wallet);
  const setWallet = useWalletStore((s) => s.setWallet);

  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPicker, setShowPicker] = useState(false);

  async function handleConnect(provider: WalletProvider) {
    setConnecting(true);
    setError(null);
    setShowPicker(false);
    try {
      const state = await connectWallet(provider);
      if (state.taprootAddress === state.paymentAddress) {
        throw new Error('Both a taproot and a payment address are required. Your wallet only returned one.');
      }
      setWallet(state);
      onConnected?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect');
    } finally {
      setConnecting(false);
    }
  }

  function handleDisconnect() {
    const state = disconnectWallet();
    setWallet(state);
    useSortStore.getState().reset();
    useComposeStore.getState().reset();
  }

  if (wallet.connected) {
    return (
      <div className="w-full rounded-lg border border-gray-800 bg-gray-900 px-4 py-3 flex items-center justify-between gap-4">
        <div className="flex flex-col gap-1 min-w-0">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-gray-500">Taproot:</span>
            <span className="font-mono text-gray-300 truncate">{truncateAddress(wallet.taprootAddress)}</span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-gray-500">Payment:</span>
            <span className="font-mono text-gray-300 truncate">{truncateAddress(wallet.paymentAddress)}</span>
          </div>
        </div>
        <button
          onClick={handleDisconnect}
          className="shrink-0 rounded-lg border border-gray-700 px-3 py-1.5 text-xs text-gray-400 hover:border-red-500 hover:text-red-400 transition-colors"
        >
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3">
      {showPicker ? (
        <div className="flex gap-3">
          <button
            onClick={() => handleConnect('sats-connect')}
            disabled={connecting}
            className="rounded-lg border border-gray-700 bg-gray-900 px-5 py-2.5 text-sm font-medium text-white hover:border-orange-500 transition-colors disabled:opacity-50"
          >
            Xverse
          </button>
          <button
            onClick={() => handleConnect('leather')}
            disabled={connecting}
            className="rounded-lg border border-gray-700 bg-gray-900 px-5 py-2.5 text-sm font-medium text-white hover:border-orange-500 transition-colors disabled:opacity-50"
          >
            Leather
          </button>
        </div>
      ) : (
        <button
          onClick={() => setShowPicker(true)}
          disabled={connecting}
          className="rounded-lg bg-orange-600 px-6 py-2.5 text-sm font-semibold text-white hover:bg-orange-500 transition-colors disabled:opacity-50"
        >
          {connecting ? 'Connecting...' : 'Connect Wallet'}
        </button>
      )}
      {error && <p className="text-sm text-red-400">{error}</p>}
    </div>
  );
}
