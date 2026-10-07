import type { Attendee, EventRecord } from '../types';
export const demoEvents: EventRecord[] = [
  { id: 'preview-gala', name: 'Community Gala 2026', event_date: '2026-10-24', timezone: 'America/New_York', venue: 'The Glasshouse · Main Hall', archived_at: null, created_at: '2026-10-01T12:00:00Z', attendee_count: 248, checked_in_count: 86 },
  { id: 'preview-meetup', name: 'Founders & Friends', event_date: '2026-11-06', timezone: 'America/New_York', venue: 'Studio 12', archived_at: null, created_at: '2026-10-01T12:00:00Z', attendee_count: 120, checked_in_count: 0 },
  { id: 'preview-summer', name: 'Summer Social', event_date: '2026-08-15', timezone: 'America/New_York', venue: 'Riverside Gardens', archived_at: '2026-08-16T12:00:00Z', created_at: '2026-07-01T12:00:00Z', attendee_count: 180, checked_in_count: 164 },
];
export const demoAttendees: Attendee[] = ['Alex Morgan', 'Amelia Chen', 'Daniel Rivera', 'Fatima Khan', 'James Wilson', 'Maya Patel', 'Oliver Brooks', 'Sofia Garcia'].map((name, i) => ({
  id: `preview-${i}`, event_id: 'preview-gala', name, email: name.toLowerCase().replace(' ', '.') + '@example.com',
  ticket_code: `00${1001 + i}`, checked_in_at: i < 3 ? '2026-10-24T22:05:00Z' : null,
  checked_in_by: i < 3 ? 'preview' : null, checkin_method: i < 3 ? 'qr' : null, version: i < 3 ? 1 : 0,
}));
