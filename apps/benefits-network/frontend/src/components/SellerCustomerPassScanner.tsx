'use client';

import type QrScannerType from 'qr-scanner';
import { useCallback, useEffect, useRef, useState } from 'react';
import { parseCustomerPassQrPayload } from '@/lib/customerPassLink';

export function SellerCustomerPassScanner({ onPass }: { onPass: (passId: string) => void }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scannerRef = useRef<QrScannerType | null>(null);
  const [active, setActive] = useState(false);
  const [message, setMessage] = useState('Camera stays off until you start it.');
  const [imageLoading, setImageLoading] = useState(false);

  const stop = useCallback(() => {
    scannerRef.current?.stop();
    scannerRef.current?.destroy();
    scannerRef.current = null;
    setActive(false);
  }, []);

  const accept = useCallback((value: string) => {
    const parsed = parseCustomerPassQrPayload(value, window.location.origin);
    if (!parsed.ok) {
      setMessage(parsed.message);
      return false;
    }
    onPass(parsed.passId);
    setMessage('Customer pass found. Review the selected rule, then bind it.');
    stop();
    return true;
  }, [onPass, stop]);

  useEffect(() => stop, [stop]);

  async function start() {
    setMessage('Checking camera...');
    try {
      const { default: QrScanner } = await import('qr-scanner');
      if (!navigator.mediaDevices || !await QrScanner.hasCamera() || !videoRef.current) {
        setMessage('No camera is available. Paste the pass link or choose a QR image.');
        return;
      }
      const scanner = new QrScanner(videoRef.current, (result) => accept(result.data), {
        preferredCamera: 'environment',
        maxScansPerSecond: 8,
        highlightScanRegion: true,
        highlightCodeOutline: true,
        returnDetailedScanResult: true,
        onDecodeError: () => {},
      });
      scannerRef.current = scanner;
      await scanner.start();
      setActive(true);
      setMessage('Camera active. Hold the customer QR inside the frame.');
    } catch (err) {
      stop();
      const name = err instanceof DOMException ? err.name : '';
      setMessage(name === 'NotAllowedError'
        ? 'Camera permission was blocked. Allow it for shop.ifrunit.tech or paste the pass link.'
        : 'Camera could not start. Paste the pass link or choose a QR image.');
    }
  }

  async function scanImage(file?: File) {
    if (!file) return;
    setImageLoading(true);
    try {
      const { default: QrScanner } = await import('qr-scanner');
      const result = await QrScanner.scanImage(file, { returnDetailedScanResult: true, alsoTryWithoutScanRegion: true });
      accept(result.data);
    } catch {
      setMessage('No canonical IFR customer pass was found in that image.');
    } finally {
      setImageLoading(false);
    }
  }

  return (
    <div className="mt-3 border-t border-green-200/15 pt-3">
      <div className="grid gap-2 sm:grid-cols-2">
        <button type="button" onClick={active ? stop : start} className="rounded-xl border border-green-200/30 px-3 py-3 text-xs font-black uppercase tracking-[0.1em] text-green-50">
          {active ? 'Stop camera' : 'Scan customer QR'}
        </button>
        <label className="cursor-pointer rounded-xl border border-white/15 px-3 py-3 text-center text-xs font-black uppercase tracking-[0.1em] text-stone-100">
          {imageLoading ? 'Reading image' : 'Choose QR image'}
          <input type="file" accept="image/*" className="sr-only" disabled={imageLoading} onChange={(event) => { void scanImage(event.target.files?.[0]); event.currentTarget.value = ''; }} />
        </label>
      </div>
      <div className={`mt-3 overflow-hidden rounded-2xl border border-white/10 bg-black/30 ${active ? 'aspect-[4/3]' : 'h-0 border-0'}`}>
        <video ref={videoRef} playsInline muted className="h-full w-full object-cover" aria-label="Customer pass camera preview" />
      </div>
      <p className="mt-2 text-xs leading-5 text-stone-400" aria-live="polite">{message}</p>
    </div>
  );
}
