import { NextResponse } from 'next/server'

export async function GET() {
  return NextResponse.json({
    commit: process.env.GIT_SHA || 'unknown',
    builtAt: process.env.BUILD_TIME || null,
    env: 'production',
  })
}
