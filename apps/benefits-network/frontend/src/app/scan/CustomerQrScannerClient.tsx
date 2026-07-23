'use client';

import type QrScannerType from 'qr-scanner';
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  CustomerProofLinkResult,
  parseCustomerProofManualInput,
  parseCustomerProofQrPayload,
} from '@/lib/customerProofLink';

type CameraState = 'idle' | 'checking' | 'scanning' | 'found' | 'unavailable' | 'error';

function cameraFailureMessage(error: unknown) {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Camera access was blocked. Allow camera access for shop.ifrunit.tech, or paste the seller proof link below.';
  }
  if (name === 'NotReadableError') {
    return 'The camera is already in use by another app. Close it there, then try again.';
  }
  return 'The camera could not start. Check browser camera permission, or paste the seller proof link below.';
}

export function CustomerQrScannerClient() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const scannerRef = useRef<QrScannerType | null>(null);
  const mountedRef = useRef(true);
  const navigatingRef = useRef(false);
  const [cameraState, setCameraState] = useState<CameraState>('idle');
  const [cameraMessage, setCameraMessage] = useState('Camera stays off until you start it.');
  const [manualInput, setManualInput] = useState('');
  const [manualError, setManualError] = useState('');
  const [imageLoading, setImageLoading] = useState(false);

  const destroyScanner = useCallback(() => {
    const scanner = scannerRef.current;
    scannerRef.current = null;
    if (scanner) {
      scanner.stop();
      scanner.destroy();
    }
  }, []);

  const openProof = useCallback((result: CustomerProofLinkResult) => {
    if (!result.ok || navigatingRef.current) return false;
    navigatingRef.current = true;
    destroyScanner();
    setCameraState('found');
    setCameraMessage('IFR Benefits proof found. Opening secure verification...');
    router.push(result.path);
    return true;
  }, [destroyScanner, router]);

  const handleScannedValue = useCallback((value: string) => {
    const result = parseCustomerProofQrPayload(value, window.location.origin);
    if (openProof(result)) return;
    if (!result.ok) {
      setCameraMessage(`${result.message} Keep the camera pointed at the seller QR.`);
    }
  }, [openProof]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      destroyScanner();
    };
  }, [destroyScanner]);

  async function startCamera() {
    if (cameraState === 'checking' || cameraState === 'scanning') return;
    navigatingRef.current = false;
    setCameraState('checking');
    setCameraMessage('Checking for a camera...');
    destroyScanner();

    try {
      const { default: QrScanner } = await import('qr-scanner');
      if (!mountedRef.current) return;
      if (!navigator.mediaDevices || !await QrScanner.hasCamera()) {
        setCameraState('unavailable');
        setCameraMessage('No browser camera was found. Paste the seller proof link or choose a QR image below.');
        return;
      }
      if (!videoRef.current) throw new Error('Camera preview is not ready');

      const scanner = new QrScanner(
        videoRef.current,
        (result) => handleScannedValue(result.data),
        {
          preferredCamera: 'environment',
          maxScansPerSecond: 8,
          highlightScanRegion: true,
          highlightCodeOutline: true,
          returnDetailedScanResult: true,
          onDecodeError: () => {},
        }
      );
      scannerRef.current = scanner;
      await scanner.start();
      if (!mountedRef.current || scannerRef.current !== scanner) {
        scanner.destroy();
        return;
      }
      setCameraState('scanning');
      setCameraMessage('Camera active. Hold the seller QR inside the frame.');
    } catch (error) {
      destroyScanner();
      if (!mountedRef.current) return;
      setCameraState('error');
      setCameraMessage(cameraFailureMessage(error));
    }
  }

  function stopCamera() {
    destroyScanner();
    navigatingRef.current = false;
    setCameraState('idle');
    setCameraMessage('Camera stopped. No image was saved.');
  }

  async function scanImage(file: File | undefined) {
    if (!file || imageLoading) return;
    setManualError('');
    setImageLoading(true);
    try {
      const { default: QrScanner } = await import('qr-scanner');
      const result = await QrScanner.scanImage(file, {
        returnDetailedScanResult: true,
        alsoTryWithoutScanRegion: true,
      });
      const parsed = parseCustomerProofQrPayload(result.data, window.location.origin);
      if (!openProof(parsed) && !parsed.ok) setManualError(parsed.message);
    } catch {
      setManualError('No valid IFR Benefits QR was found in that image.');
    } finally {
      setImageLoading(false);
    }
  }

  function submitManual(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    navigatingRef.current = false;
    const result = parseCustomerProofManualInput(manualInput, window.location.origin);
    if (openProof(result)) {
      setManualError('');
      return;
    }
    if (!result.ok) setManualError(result.message);
  }

  const cameraActive = cameraState === 'checking' || cameraState === 'scanning';

  return (
    <div data-testid="customer-qr-scanner" className="grid gap-5 lg:grid-cols-[1.12fr_0.88fr]">
      <section className="overflow-hidden rounded-[2rem] border border-white/10 bg-white/[0.055] shadow-2xl shadow-black/25">
        <div className="border-b border-white/10 p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-orange-200/80">
                Customer checkout
              </p>
              <h1 className="mt-2 text-4xl font-black text-white">Scan seller QR</h1>
            </div>
            <span className="rounded-full border border-green-300/25 bg-green-300/[0.08] px-3 py-2 text-xs font-black uppercase text-green-50">
              Local scan
            </span>
          </div>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-stone-300">
            Open the seller&apos;s one-time IFR Benefits proof. The camera image stays on this device.
          </p>
        </div>

        <div className="p-4 sm:p-6">
          <div className="mb-4 grid gap-3 sm:grid-cols-2">
            {!cameraActive ? (
              <button
                type="button"
                onClick={startCamera}
                disabled={cameraState === 'found'}
                className="rounded-2xl bg-orange-300 px-5 py-3 text-sm font-black uppercase text-stone-950 shadow-xl shadow-orange-950/30 transition hover:-translate-y-0.5 hover:bg-orange-200 disabled:cursor-not-allowed disabled:opacity-50"
                data-testid="start-camera"
              >
                Start camera
              </button>
            ) : (
              <button
                type="button"
                onClick={stopCamera}
                className="rounded-2xl border border-white/15 px-5 py-3 text-sm font-black uppercase text-stone-100 transition hover:border-orange-200/60"
                data-testid="stop-camera"
              >
                Stop camera
              </button>
            )}
            <label className="inline-flex cursor-pointer items-center justify-center rounded-2xl border border-white/15 px-5 py-3 text-center text-sm font-black uppercase text-stone-100 transition hover:border-orange-200/60">
              {imageLoading ? 'Reading image' : 'Choose QR image'}
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                disabled={imageLoading}
                onChange={(event) => {
                  void scanImage(event.target.files?.[0]);
                  event.currentTarget.value = '';
                }}
                data-testid="qr-image-input"
              />
            </label>
          </div>

          <div className="relative aspect-[4/3] overflow-hidden rounded-3xl border border-white/10 bg-[#160f0b]">
            <video
              ref={videoRef}
              className={`h-full w-full object-cover ${cameraActive ? 'opacity-100' : 'opacity-0'}`}
              playsInline
              muted
              aria-label="QR camera preview"
            />
            {!cameraActive ? (
              <div className="absolute inset-0 grid place-items-center p-6 text-center">
                <div>
                  <div className="mx-auto grid h-16 w-16 place-items-center rounded-full border border-orange-200/35 bg-orange-200/10 text-2xl font-black text-orange-100">
                    QR
                  </div>
                  <p className="mt-4 text-lg font-black text-white">
                    {cameraState === 'found' ? 'Proof found' : 'Camera ready when you are'}
                  </p>
                  <p className="mt-2 text-sm leading-6 text-stone-300">No recording. No image upload.</p>
                </div>
              </div>
            ) : null}
          </div>

          <p
            className={`mt-4 rounded-2xl border p-4 text-sm leading-6 ${
              cameraState === 'error' || cameraState === 'unavailable'
                ? 'border-red-300/25 bg-red-300/[0.08] text-red-100'
                : 'border-white/10 bg-black/20 text-stone-300'
            }`}
            role="status"
            aria-live="polite"
            data-testid="camera-status"
          >
            {cameraMessage}
          </p>
        </div>
      </section>

      <div className="grid content-start gap-5">
        <section className="rounded-[2rem] border border-white/10 bg-white/[0.055] p-5 shadow-2xl shadow-black/20 sm:p-6">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-orange-200/80">
            Link fallback
          </p>
          <h2 className="mt-2 text-3xl font-black text-white">Open proof manually</h2>
          <form className="mt-5" onSubmit={submitManual}>
            <label htmlFor="customer-proof-input" className="text-xs font-black uppercase text-stone-400">
              Seller proof link or session ID
            </label>
            <textarea
              id="customer-proof-input"
              value={manualInput}
              onChange={(event) => {
                setManualInput(event.target.value);
                setManualError('');
              }}
              rows={4}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="https://shop.ifrunit.tech/r/..."
              className="mt-2 w-full resize-none rounded-2xl border border-white/10 bg-black/25 px-4 py-3 font-mono text-sm text-white outline-none transition focus:border-orange-200/60"
              data-testid="manual-proof-input"
            />
            {manualError ? (
              <p className="mt-3 text-sm leading-6 text-red-100" role="alert" data-testid="manual-proof-error">
                {manualError}
              </p>
            ) : null}
            <button
              type="submit"
              className="mt-4 w-full rounded-2xl bg-orange-300 px-5 py-3 text-sm font-black uppercase text-stone-950 shadow-xl shadow-orange-950/30 transition hover:-translate-y-0.5 hover:bg-orange-200"
              data-testid="open-proof"
            >
              Open customer proof
            </button>
          </form>
        </section>

        <section className="rounded-[2rem] border border-green-300/20 bg-green-300/[0.07] p-5 sm:p-6">
          <p className="text-xs font-black uppercase text-green-100/80">Security check</p>
          <h2 className="mt-2 text-2xl font-black text-white">Only IFR Benefits proofs open.</h2>
          <p className="mt-3 text-sm leading-6 text-stone-300">
            Foreign QR destinations are rejected. A valid scan opens only a local
            <span className="font-mono text-stone-200"> /r/session</span> route before wallet signing.
          </p>
          <a
            href="/"
            className="mt-4 inline-flex rounded-2xl border border-white/15 px-4 py-3 text-xs font-black uppercase text-stone-100 transition hover:border-orange-200/60"
          >
            Back to benefits
          </a>
        </section>
      </div>
    </div>
  );
}
