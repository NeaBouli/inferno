import type { Metadata, Viewport } from 'next';
import { Providers } from './providers';
import './globals.css';

export const metadata: Metadata = {
  title: 'IFR Benefits | Customer & Seller App',
  description: 'Customer and seller app for IFR locked-access benefits, QR verification, discounts and shop integrations.',
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
  },
};

export const viewport: Viewport = {
  themeColor: '#F5F1E8',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" href="/icons/ifr-token-64-v9.png" type="image/png" sizes="64x64" />
        <link rel="shortcut icon" href="/icons/favicon-v9.ico" type="image/x-icon" />
        <link rel="apple-touch-icon" href="/icons/ifr-token-180-v9.png" sizes="180x180" />
      </head>
      <body className="shop-body min-h-screen antialiased">
        <Providers>{children}</Providers>
        <script
          dangerouslySetInnerHTML={{
            __html: `if('serviceWorker' in navigator){const hadController=Boolean(navigator.serviceWorker.controller);let refreshing=false;if(hadController){navigator.serviceWorker.addEventListener('controllerchange',()=>{if(refreshing)return;refreshing=true;window.location.reload()})}window.addEventListener('load',()=>{navigator.serviceWorker.register('/sw.js?v=11',{updateViaCache:'none'}).then(registration=>registration.update()).catch(()=>{})})}`,
          }}
        />
      </body>
    </html>
  );
}
