import { useRef, useState, type FormEvent } from 'react';
import { supabase } from './lib/supabase';
import { loadFlights, loadPilots } from './flight-data';

const workbookType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const expirySeconds = 24 * 60 * 60;

export function FlightBackup({ sectionId, userId, name, approvalsReady }: {
  sectionId: string;
  userId: string;
  name: string;
  approvalsReady: boolean;
}) {
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
      const [{ createFlightWorkbook }, flights, pilots] = await Promise.all([
        import('./flight-export'), loadFlights(), loadPilots(approvalsReady),
      ]);
      const names = new Map(pilots.map(pilot => [pilot.id, pilot.display_name || pilot.email || pilot.id]));
      names.set(userId, name);
      const buffer = await createFlightWorkbook(flights, names);
      const date = new Date().toLocaleDateString('en-CA');
      const filename = 'UDRON-copia-de-vols-' + date + '.xlsx';
      const path = userId + '/' + crypto.randomUUID() + '-' + filename;
      const storage = supabase.storage.from('flight-backups');
      const { error: uploadError } = await storage.upload(path, new Blob([buffer], { type: workbookType }), {
        contentType: workbookType, cacheControl: '0',
      });
      if (uploadError) throw uploadError;
      const { data, error } = await storage.createSignedUrl(path, expirySeconds, { download: filename });
      if (error) throw error;
      setLink(data.signedUrl);
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

  return <section id={sectionId} aria-labelledby="backup-title">
    <h2 id="backup-title">Còpia de seguretat</h2>
    <p>Genera un fitxer Excel amb tots els vols actius i les hores per pilot. Qualsevol persona que tingui l’enllaç el podrà descarregar durant 24 hores.</p>
    <form onSubmit={createBackup}>
      <button disabled={busy}>{busy ? 'Preparant la còpia…' : 'Genera l’enllaç'}</button>
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
