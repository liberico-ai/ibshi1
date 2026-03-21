import { NextResponse } from 'next/server'
import prisma from '@/lib/db'

export async function GET() {
  const timestamp = new Date().toISOString()

  try {
    // Verify database connectivity
    await prisma.$queryRawUnsafe('SELECT 1')

    return NextResponse.json({
      status: 'ok',
      timestamp,
      db: 'connected',
      version: process.env.npm_package_version || '0.1.0',
    })
  } catch (err) {
    console.error('Health check failed:', err)
    return NextResponse.json(
      {
        status: 'error',
        timestamp,
        db: 'disconnected',
        error: 'Database connection failed',
      },
      { status: 503 }
    )
  }
}
