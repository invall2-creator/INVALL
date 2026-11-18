import { useEffect, useState } from 'react';

/** Hourly forecast for flying a drone at a point, from Open-Meteo (free, no key, CC BY 4.0). */
type Hour = {
  time: string; temp: number; precipProb: number; precip: number; code: number; cloud: number; visibility: number;
  wind: number; gust: number; dir: number; wind120: number;
};
type Verdict = { tone: 'ok' | 'warn' | 'bad'; label: string; reasons: string[] };

// Thresholds (km/h). Most DJI enterprise drones tolerate about 43 km/h (12 m/s); the Avata, about 38 km/h.
const WIND_WARN = 25, WIND_BAD = 38;

export function verdictFor(h: Hour): Verdict {
  const bad: string[] = [], warn: string[] = [];
  const maxWind = Math.max(h.wind, h.gust);
  if (maxWind > WIND_BAD) bad.push(`ratxes de ${Math.round(h.gust)} km/h`);
  else if (maxWind > WIND_WARN) warn.push(`vent fins a ${Math.round(maxWind)} km/h`);
  if (h.wind120 > WIND_BAD) bad.push(`vent a 120 m de ${Math.round(h.wind120)} km/h`);
  else if (h.wind120 > WIND_WARN + 5) warn.push(`vent a 120 m de ${Math.round(h.wind120)} km/h`);
  if (h.precip >= 0.5 || h.precipProb >= 60) bad.push('pluja');
  else if (h.precip > 0 || h.precipProb >= 30) warn.push(`${h.precipProb}% de probabilitat de pluja`);
  if ([95, 96, 99].includes(h.code)) bad.push('tempesta');
  if ([45, 48].includes(h.code) || h.visibility < 1000) bad.push('boira o visibilitat baixa');
  else if (h.visibility < 3000) warn.push('visibilitat reduïda');
  if (h.temp < 0 || h.temp > 40) warn.push(`temperatura de ${Math.round(h.temp)} °C`);
  if (bad.length) return { tone: 'bad', label: 'No volar', reasons: bad };
  if (warn.length) return { tone: 'warn', label: 'Precaució', reasons: warn };
  return { tone: 'ok', label: 'Es pot volar', reasons: [] };
}

const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
const dirName = (deg: number) => DIRS[Math.round(deg / 45) % 8];
const SKY: Record<number, string> = { 0: 'Serè', 1: 'Poc ennuvolat', 2: 'Mig ennuvolat', 3: 'Cobert', 45: 'Boira', 48: 'Boira', 51: 'Plugim', 53: 'Plugim', 55: 'Plugim', 61: 'Pluja feble', 63: 'Pluja', 65: 'Pluja forta', 71: 'Neu', 73: 'Neu', 75: 'Neu', 80: 'Ruixats', 81: 'Ruixats', 82: 'Ruixats forts', 95: 'Tempesta', 96: 'Tempesta', 99: 'Tempesta' };

const cache = new Map<string, { at: number; hours: Hour[] }>();

async function fetchHours(lat: number, lng: number): Promise<Hour[]> {
  const key = `${lat.toFixed(3)},${lng.toFixed(3)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 15 * 60_000) return hit.hours;
  const vars = 'temperature_2m,precipitation_probability,precipitation,weather_code,cloud_cover,visibility,wind_speed_10m,wind_gusts_10m,wind_direction_10m,wind_speed_120m';
  const url = 'https://api.open-meteo.com/v1/forecast?' + new URLSearchParams({
    latitude: lat.toFixed(4), longitude: lng.toFixed(4), hourly: vars, timezone: 'Europe/Madrid', forecast_hours: '12', wind_speed_unit: 'kmh',
  });
  const res = await fetch(url);
  if (!res.ok) throw new Error('weather');
  const j = await res.json() as { hourly: Record<string, (number | string)[]> };
  const h = j.hourly;
  const hours = (h.time as string[]).map((time, i) => ({
    time, temp: Number(h.temperature_2m[i]), precipProb: Number(h.precipitation_probability[i] ?? 0), precip: Number(h.precipitation[i] ?? 0),
    code: Number(h.weather_code[i]), cloud: Number(h.cloud_cover[i]), visibility: Number(h.visibility[i] ?? 99999),
    wind: Number(h.wind_speed_10m[i]), gust: Number(h.wind_gusts_10m[i]), dir: Number(h.wind_direction_10m[i]), wind120: Number(h.wind_speed_120m[i] ?? h.wind_speed_10m[i]),
  }));
  cache.set(key, { at: Date.now(), hours });
  return hours;
}

export function FlightWeather({ lat, lng, label }: { lat: number; lng: number; label: string }) {
  const [hours, setHours] = useState<Hour[] | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let active = true;
    setHours(null); setError('');
    fetchHours(lat, lng).then(h => active && setHours(h)).catch(() => active && setError("No s'ha pogut obtenir la previsió. Revisa la connexió."));
    return () => { active = false; };
  }, [lat, lng]);

  const now = hours?.[0];
  const v = now ? verdictFor(now) : null;
  return <div className="panel meteo">
    <div className="view-head">
      <h3 className="roof-title">Meteo per volar</h3>
      <span className="hint">{label}</span>
    </div>
    {error ? <p className="err">{error}</p> : !now || !v ? <p className="hint">Carregant la previsió…</p> : <>
      <div className="meteo-now">
        <span className={'chip ' + v.tone}>{v.label}</span>
        <span className="num">{Math.round(now.temp)} °C · {SKY[now.code] ?? ''}</span>
      </div>
      <dl className="kv">
        <dt>Vent</dt><dd className="num"><span className="wind-arrow" style={{ transform: `rotate(${now.dir + 180}deg)` }} aria-hidden="true">↑</span> {Math.round(now.wind)} km/h del {dirName(now.dir)}</dd>
        <dt>Ratxes</dt><dd className="num">{Math.round(now.gust)} km/h</dd>
        <dt>Vent a 120 m</dt><dd className="num">{Math.round(now.wind120)} km/h</dd>
        <dt>Pluja</dt><dd className="num">{now.precipProb}% · {now.precip.toFixed(1).replace('.', ',')} mm</dd>
        <dt>Visibilitat</dt><dd className="num">{now.visibility >= 10000 ? 'Més de 10 km' : `${(now.visibility / 1000).toFixed(1).replace('.', ',')} km`}</dd>
      </dl>
      {v.reasons.length > 0 && <p className={v.tone === 'bad' ? 'err' : 'hint'}>Motiu: {v.reasons.join(', ')}.</p>}
      <button type="button" className="link" onClick={() => setOpen(o => !o)}>{open ? 'Amaga les properes hores' : 'Mostra les properes 12 hores'}</button>
      {open && <div className="tablewrap"><table className="meteo-hours">
        <thead><tr><th>Hora</th><th>Vent</th><th>Ratxes</th><th>Pluja</th><th></th></tr></thead>
        <tbody>{hours!.map(h => { const hv = verdictFor(h); return <tr key={h.time}>
          <td className="num">{h.time.slice(11, 16)}</td>
          <td className="num"><span className="wind-arrow" style={{ transform: `rotate(${h.dir + 180}deg)` }} aria-hidden="true">↑</span> {Math.round(h.wind)}</td>
          <td className="num">{Math.round(h.gust)}</td>
          <td className="num">{h.precipProb}%</td>
          <td><span className={'chip ' + hv.tone} title={hv.reasons.join(', ')}>{hv.label}</span></td>
        </tr>; })}</tbody>
      </table></div>}
      <p className="hint">Orientatiu: verd fins a 25 km/h de vent o ratxes, groc fins a 38, vermell per sobre, amb pluja, tempesta o boira. Comprova sempre els límits de l'aeronau i les zones geogràfiques (ENAIRE Drones). Previsió: <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo</a>.</p>
    </>}
  </div>;
}
