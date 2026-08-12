import { NextRequest } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/db'
import { successResponse, errorResponse } from '@/lib/auth'
import { authenticateApiClient, requireScope } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'

const querySchema = z.object({
  status: z.enum(['active', 'all']).default('active'),
  q: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
})

export async function GET(req: NextRequest) {
  const client = await authenticateApiClient(req)
  if (!client) return errorResponse('Unauthorized', 401, 'UNAUTHORIZED')
  if (!requireScope(client, 'read:projects')) return errorResponse('Insufficient scope', 403, 'INSUFFICIENT_SCOPE')

  const params = querySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams))
  if (!params.success) return errorResponse('Invalid query parameters', 400, 'VALIDATION_FAILED')

  const { status, q, page, pageSize } = params.data

  const where: Record<string, unknown> = {}
  if (status === 'active') where.status = 'ACTIVE'
  if (q) {
    where.OR = [
      { projectCode: { contains: q, mode: 'insensitive' } },
      { projectName: { contains: q, mode: 'insensitive' } },
    ]
  }

  const [projects, total] = await Promise.all([
    prisma.project.findMany({
      where,
      select: { id: true, projectCode: true, projectName: true, status: true },
      orderBy: { projectCode: 'asc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.project.count({ where }),
  ])

  return successResponse({ data: projects, page, pageSize, total })
}

// ── POST: Submit project from Sale for IBS review ──

const submitSchema = z.object({
  externalRef: z.string().min(1, 'externalRef là bắt buộc'),
  projectName: z.string().min(1, 'projectName là bắt buộc'),
  clientName: z.string().min(1, 'clientName là bắt buộc'),
  productType: z.string().optional(),
  projectType: z.string().optional(),
  contractValue: z.number().optional(),
  currency: z.string().default('VND'),
  description: z.string().optional(),
  saleCustomerId: z.string().optional(),
})

export async function POST(req: NextRequest) {
  const client = await authenticateApiClient(req)
  if (!client) return errorResponse('Unauthorized', 401, 'UNAUTHORIZED')
  if (!requireScope(client, 'write:projects')) return errorResponse('Insufficient scope', 403, 'INSUFFICIENT_SCOPE')

  let body: unknown
  try { body = await req.json() } catch { return errorResponse('Invalid JSON body', 400, 'VALIDATION_FAILED') }

  const parsed = submitSchema.safeParse(body)
  if (!parsed.success) {
    const msg = parsed.error.issues.map(i => i.message).join('; ')
    return errorResponse(msg, 400, 'VALIDATION_FAILED')
  }

  const { externalRef, saleCustomerId, ...payload } = parsed.data

  // Idempotency: if externalRef already exists, return existing submission
  const existing = await prisma.projectSubmission.findUnique({
    where: { externalRef },
  })
  if (existing) {
    const data: Record<string, unknown> = {
      externalRef: existing.externalRef,
      submissionId: existing.id,
      status: existing.status,
      createdAt: existing.createdAt,
    }
    if (existing.status === 'APPROVED') {
      data.projectId = existing.projectId
      data.projectCode = existing.projectCode
    }
    return successResponse({ data })
  }

  const sub = await prisma.projectSubmission.create({
    data: {
      externalRef,
      payload,
      saleCustomerId: saleCustomerId || null,
    },
  })

  console.log(`[ExternalAPI] ProjectSubmission created: ${sub.id} externalRef=${externalRef} by client=${client.name}`)

  return successResponse({
    data: {
      externalRef: sub.externalRef,
      submissionId: sub.id,
      status: sub.status,
      createdAt: sub.createdAt,
    },
  }, undefined, 201)
}
