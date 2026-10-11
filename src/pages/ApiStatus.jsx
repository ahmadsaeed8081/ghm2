import React, { useEffect, useState } from 'react';
import { api } from '../services/api.js';
export function ApiStatus() {
  const [status, setStatus] = useState('Checking backend and MongoDB…');
  useEffect(() => {
    api.health().then((result) => setStatus(`API reachable · MongoDB ${result.database || 'status unknown'} · Polygon network (chain ${result.chainId || 'unknown'})`))
      .catch(() => setStatus('Backend unavailable — make sure /api is routed to the Express server.'));
  }, []);
  return <main className="status-page"><h1>GHM21 system status</h1><p>{status}</p><p>This checks API reachability and MongoDB connection status. It does not certify that the Polygon contract addresses or ABI are correct.</p><a href="/">Return to application</a></main>;
}
