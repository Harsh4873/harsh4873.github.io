import type { IScannerControls } from '@zxing/browser';
import { Camera, Keyboard, LoaderCircle, ScanLine } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Modal, SegmentedControl } from '../ui';

function normalizeBarcode(value: string) {
  const digits = value.replace(/\D/g, '');
  return digits.length >= 8 && digits.length <= 14 ? digits : '';
}

interface BarcodeScannerProps {
  open: boolean;
  onClose: () => void;
  onScan: (barcode: string) => void;
}

export function BarcodeScanner({ open, onClose, onScan }: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<IScannerControls>();
  const [mode, setMode] = useState<'camera' | 'manual'>('camera');
  const [manual, setManual] = useState('');
  const [status, setStatus] = useState<'starting' | 'ready' | 'error'>('starting');
  const [message, setMessage] = useState('Starting the rear camera…');

  useEffect(() => {
    if (!open || mode !== 'camera') return;
    let active = true;
    setStatus('starting');
    setMessage('Starting the rear camera…');

    void import('@zxing/browser').then(async ({ BrowserMultiFormatReader }) => {
      if (!active || !videoRef.current) return;
      const reader = new BrowserMultiFormatReader(undefined, { delayBetweenScanAttempts: 140 });
      try {
        const controls = await reader.decodeFromConstraints(
          { audio: false, video: { facingMode: { ideal: 'environment' } } },
          videoRef.current,
          (result, error, scannerControls) => {
            if (!active) return;
            if (result) {
              const barcode = normalizeBarcode(result.getText());
              if (!barcode) return;
              scannerControls.stop();
              onScan(barcode);
              return;
            }
            if (error && !String(error.name).includes('NotFound')) {
              setStatus('error');
              setMessage('The camera could not read that code. Hold it steady or type the digits instead.');
            }
          },
        );
        if (!active) {
          controls.stop();
          return;
        }
        controlsRef.current = controls;
        setStatus('ready');
        setMessage('Center the UPC or EAN barcode inside the frame.');
      } catch (error) {
        if (!active) return;
        setStatus('error');
        const denied = error instanceof DOMException && error.name === 'NotAllowedError';
        setMessage(denied
          ? 'Camera access was denied. Allow it in Safari settings or enter the barcode manually.'
          : 'The camera is unavailable here. Enter the barcode manually instead.');
      }
    });

    return () => {
      active = false;
      controlsRef.current?.stop();
      controlsRef.current = undefined;
      const stream = videoRef.current?.srcObject;
      if (stream instanceof MediaStream) stream.getTracks().forEach((track) => track.stop());
    };
  }, [mode, onScan, open]);

  useEffect(() => {
    if (!open) {
      setMode('camera');
      setManual('');
    }
  }, [open]);

  if (!open) return null;

  function submitManual(event: React.FormEvent) {
    event.preventDefault();
    const barcode = normalizeBarcode(manual);
    if (!barcode) {
      setStatus('error');
      setMessage('Enter the 8–14 digits printed below the barcode.');
      return;
    }
    onScan(barcode);
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Scan a barcode"
      description="Use the rear camera or enter the digits printed on the package."
      width="large"
      className="scanner-modal"
    >
      <SegmentedControl
        value={mode}
        options={[
          { value: 'camera', label: 'Camera', icon: <Camera /> },
          { value: 'manual', label: 'Type code', icon: <Keyboard /> },
        ]}
        onChange={setMode}
        label="Barcode entry method"
        fullWidth
      />

      {mode === 'camera' ? (
        <div className="scanner-stage">
          <video ref={videoRef} muted playsInline aria-label="Live barcode camera" />
          <span className="scanner-frame" aria-hidden="true"><ScanLine /></span>
          {status === 'starting' && <span className="scanner-loading"><LoaderCircle className="spin" /> Starting camera</span>}
        </div>
      ) : (
        <form className="manual-barcode" onSubmit={submitManual}>
          <label>Barcode digits<input inputMode="numeric" autoComplete="off" value={manual} onChange={(event) => setManual(event.target.value)} placeholder="0643843716686" autoFocus /></label>
          <button type="submit" className="button button--primary">Look up product</button>
        </form>
      )}

      <p className={`scanner-status ${status}`} role="status">{message}</p>
      <p className="fine-print">Camera video stays on this device and stops as soon as you close the scanner or a code is found.</p>
    </Modal>
  );
}
