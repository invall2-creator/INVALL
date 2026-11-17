import { useState, type ReactNode } from 'react';
import type { AppData } from '../context';
import type { Flight } from '../flight-data';
import { daysBetween, fmtDate, fmtHM, fmtHours, lastDate, recency, sumMinutes, todayISO } from '../format';

const monthNames = ['gen', 'feb', 'març', 'abr', 'maig', 'juny', 'jul', 'ag', 'set', 'oct', 'nov', 'des'];

function Hours({ minutes }: { minutes: number }) {
  return <>{Math.floor(minutes / 60).toLocaleString('ca')}<small> h {String(Math.round(minutes % 60)).padStart(2, '0')}</small></>;
}

export function RecencyChip({ last }: { last: string }) {
  const r = recency(last);
  return <span className={'chip ' + r.tone}>{r.label}</span>;
}

function MonthChart({ flights }: { flights: Flight[] }) {
  const now = new Date();
  const months = Array.from({ length: 12 }, (_, i) => new Date(now.getFullYear(), now.getMonth() - 11 + i, 1).toLocaleDateString('en-CA').slice(0, 7));
  const values = months.map(m => sumMinutes(flights.filter(f => f.flight_date.startsWith(m))) / 60);
  const max = Math.max(1, ...values);
  const step = max > 20 ? 10 : max > 8 ? 4 : max > 4 ? 2 : 1;
  const top = Math.ceil(max / step) * step;
  const W = 620, H = 220, L = 34, B = 26, cw = (W - L - 6) / 12;
  const y = (v: number) => H - B - (v / top) * (H - B - 12);
  const ticks = Array.from({ length: top / step + 1 }, (_, i) => i * step);
  return <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Hores de vol per mes, últims 12 mesos">
    {ticks.map(v => <g key={v}><line x1={L} x2={W} y1={y(v)} y2={y(v)} className="grid" /><text x={L - 6} y={y(v) + 4} textAnchor="end">{v}</text></g>)}
    {values.map((v, i) => {
      const x = L + i * cw + cw * 0.18, w = cw * 0.64, label = monthNames[Number(months[i].slice(5)) - 1];
      return <g key={months[i]}>
        <rect x={x} y={y(v)} width={w} height={Math.max(0, H - B - y(v))} rx={3} className={i === 11 ? 'bar-now' : 'bar'}>
          <title>{`${label} ${months[i].slice(0, 4)}: ${fmtHours(Math.round(v * 60))}`}</title>
        </rect>
        {v > 0 && <text x={x + w / 2} y={y(v) - 4} textAnchor="middle">{v.toFixed(1).replace('.', ',')}</text>}
        <text x={x + w / 2} y={H - 8} textAnchor="middle">{label}</text>
      </g>;
    })}
  </svg>;
}

function Bars({ groups }: { groups: [string, number][] }) {
  if (!groups.length) return <p className="empty">Encara no hi ha vols.</p>;
  const max = Math.max(1, ...groups.map(g => g[1]));
  return <div className="bars">{groups.map(([label, minutes]) => <div className="bar-row" key={label}>
    <span>{label}</span>
    <div className="track"><div className="fill" style={{ width: `${(minutes / max) * 100}%` }} /></div>
    <span className="val">{fmtHM(minutes)}</span>
  </div>)}</div>;
}

export function Dashboard({ data }: { data: AppData }) {
  const [scope, setScope] = useState<'me' | 'team'>('me');
  const team = data.isAdmin && scope === 'team';
  const flights = data.flights.filter(f => !f.deleted_at && (team || f.pilot_id === data.user.id));
  const today = todayISO();
  const last90 = flights.filter(f => daysBetween(f.flight_date, today) <= 90);
  const thisYear = flights.filter(f => f.flight_date.startsWith(today.slice(0, 4)));
  const night = flights.filter(f => f.light === 'nit');
  const group = (key: (f: Flight) => string) => {
    const totals = new Map<string, number>();
    for (const f of flights) totals.set(key(f), (totals.get(key(f)) ?? 0) + f.duration_minutes);
    return [...totals].sort((a, b) => b[1] - a[1]);
  };
  const tiles: [ReactNode, string][] = [
    [<Hours minutes={sumMinutes(flights)} />, 'Hores totals'],
    [flights.length.toLocaleString('ca'), 'Vols'],
    [<Hours minutes={sumMinutes(thisYear)} />, 'Hores aquest any'],
    [<Hours minutes={sumMinutes(last90)} />, 'Últims 90 dies'],
    [<Hours minutes={sumMinutes(night)} />, 'Hores nocturnes'],
    [flights.reduce((s, f) => s + (f.takeoffs || 1), 0).toLocaleString('ca'), 'Enlairaments'],
  ];
  const members = data.team.filter(m => m.approval_status === 'approved');

  return <section className="view" aria-labelledby="tauler-titol">
    <div className="view-head">
      <h2 id="tauler-titol">{team ? "Resum de l'equip" : 'El meu resum'}</h2>
      {data.isAdmin && <div className="seg" role="group" aria-label="Abast">
        <button type="button" aria-pressed={scope === 'me'} onClick={() => setScope('me')}>Els meus vols</button>
        <button type="button" aria-pressed={scope === 'team'} onClick={() => setScope('team')}>Tot l'equip</button>
      </div>}
    </div>
    <div className="tiles">{tiles.map(([value, label]) => <div className="tile" key={label}><div className="v">{value}</div><div className="l">{label}</div></div>)}</div>
    <div className="grid-2">
      <div className="panel chart"><h3>Hores per mes · últims 12 mesos</h3><MonthChart flights={flights} /></div>
      <div className="panel">
        <h3>Estat de pràctica</h3>
        {team ? <>
          <div className="bars">{members.map(m => ({ m, last: lastDate(flights.filter(f => f.pilot_id === m.id)) }))
            .sort((a, b) => a.last.localeCompare(b.last))
            .map(({ m, last }) => <div className="bar-row two" key={m.id}><span>{data.nameOf(m.id)}</span><RecencyChip last={last} /></div>)}</div>
          <p className="hint">Verd: ha volat els últims 30 dies. Groc: entre 31 i 90. Vermell: més de 90.</p>
        </> : <>
          <dl className="kv">
            <dt>Últim vol</dt><dd>{fmtDate(lastDate(flights))} <RecencyChip last={lastDate(flights)} /></dd>
            <dt>Últim vol nocturn</dt><dd>{fmtDate(lastDate(night))}</dd>
            <dt>Vols últims 90 dies</dt><dd className="num">{last90.length}</dd>
            <dt>Incidències</dt><dd className="num">{flights.filter(f => f.incident).length}</dd>
          </dl>
          <p className="hint">Per saber si estàs al dia de pràctica abans d'un servei.</p>
        </>}
      </div>
    </div>
    <div className="grid-2">
      <div className="panel"><h3>Hores per aeronau</h3><Bars groups={group(data.craftName)} /></div>
      <div className="panel"><h3>Hores per tipus de servei</h3><Bars groups={group(f => f.mission || 'Sense especificar')} /></div>
    </div>
  </section>;
}
