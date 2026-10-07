import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { ArrowRight, CalendarDays, Check, MapPin, Plus, Search, Ticket, Users } from 'lucide-react';
import { useApp } from '../app/context';
import { listEvents, message } from '../lib/supabase';
import { demoEvents } from '../lib/demo';
import type { EventRecord } from '../types';

export function Dashboard() {
  const { demo, profile } = useApp();
  const [events, setEvents] = useState<EventRecord[]>([]); const [error, setError] = useState('');
  const [loading, setLoading] = useState(true); const [query, setQuery] = useState('');
  const [tab, setTab] = useState('all'); const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    (demo ? Promise.resolve(demoEvents) : listEvents()).then(data => { if (active) { setEvents(data); setError(''); } }).catch(e => { if (active) setError(message(e)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [demo, reload]);
  const today = new Date().toLocaleDateString('en-CA');
  const filtered = events.filter(e => e.name.toLowerCase().includes(query.toLowerCase()) && (tab === 'all' || (tab === 'upcoming' ? e.event_date >= today && !e.archived_at : tab === 'past' ? e.event_date < today && !e.archived_at : !!e.archived_at)));
  const total = events.reduce((n, e) => n + Number(e.attendee_count), 0);
  const checked = events.reduce((n, e) => n + Number(e.checked_in_count), 0);
  return <>
    <div className="page-heading"><div><span className="eyebrow">THE WELCOME STARTS HERE</span><h1>Your events<span className="green">.</span></h1><p className="muted">A little preparation. A seamless arrival.</p></div>{profile.role === 'organiser' && <Link className="button primary" to="/events/new"><Plus size={18}/> Create event</Link>}</div>
    <div className="stats-grid"><Stat label="TOTAL EVENTS" value={events.length} icon={<CalendarDays/>} detail="All your gatherings, in one place"/><Stat label="REGISTERED GUESTS" value={total} icon={<Users/>} detail="Ready for a warm welcome"/><Stat label="CHECKED IN" value={checked} icon={<Check/>} detail="Arrivals confirmed and recorded"/></div>
    <section className="events-section"><div className="section-heading"><h2>Event overview <span className="count-pill">{events.length}</span></h2><span className="muted small">Choose an event to open your check-in desk</span></div><div className="toolbar"><div className="tabs" aria-label="Filter events">{['all', 'upcoming', 'past', 'archived'].map(t => <button key={t} className={tab === t ? 'selected' : ''} onClick={() => setTab(t)}>{t === 'all' ? 'All events' : t.charAt(0).toUpperCase() + t.slice(1)}</button>)}</div><div className="search-field"><Search size={17}/><input aria-label="Search events" placeholder="Search events…" value={query} onChange={e => setQuery(e.target.value)}/></div></div>
    {error && <div className="alert error" role="alert">{error} <button onClick={() => setReload(n => n + 1)}>Retry</button></div>}
    {loading ? <div className="empty">Loading your events…</div> : filtered.length ? <div className="event-grid">{filtered.map((event, i) => <EventCard key={event.id} event={event} index={i}/>)}</div> : <div className="empty"><CalendarDays size={35}/><h3>{query ? 'No matching events' : 'Your next event starts here'}</h3><p>{profile.role === 'organiser' ? 'Create an event and import your attendee list.' : 'Your organiser will assign events to your account.'}</p></div>}
    </section><div className="help-strip"><span className="help-icon"><Ticket size={22}/></span><div><strong>Already have your tickets? You’re ready.</strong><p>Import your Excel or CSV attendee list. Use your existing QR codes at the door.</p></div><Link to={profile.role === 'organiser' ? '/events/new' : '/'}>Let’s get started <ArrowRight size={17}/></Link></div>
  </>;
}
function Stat({ label, value, icon, detail }: { label: string; value: number; icon: React.ReactNode; detail: string }) { return <div className="stat-card"><div><span className="stat-label">{label}</span><strong>{value.toLocaleString()}</strong><small>{detail}</small></div><span className="stat-icon">{icon}</span></div>; }
function EventCard({ event, index }: { event: EventRecord; index: number }) {
  const date = new Date(event.event_date + 'T12:00:00');
  const percent = event.attendee_count ? Math.round(event.checked_in_count / event.attendee_count * 100) : 0;
  return <Link to={`/events/${event.id}`} className="event-card"><div className={`event-art art-${index % 3}`}><div className="art-orbit"/><div className="art-orbit second"/><span className="art-caption">{index % 3 === 0 ? 'COME TOGETHER' : index % 3 === 1 ? 'GOOD COMPANY' : 'MOMENTS THAT MATTER'}</span><span className="date-tile"><strong>{date.getDate()}</strong><small>{date.toLocaleDateString(undefined, { month: 'short' }).toUpperCase()}</small></span><span className="event-badge">{event.archived_at ? 'Archived' : event.checked_in_count > 0 ? 'Check-in started' : 'Upcoming'}</span></div><div className="event-card-body"><h3>{event.name}</h3><p><CalendarDays size={14}/>{date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</p><p><MapPin size={14}/>{event.venue || 'Venue to be confirmed'}</p><div className="attendance-label"><span><strong>{event.checked_in_count}</strong> / {event.attendee_count} checked in</span><strong>{percent}%</strong></div><div className="progress"><span style={{ width: `${percent}%` }}/></div><div className="card-bottom"><span><Users size={15}/>{event.attendee_count} guests</span><strong>Open event <ArrowRight size={16}/></strong></div></div></Link>;
}
