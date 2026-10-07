export type Role = 'organiser' | 'checkin';
export interface Profile { user_id: string; role: Role; active: boolean }
export interface EventRecord {
  id: string; name: string; event_date: string; timezone: string; venue: string | null;
  archived_at: string | null; created_at: string; attendee_count: number; checked_in_count: number;
}
export interface Attendee {
  id: string; event_id: string; ticket_code: string; name: string; email: string | null;
  checked_in_at: string | null; checked_in_by: string | null;
  checkin_method: 'qr' | 'manual' | null; version: number;
}
export interface ImportAttendee { ticket_code: string; name: string; email: string | null }
export interface CheckInResult {
  status: 'checked_in' | 'already_checked_in' | 'not_found';
  name?: string; checked_in_at?: string;
}
