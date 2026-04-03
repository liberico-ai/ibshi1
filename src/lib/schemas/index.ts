// ── Common ──
export {
  paginationSchema,
  idParamSchema,
  dateRangeSchema,
  sortOrderSchema,
  searchFilterSchema,
  optionalString,
  optionalNumber,
  type PaginationInput,
  type IdParam,
  type DateRangeInput,
  type SortOrder,
  type SearchFilterInput,
} from './common.schema'

// ── Auth ──
export { loginSchema, type LoginInput } from './auth.schema'

// ── User ──
export {
  createUserSchema,
  updateUserSchema,
  type CreateUserInput,
  type UpdateUserInput,
} from './user.schema'

// ── Project ──
export {
  projectListQuerySchema,
  createProjectSchema,
  updateProjectSchema,
  type ProjectListQuery,
  type CreateProjectInput,
  type UpdateProjectInput,
} from './project.schema'

// ── Task ──
export {
  rejectTaskSchema,
  taskCommentSchema,
  completeTaskSchema,
  activateTasksSchema,
  type RejectTaskInput,
  type TaskCommentInput,
  type CompleteTaskInput,
  type ActivateTasksInput,
} from './task.schema'

// ── Material ──
export {
  createMaterialSchema,
  updateMaterialSchema,
  stockMovementSchema,
  type CreateMaterialInput,
  type UpdateMaterialInput,
  type StockMovementInput,
} from './material.schema'

// ── Procurement ──
export {
  createPurchaseRequestSchema,
  createPurchaseOrderSchema,
  convertPrToPoSchema,
  createGrnSchema,
  createVendorSchema,
  updateVendorSchema,
  type CreatePurchaseRequestInput,
  type CreatePurchaseOrderInput,
  type ConvertPrToPoInput,
  type CreateGrnInput,
  type CreateVendorInput,
  type UpdateVendorInput,
} from './procurement.schema'

// ── Production ──
export {
  createWorkOrderSchema,
  updateWorkOrderSchema,
  createJobCardSchema,
  updateJobCardSchema,
  createMaterialIssueSchema,
  createWorkshopSchema,
  createDeliverySchema,
  updateDeliverySchema,
  type CreateWorkOrderInput,
  type UpdateWorkOrderInput,
  type CreateJobCardInput,
  type UpdateJobCardInput,
  type CreateMaterialIssueInput,
  type CreateWorkshopInput,
  type CreateDeliveryInput,
  type UpdateDeliveryInput,
} from './production.schema'

// ── QC ──
export {
  inspectionListQuerySchema,
  createInspectionSchema,
  updateInspectionSchema,
  createItpSchema,
  createNcrSchema,
  updateNcrSchema,
  createNcrActionSchema,
  createCertificateSchema,
  createMillCertSchema,
  type InspectionListQuery,
  type CreateInspectionInput,
  type UpdateInspectionInput,
  type CreateItpInput,
  type CreateNcrInput,
  type UpdateNcrInput,
  type CreateNcrActionInput,
  type CreateCertificateInput,
  type CreateMillCertInput,
} from './qc.schema'

// ── Design ──
export {
  createDrawingSchema,
  updateDrawingSchema,
  createDrawingRevisionSchema,
  drawingTransitionSchema,
  createBomSchema,
  updateBomSchema,
  createEcoSchema,
  updateEcoSchema,
  type CreateDrawingInput,
  type UpdateDrawingInput,
  type CreateDrawingRevisionInput,
  type DrawingTransitionInput,
  type CreateBomInput,
  type UpdateBomInput,
  type CreateEcoInput,
  type UpdateEcoInput,
} from './design.schema'

// ── HR ──
export {
  employeeListQuerySchema,
  createEmployeeSchema,
  updateEmployeeSchema,
  recordAttendanceSchema,
  bulkAttendanceSchema,
  salaryCalcSchema,
  createContractSchema,
  updateContractSchema,
  createPieceRateContractSchema,
  createPieceRateOutputSchema,
  createTimesheetSchema,
  type EmployeeListQuery,
  type CreateEmployeeInput,
  type UpdateEmployeeInput,
  type RecordAttendanceInput,
  type BulkAttendanceInput,
  type SalaryCalcInput,
  type CreateContractInput,
  type UpdateContractInput,
  type CreatePieceRateContractInput,
  type CreatePieceRateOutputInput,
  type CreateTimesheetInput,
} from './hr.schema'

// ── Finance ──
export {
  createInvoiceSchema,
  updateInvoiceSchema,
  createPaymentSchema,
  createBudgetSchema,
  updateBudgetSchema,
  createCashflowSchema,
  updateCashflowSchema,
  type CreateInvoiceInput,
  type UpdateInvoiceInput,
  type CreatePaymentInput,
  type CreateBudgetInput,
  type UpdateBudgetInput,
  type CreateCashflowInput,
  type UpdateCashflowInput,
} from './finance.schema'
