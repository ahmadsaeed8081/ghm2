# Polygon wallet configuration

- `npm run dev` and `npm run build` both select Polygon Mainnet (chain ID 137).
- Both networks are Polygon; BNB Chain is not configured as a fallback.
- The React shell injects the selected network and matching environment addresses into the legacy compatibility iframe.
- Browser-extension providers use the explicit wallet picker; Reown AppKit handles WalletConnect/QR.
- When connected, clicking the address opens Disconnect and Choose another wallet.
- Configure verified Polygon Mainnet contract addresses before using on-chain features.
- Configure the same protocol contract address in client and server environment files so the API can validate submitted transactions.
