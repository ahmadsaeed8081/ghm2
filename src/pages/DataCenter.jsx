import React from 'react';
import { Link } from 'react-router-dom';
import { PublicTaskFeed } from '../components/PublicTaskFeed.jsx';
import { TelegramProfile } from '../components/TelegramProfile.jsx';
import { TransactionHistory } from '../components/TransactionHistory.jsx';
export default function DataCenter() {
  return <main className="data-center"><header className="data-center-header"><div><p className="db-eyebrow">GHM21 · POLYGON MAINNET</p><h1>MongoDB data workspace</h1><p className="db-muted">Public tasks, wallet profile and transaction history loaded from the API.</p></div><nav><Link to="/">Back to website</Link> · <Link to="/migration-status">System status</Link></nav></header><div className="db-grid"><PublicTaskFeed /><div className="db-side"><TelegramProfile /><TransactionHistory /></div></div></main>;
}
