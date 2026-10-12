import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../services/api.js';

export function PublicTaskFeed() {
  const [items, setItems] = useState([]);
  const [state, setState] = useState('Loading public MongoDB task feed…');
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const result = await api.tasks();
      setItems(result.items || []);
      setState((result.items || []).length ? '' : 'No task submissions have been saved yet.');
    } catch (error) { setState(`Could not load the task feed: ${error.message}`); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  return <section className="db-panel">
    <div className="db-panel-heading"><h2>Public task feed</h2><button onClick={refresh} disabled={busy} aria-busy={busy}>{busy && <span className="inline-spinner" aria-hidden="true" />}{busy ? 'Refreshing…' : 'Refresh'}</button></div>
    {state && <p className="db-muted">{state}</p>}
    <div className="db-task-list">{items.map((item) => <article className="db-task" key={item.id || item._id}>
      <div className="db-task-top"><strong>{item.taskTitle}</strong><span>{item.isVerified ? 'Verified' : 'Pending review'}</span></div>
      <p className="db-muted">Wallet: {item.performerWallet}</p>
      <p><a href={item.proofLink} target="_blank" rel="noreferrer">Open proof link</a>{(item.attachmentUrls || []).map((file) => <React.Fragment key={file.url}> · <a href={`${(import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '')}${file.url}`} target="_blank" rel="noreferrer">View {file.filename || 'attachment'}</a></React.Fragment>)}</p>
      <small>{item.likeCount || 0} likes · {item.tipCount || 0} tips · {item.createdAt ? new Date(item.createdAt).toLocaleString() : ''}</small>
    </article>)}</div>
  </section>;
}
