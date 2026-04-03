import { createSchema } from 'zod-openapi'
import { z } from 'zod'
import {
  loginSchema,
  createUserSchema,
  updateUserSchema,
  projectListQuerySchema,
  createProjectSchema,
  updateProjectSchema,
  rejectTaskSchema,
  taskCommentSchema,
  completeTaskSchema,
  activateTasksSchema,
  createMaterialSchema,
  stockMovementSchema,
  createPurchaseRequestSchema,
  createPurchaseOrderSchema,
  convertPrToPoSchema,
  createGrnSchema,
  createVendorSchema,
  createWorkOrderSchema,
  updateWorkOrderSchema,
  createJobCardSchema,
  createMaterialIssueSchema,
  createWorkshopSchema,
  createDeliverySchema,
  createInspectionSchema,
  updateInspectionSchema,
  createItpSchema,
  createNcrSchema,
  createCertificateSchema,
  createMillCertSchema,
  createDrawingSchema,
  drawingTransitionSchema,
  createBomSchema,
  createEcoSchema,
  createEmployeeSchema,
  recordAttendanceSchema,
  salaryCalcSchema,
  createContractSchema,
  createTimesheetSchema,
  createPieceRateContractSchema,
  createPieceRateOutputSchema,
  createInvoiceSchema,
  createPaymentSchema,
  createBudgetSchema,
  createCashflowSchema,
  searchFilterSchema,
  paginationSchema,
} from '@/lib/schemas'

// Convert Zod schema to JSON Schema object
function toJsonSchema(schema: z.ZodType) {
  return createSchema(schema).schema
}

// ── Helpers ──
function jsonBody(schema: z.ZodType, description: string) {
  return { content: { 'application/json': { schema: toJsonSchema(schema) } }, description }
}

const errResp = {
  description: 'Error response',
  content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean', example: false }, error: { type: 'string' } } } } },
}

const okResp = (desc: string) => ({
  description: desc,
  content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean', example: true }, data: { type: 'object' }, message: { type: 'string' } } } } },
})

function idPath(name = 'id') {
  return { in: 'path', name, required: true, schema: { type: 'string' } }
}

function queryParams(schema: z.ZodType) {
  return { in: 'query', name: 'params', schema: toJsonSchema(schema) }
}

// ── OpenAPI 3.1 Spec ──
export function generateOpenApiSpec() {
  return {
    openapi: '3.1.0',
    info: {
      title: 'IBS ERP API',
      version: '0.1.0',
      description: 'Internal Business System - Enterprise Resource Planning API. Manages projects, tasks, materials, procurement, production, QC, HR, and finance for industrial/manufacturing operations.',
    },
    servers: [{ url: '/', description: 'Current server' }],
    security: [{ bearerAuth: [] }],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'JWT from POST /api/auth/login' },
      },
    },
    tags: [
      { name: 'Auth', description: 'Authentication' },
      { name: 'Users', description: 'User management' },
      { name: 'Dashboard', description: 'Dashboard & analytics' },
      { name: 'Projects', description: 'Project management' },
      { name: 'Tasks', description: 'Workflow tasks' },
      { name: 'Warehouse', description: 'Materials & stock' },
      { name: 'Procurement', description: 'PR, PO, GRN, vendors' },
      { name: 'Production', description: 'Work orders, job cards, delivery' },
      { name: 'QC', description: 'Inspections, ITP, NCR, certificates' },
      { name: 'Design', description: 'Drawings, BOM, ECO' },
      { name: 'HR', description: 'Employees, attendance, salary, contracts' },
      { name: 'Finance', description: 'Invoices, payments, budgets, cashflow' },
      { name: 'Admin', description: 'Admin stats & audit logs' },
      { name: 'System', description: 'Health check & system endpoints' },
    ],
    paths: {
      // ── Auth ──
      '/api/auth/login': {
        post: { tags: ['Auth'], summary: 'Login', security: [], requestBody: jsonBody(loginSchema, 'Credentials'), responses: { '200': okResp('JWT token'), '401': errResp } },
      },
      '/api/auth/me': {
        get: { tags: ['Auth'], summary: 'Current user', responses: { '200': okResp('User profile') } },
      },

      // ── Users ──
      '/api/users': {
        get: { tags: ['Users'], summary: 'List users', parameters: [queryParams(searchFilterSchema)], responses: { '200': okResp('Users') } },
        post: { tags: ['Users'], summary: 'Create user', requestBody: jsonBody(createUserSchema, 'User'), responses: { '201': okResp('Created'), '400': errResp } },
      },
      '/api/users/{id}': {
        get: { tags: ['Users'], summary: 'Get user', parameters: [idPath()], responses: { '200': okResp('User'), '404': errResp } },
        put: { tags: ['Users'], summary: 'Update user', parameters: [idPath()], requestBody: jsonBody(updateUserSchema, 'Updates'), responses: { '200': okResp('Updated') } },
      },
      '/api/users/{id}/reset-password': {
        post: { tags: ['Users'], summary: 'Reset password', parameters: [idPath()], responses: { '200': okResp('Reset') } },
      },

      // ── Dashboard ──
      '/api/dashboard': { get: { tags: ['Dashboard'], summary: 'Overview stats', responses: { '200': okResp('Stats') } } },
      '/api/dashboard/role': { get: { tags: ['Dashboard'], summary: 'Role widgets', responses: { '200': okResp('Widgets') } } },

      // ── Projects ──
      '/api/projects': {
        get: { tags: ['Projects'], summary: 'List projects', parameters: [queryParams(projectListQuerySchema)], responses: { '200': okResp('Projects') } },
        post: { tags: ['Projects'], summary: 'Create project', requestBody: jsonBody(createProjectSchema, 'Project'), responses: { '201': okResp('Created'), '400': errResp } },
      },
      '/api/projects/{id}': {
        get: { tags: ['Projects'], summary: 'Project details', parameters: [idPath()], responses: { '200': okResp('Project'), '404': errResp } },
        put: { tags: ['Projects'], summary: 'Update project', parameters: [idPath()], requestBody: jsonBody(updateProjectSchema, 'Updates'), responses: { '200': okResp('Updated') } },
        post: { tags: ['Projects'], summary: 'Close project', parameters: [idPath()], responses: { '200': okResp('Closed') } },
      },

      // ── Tasks ──
      '/api/tasks': { get: { tags: ['Tasks'], summary: 'Task inbox', responses: { '200': okResp('Tasks by urgency') } } },
      '/api/tasks/activate': { post: { tags: ['Tasks'], summary: 'Activate tasks', requestBody: jsonBody(activateTasksSchema, 'Params'), responses: { '200': okResp('Activated') } } },
      '/api/tasks/{id}': {
        get: { tags: ['Tasks'], summary: 'Task details', parameters: [idPath()], responses: { '200': okResp('Task') } },
        put: { tags: ['Tasks'], summary: 'Complete task', parameters: [idPath()], requestBody: jsonBody(completeTaskSchema, 'Result data'), responses: { '200': okResp('Completed') } },
      },
      '/api/tasks/{id}/reject': { post: { tags: ['Tasks'], summary: 'Reject task', parameters: [idPath()], requestBody: jsonBody(rejectTaskSchema, 'Reason'), responses: { '200': okResp('Rejected') } } },
      '/api/tasks/{id}/comments': {
        get: { tags: ['Tasks'], summary: 'List comments', parameters: [idPath()], responses: { '200': okResp('Comments') } },
        post: { tags: ['Tasks'], summary: 'Add comment', parameters: [idPath()], requestBody: jsonBody(taskCommentSchema, 'Comment'), responses: { '201': okResp('Added') } },
      },
      '/api/tasks/{id}/history': { get: { tags: ['Tasks'], summary: 'Workflow history', parameters: [idPath()], responses: { '200': okResp('History') } } },

      // ── Warehouse ──
      '/api/materials': {
        get: { tags: ['Warehouse'], summary: 'List materials', parameters: [queryParams(searchFilterSchema)], responses: { '200': okResp('Materials') } },
        post: { tags: ['Warehouse'], summary: 'Create material', requestBody: jsonBody(createMaterialSchema, 'Material'), responses: { '201': okResp('Created') } },
      },
      '/api/stock-movements': {
        get: { tags: ['Warehouse'], summary: 'List movements', responses: { '200': okResp('Movements') } },
        post: { tags: ['Warehouse'], summary: 'Create movement', requestBody: jsonBody(stockMovementSchema, 'Movement'), responses: { '201': okResp('Created') } },
      },
      '/api/warehouse/stats': { get: { tags: ['Warehouse'], summary: 'Warehouse stats', responses: { '200': okResp('Stats') } } },
      '/api/warehouse/{id}': { get: { tags: ['Warehouse'], summary: 'Material detail', parameters: [idPath()], responses: { '200': okResp('Detail') } } },

      // ── Procurement ──
      '/api/purchase-requests': {
        get: { tags: ['Procurement'], summary: 'List PRs', parameters: [queryParams(searchFilterSchema)], responses: { '200': okResp('PRs') } },
        post: { tags: ['Procurement'], summary: 'Create PR', requestBody: jsonBody(createPurchaseRequestSchema, 'PR'), responses: { '201': okResp('Created') } },
      },
      '/api/purchase-requests/{id}/approve': { post: { tags: ['Procurement'], summary: 'Approve PR', parameters: [idPath()], responses: { '200': okResp('Approved') } } },
      '/api/purchase-orders': {
        get: { tags: ['Procurement'], summary: 'List POs', parameters: [queryParams(searchFilterSchema)], responses: { '200': okResp('POs') } },
        post: { tags: ['Procurement'], summary: 'Create PO', requestBody: jsonBody(createPurchaseOrderSchema, 'PO'), responses: { '201': okResp('Created') } },
      },
      '/api/purchase-orders/convert': { post: { tags: ['Procurement'], summary: 'Convert PR to PO', requestBody: jsonBody(convertPrToPoSchema, 'Conversion'), responses: { '201': okResp('Converted') } } },
      '/api/purchase-orders/{id}/approve': { post: { tags: ['Procurement'], summary: 'Approve PO', parameters: [idPath()], responses: { '200': okResp('Approved') } } },
      '/api/grn': { post: { tags: ['Procurement'], summary: 'Goods receipt', requestBody: jsonBody(createGrnSchema, 'GRN'), responses: { '201': okResp('Received') } } },
      '/api/vendors': {
        get: { tags: ['Procurement'], summary: 'List vendors', parameters: [queryParams(searchFilterSchema)], responses: { '200': okResp('Vendors') } },
        post: { tags: ['Procurement'], summary: 'Create vendor', requestBody: jsonBody(createVendorSchema, 'Vendor'), responses: { '201': okResp('Created') } },
      },

      // ── Production ──
      '/api/production': {
        get: { tags: ['Production'], summary: 'List work orders', parameters: [queryParams(searchFilterSchema)], responses: { '200': okResp('Work orders') } },
        post: { tags: ['Production'], summary: 'Create work order', requestBody: jsonBody(createWorkOrderSchema, 'WO'), responses: { '201': okResp('Created') } },
      },
      '/api/production/{id}': {
        get: { tags: ['Production'], summary: 'WO details', parameters: [idPath()], responses: { '200': okResp('WO') } },
        put: { tags: ['Production'], summary: 'Update WO', parameters: [idPath()], requestBody: jsonBody(updateWorkOrderSchema, 'Updates'), responses: { '200': okResp('Updated') } },
      },
      '/api/production/{id}/issue-material': { post: { tags: ['Production'], summary: 'Issue material', parameters: [idPath()], requestBody: jsonBody(createMaterialIssueSchema, 'Issue'), responses: { '200': okResp('Issued') } } },
      '/api/production/{id}/transition': { post: { tags: ['Production'], summary: 'Transition WO status', parameters: [idPath()], responses: { '200': okResp('Transitioned') } } },
      '/api/production/job-cards': { post: { tags: ['Production'], summary: 'Create job card', requestBody: jsonBody(createJobCardSchema, 'Card'), responses: { '201': okResp('Created') } } },
      '/api/workshops': { post: { tags: ['Production'], summary: 'Create workshop', requestBody: jsonBody(createWorkshopSchema, 'Workshop'), responses: { '201': okResp('Created') } } },
      '/api/delivery': { post: { tags: ['Production'], summary: 'Create delivery', requestBody: jsonBody(createDeliverySchema, 'Delivery'), responses: { '201': okResp('Created') } } },

      // ── QC ──
      '/api/qc': {
        get: { tags: ['QC'], summary: 'List inspections', parameters: [queryParams(searchFilterSchema)], responses: { '200': okResp('Inspections') } },
        post: { tags: ['QC'], summary: 'Create inspection', requestBody: jsonBody(createInspectionSchema, 'Inspection'), responses: { '201': okResp('Created') } },
      },
      '/api/qc/{id}': { patch: { tags: ['QC'], summary: 'Update inspection', parameters: [idPath()], requestBody: jsonBody(updateInspectionSchema, 'Updates'), responses: { '200': okResp('Updated') } } },
      '/api/qc/itp': { post: { tags: ['QC'], summary: 'Create ITP', requestBody: jsonBody(createItpSchema, 'ITP'), responses: { '201': okResp('Created') } } },
      '/api/qc/ncr': { post: { tags: ['QC'], summary: 'Create NCR', requestBody: jsonBody(createNcrSchema, 'NCR'), responses: { '201': okResp('Created') } } },
      '/api/qc/certificates': { post: { tags: ['QC'], summary: 'Create certificate', requestBody: jsonBody(createCertificateSchema, 'Cert'), responses: { '201': okResp('Created') } } },
      '/api/mill-certificates': { post: { tags: ['QC'], summary: 'Create mill cert', requestBody: jsonBody(createMillCertSchema, 'Mill cert'), responses: { '201': okResp('Created') } } },

      // ── Design ──
      '/api/design': {
        get: { tags: ['Design'], summary: 'List drawings', parameters: [queryParams(searchFilterSchema)], responses: { '200': okResp('Drawings') } },
        post: { tags: ['Design'], summary: 'Create drawing', requestBody: jsonBody(createDrawingSchema, 'Drawing'), responses: { '201': okResp('Created') } },
      },
      '/api/design/bom': { post: { tags: ['Design'], summary: 'Create BOM', requestBody: jsonBody(createBomSchema, 'BOM'), responses: { '201': okResp('Created') } } },
      '/api/design/eco': { post: { tags: ['Design'], summary: 'Create ECO', requestBody: jsonBody(createEcoSchema, 'ECO'), responses: { '201': okResp('Created') } } },
      '/api/drawings/{id}/transition': { post: { tags: ['Design'], summary: 'Transition drawing', parameters: [idPath()], requestBody: jsonBody(drawingTransitionSchema, 'Transition'), responses: { '200': okResp('Transitioned') } } },

      // ── HR ──
      '/api/hr/employees': {
        get: { tags: ['HR'], summary: 'List employees', parameters: [queryParams(searchFilterSchema)], responses: { '200': okResp('Employees') } },
        post: { tags: ['HR'], summary: 'Create employee', requestBody: jsonBody(createEmployeeSchema, 'Employee'), responses: { '201': okResp('Created') } },
      },
      '/api/hr/attendance': { post: { tags: ['HR'], summary: 'Record attendance', requestBody: jsonBody(recordAttendanceSchema, 'Attendance'), responses: { '201': okResp('Recorded') } } },
      '/api/hr/salary/calculate': { post: { tags: ['HR'], summary: 'Calculate salary', requestBody: jsonBody(salaryCalcSchema, 'Params'), responses: { '200': okResp('Salary result') } } },
      '/api/hr/contracts': { post: { tags: ['HR'], summary: 'Create contract', requestBody: jsonBody(createContractSchema, 'Contract'), responses: { '201': okResp('Created') } } },
      '/api/hr/timesheets': { post: { tags: ['HR'], summary: 'Create timesheet', requestBody: jsonBody(createTimesheetSchema, 'Timesheet'), responses: { '201': okResp('Created') } } },
      '/api/hr/piece-rate-contracts': { post: { tags: ['HR'], summary: 'Create piece-rate contract', requestBody: jsonBody(createPieceRateContractSchema, 'Contract'), responses: { '201': okResp('Created') } } },
      '/api/hr/piece-rate-output': { post: { tags: ['HR'], summary: 'Record output', requestBody: jsonBody(createPieceRateOutputSchema, 'Output'), responses: { '201': okResp('Recorded') } } },

      // ── Finance ──
      '/api/finance/invoices': {
        get: { tags: ['Finance'], summary: 'List invoices', parameters: [queryParams(searchFilterSchema)], responses: { '200': okResp('Invoices') } },
        post: { tags: ['Finance'], summary: 'Create invoice', requestBody: jsonBody(createInvoiceSchema, 'Invoice'), responses: { '201': okResp('Created') } },
      },
      '/api/finance/payments': { post: { tags: ['Finance'], summary: 'Create payment', requestBody: jsonBody(createPaymentSchema, 'Payment'), responses: { '201': okResp('Created') } } },
      '/api/finance/budgets': {
        get: { tags: ['Finance'], summary: 'List budgets', parameters: [queryParams(searchFilterSchema)], responses: { '200': okResp('Budgets') } },
        post: { tags: ['Finance'], summary: 'Upsert budget', requestBody: jsonBody(createBudgetSchema, 'Budget'), responses: { '200': okResp('Upserted') } },
      },
      '/api/finance/cashflow-entries': { post: { tags: ['Finance'], summary: 'Create cashflow entry', requestBody: jsonBody(createCashflowSchema, 'Entry'), responses: { '201': okResp('Created') } } },

      // ── Admin ──
      '/api/admin/stats': { get: { tags: ['Admin'], summary: 'Admin stats', responses: { '200': okResp('Stats') } } },
      '/api/admin/audit-logs': { get: { tags: ['Admin'], summary: 'Audit logs', parameters: [queryParams(paginationSchema)], responses: { '200': okResp('Logs') } } },

      // ── System ──
      '/api/health': {
        get: {
          tags: ['System'], summary: 'Health check', security: [],
          responses: { '200': okResp('Healthy'), '503': errResp },
        },
      },
    },
  }
}
