import Papa from 'papaparse';
import type { Attendee, EventRecord } from '../types';

export function formatTime(value: string | null | undefined, timezone: string): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat(undefined, { timeZone: timezone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}
export function safeCell(value: string): string {
  return /^[\s]*[=+\-@\t\r\n]/.test(value) || /^[\t\r\n]/.test(value) ? `'${value}` : value;
}
export function attendanceCsv(event: EventRecord, attendees: Attendee[]): string {
  return Papa.unparse(attendees.map(a => ({
    'Event name': safeCell(event.name), 'Ticket code': safeCell(a.ticket_code),
    'Attendee name': safeCell(a.name), Email: safeCell(a.email ?? ''),
    'Checked in': a.checked_in_at ? 'Yes' : 'No',
    'Check-in time': a.checked_in_at ? `${formatTime(a.checked_in_at, event.timezone)} (${event.timezone})` : '',
    'Check-in method': a.checkin_method ?? '',
  })), { newline: '\r\n' });
}
export function downloadCsv(event: EventRecord, attendees: Attendee[]) {
  const url = URL.createObjectURL(new Blob(['\uFEFF', attendanceCsv(event, attendees)], { type: 'text/csv;charset=utf-8;' }));
  const a = document.createElement('a');
  a.href = url; a.download = `${event.name.replace(/[^a-z0-9_-]/gi, '-')}-attendance.csv`;
  a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
export function printableHtml(event: EventRecord, attendees: Attendee[]): string {
  return `<!doctype html><html><head><title>${escapeHtml(event.name)} — attendee list</title><style>body{font:13px Arial;margin:28px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #bbb;padding:9px;text-align:left}thead{display:table-header-group}tr{break-inside:avoid}.note{color:#555}</style></head><body>
  <h1>${escapeHtml(event.name)}</h1><p>Alphabetical attendee list · ${escapeHtml(event.event_date)}</p>
  <p class="note">Snapshot exported ${escapeHtml(formatTime(new Date().toISOString(), event.timezone))} (${escapeHtml(event.timezone)}). Record admissions and times on paper; reconcile before resuming scanning.</p>
  <table><thead><tr><th>Name</th><th>Ticket code</th><th>Status at export</th><th>Admitted</th><th>Admission time</th></tr></thead><tbody>
  ${[...attendees].sort((a,b) => a.name.localeCompare(b.name)).map(a => `<tr><td>${escapeHtml(a.name)}</td><td>${escapeHtml(a.ticket_code)}</td><td>${a.checked_in_at ? 'Checked in' : 'Not arrived'}</td><td>☐</td><td>________________</td></tr>`).join('')}
  </tbody></table></body></html>`;
}
export function printList(event: EventRecord, attendees: Attendee[]) {
  const popup = window.open('', '_blank');
  if (!popup) throw new Error('Allow pop-ups to print the backup list.');
  popup.document.write(printableHtml(event, attendees)); popup.document.close();
  popup.focus(); popup.print();
}
