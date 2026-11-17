import { useEffect, useState } from 'react';
import type { AppData } from '../context';
import { loadSessions, type AppSession, type Member } from '../flight-data';
import { daysBetween, fmtDate, fmtHM, lastDate, sumMinutes, todayISO } from '../format';
import { supabase } from '../lib/supabase';
import { RecencyChip } from './Dashboard';
import { FlightBackup } from '../FlightBackup';
import { Modal } from '../Modal';

const ONLINE_MS = 3 * 60_000;
const BEAT_MS = 60_000;
const sessionMs = (s: AppSession, now: number) =>
  (now - Date.parse(s.last_seen_at) < ONLINE_MS ? now : Date.parse(s.last_seen_at) + BEAT_MS) - Date.parse(s.started_at);
function fmtSpan(ms: number) {
  const min = Math.max(1, Math.round(ms / 60_000));
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`;
}
function fmtLastSeen(iso: string | undefined, now: number) {
  if (!iso) return 'Fa més de 7 dies';
  const t = Date.parse(iso), diff = now - t;
  if (diff < ONLINE_MS) return 'Ara';
  if (diff < 3_600_000) return `Fa ${Math.round(diff / 60_000)} min`;
  const d = new Date(t), today = new Date(now);
  const hm = d.toLocaleTimeString('ca', { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === today.toDateString() ? `Avui ${hm}` : `${d.toLocaleDateString('ca', { day: '2-digit', month: '2-digit' })} ${hm}`;
}

function useSessions() {
  const [sessions, setSessions] = useState<AppSession[] | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    let active = true;
    const load = () => loadSessions(7).then(rows => { if (active) { setSessions(rows); setNow(Date.now()); } }).catch(() => active && setSessions([]));
    load();
    const timer = window.setInterval(load, 60_000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);
  return { sessions, now };
}

export function Team({ data, onOpenPilot }: { data: AppData; onOpenPilot: (id: string) => void }) {
  const { sessions, now } = useSessions();
  const byUser = new Map<string, AppSession[]>();
  for (const s of sessions ?? []) byUser.set(s.user_id, [...(byUser.get(s.user_id) ?? []), s]);
  const online = (sessions ?? []).filter(s => now - Date.parse(s.last_seen_at) < ONLINE_MS)
    .sort((a, b) => a.started_at.localeCompare(b.started_at))
    .filter((s, i, list) => list.findIndex(x => x.user_id === s.user_id) === i);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [removing, setRemoving] = useState<Member | null>(null);
  const today = todayISO();
  const pending = data.team.filter(m => m.approval_status === 'pending');
  const removed = data.team.filter(m => m.approval_status === 'removed');
  const members = data.team.filter(m => m.approval_status !== 'pending' && m.approval_status !== 'removed').sort((a, b) => data.nameOf(a.id).localeCompare(data.nameOf(b.id), 'ca'));

  async function run(member: Member, action: () => PromiseLike<{ error: unknown }>, done: string) {
    setBusy(member.id);
    setNotice('');
    try {
      const { error } = await action();
      if (error) throw error;
      setNotice(done);
      data.reload();
    } catch {
      setNotice("No s'ha pogut fer el canvi. Torna-ho a provar.");
    } finally { setBusy(null); }
  }
  const approval = (m: Member, status: 'approved' | 'blocked') => run(m, () => supabase.rpc('set_pilot_approval', { target_id: m.id, new_status: status }),
    status === 'approved' ? `${data.nameOf(m.id)} ja pot fer servir l'app.` : `${data.nameOf(m.id)} ha quedat bloquejat.`);
  const role = (m: Member, newRole: 'pilot' | 'admin') => run(m, () => supabase.rpc('set_member_role', { target_id: m.id, new_role: newRole }),
    newRole === 'admin' ? `${data.nameOf(m.id)} ara és administrador.` : `${data.nameOf(m.id)} torna a ser pilot.`);
  async function confirmRemove() {
    if (!removing) return;
    const m = removing;
    setRemoving(null);
    await run(m, () => supabase.rpc('remove_member', { target_id: m.id }), `${m.display_name || m.email} s'ha eliminat. Els seus vols es conserven.`);
  }
  const restore = (m: Member) => run(m, () => supabase.rpc('restore_member', { target_id: m.id }), `${m.display_name || m.email} torna a tenir accés.`);

  return <section className="view" aria-labelledby="equip-titol">
    <div className="panel">
      <div className="view-head"><h2>Connectats ara {sessions && <span className="hint">· {online.length}</span>}</h2><span className="hint">S'actualitza cada minut</span></div>
      {!sessions ? <p className="hint">Carregant…</p> : !online.length ? <p className="hint">Ara mateix no hi ha ningú connectat.</p> :
        <div className="tablewrap"><table className="cards">
          <thead><tr><th>Nom</th><th>Connectat des de</th><th>Temps connectat</th></tr></thead>
          <tbody>{online.map(s => <tr key={s.id}>
            <td data-l="Nom"><span className="chip ok">{data.nameOf(s.user_id)}</span></td>
            <td data-l="Connectat des de" className="num">{new Date(s.started_at).toLocaleTimeString('ca', { hour: '2-digit', minute: '2-digit' })}</td>
            <td data-l="Temps connectat" className="num">{fmtSpan(sessionMs(s, now))}</td>
          </tr>)}</tbody>
        </table></div>}
      <p className="hint">Compta mentre l'app està oberta i a la vista. Si algú la deixa en segon pla més de 5 minuts, es comença una connexió nova.</p>
    </div>
    <div className="panel">
      <div className="view-head"><h2 id="equip-titol">Sol·licituds d'accés</h2><span className="hint">Els pilots es registren a la pantalla d'inici i tu els autoritzes aquí</span></div>
      {!pending.length ? <p className="hint">No hi ha cap sol·licitud pendent.</p> : <div className="tablewrap"><table className="cards">
        <thead><tr><th>Nom</th><th>Correu</th><th>Estat del correu</th><th><span className="sr-only">Accions</span></th></tr></thead>
        <tbody>{pending.map(m => <tr key={m.id}>
          <td data-l="Nom">{m.display_name || '—'}</td><td data-l="Correu">{m.email}</td>
          <td data-l="Correu">{m.email_confirmed ? <span className="chip ok">Confirmat</span> : <span className="chip warn">Sense confirmar</span>}</td>
          <td className="actions">
            <button className="small primary" disabled={busy !== null || !m.email_confirmed} onClick={() => void approval(m, 'approved')}>Autoritza</button>
            <button className="small danger" disabled={busy !== null} onClick={() => void approval(m, 'blocked')}>Denega</button>
            <button className="small danger" disabled={busy !== null} onClick={() => setRemoving(m)}>Elimina</button>
          </td>
        </tr>)}</tbody>
      </table></div>}
      {pending.some(m => !m.email_confirmed) && <p className="hint">Només es pot autoritzar qui ja ha confirmat el correu.</p>}
    </div>

    <div className="panel">
      <div className="view-head"><h2>Equip</h2><span className="hint">Clica un nom per veure'n els vols</span></div>
      {notice && <p className="ok" role="status">{notice}</p>}
      <div className="tablewrap"><table className="cards">
        <thead><tr><th>Nom</th><th>Rol</th><th>Vols</th><th>Hores</th><th>90 dies</th><th>Nocturnes</th><th>Últim vol</th><th>Última connexió</th><th>Connexió 7 dies</th><th>Estat</th><th><span className="sr-only">Accions</span></th></tr></thead>
        <tbody>{members.map(m => {
          const flights = data.flights.filter(f => f.pilot_id === m.id && !f.deleted_at);
          const last = lastDate(flights);
          const self = m.id === data.user.id;
          return <tr key={m.id} className={m.approval_status === 'blocked' ? 'deleted' : undefined}>
            <td data-l="Nom"><button className="link" onClick={() => onOpenPilot(m.id)}>{data.nameOf(m.id)}</button><div className="hint">{m.email}</div></td>
            <td data-l="Rol">{m.role === 'admin' ? 'Administrador' : 'Pilot'}</td>
            <td data-l="Vols" className="num">{flights.length}</td>
            <td data-l="Hores" className="num">{fmtHM(sumMinutes(flights))}</td>
            <td data-l="90 dies" className="num">{fmtHM(sumMinutes(flights.filter(f => daysBetween(f.flight_date, today) <= 90)))}</td>
            <td data-l="Nocturnes" className="num">{fmtHM(sumMinutes(flights.filter(f => f.light === 'nit')))}</td>
            <td data-l="Últim vol" className="num">{fmtDate(last)}</td>
            <td data-l="Última connexió" className="num">{sessions ? fmtLastSeen(byUser.get(m.id)?.[0]?.last_seen_at, now) : '…'}</td>
            <td data-l="Connexió 7 dies" className="num">{sessions ? (byUser.get(m.id)?.length ? fmtSpan((byUser.get(m.id) ?? []).reduce((t, x) => t + sessionMs(x, now), 0)) : '—') : '…'}</td>
            <td data-l="Estat">{m.approval_status === 'blocked' ? <span className="chip bad">Bloquejat</span> : <RecencyChip last={last} />}</td>
            <td className="actions">{!self && <>
              {m.approval_status === 'blocked'
                ? <>
                  <button className="small" disabled={busy !== null} onClick={() => void approval(m, 'approved')}>Reactiva</button>
                  <button className="small danger" disabled={busy !== null} onClick={() => setRemoving(m)}>Elimina</button>
                </>
                : <>
                  {m.role === 'pilot'
                    ? <button className="small" disabled={busy !== null} onClick={() => void role(m, 'admin')}>Fes administrador</button>
                    : <button className="small" disabled={busy !== null} onClick={() => void role(m, 'pilot')}>Treu administrador</button>}
                  {m.role === 'pilot' && <button className="small danger" disabled={busy !== null} onClick={() => void approval(m, 'blocked')}>Bloqueja</button>}
                  {m.role === 'pilot' && <button className="small danger" disabled={busy !== null} onClick={() => setRemoving(m)}>Elimina</button>}
                </>}
            </>}</td>
          </tr>;
        })}</tbody>
      </table></div>
      <p className="hint">Bloquejar treu l'accés temporalment. Eliminar treu la persona de l'equip i li tanca l'accés per sempre, però els seus vols es conserven. Per bloquejar o eliminar un administrador, primer treu-li el rol.</p>
    </div>
    {removed.length > 0 && <details className="panel">
      <summary><h3 style={{ display: 'inline' }}>Usuaris eliminats ({removed.length})</h3></summary>
      <div className="tablewrap"><table className="cards">
        <thead><tr><th>Nom</th><th>Correu</th><th>Vols conservats</th><th><span className="sr-only">Accions</span></th></tr></thead>
        <tbody>{removed.map(m => {
          const flights = data.flights.filter(f => f.pilot_id === m.id && !f.deleted_at);
          return <tr key={m.id}>
            <td data-l="Nom"><button className="link" onClick={() => onOpenPilot(m.id)}>{m.display_name || '—'}</button></td>
            <td data-l="Correu">{m.email}</td>
            <td data-l="Vols conservats" className="num">{flights.length} · {fmtHM(sumMinutes(flights))}</td>
            <td className="actions"><button className="small" disabled={busy !== null} onClick={() => void restore(m)}>Restaura</button></td>
          </tr>;
        })}</tbody>
      </table></div>
    </details>}
    <Modal open={!!removing} onClose={() => setRemoving(null)} labelledBy="eliminar-usuari-titol">
      {removing && <div className="dlg-form">
        <h2 id="eliminar-usuari-titol">Eliminar {removing.display_name || removing.email}?</h2>
        <p>No podrà tornar a entrar a l'app i desapareixerà de l'equip. Els seus vols es conserven al llibre i a l'Excel, marcats com a «eliminat». Si t'equivoques, el pots restaurar des de «Usuaris eliminats».</p>
        <div className="foot">
          <button type="button" onClick={() => setRemoving(null)}>Cancel·la</button>
          <button type="button" className="primary danger-fill" onClick={() => void confirmRemove()}>Elimina</button>
        </div>
      </div>}
    </Modal>
    <FlightBackup data={data} team />
  </section>;
}
