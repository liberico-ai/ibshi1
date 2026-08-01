import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, requireRoles } from '@/lib/auth'

// S-curve tiến độ dự án (plan vs actual theo tuần) — zero-schema, lưu SystemConfig scurve:{projectId}.
// value = { unit: 'week'|'cw', points: [{ label, plan, actual }], note }

const VIEW_ROLES = ['R01', 'R02', 'R02a', 'R03', 'R03a', 'R08', 'R08a', 'R10']
const EDIT_ROLES = ['R01', 'R02', 'R02a', 'R10']   // PM + BGĐ + Admin lập S-curve

interface ScurvePoint { label: string; plan: number | null; actual: number | null }
interface ScurveDoc { unit: string; points: ScurvePoint[]; note?: string }

function empty(): ScurveDoc { return { unit: 'week', points: [], note: '' } }

// GET /api/reports/project-scurve?projectId=xxx
export async function GET(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()
  if (!requireRoles(user.roleCode, VIEW_ROLES)) return errorResponse('Không có quyền xem tiến độ dự án', 403)

  const projectId = new URL(req.url).searchParams.get('projectId') || ''
  if (!projectId) return errorResponse('Thiếu projectId', 400)
  const row = await prisma.systemConfig.findUnique({ where: { key: `scurve:${projectId}` } })
  let doc = empty()
  if (row?.value) { try { doc = { ...empty(), ...JSON.parse(row.value) } } catch { /* giữ empty */ } }
  return successResponse({ scurve: doc, canEdit: requireRoles(user.roleCode, EDIT_ROLES) })
}

// PUT /api/reports/project-scurve — body: { projectId, unit, points, note }
export async function PUT(req: NextRequest) {
  const user = await authenticateRequest(req)
  if (!user) return unauthorizedResponse()
  if (!requireRoles(user.roleCode, EDIT_ROLES)) return errorResponse('Chỉ PM / BGĐ / Admin được lập S-curve', 403)

  const body = await req.json().catch(() => null)
  const projectId: string = body?.projectId
  if (!projectId) return errorResponse('Thiếu projectId', 400)

  const rawPoints = Array.isArray(body?.points) ? body.points : []
  const points: ScurvePoint[] = rawPoints
    .filter((p: unknown): p is Record<string, unknown> => !!p && typeof p === 'object')
    .map((p: Record<string, unknown>) => ({
      label: String(p.label ?? '').trim(),
      plan: p.plan == null || p.plan === '' ? null : Number(p.plan),
      actual: p.actual == null || p.actual === '' ? null : Number(p.actual),
    }))
    .filter((p: ScurvePoint) => p.label)

  const doc: ScurveDoc = { unit: body?.unit === 'cw' ? 'cw' : 'week', points, note: String(body?.note ?? '') }
  await prisma.systemConfig.upsert({
    where: { key: `scurve:${projectId}` },
    update: { value: JSON.stringify(doc) },
    create: { key: `scurve:${projectId}`, value: JSON.stringify(doc) },
  })
  return successResponse({ scurve: doc }, 'Đã lưu S-curve')
}
