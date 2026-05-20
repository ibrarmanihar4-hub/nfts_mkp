import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Doggy Sniper',
  description: 'NFT sniper for doggy.market doginals',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
