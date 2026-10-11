import React from 'react';
import { useAppKit, useAppKitAccount } from '@reown/appkit/react';
import { appKitConfigured } from '../web3.js';

function ConfiguredWalletConnect() {
  const { open } = useAppKit();
  const { address, isConnected } = useAppKitAccount();
  return <button className="wallet-button" type="button" onClick={() => open({ view: isConnected ? 'Account' : 'Connect' })}>
    {isConnected && address ? `${address.slice(0, 6)}…${address.slice(-4)}` : 'Connect wallet'}
  </button>;
}

export default function WalletConnect() {
  if (!appKitConfigured) return <button className="wallet-button" type="button" disabled title="Set VITE_REOWN_PROJECT_ID in client/.env">WalletConnect setup required</button>;
  return <ConfiguredWalletConnect />;
}
