import { useRef, useState, type FormEvent } from 'react';
import { supabase } from './lib/supabase';
import type { AppData } from './context';
import { loadFlights } from './flight-data';
import { todayISO } from './format';
const expirySeconds = 24 * 60 * 60;

export function FlightBackup({ data, team = false }: { data: AppData; team?: boolean }) {
  const teamBackup = team && data.isAdmin;
  const [email, setEmail] = useState('');
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const linkField = useRef<HTMLInputElement>(null);

  async function createBackup(event: FormEvent) {
    event.preventDefault();
    setLink('');
    setMessage('');
    setBusy(true);
    try {
      const [{ createFlightWorkbook, WORKBOOK_TYPE }, flights] = await Promise.all([
        import('./flight-export'), loadFlights(teamBackup ? undefined : data.user.id),
      ]);
      const buffer = await createFlightWorkbook(flights.filter(f => !f.deleted_at), { ...data, isAdmin: teamBackup });
      const scope = teamBackup ? 'equip' : 'personal';
      const filename = 'UDRON-copia-' + scope + '-' + todayISO() + '.xlsx';
      const path = data.user.id + '/' + scope + '/' + crypto.randomUUID() + '-' + filename;
      const storage = supabase.storage.from('flight-backups');
      const { error: uploadError } = await storage.upload(path, new Blob([buffer], { type: WORKBOOK_TYPE }), {
        contentType: WORKBOOK_TYPE, cacheControl: '0',
      });
      if (uploadError) throw uploadError;
      const { data: signed, error } = await storage.createSignedUrl(path, expirySeconds, { download: filename });
      if (error) throw error;
      setLink(signed.signedUrl);
      setMessage('Enllaç creat.');
    } catch {
      setMessage('No s’ha pogut crear la còpia de seguretat. Torna-ho a provar.');
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(link);
      setMessage('Enllaç copiat.');
    } catch {
      linkField.current?.focus();
      linkField.current?.select();
      setMessage('Copia l’enllaç seleccionat.');
    }
  }

  const mailBody = 'Còpia de vols d’UDRON. L’enllaç és vàlid durant 24 hores des que es genera.\n\n' + link;
  const draftUrl = 'mailto:' + encodeURIComponent(email.trim()).replace('%40', '@') +
    '?subject=' + encodeURIComponent('UDRON · Còpia de vols') + '&body=' + encodeURIComponent(mailBody);

  return <section className="panel" aria-labelledby="backup-title">
    <h2 id="backup-title">{teamBackup ? 'Còpia de seguretat de l’equip' : 'Còpia de seguretat personal'}</h2>
    <p>{teamBackup ? 'Genera un Excel amb tots els vols actius i les hores per pilot.' : 'Genera un Excel amb els teus vols actius i el teu total d’hores.'} Qualsevol persona que tingui l’enllaç el podrà descarregar durant 24 hores.</p>
    <form onSubmit={createBackup}>
      <button className="primary" disabled={busy}>{busy ? 'Preparant la còpia…' : 'Genera l’enllaç'}</button>
    </form>
    {link && <div className="backup-share">
      <label>Enllaç de descàrrega<input ref={linkField} type="url" readOnly value={link} /></label>
      <div className="actions">
        <button type="button" onClick={() => void copyLink()}>Copia l’enllaç</button>
        <a href={link} rel="noreferrer">Descarrega l’Excel</a>
      </div>
      <form onSubmit={event => { event.preventDefault(); window.location.href = draftUrl; }}>
        <label>Correu del destinatari<input type="email" value={email} onChange={event => setEmail(event.target.value)} required /></label>
        <button>Obre l’esborrany de correu</button>
      </form>
    </div>}
    {message && <p role="status">{message}</p>}
  </section>;
}
