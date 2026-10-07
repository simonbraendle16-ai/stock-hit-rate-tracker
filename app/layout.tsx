import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import localFont from 'next/font/local'
import { Toaster } from '@/components/ui/sonner'
import { AppBackdrop } from '@/components/app-backdrop'
import './globals.css'

// Institutionelles Terminal: IBM-Plex-Superfamilie — eine Vision, drei Rollen.
// Serif = Titel & Hero-Zahlen (Gravitas), Sans = UI/Text, Mono = Daten/Kurse.
const plexSerif = localFont({
  variable: '--font-plex-serif',
  display: 'swap',
  src: [
    { path: './fonts/ibm-plex-serif-latin-400-normal.woff2', weight: '400', style: 'normal' },
    { path: './fonts/ibm-plex-serif-latin-500-normal.woff2', weight: '500', style: 'normal' },
    { path: './fonts/ibm-plex-serif-latin-600-normal.woff2', weight: '600', style: 'normal' },
    { path: './fonts/ibm-plex-serif-latin-700-normal.woff2', weight: '700', style: 'normal' },
  ],
})
const plexSans = localFont({
  variable: '--font-plex-sans',
  display: 'swap',
  src: [
    { path: './fonts/ibm-plex-sans-latin-400-normal.woff2', weight: '400', style: 'normal' },
    { path: './fonts/ibm-plex-sans-latin-500-normal.woff2', weight: '500', style: 'normal' },
    { path: './fonts/ibm-plex-sans-latin-600-normal.woff2', weight: '600', style: 'normal' },
    { path: './fonts/ibm-plex-sans-latin-700-normal.woff2', weight: '700', style: 'normal' },
  ],
})
const plexMono = localFont({
  variable: '--font-plex-mono',
  display: 'swap',
  src: [
    { path: './fonts/ibm-plex-mono-latin-400-normal.woff2', weight: '400', style: 'normal' },
    { path: './fonts/ibm-plex-mono-latin-500-normal.woff2', weight: '500', style: 'normal' },
    { path: './fonts/ibm-plex-mono-latin-600-normal.woff2', weight: '600', style: 'normal' },
  ],
})

export const metadata: Metadata = {
  title: 'Trading Cockpit – Disziplin & Trefferquote',
  description:
    'Plane Trades nach Elliott-Wellen, führe sie diszipliniert nach Mark Douglas aus und tracke Disziplin-Score, Trefferquote und Erwartungswert.',
  generator: 'v0.app',
  icons: {
    icon: [
      {
        url: '/icon-light-32x32.png',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/icon-dark-32x32.png',
        media: '(prefers-color-scheme: dark)',
      },
      {
        url: '/icon.svg',
        type: 'image/svg+xml',
      },
    ],
    apple: '/apple-icon.png',
  },
}

export const viewport: Viewport = {
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: 'white' },
    { media: '(prefers-color-scheme: dark)', color: 'black' },
  ],
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="de"
      className={`dark ${plexSerif.variable} ${plexSans.variable} ${plexMono.variable} bg-background`}
    >
      <body className="font-sans antialiased">
        <AppBackdrop />
        {children}
        <Toaster richColors position="top-center" />
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
