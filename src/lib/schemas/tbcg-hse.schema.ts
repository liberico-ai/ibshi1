import { z } from 'zod'

// ── Equipment ──
export const createEquipmentSchema = z.object({
  name: z.string().min(1),
  category: z.enum(['CRANE', 'WELDING_MACHINE', 'CUTTING_MACHINE', 'COMPRESSOR', 'GENERATOR', 'VEHICLE', 'SCAFFOLD', 'OTHER']).default('OTHER'),
  model: z.string().optional(),
  serialNo: z.string().optional(),
  manufacturer: z.string().optional(),
  location: z.string().optional(),
  departmentId: z.string().optional(),
  purchaseDate: z.string().optional(),
  inspectionDue: z.string().optional(),
  notes: z.string().optional(),
})
export type CreateEquipmentInput = z.infer<typeof createEquipmentSchema>

export const updateEquipmentSchema = z.object({
  name: z.string().min(1).optional(),
  category: z.string().optional(),
  status: z.enum(['AVAILABLE', 'IN_USE', 'MAINTENANCE', 'RETIRED']).optional(),
  condition: z.enum(['GOOD', 'FAIR', 'POOR', 'BROKEN']).optional(),
  location: z.string().optional(),
  departmentId: z.string().optional(),
  inspectionDue: z.string().optional(),
  lastInspection: z.string().optional(),
  notes: z.string().optional(),
})
export type UpdateEquipmentInput = z.infer<typeof updateEquipmentSchema>

// ── Maintenance ──
export const createMaintenanceSchema = z.object({
  equipmentId: z.string().min(1),
  type: z.enum(['PREVENTIVE', 'BREAKDOWN', 'INSPECTION']).default('PREVENTIVE'),
  description: z.string().min(1),
  scheduledDate: z.string().optional(),
  cost: z.number().min(0).optional(),
  notes: z.string().optional(),
})
export type CreateMaintenanceInput = z.infer<typeof createMaintenanceSchema>

export const updateMaintenanceSchema = z.object({
  status: z.enum(['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']).optional(),
  completedDate: z.string().optional(),
  cost: z.number().min(0).optional(),
  performedBy: z.string().optional(),
  notes: z.string().optional(),
})
export type UpdateMaintenanceInput = z.infer<typeof updateMaintenanceSchema>

// ── Equipment Assignment ──
export const createAssignmentSchema = z.object({
  equipmentId: z.string().min(1),
  workOrderId: z.string().optional(),
  departmentId: z.string().optional(),
  assignedTo: z.string().optional(),
  notes: z.string().optional(),
})
export type CreateAssignmentInput = z.infer<typeof createAssignmentSchema>

// ── Work Permit ──
export const createWorkPermitSchema = z.object({
  permitType: z.enum(['HOT_WORK', 'HEIGHT_WORK', 'CONFINED_SPACE', 'ELECTRICAL', 'EXCAVATION', 'OTHER']).default('HOT_WORK'),
  projectId: z.string().optional(),
  workOrderId: z.string().optional(),
  location: z.string().optional(),
  description: z.string().min(1),
  hazards: z.string().optional(),
  precautions: z.string().optional(),
  validFrom: z.string().min(1),
  validTo: z.string().min(1),
  notes: z.string().optional(),
})
export type CreateWorkPermitInput = z.infer<typeof createWorkPermitSchema>

export const updateWorkPermitSchema = z.object({
  status: z.enum(['DRAFT', 'PENDING', 'APPROVED', 'ACTIVE', 'CLOSED', 'REJECTED']).optional(),
  approvedBy: z.string().optional(),
  closedBy: z.string().optional(),
  notes: z.string().optional(),
})
export type UpdateWorkPermitInput = z.infer<typeof updateWorkPermitSchema>

// ── Incident (enhanced SafetyIncident) ──
export const updateIncidentSchema = z.object({
  status: z.enum(['OPEN', 'INVESTIGATING', 'ACTION_TAKEN', 'CLOSED']).optional(),
  rootCause: z.string().optional(),
  correctiveAction: z.string().optional(),
  investigatedBy: z.string().optional(),
  lostTimeDays: z.number().int().min(0).optional(),
  recordable: z.boolean().optional(),
  notes: z.string().optional(),
})
export type UpdateIncidentInput = z.infer<typeof updateIncidentSchema>

export const upsertManHoursSchema = z.object({
  periodYear: z.number().int().min(2020).max(2099),
  periodMonth: z.number().int().min(1).max(12),
  projectId: z.string().optional(),
  manHours: z.number().min(0),
  note: z.string().optional(),
})
export type UpsertManHoursInput = z.infer<typeof upsertManHoursSchema>

// ── Toolbox Talk ──
export const createToolboxTalkSchema = z.object({
  departmentId: z.string().optional(),
  talkDate: z.string().min(1),
  topic: z.string().min(1),
  content: z.string().optional(),
  attendees: z.number().int().positive(),
  notes: z.string().optional(),
})
export type CreateToolboxTalkInput = z.infer<typeof createToolboxTalkSchema>
