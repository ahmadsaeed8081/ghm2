import React, { useRef, useState, useCallback } from 'react';
import WalletBridge from '../components/WalletBridge.jsx';
import { networkConfig } from '../web3.js';

export default function LegacyApp() {
  const iframeRef = useRef(null);
  const [frameReady, setFrameReady] = useState(false);
  const handleFrameLoad = useCallback(() => {
    const frame = iframeRef.current?.contentWindow;
    if (frame) {
      frame.__GHM21_CONFIG__ = networkConfig;
      frame.__GHM21_API_BASE_URL__ = networkConfig.apiBaseUrl;
      if (typeof frame.applyGHM21Config === 'function') frame.applyGHM21Config(networkConfig);
      // The legacy shell remains temporarily for compatibility, but all persistent
      // task/profile/transaction data is handled by the Express + MongoDB API.
      if (typeof frame.loadCommunityFeed === 'function') frame.loadCommunityFeed();
    }
    setFrameReady(true);
  }, []);
  return <main className="legacy-host">
    <iframe ref={iframeRef} title="GHM21 P2P Mutual Aid Protocol" src="/legacy.html"
      onLoad={handleFrameLoad} allow="clipboard-read; clipboard-write" />
    <WalletBridge iframeRef={iframeRef} frameReady={frameReady} />
    <a className="migration-link" href="/migration-status">API status</a>
  </main>;
}
