import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
import { parsePrRows } from '@/lib/pr-parser'

export const runtime = 'nodejs'

interface Matched { materialCode: string; name: string; unit: string; status: string; currentStock: number; via: 'canonical' | 'alias' | 'spec' }
const num = (s: string) => { const n = parseFloat(String(s).replace(/[^\d.,-]/g, '').replace(/,/g, '')); return isNaN(n) ? 0 : n }

// POST /api/work/tasks/[id]/pr-parse — đọc Excel PR, khớp mã vật tư (có sẵn / alias), lưu vào task
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()
    const { id } = await params
    const form = await req.formData()
    const file = form.get('file')
    if (!file || typeof file === 'string') return errorResponse('Cần đính kèm file PR (Excel)', 400)
    if (!/\.(xls|xlsx)$/i.test((file as File).name || '')) return errorResponse('Chỉ hỗ trợ Excel (.xls/.xlsx)', 400)
    const fileUrl = (form.get('fileUrl') as string) || ''
    const fileName = (form.get('fileName') as string) || (file as File).name

    const rows = parsePrRows(Buffer.from(await (file as File).arrayBuffer()))
    if (rows.length === 0) return errorResponse('Không đọc được dòng vật tư nào trong file', 400)

    // Khớp danh mục kho: (1) mã chính xác → (2) mã chuẩn hóa → (3) alias → (4) theo QUY CÁCH (profile)
    const norm = (s: string) => s.trim().replace(/\s+/g, '').toLowerCase()
    const codes = Array.from(new Set(rows.map((r) => r.code.trim()).filter(Boolean)))
    const sel = { materialCode: true, name: true, unit: true, status: true, currentStock: true }
    const lite = (m: { materialCode: string; name: string; unit: string; status: string; currentStock: unknown }, via: Matched['via']): Matched =>
      ({ materialCode: m.materialCode, name: m.name, unit: m.unit, status: m.status, currentStock: Number(m.currentStock || 0), via })
    const byCode = new Map<string, Matched>()
    if (codes.length) {
      // Step 1: exact match
      const mats = await prisma.material.findMany({ where: { materialCode: { in: codes } }, select: sel })
      for (const m of mats) byCode.set(m.materialCode, lite(m, 'canonical'))
      let remain = codes.filter((c) => !byCode.has(c))
      // Step 2: normalized match (case-insensitive, whitespace-collapsed)
      if (remain.length) {
        const allMats = await prisma.material.findMany({ select: sel })
        const normIndex = new Map(allMats.map((m) => [norm(m.materialCode), m]))
        for (const c of remain) {
          const hit = normIndex.get(norm(c))
          if (hit) byCode.set(c, lite(hit, 'canonical'))
        }
        remain = remain.filter((c) => !byCode.has(c))
      }
      // Step 3: alias match
      if (remain.length) {
        const aliases = await prisma.materialCodeAlias.findMany({ where: { aliasCode: { in: remain } }, select: { aliasCode: true, material: { select: sel } } })
        for (const a of aliases) if (a.material) byCode.set(a.aliasCode, lite(a.material, 'alias'))
        const stillRemain = remain.filter((c) => !byCode.has(c))
        // Step 3b: normalized alias match
        if (stillRemain.length) {
          const allAliases = await prisma.materialCodeAlias.findMany({ select: { aliasCode: true, material: { select: sel } } })
          const aliasIndex = new Map(allAliases.filter((a) => a.material).map((a) => [norm(a.aliasCode), a]))
          for (const c of stillRemain) {
            const hit = aliasIndex.get(norm(c))
            if (hit?.material) byCode.set(c, lite(hit.material, 'alias'))
          }
        }
      }
    }
    // Khớp theo quy cách (profile = đoạn đầu của spec, trước ' · ') với danh mục kho
    const profileOf = (spec: string) => (spec.split('·')[0] || '').trim()
    const profiles = Array.from(new Set(rows.map((r) => profileOf(r.spec)).filter(Boolean)))
    const bySpec = new Map<string, Matched>()
    if (profiles.length) {
      const mats = await prisma.material.findMany({ where: { specification: { in: profiles } }, select: { ...sel, specification: true } })
      for (const m of mats) if (m.specification) bySpec.set(m.specification, lite(m, 'spec'))
    }

    const items = rows.map((r) => {
      const matched = (r.code && byCode.get(r.code.trim())) || bySpec.get(profileOf(r.spec)) || null
      const need = matched ? Math.max(0, num(r.qty) - matched.currentStock) : num(r.qty)
      return { ...r, matched, needBuy: matched ? need : null }
    })
    const summary = {
      total: items.length,
      matched: items.filter((i) => i.matched).length,
      unmatched: items.filter((i) => !i.matched).length,
      inStock: items.filter((i) => i.matched && i.matched.currentStock > 0).length,
    }

    // Lưu vào task.resultData.pr
    const task = await prisma.task.findUnique({ where: { id }, select: { resultData: true } })
    const prev = (task?.resultData && typeof task.resultData === 'object') ? (task.resultData as Record<string, unknown>) : {}
    await prisma.task.update({
      where: { id },
      data: { resultData: JSON.parse(JSON.stringify({ ...prev, pr: { items, summary, fileUrl, fileName, parsedAt: new Date().toISOString() } })) },
    })

    return successResponse({ items, summary })
  } catch (err) {
    console.error('POST /api/work/tasks/[id]/pr-parse error:', err)
    return errorResponse(err instanceof Error ? err.message : 'Lỗi hệ thống', 400)
  }
}
