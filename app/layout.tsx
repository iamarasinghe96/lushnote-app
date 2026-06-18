import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import { AuthProvider } from '@/components/AuthProvider'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'LushNote',
  description: 'Clinical note builder for psychiatrists',
  applicationName: 'LushNote',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    title: 'LushNote',
    statusBarStyle: 'black-translucent',
    startupImage: '/apple-touch-icon.png',
  },
  icons: {
    apple: '/apple-touch-icon.png',
  },
  other: {
    'mobile-web-app-capable': 'yes',
  },
  metadataBase: new URL('https://lushnote.com.au'),
  openGraph: {
    title: 'LushNote',
    description: 'Clinical note builder for psychiatrists',
    url: 'https://lushnote.com.au',
    siteName: 'LushNote',
    type: 'website',
  },
}

export const viewport: Viewport = {
  themeColor: '#1d4ed8',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.className}>
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  )
}
