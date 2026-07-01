import { errorResponse } from '@/lib/auth'

// POST /api/safety/[id]/status — LOCKED: dùng PUT /api/hse/incidents/[id] thay thế
export async function POST() {
  return errorResponse('API /api/safety đã ngừng. Dùng PUT /api/hse/incidents/[id].', 410)
}
