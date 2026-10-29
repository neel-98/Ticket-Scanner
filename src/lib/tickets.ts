import QRCode from 'qrcode';
import JSZip from 'jszip';
import Papa from 'papaparse';
import type { Attendee, EventRecord } from '../types';

type Ticket = Pick<Attendee, 'ticket_code'>;
type TicketEvent = Pick<EventRecord, 'name'>;

export function ticketFolderName(event: TicketEvent): string {
  const name = event.name.replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 120) || 'event';
  return `${name}-qr-tickets`;
}

export function ticketFiles(event: TicketEvent, attendees: Ticket[]) {
  const folder = ticketFolderName(event);
  const used = new Set<string>();
  return attendees.map((attendee, index) => {
    const code = attendee.ticket_code;
    if (!code || code === '-') throw new Error('Every attendee must have a valid ticket code.');
    const base = code.replace(/[^a-z0-9_-]/gi, '-').slice(0, 120) || 'ticket';
    let filename = `${base}.png`;
    let suffix = index + 1;
    while (used.has(filename.toLowerCase())) filename = `${base}-${suffix++}.png`;
    used.add(filename.toLowerCase());
    return { code, filename, path: `/${folder}/${filename}` };
  });
}

export async function ticketArchive(event: TicketEvent, attendees: Ticket[], onProgress?: (completed: number, total: number) => void): Promise<ArrayBuffer> {
  if (!attendees.length) throw new Error('There are no attendees to export.');
  const files = ticketFiles(event, attendees);
  const zip = new JSZip();
  for (const [index, file] of files.entries()) {
    // Encode the exact stored ticket code, never its sanitised filename or a URL.
    const image = await QRCode.toDataURL(file.code, { width: 512, margin: 4, errorCorrectionLevel: 'M' });
    zip.file(file.path.slice(1), image.split(',')[1], { base64: true });
    onProgress?.(index + 1, files.length);
    if (index % 10 === 0) await new Promise(resolve => setTimeout(resolve, 0));
  }
  zip.file('ticket-files.csv', '\uFEFF' + Papa.unparse(files.map(file => ({
    'Conditional Ticket': /^[\s]*[=+\-@]/.test(file.code) ? `'${file.code}` : file.code,
    QRFilePath: file.path,
  })), { newline: '\r\n' }));
  zip.file('README.txt', [
    'QR images were generated locally. Each QR encodes the exact imported ticket code.',
    `Upload the ${ticketFolderName(event)} folder to the root of your work OneDrive.`,
    'ticket-files.csv maps Conditional Ticket to QRFilePath. Import ticket codes as Text in Excel.',
    'Spreadsheet formula prefixes are escaped with an apostrophe; remove that escape when matching literal codes.',
    'Keep recipient emails in your original Microsoft 365 workbook and match each row by ticket code.',
    'Power Automate: List rows → Apply to each → Get file content using path (QRFilePath) → Send an email (V2).',
    'Use File content for the attachment content. No HTTP or Upload file from URL action is needed.',
    'For filenames changed to remove unsupported characters or avoid collisions, use the manifest path.',
  ].join('\r\n'));
  return zip.generateAsync({ type: 'arraybuffer' });
}

export async function downloadTickets(event: EventRecord, attendees: Ticket[], onProgress?: (completed: number, total: number) => void) {
  const archive = await ticketArchive(event, attendees, onProgress);
  const url = URL.createObjectURL(new Blob([archive], { type: 'application/zip' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${ticketFolderName(event)}.zip`;
  document.body.append(link);
  link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
