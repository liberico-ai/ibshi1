import { apiFetch } from '@/hooks/useAuth'

export interface ResolvedLite {
  id: string
  materialCode: string
  name: string
  unit: string
  currentStock: number
  status: string
}

// Resolve many codes (canonical OR old/alias) → canonical material map.
// Returns a Map keyed by the input code; missing codes are simply absent.
export async function resolveCodes(codes: string[]): Promise<Map<string, ResolvedLite>> {
  const clean = Array.from(new Set(codes.map((c) => (c || '').trim()).filter(Boolean)))
  const out = new Map<string, ResolvedLite>()
  if (clean.length === 0) return out
  try {
    const res = await apiFetch('/api/materials/resolve-batch', { method: 'POST', body: JSON.stringify({ codes: clean }) })
    if (res.ok && res.results) {
      for (const [code, mat] of Object.entries(res.results as Record<string, ResolvedLite | null>)) {
        if (mat) out.set(code, mat)
      }
    }
  } catch { /* network — leave empty, falls back to name matching */ }
  return out
}
