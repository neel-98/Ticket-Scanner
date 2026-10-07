import { useEffect, useRef, useState } from 'react';
import { BrowserQRCodeReader, type IScannerControls } from '@zxing/browser';
import { Camera, CheckCircle2, RefreshCw, ScanLine, X } from 'lucide-react';
import { checkIn, message } from '../lib/supabase';
import { formatTime } from '../lib/exports';
import { cameraConstraints, createQrReader } from '../lib/qr';
import type { CheckInResult, EventRecord } from '../types';

export function Scanner({ event, demo, onClose, onSaved }: { event: EventRecord; demo: boolean; onClose: () => void; onSaved: () => void }) {
  const video = useRef<HTMLVideoElement>(null); const controls = useRef<IScannerControls | null>(null);
  const locked = useRef(false); const generation = useRef(0); const mounted = useRef(true);
  const request = useRef<{ code: string; id: string; method: 'qr' | 'manual' } | null>(null);
  const [running, setRunning] = useState(false); const [starting, setStarting] = useState(false);
  const [code, setCode] = useState(''); const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CheckInResult | null>(null); const [error, setError] = useState('');
  const [cameraError, setCameraError] = useState(''); const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const stop = () => {
    generation.current++; controls.current?.stop(); controls.current = null;
    const stream = video.current?.srcObject;
    if (stream instanceof MediaStream) stream.getTracks().forEach(track => track.stop());
    setRunning(false); setStarting(false);
  };
  useEffect(() => {
    mounted.current = true;
    const lifecycle = generation;
    return () => {
      mounted.current = false; lifecycle.current++; controls.current?.stop();
      // ZXing controls own the stream and stop its tracks.
    };
  }, []);
  const submit = async (ticket: string, method: 'qr' | 'manual', retry = false) => {
    if (demo || (!retry && locked.current) || !ticket) return;
    locked.current = true; setBusy(true); setError(''); setResult(null);
    if (!retry) request.current = { code: ticket, method, id: crypto.randomUUID() };
    const current = request.current!;
    try {
      const outcome = await checkIn(event.id, current.code, current.id, current.method);
      if (!mounted.current) return;
      setResult(outcome); if (outcome.status === 'checked_in') onSaved();
    } catch (e) { if (mounted.current) setError('Unable to confirm check-in. ' + message(e) + ' Retry this request or use the paper backup.'); }
    finally { if (mounted.current) setBusy(false); }
  };
  const start = async () => {
    if (demo || starting || running) return;
    stop(); const currentGeneration = generation.current;
    setStarting(true); setCameraError('');
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera scanning needs a supported browser and HTTPS. Use manual entry below.');
      const reader = createQrReader();
      const next = await reader.decodeFromConstraints(cameraConstraints(deviceId), video.current!, result => {
        if (result && currentGeneration === generation.current && !locked.current && mounted.current) void submit(result.getText(), 'qr');
      });
      if (!mounted.current || currentGeneration !== generation.current) { next.stop(); return; }
      controls.current = next; setRunning(true);
      // Device enumeration is optional; a failure must not stop a working camera.
      try {
        const available = await BrowserQRCodeReader.listVideoInputDevices();
        if (mounted.current && currentGeneration === generation.current) setDevices(available);
      } catch { /* Keep scanning with the selected camera. */ }
    } catch (e) { if (mounted.current && currentGeneration === generation.current) { setCameraError(message(e) + ' Allow camera access, choose another camera, or use manual entry.'); stop(); } }
    finally { if (mounted.current && currentGeneration === generation.current) setStarting(false); }
  };
  const next = () => { locked.current = false; request.current = null; setResult(null); setError(''); setCode(''); };
  const showingFeedback = busy || !!result || !!error;
  return <div className="modal-backdrop scanner-backdrop">
    <section className="modal scanner-modal" role="dialog" aria-modal="true" aria-labelledby="scanner-title">
      <div className="modal-heading"><div><span className="eyebrow">CHECK-IN DESK</span><h2 id="scanner-title">{event.name}</h2></div><button className="icon-button" aria-label="Close scanner" onClick={() => { stop(); onClose(); }}><X/></button></div>
      <p className="muted small scanner-meta">{event.checked_in_count} / {event.attendee_count} checked in · {event.timezone}</p>
      <div className="camera-view">
        <video ref={video} muted playsInline autoPlay/>
        {!running && !showingFeedback && <div className="camera-placeholder"><ScanLine size={55}/><p>{starting ? 'Starting your camera…' : 'Point your camera at a ticket QR code'}</p></div>}
        {running && !showingFeedback && <><div className="scan-frame"/><span className="camera-caption">Keep the QR and its white border inside the guide</span></>}
        <div className={`camera-feedback ${showingFeedback ? 'visible' : ''} ${result?.status ?? (error ? 'error' : 'pending')}`} aria-live="polite" aria-atomic="true">
          {busy && <div className="camera-feedback-content"><RefreshCw size={32}/><strong>Confirming ticket…</strong><p>Waiting for the database. Please hold.</p></div>}
          {!busy && result && <div className="camera-feedback-content">
            <CheckCircle2 size={40}/>
            <strong>{result.status === 'checked_in' ? 'Welcome in!' : result.status === 'already_checked_in' ? 'Already checked in' : 'Ticket not valid for this event'}</strong>
            {result.name && <span className="camera-guest-name">{result.name}</span>}
            {result.checked_in_at && <small>{formatTime(result.checked_in_at, event.timezone)} ({event.timezone})</small>}
          </div>}
          {!busy && error && <div className="camera-feedback-content"><strong>Check-in not confirmed</strong><p role="alert">{error}</p><button className="button secondary" onClick={() => void submit(request.current!.code, request.current!.method, true)}><RefreshCw size={16}/>Retry same request</button></div>}
          {!busy && (result || error) && <button className="button primary full camera-next" onClick={next}>Scan next <ScanLine size={19}/></button>}
        </div>
      </div>
      <div className="scanner-controls"><button className="button primary" disabled={demo || starting} onClick={() => running ? stop() : void start()}><Camera size={17}/>{running ? 'Stop camera' : 'Start camera'}</button>{devices.length > 1 && <select aria-label="Camera" value={deviceId} onChange={e => { stop(); setDeviceId(e.target.value); }}><option value="">Rear camera preferred</option>{devices.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Camera ${i + 1}`}</option>)}</select>}</div>
      {cameraError && <div className="alert warning" role="alert">{cameraError}</div>}
      <details className="manual-dropdown"><summary>Enter ticket code manually</summary><form className="manual-entry" onSubmit={e => { e.preventDefault(); void submit(code, 'manual'); }}><label>Exact ticket code<input className="mono" value={code} onChange={e => setCode(e.target.value)} disabled={showingFeedback} placeholder="e.g. 001001" autoComplete="off"/></label><button className="button secondary" disabled={demo || showingFeedback || !code}>Check ticket</button></form></details>
      <details className="small muted camera-guidance"><summary>Tips for a faster scan</summary><p>Keep the whole QR and its white border visible. Move slowly until the code looks sharp. Enlarge the QR on the ticket screen and tilt it slightly to reduce glare. On a MacBook, start about 30–50 cm from the webcam.</p></details>
      {demo && <p className="alert warning">Preview only. Connect Supabase to enable camera scanning and ticket validation.</p>}
      <p className="small muted">Review the result in the camera area, then tap “Scan next” to resume. An unconfirmed check-in is never reported as successful.</p>
    </section>
  </div>;
}
