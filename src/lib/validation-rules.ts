import prisma from './db'

// ── TC Validation Rules (BRD Business Rules) ──
// Each rule returns { valid, errors[], warnings[] }
// Errors block task completion; Warnings are logged but non-blocking

export interface ValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

const EMPTY_OK: ValidationResult = { valid: true, errors: [], warnings: [] }

// ── TC-02-03: BOM Consistency Check ──
// Compare engineering BOM quantities with contract BOM. Warn if diff > 0.01kg
async function validateBOMConsistency(
  projectId: string,
  resultData?: Record<string, unknown>
): Promise<ValidationResult> {
  const warnings: string[] = []

  // Check if BOM data references are present via BomItem → BillOfMaterial
  const bomItems = await prisma.bomItem.findMany({
    where: { bom: { projectId } },
    include: { material: { select: { materialCode: true, unit: true } } },
  })

  if (bomItems.length === 0) {
    warnings.push('TC-02-03: Không tìm thấy BOM cho dự án. Kiểm tra lại.')
  }

  // Check for contract BOM comparison if provided
  const contractBOM = resultData?.contractBOM as Record<string, number> | undefined
  if (contractBOM && bomItems.length > 0) {
    for (const item of bomItems) {
      const contractQty = contractBOM[item.material.materialCode]
      if (contractQty && Math.abs(Number(item.quantity) - contractQty) > 0.01) {
        warnings.push(
          `TC-02-03: ${item.material.materialCode} chênh lệch BOM: thiết kế ${item.quantity} vs HĐ ${contractQty} ${item.material.unit}`
        )
      }
    }
  }

  return { valid: true, errors: [], warnings }
}

// ── TC-02-05: IFC Stamp Validation ──
// Require IFC stamp confirmation before drawing release
async function validateIFCStamp(
  _projectId: string,
  resultData?: Record<string, unknown>
): Promise<ValidationResult> {
  const checklist = resultData?.checklist as Record<string, boolean> | undefined
  if (!checklist?.ifc_stamped) {
    return {
      valid: false,
      errors: ['TC-02-05: Bản vẽ chưa có dấu IFC (Issued For Construction). Bắt buộc phải xác nhận IFC stamp.'],
      warnings: [],
    }
  }
  return EMPTY_OK
}

// ── TC-03-04: Minimum 3 Supplier Quotes ──
// Enforce at least 3 independent supplier quotes
async function validateMinQuotes(
  _projectId: string,
  resultData?: Record<string, unknown>
): Promise<ValidationResult> {
  const rfqCount = resultData?.rfqCount as number | undefined
  const checklist = resultData?.checklist as Record<string, boolean> | undefined

  // Check stock_sufficient flag — if stock is sufficient, no quotes needed
  if (checklist?.stock_sufficient) {
    return { valid: true, errors: [], warnings: ['TC-03-04: Tồn kho đủ — bỏ qua yêu cầu 3 báo giá.'] }
  }

  if (rfqCount !== undefined && rfqCount < 3) {
    return {
      valid: false,
      errors: [`TC-03-04: Cần tối thiểu 3 báo giá NCC. Hiện có: ${rfqCount}`],
      warnings: [],
    }
  }

  if (rfqCount === undefined) {
    return { valid: true, errors: [], warnings: ['TC-03-04: Không xác định được số báo giá. Kiểm tra lại rfqCount.'] }
  }

  return EMPTY_OK
}

// ── TC-03-05: Budget Overrun Alert ──
// Compare PO total with budget estimate, warn if exceeded
async function validateBudgetOverrun(
  projectId: string,
  resultData?: Record<string, unknown>
): Promise<ValidationResult> {
  const warnings: string[] = []

  // Get budget estimate from P1.2 step
  const budgetTask = await prisma.workflowTask.findFirst({
    where: { projectId, stepCode: 'P1.2', status: 'DONE' },
    select: { resultData: true },
  })

  const budgetData = budgetTask?.resultData as Record<string, unknown> | null
  const totalEstimate = budgetData?.totalEstimate as number | undefined
  const poTotal = resultData?.poTotalValue as number | undefined

  if (totalEstimate && poTotal && poTotal > totalEstimate) {
    const overrunPct = ((poTotal - totalEstimate) / totalEstimate * 100).toFixed(1)
    warnings.push(
      `TC-03-05: ⚠️ VƯỢT NGÂN SÁCH! PO: ${poTotal.toLocaleString()}đ > Dự toán: ${totalEstimate.toLocaleString()}đ (+${overrunPct}%). Cần BGĐ phê duyệt.`
    )
  }

  return { valid: true, errors: [], warnings }
}

// ── TC-03-06: PO Value Gate (>50M VND) ──
// PO exceeding 50M requires Board approval
async function validatePOValueGate(
  _projectId: string,
  resultData?: Record<string, unknown>
): Promise<ValidationResult> {
  const PO_THRESHOLD = 50_000_000 // 50M VND
  const poTotal = resultData?.poTotalValue as number | undefined
  const checklist = resultData?.checklist as Record<string, boolean> | undefined

  if (poTotal && poTotal > PO_THRESHOLD && !checklist?.bgd_approved) {
    return {
      valid: false,
      errors: [
        `TC-03-06: PO ${poTotal.toLocaleString()}đ vượt ngưỡng 50.000.000đ. Bắt buộc BGĐ phê duyệt (tick "BGĐ đã phê duyệt").`
      ],
      warnings: [],
    }
  }

  return EMPTY_OK
}

// ── TC-04-02: LSX must link to BOM ──
// Work Orders must be linked to project BOM
async function validateLSXBOMLink(
  _projectId: string,
  resultData?: Record<string, unknown>
): Promise<ValidationResult> {
  const bomId = resultData?.bomId as string | undefined
  const bomLinked = resultData?.bomLinked as boolean | undefined
  const checklist = resultData?.checklist as Record<string, boolean> | undefined

  if (!bomId && !bomLinked && !checklist?.bom_linked) {
    return {
      valid: false,
      errors: ['TC-04-02: Lệnh SX phải gắn liên kết với BOM dự án. Xác nhận bomId hoặc tick "Đã liên kết BOM".'],
      warnings: [],
    }
  }

  return EMPTY_OK
}

// ── TC-05-01: 3-Way Shipping Sign-off ──
// Requires confirmation from Production, Transport, and PM
async function validateShippingSignoff(
  _projectId: string,
  resultData?: Record<string, unknown>
): Promise<ValidationResult> {
  const checklist = resultData?.checklist as Record<string, boolean> | undefined
  const missing: string[] = []

  if (!checklist?.signoff_production) missing.push('Sản xuất (R07)')
  if (!checklist?.signoff_transport) missing.push('Vận tải')
  if (!checklist?.signoff_pm) missing.push('PM (R02)')

  if (missing.length > 0) {
    return {
      valid: false,
      errors: [`TC-05-01: Thiếu xác nhận giao hàng từ: ${missing.join(', ')}. Cần 3-way sign-off.`],
      warnings: [],
    }
  }

  return EMPTY_OK
}

// ── TC-05-02: Proof of Delivery ──
// Requires at least one attachment confirming client receipt
async function validateProofOfDelivery(
  _projectId: string,
  resultData?: Record<string, unknown>
): Promise<ValidationResult> {
  const attachments = resultData?.attachments as Record<string, string> | undefined
  const hasProof = attachments && Object.keys(attachments).length > 0

  if (!hasProof) {
    const checklist = resultData?.checklist as Record<string, boolean> | undefined
    if (!checklist?.delivery_proof_attached) {
      return {
        valid: false,
        errors: ['TC-05-02: Chưa đính kèm bằng chứng giao hàng cho khách. Đính kèm file hoặc tick xác nhận.'],
        warnings: [],
      }
    }
  }

  return EMPTY_OK
}

// ── Rule Registry: maps step codes to their validation functions ──

const STEP_VALIDATION_MAP: Record<string, (projectId: string, resultData?: Record<string, unknown>) => Promise<ValidationResult>> = {
  'P2.1': validateBOMConsistency,   // TC-02-03
  // TC-02-05: IFC stamp — applies when P2.1 includes IFC release
  'P3.5': validateMinQuotes,        // TC-03-04
  'P3.7': async (projectId, resultData) => {
    // Run both TC-03-05 and TC-03-06 at PO finalization
    const r1 = await validateBudgetOverrun(projectId, resultData)
    const r2 = await validatePOValueGate(projectId, resultData)
    return {
      valid: r1.valid && r2.valid,
      errors: [...r1.errors, ...r2.errors],
      warnings: [...r1.warnings, ...r2.warnings],
    }
  },
  'P3.4': validateLSXBOMLink,       // TC-04-02
  // 'P5.5': validateShippingSignoff,  // TC-05-01 removed — P5.5 is salary calculation, not shipping
  // 'P6.1': validateProofOfDelivery,  // TC-05-02 removed — P6.1 is QC dossier, not delivery proof
}

// ── Main Entry Point ──

export async function runValidationRules(
  stepCode: string,
  resultData: Record<string, unknown> | undefined,
  projectId: string
): Promise<ValidationResult> {
  const validator = STEP_VALIDATION_MAP[stepCode]
  if (!validator) return EMPTY_OK

  try {
    const result = await validator(projectId, resultData)
    // Log warnings for observability
    if (result.warnings.length > 0) {
      console.log(`[TC VALIDATION] ${stepCode}: ${result.warnings.join(' | ')}`)
    }
    if (result.errors.length > 0) {
      console.warn(`[TC VALIDATION BLOCKED] ${stepCode}: ${result.errors.join(' | ')}`)
    }
    return result
  } catch (err) {
    // Validation should not block task completion on unexpected errors
    console.error(`[TC VALIDATION ERROR] ${stepCode}:`, err)
    return EMPTY_OK
  }
}
