import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import { AuthProvider } from '@/components/AuthProvider'
import { LiquidGlass } from '@/components/LiquidGlass'
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
    icon: [
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
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
        <LiquidGlass />

        {/* Liquid-glass refraction filter — fractal noise piped through a
            displacement map bends whatever is behind a .ln-glass surface. */}
        <svg
          aria-hidden
          width="0"
          height="0"
          style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}
        >
          <defs>
            <filter id="glass-distortion" x="0%" y="0%" width="100%" height="100%">
              <feTurbulence
                type="fractalNoise"
                baseFrequency="0.0005 0.0005"
                numOctaves="2"
                seed="92"
                result="noise"
              />
              <feGaussianBlur in="noise" stdDeviation="2" result="blurred" />
              <feDisplacementMap
                in="SourceGraphic"
                in2="blurred"
                scale="77"
                xChannelSelector="R"
                yChannelSelector="G"
              />
            </filter>
          </defs>
        </svg>
      </body>
    </html>
  )
}
