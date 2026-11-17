import { loadFlights, summarizeFlights } from './flight-data';

export async function createFlightWorkbook(flights: Awaited<ReturnType<typeof loadFlights>>, pilotNames: ReadonlyMap<string, string>) {
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  const history = workbook.addWorksheet('Llibre de vols');
  const summary = workbook.addWorksheet('Totals per pilot');

  history.columns = [
    { header: 'Data', width: 14, style: { numFmt: 'dd/mm/yyyy' } },
    { header: 'Pilot', width: 34 },
    { header: 'Aeronau', width: 28 },
    { header: 'Durada', width: 15, style: { numFmt: '[h]:mm' } },
    { header: 'Observacions', width: 52 },
  ];
  const dayMinutes = 24 * 60;
  for (const flight of flights) {
    history.addRow([
      new Date(flight.flight_date + 'T00:00:00Z'),
      pilotNames.get(flight.pilot_id) ?? flight.pilot_id,
      flight.aircraft, flight.duration_minutes / dayMinutes, flight.notes ?? '',
    ]);
  }

  summary.columns = [
    { header: 'Pilot', width: 34 },
    { header: 'Vols', width: 12 },
    { header: 'Hores totals', width: 18, style: { numFmt: '[h]:mm' } },
  ];
  for (const total of summarizeFlights(flights, pilotNames)) {
    summary.addRow([total.name, total.count, total.minutes / dayMinutes]);
  }
  summary.addRow(['Total', flights.length, flights.reduce((sum, row) => sum + row.duration_minutes, 0) / dayMinutes]).font = { bold: true };

  for (const sheet of [history, summary]) {
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.getRow(1).font = { bold: true };
  }
  history.autoFilter = { from: 'A1', to: 'E1' };
  return workbook.xlsx.writeBuffer();
}
