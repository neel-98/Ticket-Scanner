import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCsv, suggestMapping, validateSheet } from '../src/lib/parsing.ts';

test('imports a CSV containing only names and ticket codes', () => {
  const sheet = parseCsv('Name,Ticket\nAlex Morgan,00123\nMaya Patel,AbC');
  const result = validateSheet(sheet, suggestMapping(sheet.headers));
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.attendees, [
    { name: 'Alex Morgan', ticket_code: '00123', email: null },
    { name: 'Maya Patel', ticket_code: 'AbC', email: null },
  ]);
});

test('skipping an available email column excludes addresses from the import payload', () => {
  const sheet = parseCsv('Name,Ticket,Email\nAlex Morgan,00123,alex@example.com');
  const result = validateSheet(sheet, { ...suggestMapping(sheet.headers), email: -1 });
  assert.deepEqual(result.errors, []);
  assert.equal(result.attendees[0].email, null);
  assert.ok(!JSON.stringify(result.attendees).includes('alex@example.com'));
});

test('skipped Excel email formulas do not block a name and ticket import', () => {
  const sheet = {
    name: 'Guests', headers: ['First name', 'Last name', 'Ticket', 'Email'],
    rows: [{ number: 2, cells: [{ text: 'Alex' }, { text: 'Morgan' }, { text: '00123' }, { text: '', formula: true }] }],
  };
  const result = validateSheet(sheet, { ...suggestMapping(sheet.headers), email: -1 });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.attendees, [{ name: 'Alex Morgan', ticket_code: '00123', email: null }]);
});

test('mapped emails remain optional per attendee and are imported when present', () => {
  const sheet = parseCsv('Name,Ticket,Email\nAlex Morgan,00123, alex@example.com \nMaya Patel,AbC,');
  const result = validateSheet(sheet, suggestMapping(sheet.headers));
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.attendees.map(a => a.email), ['alex@example.com', null]);
});
