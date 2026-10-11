import React, { useEffect, useState } from 'react';
import { api } from '../services/api.js';
export function TelegramProfile() {
  const [telegramHandle, setTelegramHandle] = useState('');
  const [state, setState] = useState('Loading saved profile…');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.profile().then((result) => { setTelegramHandle(result.user?.telegramHandle || ''); setState('Profile loaded from MongoDB.'); })
      .catch((error) => setState(`Connect/sign in from the main website first. ${error.message}`));
  }, []);
  async function save(event) {
    event.preventDefault(); setBusy(true); setState('Saving…');
    try { await api.updateProfile({ telegramHandle }); setState('Telegram name/ID saved to MongoDB.'); }
    catch (error) { setState(`Could not save: ${error.message}`); }
    finally { setBusy(false); }
  }
  return <section className="db-panel"><h2>Telegram profile</h2><p className="db-muted">This value is stored against your signed-in wallet, not in browser storage.</p>
    <form className="db-form" onSubmit={save}><label htmlFor="telegram-handle">Telegram username or numeric chat ID</label><input id="telegram-handle" value={telegramHandle} onChange={(event) => setTelegramHandle(event.target.value)} maxLength={100} placeholder="@yourusername or chat ID" required /><button disabled={busy}>{busy ? 'Saving…' : 'Save profile'}</button></form>
    <p className="db-status">{state}</p>
  </section>;
}
