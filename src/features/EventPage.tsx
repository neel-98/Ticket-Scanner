import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { Archive, ArrowLeft, Check, Download, MapPin, Printer, RefreshCw, ScanLine, Search, Undo2, Users, X } from 'lucide-react';
import { useApp } from '../app/context';
import { client, checkIn, getAttendees, listEvents, message } from '../lib/supabase';
import { downloadCsv, formatTime, printList } from '../lib/exports';
import { admissionToIso } from '../lib/timezone';
import { demoAttendees, demoEvents } from '../lib/demo';
import type { Attendee, EventRecord, Profile } from '../types';
const Scanner = lazy(() => import('./Scanner').then(module => ({ default: module.Scanner })));

export function EventPage() {
  const { eventId } = useParams(); const { demo, profile } = useApp();
  const [event, setEvent] = useState<EventRecord | null>(null); const [attendees, setAttendees] = useState<Attendee[]>([]);
  const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [query, setQuery] = useState(''); const [filter, setFilter] = useState('all'); const [page, setPage] = useState(0);
  const [scanner, setScanner] = useState(false); const [selected, setSelected] = useState<Attendee | null>(null);
  const [undo, setUndo] = useState(false); const [admissionTime, setAdmissionTime] = useState(''); const [busy, setBusy] = useState(false);
  const [staff, setStaff] = useState<Profile[]>([]); const [assigned, setAssigned] = useState<string[]>([]);
  const pending = useRef<{ id: string; attendee: string; undo: boolean; time: string | null; version: number } | null>(null);
  const refresh = useCallback(async () => {
    if (!eventId) return;
    try {
      const [events, rows] = await Promise.all([demo ? Promise.resolve(demoEvents) : listEvents(), demo ? Promise.resolve(demoAttendees.map(a => ({ ...a, event_id: eventId }))) : getAttendees(eventId)]);
      const current = events.find(e => e.id === eventId);
      if (!current) throw new Error('Event not found or access denied.');
      setEvent(current); setAttendees(rows); setError('');
      if (!demo && profile.role === 'organiser') {
        const [staffResult, assignmentResult] = await Promise.all([client().from('staff_profiles').select('*').eq('role', 'checkin').eq('active', true), client().from('event_staff').select('user_id').eq('event_id', eventId)]);
        if (staffResult.error) throw staffResult.error;
        if (assignmentResult.error) throw assignmentResult.error;
        setStaff(staffResult.data); setAssigned(assignmentResult.data.map(s => s.user_id));
      }
    } catch (e) { setError(message(e)); } finally { setLoading(false); }
  }, [eventId, demo, profile.role]);
  useEffect(() => { setEvent(null); setLoading(true); void refresh(); }, [refresh]);
  const organiser = profile.role === 'organiser';
  const changeAttendance = async () => {
    if (!selected || !event || demo || busy) return;
    setBusy(true); setNotice('');
    try {
      if (!pending.current) pending.current = { id: crypto.randomUUID(), attendee: selected.id, undo, time: admissionTime ? admissionToIso(admissionTime, event.timezone) : null, version: selected.version };
      const request = pending.current;
      if (request.undo) {
        const { error } = await client().rpc('undo_check_in', { p_attendee_id: request.attendee, p_expected_version: request.version, p_request_id: request.id });
        if (error) throw error;
        setNotice(`Check-in undone for ${selected.name}.`);
      } else {
        const outcome = await checkIn(event.id, selected.ticket_code, request.id, 'manual', request.time);
        setNotice(outcome.status === 'checked_in' ? `Check-in confirmed for ${outcome.name}.` : outcome.status === 'already_checked_in' ? `${outcome.name} was already checked in at ${formatTime(outcome.checked_in_at, event.timezone)}. Nothing was overwritten.` : 'Ticket not found.');
      }
      setSelected(null); pending.current = null; await refresh();
    } catch (e) { setError('Unable to confirm attendance change. ' + message(e) + ' Retry the same request to confirm its saved outcome.'); }
    finally { setBusy(false); }
  };
  const openAttendance = (a: Attendee, isUndo: boolean) => { setSelected(a); setUndo(isUndo); setAdmissionTime(''); pending.current = null; setError(''); };
  const archive = async () => {
    if (!event || demo || !window.confirm('Archive this event? It will become read-only.')) return;
    setBusy(true);
    try { const { error } = await client().rpc('archive_event', { p_event_id: event.id }); if (error) throw error; await refresh(); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  };
  const assign = async (userId: string, value: boolean) => {
    if (!event || busy) return;
    setBusy(true);
    try { const { error } = await client().rpc('assign_event_staff', { p_event_id: event.id, p_user_id: userId, p_assigned: value }); if (error) throw error; await refresh(); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  };
  if (loading) return <div className="empty">Opening event…</div>;
  if (!event) return <><Link className="back-link" to="/">← All events</Link><div className="alert error">{error}<button onClick={() => void refresh()}>Retry</button></div></>;
  const filtered = attendees.filter(a => [a.name, a.ticket_code, a.email ?? ''].some(s => s.toLowerCase().includes(query.toLowerCase())) && (filter === 'all' || (filter === 'arrived' ? !!a.checked_in_at : !a.checked_in_at)));
  const rows = filtered.slice(page * 50, (page + 1) * 50);
  return <><Link className="back-link" to="/"><ArrowLeft size={16}/> All events</Link><div className="page-heading"><div><span className="eyebrow">{event.archived_at ? 'ARCHIVED · READ ONLY' : 'YOUR CHECK-IN DESK'}</span><h1>{event.name}<span className="green">.</span></h1><p className="muted event-meta">{event.event_date} · {event.timezone} <MapPin size={15}/>{event.venue || 'No venue specified'}</p></div><button className="button primary" disabled={!!event.archived_at} onClick={() => setScanner(true)}><ScanLine size={18}/> Start scanner</button></div>{error && <div className="alert error" role="alert">{error}</div>}{notice && <div className="alert success" role="status">{notice}</div>}
    <div className="event-summary"><div><Users size={21}/><strong>{event.attendee_count}</strong><span>Registered guests</span></div><div><Check size={21}/><strong>{event.checked_in_count}</strong><span>Checked in</span></div><div><strong>{Number(event.attendee_count) - Number(event.checked_in_count)}</strong><span>Still to arrive</span></div></div>
    {organiser && <div className="event-actions"><button className="button secondary" onClick={() => downloadCsv(event, attendees)}><Download size={16}/> Export attendance</button><button className="button secondary" onClick={() => { try { printList(event, attendees); } catch (e) { setError(message(e)); } }}><Printer size={16}/> Print backup list</button><button className="button secondary" disabled={demo || busy || !!event.archived_at} onClick={() => void archive()}><Archive size={16}/> Archive event</button></div>}
    <section className="panel attendee-panel"><div className="section-heading"><h2>Guest list <span className="count-pill">{attendees.length}</span></h2><button className="icon-button" aria-label="Refresh attendance" onClick={() => void refresh()}><RefreshCw size={18}/></button></div><div className="toolbar"><div className="tabs">{[['all', 'All guests'], ['arrived', 'Checked in'], ['waiting', 'Not arrived']].map(([value, label]) => <button className={filter === value ? 'selected' : ''} key={value} onClick={() => { setFilter(value); setPage(0); }}>{label}</button>)}</div><div className="search-field"><Search size={17}/><input aria-label="Search attendees" placeholder="Name, email or ticket code…" value={query} onChange={e => { setQuery(e.target.value); setPage(0); }}/></div></div><div className="table-scroll"><table><thead><tr><th>Guest</th><th>Ticket code</th><th>Status</th><th>Check-in time</th><th>Action</th></tr></thead><tbody>{rows.map(a => <tr key={a.id}><td><strong>{a.name}</strong><small className="table-email">{a.email || 'No email'}</small></td><td className="mono">{a.ticket_code}</td><td><span className={`status-pill ${a.checked_in_at ? 'arrived' : ''}`}>{a.checked_in_at ? 'Checked in' : 'Not arrived'}</span></td><td>{formatTime(a.checked_in_at, event.timezone)}{a.checkin_method && <small className="table-email">{a.checkin_method === 'qr' ? 'QR scan' : 'Manual admission'}</small>}</td><td>{a.checked_in_at ? organiser && <button className="text-button" disabled={demo || !!event.archived_at} onClick={() => openAttendance(a, true)}><Undo2 size={14}/>Undo</button> : <button className="text-button" disabled={demo || !!event.archived_at} onClick={() => openAttendance(a, false)}>Check in</button>}</td></tr>)}</tbody></table>{!rows.length && <div className="empty">No guests match this search.</div>}</div><div className="pagination"><span>{filtered.length} guests · {event.timezone}</span><button disabled={page === 0} onClick={() => setPage(n => n - 1)}>Previous</button><span>Page {page + 1}</span><button disabled={(page + 1) * 50 >= filtered.length} onClick={() => setPage(n => n + 1)}>Next</button></div></section>
    {organiser && <><div className="info-note"><Printer size={20}/><span><strong>Keep a paper backup at the entrance.</strong> Record admission times during an outage, then use manual check-in with the observed time before resuming scanning. Exports are snapshots.</span></div><details className="panel staff-panel"><summary>Manage check-in staff</summary><p className="muted small">Create staff accounts and profiles in Supabase first. Staff IDs are shown below; match them to accounts in your Supabase dashboard.</p>{staff.length ? staff.map(s => <label className="staff-option" key={s.user_id}><input type="checkbox" checked={assigned.includes(s.user_id)} disabled={busy || !!event.archived_at} onChange={e => void assign(s.user_id, e.target.checked)}/><span className="mono">{s.user_id}</span></label>) : <p className="muted">{demo ? 'Staff assignments become available when Supabase is connected.' : 'No active check-in staff accounts yet.'}</p>}</details></>}
    {scanner && <Suspense fallback={<div className="alert">Opening scanner…</div>}><Scanner event={event} demo={demo} onClose={() => setScanner(false)} onSaved={() => void refresh()}/></Suspense>}
    {selected && <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="attendance-title"><div className="modal-heading"><h2 id="attendance-title">{undo ? 'Undo check-in?' : 'Manual check-in'}</h2><button className="icon-button" disabled={busy} aria-label="Close confirmation" onClick={() => setSelected(null)}><X/></button></div><p><strong>{selected.name}</strong> · <span className="mono">{selected.ticket_code}</span></p>{undo ? <p className="muted">This clears the current check-in and records who undid it. If attendance has changed, the undo will be rejected.</p> : <><p className="muted">Confirm admission using the same duplicate-safe check-in process.</p>{organiser && <label>Observed admission time <span className="muted">(optional, for paper reconciliation)</span><input type="datetime-local" value={admissionTime} disabled={busy || !!pending.current} onChange={e => setAdmissionTime(e.target.value)}/><small>Interpreted in {event.timezone}. Leave blank to check in now.</small></label>}</>}{error && <div className="alert error" role="alert">{error}</div>}<button className="button primary full" disabled={busy} onClick={() => void changeAttendance()}>{busy ? 'Confirming…' : pending.current ? 'Retry same request' : undo ? 'Confirm undo' : 'Confirm check-in'}</button></section></div>}
  </>;
}
