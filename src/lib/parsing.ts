import Papa from 'papaparse';
import type { CellValue } from 'exceljs';
import type { ImportAttendee } from '../types';

export const LIMITS = { fileBytes: 5 * 1024 * 1024, attendees: 5000, ticketLength: 256, nameLength: 200 };
export type Value = { text: string; formula?: boolean; numeric?: boolean; unsupported?: boolean };
export interface Sheet { name: string; headers: string[]; rows: { number: number; cells: Value[] }[] }
export interface Mapping { ticket: number; name: number; first: number; last: number; email: number }
export interface Validation { attendees: ImportAttendee[]; errors: string[]; warnings: string[]; skipped: number }
export function excelValue(value: CellValue): Value {
  if (value === null || value === undefined) return { text: '' };
  if (typeof value === 'string') return { text: value };
  if (typeof value === 'number') return { text: String(value), numeric: true };
  if (typeof value === 'object' && ('formula' in value || 'sharedFormula' in value)) return { text: '', formula: true };
  if (typeof value === 'object' && 'richText' in value) return { text: value.richText.map(v => v.text).join('') };
  return { text: String(value), unsupported: true };
}
export function parseCsv(text: string): Sheet {
  const parsed = Papa.parse<string[]>(text, { skipEmptyLines: false, dynamicTyping: false });
  if (parsed.errors.length) throw new Error(`Malformed CSV: ${parsed.errors[0].message}`);
  const [headers = [], ...rows] = parsed.data;
  return { name: 'CSV', headers, rows: rows.map((row, i) => ({ number: i + 2, cells: row.map(text => ({ text })) })) };
}
export async function readSpreadsheet(file: File): Promise<Sheet[]> {
  if (file.size > LIMITS.fileBytes) throw new Error('File is too large. Maximum upload size is 5 MB.');
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (extension === 'csv') return [parseCsv(await file.text())];
  if (extension !== 'xlsx') throw new Error('Choose a CSV or .xlsx file.');
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  return workbook.worksheets.map(sheet => {
    const width = Math.min(sheet.columnCount, 200);
    if (sheet.columnCount > 200 || sheet.rowCount > 20000) throw new Error('Worksheet is too large. Use at most 200 columns and 20,000 source rows.');
    const headers = Array.from({ length: width }, (_, i) => excelValue(sheet.getRow(1).getCell(i + 1).value).text);
    const rows: Sheet['rows'] = [];
    for (let n = 2; n <= sheet.rowCount; n++) {
      rows.push({ number: n, cells: Array.from({ length: width }, (_, i) => excelValue(sheet.getRow(n).getCell(i + 1).value)) });
    }
    return { name: sheet.name, headers, rows };
  });
}
export function suggestMapping(headers: string[]): Mapping {
  const normalized = headers.map(h => h.toLowerCase().replace(/[^a-z0-9]/g, ''));
  const find = (names: string[]) => normalized.findIndex(h => names.includes(h));
  return {
    ticket: find(['ticketcode', 'ticketid', 'qrpayload', 'qrcode', 'code', 'ticket']),
    name: find(['fullname', 'name', 'attendeename', 'guestname']),
    first: find(['firstname', 'first', 'givenname']), last: find(['lastname', 'last', 'surname']),
    email: find(['email', 'emailaddress']),
  };
}
export function validateSheet(sheet: Sheet, mapping: Mapping): Validation {
  const result: Validation = { attendees: [], errors: [], warnings: [], skipped: 0 };
  if (mapping.ticket < 0) result.errors.push('Map a ticket-code column.');
  if (mapping.name < 0 && (mapping.first < 0 || mapping.last < 0)) result.errors.push('Map full name, or both first and last name.');
  const selected = [mapping.ticket, mapping.name >= 0 ? mapping.name : mapping.first, ...(mapping.name < 0 ? [mapping.last] : []), mapping.email].filter(i => i >= 0);
  if (new Set(selected).size !== selected.length) result.errors.push('Each app field must use a different column.');
  if (result.errors.length) return result;
  const seen = new Map<string, number>();
  for (const row of sheet.rows) {
    if (row.cells.every(c => !c.text && !c.formula && !c.unsupported)) { result.skipped++; continue; }
    const cell = (i: number): Value => row.cells[i] ?? { text: '' };
    const code = cell(mapping.ticket);
    const nameCells = mapping.name >= 0 ? [cell(mapping.name)] : [cell(mapping.first), cell(mapping.last)];
    const name = nameCells.map(c => c.text.trim()).filter(Boolean).join(' ');
    const email = mapping.email >= 0 ? cell(mapping.email) : { text: '' };
    const prefix = `Row ${row.number}: `;
    if (selected.some(i => cell(i).formula || cell(i).unsupported)) result.errors.push(prefix + 'Mapped fields must be literal text values, not formulas or unsupported data.');
    if (!code.text) result.errors.push(prefix + 'Missing ticket code.');
    if (code.text !== code.text.trim()) result.errors.push(prefix + 'Ticket code has surrounding whitespace. Correct it in the source file.');
    if (code.text.length > LIMITS.ticketLength) result.errors.push(prefix + 'Ticket code exceeds 256 characters.');
    if (!name) result.errors.push(prefix + 'Missing attendee name.');
    if (name.length > LIMITS.nameLength) result.errors.push(prefix + 'Name exceeds 200 characters.');
    if (code.text && seen.has(code.text)) result.errors.push(prefix + `Duplicate ticket code (also row ${seen.get(code.text)}).`);
    else if (code.text) seen.set(code.text, row.number);
    if (code.numeric) result.warnings.push(prefix + 'Numeric Excel ticket code: previously lost leading zeros cannot be recovered. Store codes as text.');
    result.attendees.push({ ticket_code: code.text, name, email: email.text.trim() || null });
  }
  if (!result.attendees.length) result.errors.push('No attendees found.');
  if (result.attendees.length > LIMITS.attendees) result.errors.push('Maximum 5,000 attendees per event.');
  return result;
}
