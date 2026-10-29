import assert from 'node:assert/strict';
import { test } from 'node:test';
import JSZip from 'jszip';
import Papa from 'papaparse';
import { PNG } from 'pngjs';
import { BinaryBitmap, HybridBinarizer, MultiFormatReader, RGBLuminanceSource } from '@zxing/library';
import { ticketArchive, ticketFiles, ticketFolderName } from '../src/lib/tickets.ts';

const event = { name: 'Community Gala 2026' };

test('exported PNG tickets decode to exact codes and the ZIP contains no recipient data', async () => {
  const attendees = [
    { ticket_code: 'DIWALI-HSTKT-80490-741', name: 'Private name', email: 'private@example.com' },
    { ticket_code: '00123' },
    { ticket_code: 'AbC/with?symbols&=1' },
  ];
  const progress: number[] = [];
  const zip = await JSZip.loadAsync(await ticketArchive(event, attendees, completed => progress.push(completed)));
  const files = ticketFiles(event, attendees);
  for (const file of files) {
    const png = PNG.sync.read(await zip.file(file.path.slice(1))!.async('nodebuffer'));
    assert.equal(png.width, 512);
    const pixels = new Int32Array(png.width * png.height);
    for (let i = 0; i < pixels.length; i++) {
      pixels[i] = (png.data[i * 4] << 16) | (png.data[i * 4 + 1] << 8) | png.data[i * 4 + 2];
    }
    const bitmap = new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(pixels, png.width, png.height)));
    assert.equal(new MultiFormatReader().decode(bitmap).getText(), file.code);
  }
  const csv = await zip.file('ticket-files.csv')!.async('string');
  const parsed = Papa.parse(csv, { header: true });
  assert.deepEqual(parsed.data, files.map(file => ({ 'Conditional Ticket': file.code, QRFilePath: file.path })));
  assert.ok(!csv.includes('Private name'));
  assert.ok(!csv.includes('private@example.com'));
  assert.deepEqual(progress, [1, 2, 3]);
  assert.equal(Object.values(zip.files).filter(file => !file.dir).length, 5);
  assert.ok(files.every(file => file.path.startsWith('/Community-Gala-2026-qr-tickets/')));
  assert.ok((await zip.file('README.txt')!.async('string')).includes('Upload the Community-Gala-2026-qr-tickets folder'));
});

test('OneDrive filenames stay unique despite case differences, unsafe characters and long codes', () => {
  const codes = ['AbC', 'abc', '../a', '..\\a', 'x'.repeat(121), 'x'.repeat(120) + 'y'];
  const files = ticketFiles(event, codes.map(ticket_code => ({ ticket_code })));
  assert.equal(new Set(files.map(file => file.filename.toLowerCase())).size, codes.length);
  for (const file of files) assert.match(file.filename, /^[a-z0-9_-]+\.png$/i);
  assert.deepEqual(files.map(file => file.code), codes);
});

test('ticket folders use the selected event name and sanitise path characters', () => {
  assert.equal(ticketFolderName({ name: 'Summer Social' }), 'Summer-Social-qr-tickets');
  assert.equal(ticketFolderName({ name: '../Summer: Social / 2026?' }), 'Summer-Social-2026-qr-tickets');
  assert.equal(ticketFolderName({ name: ' /? ' }), 'event-qr-tickets');
  assert.equal(ticketFiles({ name: 'Summer Social' }, [{ ticket_code: '00123' }])[0].path, '/Summer-Social-qr-tickets/00123.png');
});
