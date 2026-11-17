import type { AppData } from './context';
import type { Flight } from './flight-data';
import { todayISO } from './format';

const DAY = 24 * 60;

export const WORKBOOK_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export async function createFlightWorkbook(flights: Flight[], data: AppData) {
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  const sorted = [...flights].sort((a, b) => a.flight_date.localeCompare(b.flight_date) || a.created_at.localeCompare(b.created_at));

  const log = workbook.addWorksheet('Llibre de vols');
  log.columns = [
    { header: 'Data', width: 12, style: { numFmt: 'dd/mm/yyyy' } },
    { header: 'Pilot', width: 26 },
    { header: 'Funció', width: 12 },
    { header: 'Aeronau', width: 20 },
    { header: 'Núm. sèrie', width: 20 },
    { header: 'Temps de vol', width: 13, style: { numFmt: '[h]:mm' } },
    { header: 'Enlairaments', width: 13 },
    { header: 'Lloc', width: 22 },
    { header: 'Servei', width: 24 },
    { header: 'Categoria', width: 22 },
    { header: 'Condicions', width: 11 },
    { header: 'Incidència', width: 32 },
    { header: 'Observacions', width: 40 },
  ];
  for (const f of sorted) {
    const craft = data.aircraft.find(a => a.id === f.aircraft_id);
    log.addRow([
      new Date(f.flight_date + 'T00:00:00Z'), data.nameOf(f.pilot_id), f.crew_role === 'observador' ? 'Observador' : 'Pilot',
      data.craftName(f), craft?.serial ?? '', f.duration_minutes / DAY, f.takeoffs || 1,
      f.place ?? '', f.mission ?? '', f.category ?? '', f.light === 'nit' ? 'Nocturn' : 'Diürn',
      f.incident ? f.incident_text ?? 'Sí' : '', f.notes ?? '',
    ]);
  }
  log.autoFilter = { from: 'A1', to: 'M1' };

  const totals = (name: string, label: string, key: (f: Flight) => string) => {
    const sheet = workbook.addWorksheet(name);
    sheet.columns = [
      { header: label, width: 28 }, { header: 'Vols', width: 8 },
      { header: 'Hores', width: 10, style: { numFmt: '[h]:mm' } }, { header: 'Hores nocturnes', width: 16, style: { numFmt: '[h]:mm' } },
    ];
    const groups = new Map<string, Flight[]>();
    for (const f of sorted) groups.set(key(f), [...(groups.get(key(f)) ?? []), f]);
    const sum = (list: Flight[]) => list.reduce((s, f) => s + f.duration_minutes, 0) / DAY;
    for (const [k, list] of [...groups].sort((a, b) => sum(b[1]) - sum(a[1]))) {
      sheet.addRow([k, list.length, sum(list), sum(list.filter(f => f.light === 'nit'))]);
    }
    sheet.addRow(['Total', sorted.length, sum(sorted), sum(sorted.filter(f => f.light === 'nit'))]).font = { bold: true };
    return sheet;
  };
  const sheets = [log];
  if (data.isAdmin) sheets.push(totals('Totals per pilot', 'Pilot', f => data.nameOf(f.pilot_id)));
  sheets.push(totals('Totals per aeronau', 'Aeronau', data.craftName));
  for (const sheet of sheets) {
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.getRow(1).font = { bold: true };
  }

  return workbook.xlsx.writeBuffer();
}

export async function downloadWorkbook(flights: Flight[], data: AppData) {
  const buffer = await createFlightWorkbook(flights, data);
  const url = URL.createObjectURL(new Blob([buffer], { type: WORKBOOK_TYPE }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `UDRON-llibre-de-vols-${todayISO()}.xlsx`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
