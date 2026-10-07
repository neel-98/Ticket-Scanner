import { createClient } from '@supabase/supabase-js';
import type { Attendee, CheckInResult, EventRecord, ImportAttendee } from '../types';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
export const supabase = url && key ? createClient(url, key) : null;
export function client() {
  if (!supabase) throw new Error('Connect a Supabase project to use Entrydesk.');
  return supabase;
}
export function message(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) return String(error.message);
  return 'Something went wrong. Please try again.';
}
export async function listEvents(): Promise<EventRecord[]> {
  const { data, error } = await client().rpc('list_events');
  if (error) throw error;
  return data ?? [];
}
export async function getAttendees(eventId: string): Promise<Attendee[]> {
  // PostgREST defaults to 1,000 rows. Paginate instead of truncating large events.
  const all: Attendee[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await client().from('attendees').select('*')
      .eq('event_id', eventId).order('name').order('id').range(offset, offset + 499);
    if (error) throw error;
    all.push(...data);
    if (data.length < 500) return all;
  }
}
export async function importEvent(details: { name: string; event_date: string; timezone: string; venue: string }, attendees: ImportAttendee[], requestId: string): Promise<string> {
  const { data, error } = await client().rpc('import_event', {
    p_name: details.name, p_event_date: details.event_date, p_timezone: details.timezone,
    p_venue: details.venue || null, p_attendees: attendees, p_request_id: requestId,
  });
  if (error) throw error;
  return data;
}
export async function checkIn(eventId: string, code: string, requestId: string, method: 'qr' | 'manual', admissionTime: string | null = null): Promise<CheckInResult> {
  const { data, error } = await client().rpc('check_in_ticket', {
    p_event_id: eventId, p_ticket_code: code, p_request_id: requestId,
    p_method: method, p_admission_time: admissionTime,
  });
  if (error) throw error;
  return data;
}
