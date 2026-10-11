import { createAppKit } from '@reown/appkit/react';
import { EthersAdapter } from '@reown/appkit-adapter-ethers';
import { polygon } from '@reown/appkit/networks';

const projectId = (import.meta.env.VITE_REOWN_PROJECT_ID || '').trim();
const isPlaceholder = !projectId || /replace|your[-_ ]?project|placeholder/i.test(projectId);

// This project targets Polygon Mainnet in every environment.
export const targetNetwork = polygon;
export const networkConfig = {
  mode: 'polygon-mainnet',
  chainId: 137,
  chainHex: '0x89',
  chainName: 'Polygon Mainnet',
  nativeCurrency: { name: 'POL', symbol: 'POL', decimals: 18 },
  rpcUrl: (import.meta.env.VITE_POLYGON_RPC_URL || 'https://polygon-bor-rpc.publicnode.com').trim(),
  explorerUrl: 'https://polygonscan.com/',
  apiBaseUrl: (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, ''),
  usdtAddress: (import.meta.env.VITE_POLYGON_USDT_ADDRESS || '').trim(),
  protocolAddress: (import.meta.env.VITE_POLYGON_PROTOCOL_ADDRESS || '').trim(),
  vaultAddress: (import.meta.env.VITE_POLYGON_VAULT_ADDRESS || '').trim(),
  operationsAddress: (import.meta.env.VITE_POLYGON_OPERATIONS_ADDRESS || '').trim(),
  defaultUpliner: (import.meta.env.VITE_POLYGON_DEFAULT_UPLINER || '').trim(),
};

export const appKitConfigured = !isPlaceholder;

if (appKitConfigured) {
  createAppKit({
    adapters: [new EthersAdapter()],
    networks: [targetNetwork],
    defaultNetwork: targetNetwork,
    projectId,
    metadata: {
      name: 'GHM21',
      description: 'GHM21 P2P Mutual Aid Protocol',
      url: typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173',
      icons: []
    },
    enableInjected: false,
    enableEIP6963: false,
    allWallets: 'SHOW',
    features: { analytics: false, email: false, socials: [] }
  });
}
