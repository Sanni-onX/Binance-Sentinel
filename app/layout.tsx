import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  metadataBase: new URL('https://sentinel-binance-agent.giving-goose-9688.chatgpt.site'),
  title: 'Sentinel | Binance Agent OS',
  description:
    'Conservative market intelligence, portfolio analysis and strategy evaluation for Binance Agent OS.',
  icons: { icon: '/favicon.svg' },
  openGraph: {
    title: 'Sentinel | Binance Agent OS',
    description: 'Market intelligence. Measured decisions.',
  },
  twitter: {
    card: 'summary',
    title: 'Sentinel | Binance Agent OS',
    description: 'Market intelligence. Measured decisions.',
  },
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
