'use client';

import { useState, useEffect } from 'react';

interface CountdownProps {
  expiresAt: string;
  onExpired?: () => void;
}

export function Countdown({ expiresAt, onExpired }: CountdownProps) {
  const [secondsLeft, setSecondsLeft] = useState(() =>
    Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000))
  );

  useEffect(() => {
    if (secondsLeft <= 0) {
      onExpired?.();
      return;
    }
    const timer = setInterval(() => {
      const remaining = Math.max(
        0,
        Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000)
      );
      setSecondsLeft(remaining);
      if (remaining <= 0) {
        clearInterval(timer);
        onExpired?.();
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [expiresAt, secondsLeft, onExpired]);

  return (
    <span className="font-mono text-lg tabular-nums">
      {secondsLeft}s
    </span>
  );
}
