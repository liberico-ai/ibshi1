// Revise Flow36 — lõi đồ thị round (thuần, không prisma → dễ test).
// Bám DESIGN_C1_GateRound mục 2.2 (fixpoint đồ-thị-hợp) + 2.2(c) (gate eval round-scoped).

export interface GraphStep {
  code: string
  nextCodes: string[]
  gateCodes: string[]
}

function indexByCode(steps: GraphStep[]): Map<string, GraphStep> {
  return new Map(steps.map((s) => [s.code, s]))
}

/**
 * Reverse-BFS gộp gateCodes → tập TỔ TIÊN của entry (KHÔNG gồm entry).
 * Tiền nhiệm 1 bước = (bước có nó trong nextCodes) ∪ (gateCodes của chính nó).
 * BẮT BUỘC gồm gateCodes: bước hội tụ (P2.4) không nằm trong nextCodes của ai.
 * Dùng chung cho applyTemplate({fromStepCode}) và expandRevisionRound (1 nguồn).
 */
export function reverseBfsInclGate(entryCode: string, steps: GraphStep[]): Set<string> {
  const revAdj = new Map<string, string[]>()
  for (const s of steps) for (const nc of s.nextCodes || []) {
    if (!revAdj.has(nc)) revAdj.set(nc, [])
    revAdj.get(nc)!.push(s.code)
  }
  const byCode = indexByCode(steps)
  const ancestors = new Set<string>()
  const stack = [entryCode]
  while (stack.length) {
    const cur = stack.pop()!
    const curStep = byCode.get(cur)
    const preds = [...(revAdj.get(cur) || []), ...((curStep?.gateCodes) || [])]
    for (const p of preds) {
      if (p !== entryCode && !ancestors.has(p)) { ancestors.add(p); stack.push(p) }
    }
  }
  return ancestors
}

/**
 * Tập bước HẠ NGUỒN của entry — fixpoint trên ĐỒ-THỊ-HỢP:
 *   (a) cạnh next  (b) cạnh feeder→gate  (c) kéo gate-feeder song song (loại tổ tiên).
 * Reachability độc lập round (round chỉ dùng ở spawn/gate) → không nhận tham số round.
 * Xem DESIGN_C1 2.2(b): forward-BFS-nextCodes-only SAI với SX-PROD (feeder next=[]).
 */
export function expandRevisionRound(steps: GraphStep[], entryCode: string): Set<string> {
  const byCode = indexByCode(steps)
  const ancestors = reverseBfsInclGate(entryCode, steps)
  // gateSucc: F → [gate-step G có F ∈ G.gateCodes]
  const gateSucc = new Map<string, string[]>()
  for (const G of steps) for (const f of G.gateCodes || []) {
    if (!gateSucc.has(f)) gateSucc.set(f, [])
    gateSucc.get(f)!.push(G.code)
  }
  const reached = new Set<string>([entryCode])
  let changed = true
  while (changed) {
    changed = false
    for (const cur of [...reached]) {
      const s = byCode.get(cur)
      if (!s) continue
      // (a) cạnh next
      for (const nc of s.nextCodes || []) if (!reached.has(nc)) { reached.add(nc); changed = true }
      // (b) cạnh feeder→gate (cur là feeder ⇒ gate-step nhận cur reachable)
      for (const G of gateSucc.get(cur) || []) if (!reached.has(G)) { reached.add(G); changed = true }
      // (c) kéo gate-feeder song song của gate-step cur, loại tổ tiên (kế thừa round-0)
      for (const f of s.gateCodes || []) if (!reached.has(f) && !ancestors.has(f)) { reached.add(f); changed = true }
    }
  }
  return reached
}

/**
 * Orphan-feeder: bước trong `reached` (≠ entry) mà chain KHÔNG tự sinh được:
 *   - không nằm trong nextCodes của bước reached nào (không có cạnh next tới), VÀ
 *   - không phải gate-step (gateCodes rỗng → gate-driven scan không spawn).
 * Điển hình: anh-em song song leaf của entry (P2.1 → P2.2/P2.3/P2.1A). Phải pre-spawn.
 * (Gate-step như P2.4 KHÔNG orphan — do gate-driven scan sinh khi feeder resolved → chống pass-nhầm.)
 */
export function orphanFeeders(steps: GraphStep[], entryCode: string, reached: Set<string>): string[] {
  const byCode = indexByCode(steps)
  const nextTargets = new Set<string>()
  for (const code of reached) for (const nc of byCode.get(code)?.nextCodes || []) nextTargets.add(nc)
  const out: string[] = []
  for (const code of reached) {
    if (code === entryCode) continue
    const s = byCode.get(code)
    if (!s) continue
    if (nextTargets.has(code)) continue            // chain-spawnable qua next
    if ((s.gateCodes || []).length > 0) continue   // gate-spawnable (gate-driven scan)
    out.push(code)
  }
  return out
}

/**
 * Gate G round-N thoả (DESIGN_C1 2.2c): mọi gateCode g —
 *   - round 0 → done-set round-0 (y hệt hành vi cũ);
 *   - g ∈ subgraph round-N → cần task round-N của g resolved (doneN);
 *   - g là tổ tiên (ngoài subgraph) → kế thừa round-0 (done0).
 */
export function satisfiedForRound(
  gateCodes: string[],
  reached: Set<string>,
  doneN: Set<string>,
  done0: Set<string>,
  round: number,
): boolean {
  return (gateCodes || []).every((g) => {
    if (round === 0) return doneN.has(g)
    if (reached.has(g)) return doneN.has(g)
    return done0.has(g)
  })
}
