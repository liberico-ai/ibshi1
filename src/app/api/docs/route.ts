import { NextResponse } from 'next/server'
import { generateOpenApiSpec } from '@/lib/openapi'

export async function GET() {
  const spec = generateOpenApiSpec()
  return NextResponse.json(spec)
}
