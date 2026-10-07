import { useEffect, useState } from 'react';
import { Link, Navigate, Route, Routes } from 'react-router';
import { ArrowUpRight, CalendarDays, ChevronRight, LogOut, ScanLine, ShieldCheck, Ticket } from 'lucide-react';
import type { Session } from '@supabase/supabase-js';
import { supabase, message } from '../lib/supabase';
import type { Profile } from '../types';
import { AppContext } from './context';
import { Dashboard } from '../features/Dashboard';
import { ImportWizard } from '../features/ImportWizard';
import { EventPage } from '../features/EventPage';

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [ready, setReady] = useState(!supabase);
  const [error, setError] = useState('');
  const [demo, setDemo] = useState(false);
  useEffect(() => {
    if (!supabase) return;
    let active = true;
    const load = async (next: Session | null) => {
      if (!active) return;
      setSession(next); setProfile(null); setReady(false); setError('');
      if (next) {
        const { data, error } = await supabase!.from('staff_profiles').select('*').eq('user_id', next.user.id).single();
        if (!active) return;
        if (error) setError('Unable to load staff access. ' + message(error));
        else if (!data.active) setError('Your staff account is inactive. Contact your organiser.');
        else setProfile(data);
      }
      if (active) setReady(true);
    };
    supabase.auth.getSession().then(({ data, error }) => {
      if (error && active) { setError(message(error)); setReady(true); }
      else void load(data.session);
    });
    const { data } = supabase.auth.onAuthStateChange((event, next) => {
      if (event === 'TOKEN_REFRESHED') { if (active) setSession(next); return; }
      // Schedule data access outside the auth callback lock.
      setTimeout(() => { void load(next); }, 0);
    });
    return () => { active = false; data.subscription.unsubscribe(); };
  }, []);
  const signOut = async () => {
    if (demo) { setDemo(false); return; }
    const result = await supabase!.auth.signOut();
    if (result.error) setError(message(result.error));
  };
  if (!ready) return <div className="loading-page">Opening your check-in desk…</div>;
  if (!demo && (!session || !profile)) return <Login error={error} signedIn={!!session} onDemo={() => setDemo(true)} onSignOut={signOut} />;
  const current = demo ? { user_id: 'preview', role: 'organiser' as const, active: true } : profile!;
  return <AppContext.Provider value={{ profile: current, demo }}>
    <div className="shell">
      <aside className="sidebar">
        <Link to="/" className="brand"><span className="brand-icon"><Ticket size={22} /></span>entrydesk<span className="brand-dot">.</span></Link>
        <div className="workspace-label">YOUR WORKSPACE</div>
        <Link to="/" className="nav-item active"><CalendarDays size={19} /> Events <ChevronRight size={16} /></Link>
        <div className="sidebar-note"><ShieldCheck size={23}/><strong>A smoother welcome.</strong><p>Every guest accounted for.<br/>Every check-in confirmed.</p></div>
        <div className="sidebar-user"><span className="avatar">{demo ? 'P' : session?.user.email?.charAt(0).toUpperCase()}</span><div><strong>{demo ? 'Preview workspace' : session?.user.email}</strong><small>{current.role === 'organiser' ? 'Organiser' : 'Check-in staff'}</small></div><button className="icon-button" onClick={signOut} aria-label="Sign out"><LogOut size={18}/></button></div>
      </aside>
      <div className="main-wrap">
        <header className="topbar"><span><span className="online-dot"/> {demo ? 'Preview workspace' : 'Connected workspace'}</span><span className="topbar-right">Event check-in, simplified <ScanLine size={17}/></span></header>
        {demo && <div className="demo-banner">Preview mode · Sample data only. Attendance changes are disabled until Supabase is connected.<button onClick={() => setDemo(false)}>Exit preview <ArrowUpRight size={14}/></button></div>}
        {error && <div className="alert error">{error}</div>}
        <main><Routes><Route path="/" element={<Dashboard/>}/><Route path="/events/new" element={<ImportWizard/>}/><Route path="/events/:eventId" element={<EventPage/>}/><Route path="*" element={<Navigate to="/" replace/>}/></Routes></main>
        <footer>ENTRYDESK <span>Make a great first impression.</span></footer>
      </div>
    </div>
  </AppContext.Provider>;
}

function Login({ error: outerError, signedIn, onDemo, onSignOut }: { error: string; signedIn: boolean; onDemo: () => void; onSignOut: () => void }) {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const login = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const { error } = await supabase!.auth.signInWithPassword({ email, password });
      if (error) throw error;
    } catch (error) { setError(message(error)); } finally { setBusy(false); }
  };
  return <div className="login-page"><section className="login-story"><div className="brand"><span className="brand-icon"><Ticket/></span>entrydesk.</div><div><span className="eyebrow">WELCOME THEM WELL</span><h1>Great events start<br/>at the door.</h1><p>A calm, reliable check-in desk.<br/>For your guests. For your team.</p><div className="story-ticket"><ScanLine size={50}/><div><strong>One scan. A warm welcome.</strong><small>Simple event check-in, from any phone.</small></div></div></div><small>BUILT FOR THE PEOPLE BEHIND THE EVENT</small></section><section className="login-form"><span className="eyebrow">YOUR CHECK-IN DESK</span><h2>Welcome back.</h2><p className="muted">Sign in to manage your events and welcome your guests.</p>{(error || outerError) && <div className="alert error" role="alert">{error || outerError}</div>}{supabase ? signedIn ? <button className="button" onClick={onSignOut}>Sign out and try again</button> : <form onSubmit={login}><label>Email address<input type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} placeholder="you@organisation.com"/></label><label>Password<input type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)}/></label><button className="button primary full" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'} <ArrowUpRight size={18}/></button><p className="small muted">Accounts are provided by your organiser.</p></form> : <div className="setup-box"><strong>Your workspace is ready to connect.</strong><p>Add the Supabase project URL and publishable key to <code>.env.local</code>, then restart the app. See README.md for setup.</p></div>}<button className="button secondary full" onClick={onDemo}>Explore the app preview <ChevronRight size={18}/></button><div className="login-security"><ShieldCheck size={16}/> Staff-only access. Confirmed check-ins.</div></section></div>;
}
