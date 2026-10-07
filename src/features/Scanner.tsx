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
  return <div className="modal-backdrop"><section className="modal scanner-modal" role="dialog" aria-modal="true" aria-labelledby="scanner-title"><div className="modal-heading"><div><span className="eyebrow">CHECK-IN DESK</span><h2 id="scanner-title">{event.name}</h2></div><button className="icon-button" aria-label="Close scanner" onClick={() => { stop(); onClose(); }}><X/></button></div><p className="muted small">{event.checked_in_count} / {event.attendee_count} checked in · {event.timezone}</p><div className="camera-view"><video ref={video} muted playsInline autoPlay/>{!running && <div className="camera-placeholder"><ScanLine size={55}/><p>{starting ? 'Starting your camera…' : 'Point your camera at a ticket QR code'}</p></div>}{running && <div className="scan-frame"/>}</div><div className="scanner-controls"><button className="button primary" disabled={demo || starting} onClick={() => running ? stop() : void start()}><Camera size={17}/>{running ? 'Stop camera' : 'Start camera'}</button>{devices.length > 1 && <select aria-label="Camera" value={deviceId} onChange={e => { stop(); setDeviceId(e.target.value); }}><option value="">Rear camera preferred</option>{devices.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Camera ${i + 1}`}</option>)}</select>}</div>{cameraError && <div className="alert warning" role="alert">{cameraError}</div>}
    <p className="small muted camera-guidance">Keep the whole QR and its white border visible. On a MacBook, start about 30–50 cm from the webcam and move slowly until the code looks sharp. Enlarge the QR on your phone and tilt the screen slightly to reduce glare.</p>
    <form className="manual-entry" onSubmit={e => { e.preventDefault(); void submit(code, 'manual'); }}><label>Or enter the exact ticket code<input className="mono" value={code} onChange={e => setCode(e.target.value)} disabled={busy || !!result || !!error} placeholder="e.g. 001001" autoComplete="off"/></label><button className="button secondary" disabled={demo || busy || !!result || !!error || !code}>Check ticket</button></form>
    <div aria-live="polite" aria-atomic="true">{busy && <div className="scan-result pending">Confirming with the database…</div>}{result && <div className={`scan-result ${result.status}`}><CheckCircle2 size={28}/><strong>{result.status === 'checked_in' ? 'Welcome in!' : result.status === 'already_checked_in' ? 'Already checked in' : 'Ticket not valid for this event'}</strong>{result.name && <span>{result.name}</span>}{result.checked_in_at && <small>{formatTime(result.checked_in_at, event.timezone)} ({event.timezone})</small>}</div>}{error && <div className="alert error" role="alert">{error}<button className="button secondary" disabled={busy} onClick={() => void submit(request.current!.code, request.current!.method, true)}><RefreshCw size={16}/>Retry same request</button></div>}</div>{(result || error) && <button className="button primary full" disabled={busy} onClick={next}>Scan next</button>}{demo && <p className="alert warning">Preview only. Connect Supabase to enable camera scanning and ticket validation.</p>}<p className="small muted">Scanning pauses while confirming and until you press “Scan next”. An unconfirmed check-in is never reported as successful.</p></section></div>;
}
