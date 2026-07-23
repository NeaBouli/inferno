'use client';

import { useEffect, useMemo, useState } from 'react';

const sizeClasses = {
  sm: 'h-10 w-10 rounded-xl text-xs',
  md: 'h-14 w-14 rounded-2xl text-sm',
  lg: 'h-20 w-20 rounded-2xl text-lg',
} as const;

function safeLogoUrl(value: string | null | undefined) {
  if (!value || value.length > 500) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
}

function sellerInitials(name: string) {
  const words = name.trim().split(/\s+/u).filter(Boolean);
  return (words.length > 1 ? `${words[0][0]}${words[1][0]}` : words[0]?.slice(0, 2) || 'IF')
    .toLocaleUpperCase('en-US');
}

export function BusinessLogo({
  name,
  logoUrl,
  size = 'md',
  eager = false,
}: {
  name: string;
  logoUrl?: string | null;
  size?: keyof typeof sizeClasses;
  eager?: boolean;
}) {
  const url = useMemo(() => safeLogoUrl(logoUrl), [logoUrl]);
  const [failed, setFailed] = useState(false);

  useEffect(() => setFailed(false), [url]);

  return (
    <span
      data-business-logo
      className={`relative grid shrink-0 place-items-center overflow-hidden border border-orange-200/25 bg-[linear-gradient(145deg,rgba(249,115,22,0.2),rgba(134,239,172,0.12))] font-black text-orange-50 shadow-lg shadow-black/20 ${sizeClasses[size]}`}
    >
      {url && !failed ? (
        <img
          src={url}
          alt={`${name} logo`}
          referrerPolicy="no-referrer"
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <span role="img" aria-label={`${name} logo placeholder`}>
          {sellerInitials(name)}
        </span>
      )}
    </span>
  );
}
