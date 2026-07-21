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
  materialQuerySchema,
  addAliasSchema,
  quickCreateMaterialSchema,
  mergeMaterialsSchema,
  promoteMaterialSchema,
  resolveBatchSchema,
  type CreateMaterialInput,
  type UpdateMaterialInput,
  type StockMovementInput,
  type MaterialQueryInput,
  type AddAliasInput,
  type QuickCreateMaterialInput,
  type MergeMaterialsInput,
  type PromoteMaterialInput,
  type ResolveBatchInput,
} from './material.schema'

// ── Procurement ──
export {
  createPurchaseRequestSchema,
  prListQuerySchema,
  prOriginTypeSchema,
  type PrListQuery,
  type PrOriginType,
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
  createWeldJointSchema,
  updateWeldJointSchema,
  type CreateWeldJointInput,
  type UpdateWeldJointInput,
  createPackingListSchema,
  type CreatePackingListInput,
  createShipmentSchema,
  updateShipmentSchema,
  type CreateShipmentInput,
  type UpdateShipmentInput,
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
  updateCheckpointSchema,
  type UpdateCheckpointInput,
  updateNcrActionSchema,
  type UpdateNcrActionInput,
  renewCertificateSchema,
  type RenewCertificateInput,
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
  bomVersionLineSchema,
  replaceBomVersionLinesSchema,
  ECO_SOURCES,
  ECO_COST_BEARERS,
  type EcoSource,
  type EcoCostBearer,
  type CreateDrawingInput,
  type UpdateDrawingInput,
  type CreateDrawingRevisionInput,
  type DrawingTransitionInput,
  type CreateBomInput,
  type UpdateBomInput,
  type CreateEcoInput,
  type UpdateEcoInput,
  type BomVersionLineInput,
  type ReplaceBomVersionLinesInput,
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
  createReceiptSchema,
  createBudgetSchema,
  updateBudgetSchema,
  createCashflowSchema,
  updateCashflowSchema,
  type CreateInvoiceInput,
  type UpdateInvoiceInput,
  type CreatePaymentInput,
  type CreateReceiptInput,
  type CreateBudgetInput,
  type UpdateBudgetInput,
  type CreateCashflowInput,
  type UpdateCashflowInput,
} from './finance.schema'

// ── Dynamic Workflow (Phase 1) ──
export {
  createTaskSchema,
  updateTaskSchema,
  returnTaskSchema,
  completeWorkTaskSchema,
  reassignTaskSchema,
  changeRequestSchema,
  resolveChangeRequestSchema,
  commentSchema,
  inboxQuerySchema,
  createMeetingSchema,
  respondMeetingSchema,
  closeMeetingSchema,
  type CreateTaskInput,
  type ReturnTaskInput,
  type CompleteWorkTaskInput,
  type ReassignTaskInput,
  type ChangeRequestInput,
  type ResolveChangeRequestInput,
  type CommentInput,
  type InboxQueryInput,
} from './work.schema'

// ── TBCG + HSE ──
export {
  createEquipmentSchema,
  updateEquipmentSchema,
  createMaintenanceSchema,
  updateMaintenanceSchema,
  createAssignmentSchema,
  createWorkPermitSchema,
  updateWorkPermitSchema,
  updateIncidentSchema,
  upsertManHoursSchema,
  createToolboxTalkSchema,
  type CreateEquipmentInput,
  type UpdateEquipmentInput,
  type CreateMaintenanceInput,
  type UpdateMaintenanceInput,
  type CreateAssignmentInput,
  type CreateWorkPermitInput,
  type UpdateWorkPermitInput,
  type UpdateIncidentInput,
  type CreateToolboxTalkInput,
} from './tbcg-hse.schema'
