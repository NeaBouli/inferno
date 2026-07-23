import type { Metadata, Viewport } from 'next';
import { Providers } from './providers';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL('https://shop.ifrunit.tech'),
  title: 'IFR Benefits | Customer & Seller App',
  description: 'Customer and seller app for IFR locked-access benefits, QR verification, discounts and shop integrations.',
  applicationName: 'IFR Benefits',
  category: 'Web3 benefits',
  keywords: ['IFR Benefits', 'Inferno Protocol', 'IFRLock', 'customer discounts', 'seller benefits', 'Web3 loyalty'],
  manifest: '/manifest.json',
  alternates: {
    canonical: 'https://shop.ifrunit.tech',
  },
  openGraph: {
    title: 'IFR Benefits | Customer & Seller App',
    description: 'Use locked IFR access at participating sellers. Create rules, scan QR proofs and redeem benefits.',
    url: 'https://shop.ifrunit.tech',
    siteName: 'Inferno Protocol',
    type: 'website',
    images: [{ url: '/icons/ifr-token-256-v11.png', width: 256, height: 256, alt: 'Inferno Protocol IFR' }],
  },
  twitter: {
    card: 'summary',
    title: 'IFR Benefits | Customer & Seller App',
    description: 'Use locked IFR access at participating sellers. Create rules, scan QR proofs and redeem benefits.',
    images: ['/icons/ifr-token-256-v11.png'],
  },
};

export const viewport: Viewport = {
  themeColor: '#F5F1E8',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: 'IFR Benefits',
    url: 'https://shop.ifrunit.tech/',
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web, iOS, iPadOS, Android, Windows, macOS, Linux',
    description: 'Installable customer and seller app for IFR locked-access benefits, one-time QR verification and seller-managed offers.',
    isPartOf: {
      '@type': 'WebSite',
      name: 'Inferno Protocol',
      url: 'https://ifrunit.tech/',
    },
    featureList: [
      'External Ethereum wallet connection',
      'IFR and IFRLock status',
      'Customer offer discovery',
      'Short-lived customer and seller QR checkout',
      'Seller profiles, catalogs and benefit rules',
      'Installable progressive web app',
      'Contextual IFR Copilot help',
    ],
  };

  return (
    <html lang="en">
      <head>
        <link rel="icon" href="/icons/ifr-token-64-v11.png" type="image/png" sizes="64x64" />
        <link rel="shortcut icon" href="/icons/favicon-v11.ico" type="image/x-icon" />
        <link rel="apple-touch-icon" href="/icons/ifr-token-180-v11.png" sizes="180x180" />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }} />
      </head>
      <body className="shop-body min-h-screen antialiased">
        <Providers>{children}</Providers>
        <script
          dangerouslySetInnerHTML={{
            __html: `if('serviceWorker' in navigator){const hadController=Boolean(navigator.serviceWorker.controller);let refreshing=false;if(hadController){navigator.serviceWorker.addEventListener('controllerchange',()=>{if(refreshing)return;refreshing=true;window.location.reload()})}window.addEventListener('load',()=>{navigator.serviceWorker.register('/sw.js?v=16',{updateViaCache:'none'}).then(registration=>registration.update()).catch(()=>{})})}`,
          }}
        />
      </body>
    </html>
  );
}
