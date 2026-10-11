import React, { useEffect, useState } from 'react';
import { api } from '../services/api.js';
export function TransactionHistory() {
  const [items, setItems] = useState([]);
  const [state, setState] = useState('Loading wallet transaction history…');
  useEffect(() => { api.transactions().then((result) => { setItems(result.items || []); setState((result.items || []).length ? '' : 'No saved transactions.'); }).catch((error) => setState(`Connect/sign in from the main website first. ${error.message}`)); }, []);
  return <section className="db-panel"><h2>Wallet transaction history</h2>{state && <p className="db-muted">{state}</p>}
    <div className="db-task-list">{items.map((item) => <article className="db-task" key={item._id}><div className="db-task-top"><strong>{item.type}</strong><span>{item.status}</span></div><p>{item.amount}</p>{item.transactionHash && <a href={`https://polygonscan.com/tx/${item.transactionHash}`} target="_blank" rel="noreferrer">View on PolygonScan</a>}<small>{item.createdAt ? new Date(item.createdAt).toLocaleString() : ''}</small></article>)}</div>
  </section>;
}
