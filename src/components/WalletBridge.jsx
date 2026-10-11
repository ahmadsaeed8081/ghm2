import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppKit, useAppKitAccount, useAppKitProvider, useDisconnect } from '@reown/appkit/react';
import { appKitConfigured, networkConfig } from '../web3.js';

function providerName(provider) {
  if (provider?.isMetaMask) return 'MetaMask';
  if (provider?.isTrust) return 'Trust Wallet';
  if (provider?.isTokenPocket) return 'TokenPocket';
  if (provider?.isCoinbaseWallet) return 'Coinbase Wallet';
  if (provider?.isRabby) return 'Rabby Wallet';
  if (provider?.isBraveWallet) return 'Brave Wallet';
  return 'Browser wallet';
}

function walletKey({ id, rdns, name }) {
  if (rdns) return `rdns:${rdns.toLowerCase()}`;
  if (id && !String(id).startsWith('legacy-')) return `id:${String(id).toLowerCase()}`;
  return `name:${String(name || 'Browser wallet').toLowerCase().replace(/[^a-z0-9]/g, '')}`;
}

function addUniqueWallets(current, additions) {
  const next = [...current];
  for (const wallet of additions) {
    const key = walletKey(wallet);
    const nameKey = String(wallet.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!next.some(item => item.provider === wallet.provider || walletKey(item) === key ||
      (nameKey && nameKey !== 'browserwallet' && String(item.name || '').toLowerCase().replace(/[^a-z0-9]/g, '') === nameKey))) {
      next.push(wallet);
    }
  }
  return next;
}

function ConfiguredWalletPicker({ iframeRef, frameReady }) {
  const { open } = useAppKit();
  const { address, isConnected } = useAppKitAccount();
  const { walletProvider } = useAppKitProvider('eip155');
  const { disconnect } = useDisconnect();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [connectedMenuOpen, setConnectedMenuOpen] = useState(false);
  const [connectedAddress, setConnectedAddress] = useState('');
  const [wallets, setWallets] = useState([]);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const [wcPending, setWcPending] = useState(false);
  const [activeMode, setActiveMode] = useState(null);
  const [injectedProvider, setInjectedProvider] = useState(null);
  const connectedKeyRef = useRef('');

  const announceWallet = useCallback((detail) => {
    const info = detail?.info;
    const provider = detail?.provider;
    if (!provider || !info) return;
    const name = info.name || 'Browser wallet';
    const rdns = info.rdns || '';
    const id = info.uuid || rdns || `name:${name.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
    setWallets(current => {
      return addUniqueWallets(current, [{
        id,
        name,
        icon: info.icon || '',
        rdns,
        provider
      }]);
    });
  }, []);

  // Discover wallets in BOTH the top-level React page and the same-origin
  // legacy iframe. Some extensions inject/announce only in one browsing
  // context. Never call eth_requestAccounts during discovery: connecting is
  // only allowed after the user selects a wallet in the picker.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const knownProviders = new Set();
    const knownWalletIds = new Set();
    const realms = [window];
    const frameWindow = iframeRef.current?.contentWindow;
    if (frameWindow && frameWindow !== window) realms.push(frameWindow);

    const onAnnounce = (event) => {
      const detail = event.detail;
      if (!detail?.provider || !detail?.info) return;
      const info = detail.info;
      const id = info.uuid || info.rdns || `${info.name || 'wallet'}-${knownWalletIds.size}`;
      if (knownProviders.has(detail.provider) || knownWalletIds.has(id)) return;
      knownProviders.add(detail.provider);
      knownWalletIds.add(id);
      announceWallet(detail);
    };

    for (const realm of realms) {
      try {
        realm.addEventListener('eip6963:announceProvider', onAnnounce);
        realm.dispatchEvent(new Event('eip6963:requestProvider'));
      } catch (discoveryError) {
        console.debug('EIP-6963 discovery unavailable in one browsing context:', discoveryError);
      }
    }

    const fallbackTimer = window.setTimeout(() => {
      const legacyCandidates = [];
      for (const realm of realms) {
        try {
          const ethereum = realm.ethereum;
          if (!ethereum) continue;
          const providers = Array.isArray(ethereum.providers) && ethereum.providers.length
            ? ethereum.providers
            : [ethereum];
          for (const provider of providers) {
            if (provider && !knownProviders.has(provider) &&
                !legacyCandidates.some(item => item.provider === provider)) {
              legacyCandidates.push({ provider, realm });
            }
          }
        } catch (discoveryError) {
          console.debug('Legacy wallet discovery unavailable in one browsing context:', discoveryError);
        }
      }

      if (legacyCandidates.length) {
        setWallets(current => addUniqueWallets(current, legacyCandidates.map(({ provider }, index) => ({
          id: `legacy-${current.length + index}-${providerName(provider).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
          name: providerName(provider),
          icon: '',
          rdns: '',
          provider
        }))));
      }
    }, 900);

    return () => {
      for (const realm of realms) {
        try { realm.removeEventListener('eip6963:announceProvider', onAnnounce); } catch { /* ignored */ }
      }
      window.clearTimeout(fallbackTimer);
    };
  }, [announceWallet, iframeRef, frameReady]);

  const bridgeProvider = useCallback((provider, mode, connectedAddress = '') => {
    const frame = iframeRef.current?.contentWindow;
    if (!frame || !frameReady || !provider) return false;
    try {
      frame.__GHM21_CONFIG__ = networkConfig;
      frame.__GHM21_SELECTED_PROVIDER__ = provider;
      // The legacy page is same-origin. Assigning this property is only a
      // compatibility bridge; its connect handler prioritizes the explicit
      // selected provider and no longer auto-selects a random extension.
      try { Object.defineProperty(frame, 'ethereum', { configurable: true, writable: true, value: provider }); }
      catch { frame.ethereum = provider; }
      frame.web3 = { currentProvider: provider };
      frame.__GHM21_REOWN_CONNECTED__ = mode === 'walletconnect';
      const key = `${mode}:${connectedAddress || 'provider'}`;
      if (connectedKeyRef.current !== key && typeof frame.connectDynamicWallet === 'function') {
        connectedKeyRef.current = key;
        frame.connectDynamicWallet(true);
      }
      return true;
    } catch (bridgeError) {
      console.error('Could not bridge selected wallet into legacy page:', bridgeError);
      setError('The wallet connected, but the website could not initialize it. Reload the page and try again.');
      return false;
    }
  }, [frameReady, iframeRef]);

  // Only bridge a provider after the user has chosen it in the picker. This
  // prevents restored AppKit sessions from silently connecting on page load.
  useEffect(() => {
    if (wcPending && isConnected && walletProvider && address) {
      setWcPending(false);
      setActiveMode('walletconnect');
    }
  }, [wcPending, isConnected, walletProvider, address]);

  useEffect(() => {
    if (!frameReady || !activeMode) return;
    if (activeMode === 'injected' && injectedProvider) {
      bridgeProvider(injectedProvider, 'injected');
    } else if (activeMode === 'walletconnect' && isConnected && walletProvider && address) {
      bridgeProvider(walletProvider, 'walletconnect', address);
      setWcPending(false);
    }
  }, [activeMode, frameReady, isConnected, walletProvider, address, injectedProvider, bridgeProvider]);

  useEffect(() => {
    if (activeMode !== 'injected' || !injectedProvider) return undefined;
    const frame = iframeRef.current?.contentWindow;
    const onAccountsChanged = (accounts) => {
      connectedKeyRef.current = '';
      if (!Array.isArray(accounts) || !accounts[0]) {
        if (frame && typeof frame.disconnectLegacyWallet === 'function') frame.disconnectLegacyWallet();
        setInjectedProvider(null);
        setActiveMode(null);
      } else {
        bridgeProvider(injectedProvider, 'injected', accounts[0]);
      }
    };
    const onProviderDisconnect = () => {
      connectedKeyRef.current = '';
      if (frame && typeof frame.disconnectLegacyWallet === 'function') frame.disconnectLegacyWallet();
      setInjectedProvider(null);
      setActiveMode(null);
    };
    injectedProvider.on?.('accountsChanged', onAccountsChanged);
    injectedProvider.on?.('disconnect', onProviderDisconnect);
    return () => {
      injectedProvider.removeListener?.('accountsChanged', onAccountsChanged);
      injectedProvider.removeListener?.('disconnect', onProviderDisconnect);
    };
  }, [activeMode, injectedProvider, iframeRef, bridgeProvider]);

  useEffect(() => {
    if (!pickerOpen && !connectedMenuOpen) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        setPickerOpen(false);
        setConnectedMenuOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [pickerOpen, connectedMenuOpen]);

  // Clear the legacy page when an active WalletConnect session is disconnected.
  useEffect(() => {
    if (activeMode !== 'walletconnect' || isConnected) return;
    const frame = iframeRef.current?.contentWindow;
    if (frame && typeof frame.disconnectLegacyWallet === 'function') frame.disconnectLegacyWallet();
    connectedKeyRef.current = '';
    setActiveMode(null);
  }, [activeMode, isConnected, iframeRef]);

  const openPicker = useCallback(() => {
    setError('');
    setWcPending(false);
    setPickerOpen(true);
  }, []);

  useEffect(() => {
    const onMessage = (event) => {
      if (event.origin !== window.location.origin || event.source !== iframeRef.current?.contentWindow) return;
      if (event.data?.type === 'GHM21_OPEN_WALLET') {
        setConnectedMenuOpen(false);
        openPicker();
      }
      if (event.data?.type === 'GHM21_OPEN_CONNECTED_MENU') {
        setConnectedAddress(String(event.data.address || address || ''));
        setPickerOpen(false);
        setConnectedMenuOpen(true);
      }
      if (event.data?.type === 'GHM21_FRAME_READY') {
        connectedKeyRef.current = '';
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [iframeRef, openPicker, address]);

  useEffect(() => {
    if (!frameReady) return;
    const frame = iframeRef.current?.contentWindow;
    if (frame) frame.__GHM21_CONFIG__ = networkConfig;
  }, [frameReady, iframeRef]);

  const disconnectWalletFromApp = async () => {
    const frame = iframeRef.current?.contentWindow;
    if (frame && typeof frame.disconnectLegacyWallet === 'function') frame.disconnectLegacyWallet();
    connectedKeyRef.current = '';
    setConnectedMenuOpen(false);
    setPickerOpen(false);
    setWcPending(false);
    setInjectedProvider(null);
    setActiveMode(null);
    if (isConnected) {
      try { await disconnect(); }
      catch (disconnectError) { console.warn('WalletConnect session disconnect failed:', disconnectError); }
    }
  };

  const changeWallet = async () => {
    await disconnectWalletFromApp();
    setError('');
    setPickerOpen(true);
  };

  const chooseInjected = async (wallet) => {
    // This function is invoked only by the explicit Select button. Discovery
    // and page load must never request accounts from an injected provider.
    setBusyId(wallet.id);
    setError('');
    try {
      const accounts = await wallet.provider.request({ method: 'eth_requestAccounts' });
      if (!Array.isArray(accounts) || !accounts[0]) throw new Error('The wallet did not return an account.');
      if (isConnected) {
        try { await disconnect(); } catch { /* injected wallet selection can proceed */ }
      }
      setWcPending(false);
      connectedKeyRef.current = '';
      setInjectedProvider(wallet.provider);
      setActiveMode('injected');
      setPickerOpen(false);
    } catch (connectError) {
      if (connectError?.code === 4001) setError('Connection was cancelled in the wallet. Choose a wallet to try again.');
      else setError(connectError?.message || 'Could not connect this wallet.');
    } finally {
      setBusyId('');
    }
  };

  const chooseWalletConnect = async () => {
    setError('');
    setPickerOpen(false);
    setActiveMode(null);
    setInjectedProvider(null);
    connectedKeyRef.current = '';
    const legacyFrame = iframeRef.current?.contentWindow;
    if (legacyFrame && typeof legacyFrame.disconnectLegacyWallet === 'function') legacyFrame.disconnectLegacyWallet();
    if (isConnected) {
      try { await disconnect(); } catch (disconnectError) {
        console.warn('Previous WalletConnect session could not be cleared:', disconnectError);
      }
    }
    setWcPending(true);
    open({ view: 'Connect' });
  };

  // Reown is configured before this component is mounted.
  return <>
    {pickerOpen && <div className="wallet-picker-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) setPickerOpen(false);
    }}>
      <section className="wallet-picker" role="dialog" aria-modal="true" aria-labelledby="wallet-picker-title">
        <header className="wallet-picker-header">
          <div><p className="wallet-picker-eyebrow">GHM21 SECURE CONNECTION</p><h2 id="wallet-picker-title">Choose a wallet</h2></div>
          <button className="wallet-picker-close" type="button" aria-label="Close wallet picker" onClick={() => setPickerOpen(false)}>×</button>
        </header>
        <p className="wallet-picker-copy">Select the wallet you want to use. We will not choose an installed wallet automatically.</p>
        {wallets.length > 0 ? <div className="wallet-picker-list">
          {wallets.map(wallet => <button className="wallet-option" type="button" key={wallet.id} disabled={!!busyId}
            onClick={() => chooseInjected(wallet)}>
            {wallet.icon ? <img src={wallet.icon} alt="" /> : <span className="wallet-option-icon">◈</span>}
            <span className="wallet-option-name">{wallet.name}</span>
            <span className="wallet-option-action">{busyId === wallet.id ? 'Connecting…' : 'Select'}</span>
          </button>)}
        </div> : <div className="wallet-picker-empty">No browser extension wallets detected. You can connect using WalletConnect below.</div>}
        <div className="wallet-picker-divider"><span>OR CONNECT WITH</span></div>
        <button className="walletconnect-option" type="button" onClick={chooseWalletConnect}>
          <span className="walletconnect-symbol">⌁</span><span><strong>WalletConnect</strong><small>Scan a QR code or choose a mobile wallet</small></span><span className="wallet-option-action">Continue</span>
        </button>
        {error && <p className="wallet-picker-error" role="alert">{error}</p>}
        <p className="wallet-picker-footnote">Connecting a wallet does not authorize a transaction. Review every signature and transaction in your wallet.</p>
      </section>
    </div>}
    {connectedMenuOpen && <div className="wallet-picker-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) setConnectedMenuOpen(false);
    }}>
      <section className="wallet-picker wallet-account-menu" role="dialog" aria-modal="true" aria-labelledby="connected-menu-title">
        <header className="wallet-picker-header">
          <div><p className="wallet-picker-eyebrow">GHM21 WALLET</p><h2 id="connected-menu-title">Wallet connected</h2></div>
          <button className="wallet-picker-close" type="button" aria-label="Close wallet menu" onClick={() => setConnectedMenuOpen(false)}>×</button>
        </header>
        <p className="wallet-picker-copy">{connectedAddress ? `${connectedAddress.slice(0, 8)}…${connectedAddress.slice(-6)}` : 'Your wallet is connected to this website.'}</p>
        <button className="wallet-option" type="button" onClick={disconnectWalletFromApp}>
          <span className="wallet-option-icon">↪</span><span className="wallet-option-name">Disconnect wallet</span><span className="wallet-option-action">Disconnect</span>
        </button>
        <button className="wallet-option" type="button" onClick={changeWallet} style={{ marginTop: 8 }}>
          <span className="wallet-option-icon">◈</span><span className="wallet-option-name">Choose another wallet</span><span className="wallet-option-action">Change</span>
        </button>
        <p className="wallet-picker-footnote">Disconnecting here clears the website connection. For browser extension wallets, you may also need to revoke this site in the wallet's connected-sites settings.</p>
      </section>
    </div>}
  </>;
}

function UnconfiguredBridge({ iframeRef }) {
  useEffect(() => {
    const onMessage = (event) => {
      if (event.origin !== window.location.origin || event.source !== iframeRef.current?.contentWindow) return;
      if (event.data?.type === 'GHM21_OPEN_WALLET') {
        iframeRef.current?.contentWindow?.alert('Wallet connection is not configured yet. Add your Reown Project ID to client/.env as VITE_REOWN_PROJECT_ID and restart the development server.');
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [iframeRef]);
  return null;
}

export default function WalletBridge({ iframeRef, frameReady }) {
  return appKitConfigured
    ? <ConfiguredWalletPicker iframeRef={iframeRef} frameReady={frameReady} />
    : <UnconfiguredBridge iframeRef={iframeRef} />;
}
