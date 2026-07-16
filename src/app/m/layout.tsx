import type { Metadata, Viewport } from 'next'
import './mobile.css'
import { MobileGuard } from './MobileGuard'

export const metadata: Metadata = {
  title: 'IBS Xưởng',
  // Manifest đặt riêng dưới /m để bản desktop không bị chèn link cài đặt app.
  manifest: '/m/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    title: 'IBS Xưởng',
    statusBarStyle: 'default',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5, // vẫn cho phóng to — a11y
  viewportFit: 'cover', // tràn viền, tôn trọng safe-area của iPhone
  themeColor: '#ffffff',
}

export default function MobileLayout({ children }: { children: React.ReactNode }) {
  return <MobileGuard>{children}</MobileGuard>
}
