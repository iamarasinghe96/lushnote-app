import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import { AuthProvider } from '@/components/AuthProvider'
import { SupportThreadProvider } from '@/hooks/useSupportThread'
import { LiquidGlass } from '@/components/LiquidGlass'
import { SITE_URL, SITE_NAME, DEFAULT_TITLE, DEFAULT_DESCRIPTION, SOCIAL_IMAGE, INDEXABLE } from '@/lib/site'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: DEFAULT_TITLE, template: `%s | ${SITE_NAME}` },
  description: DEFAULT_DESCRIPTION,
  applicationName: SITE_NAME,
  // Previews and local builds say noindex; production says nothing restrictive.
  // /app and the admin pages override this with their own noindex.
  robots: INDEXABLE ? { index: true, follow: true } : { index: false, follow: false },
  openGraph: {
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
    url: '/',
    siteName: SITE_NAME,
    locale: 'en_AU',
    type: 'website',
    images: [SOCIAL_IMAGE],
  },
  twitter: {
    card: 'summary',
    title: DEFAULT_TITLE,
    description: DEFAULT_DESCRIPTION,
    images: [SOCIAL_IMAGE.url],
  },
  manifest: '/manifest.json',
  // Stop iOS Safari data detectors from auto-linkifying emails/phones/addresses in
  // the UI (e.g. underlining the "Signed in as …@gmail.com" line and its lead-in).
  formatDetection: { telephone: false, email: false, address: false, date: false },
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
        {/* Support lives at the ROOT because app/app/settings is a SIBLING of
            app/app/(shell), not a child — their only shared ancestor is here. It also
            has to keep polling while the panel is closed, so a human reply
            raises the badge wherever the doctor happens to be. */}
        <AuthProvider>
          <SupportThreadProvider>{children}</SupportThreadProvider>
        </AuthProvider>
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
