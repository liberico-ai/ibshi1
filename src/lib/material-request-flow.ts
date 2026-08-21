import prisma from './db'
import { MR_STATUS } from './wo-materials'

// Thông báo + việc trong Hộp việc cho luồng duyệt phiếu đề nghị cấp vật tư.
//
// Mỗi chặng chờ duyệt sinh 1 task loại MR-PM / MR-BOD giao đúng người; mở task ở tab Công việc
// sẽ thấy thẻ "Mở tab Duyệt cấp vật tư →" (khai trong notify-tasks.ts). Duyệt/trả lại xong thì
// task tự đóng, không đọng trong hộp việc.

export const MR_TASK_PM = 'MR-PM'
export const MR_TASK_BOD = 'MR-BOD'

const APPROVAL_PATH = '/dashboard/production/material-approval'

async function orderBrief(orderId: string) {
  return prisma.materialRequestOrder.findUnique({
    where: { id: orderId },
    select: {
      id: true, code: true, projectId: true, createdBy: true,
      project: { select: { projectCode: true, projectName: true, pmUserId: true } },
      department: { select: { code: true, name: true } },
      _count: { select: { items: true } },
    },
  })
}

/** Đóng các task duyệt đang mở của phiếu (khi đã duyệt/trả lại/gửi lại). */
export async function closeMaterialRequestTasks(orderId: string, byUserId: string, types?: string[]) {
  await prisma.task.updateMany({
    where: {
      taskType: { in: types || [MR_TASK_PM, MR_TASK_BOD] },
      externalRef: { startsWith: `MR:${orderId}:` },
      status: { notIn: ['DONE', 'CANCELLED'] },
    },
    data: { status: 'DONE', completedAt: new Date(), completedBy: byUserId },
  })
}

/** Tạo task duyệt + thông báo chuông cho một người cụ thể. */
async function openApprovalTask(opts: {
  orderId: string; code: string; projectId: string; taskType: string
  userId: string; role: string; title: string; message: string; byUserId: string
}) {
  const externalRef = `MR:${opts.orderId}:${opts.taskType}`
  const existing = await prisma.task.findFirst({ where: { externalRef }, select: { id: true, status: true } })
  const task = existing
    ? await prisma.task.update({
        where: { id: existing.id },
        data: { status: 'IN_PROGRESS', completedAt: null, completedBy: null },
      })
    : await prisma.task.create({
        data: {
          projectId: opts.projectId, level: 2, taskType: opts.taskType, title: opts.title,
          priority: 'NORMAL', createdBy: 'SYSTEM', assignedAt: new Date(),
          status: 'IN_PROGRESS', startedAt: new Date(), externalRef,
          resultData: { materialRequestId: opts.orderId, code: opts.code },
        },
      })

  const hasAssignee = await prisma.taskAssignee.findFirst({ where: { taskId: task.id, userId: opts.userId } })
  if (!hasAssignee) {
    await prisma.taskAssignee.create({ data: { taskId: task.id, userId: opts.userId, role: opts.role, isPrimary: true } })
  }

  await prisma.notification.create({
    data: {
      userId: opts.userId, title: opts.title, message: opts.message,
      type: 'task_assigned', linkUrl: `/dashboard/work/${task.id}`,
    },
  }).catch(() => {})

  return task
}

/** Xưởng gửi phiếu → PM phụ trách dự án duyệt. */
export async function notifyMaterialRequestSubmitted(orderId: string, byUserId: string) {
  const o = await orderBrief(orderId)
  if (!o) return
  // PM phụ trách dự án; dự án chưa gán PM thì rơi về trưởng phòng Dự án (R02) đầu tiên.
  const pmId = o.project.pmUserId
    || (await prisma.user.findFirst({ where: { roleCode: 'R02', isActive: true }, select: { id: true } }))?.id
  if (!pmId) return

  await closeMaterialRequestTasks(orderId, byUserId, [MR_TASK_BOD])
  await openApprovalTask({
    orderId, code: o.code, projectId: o.projectId, taskType: MR_TASK_PM,
    userId: pmId, role: 'R02', byUserId,
    title: `Duyệt cấp vật tư: ${o.code}`,
    message: `${o.department?.name || 'Xưởng'} đề nghị cấp ${o._count.items} dòng vật tư — dự án ${o.project.projectCode}. Cần PM duyệt.`,
  })
}

/** PM duyệt xong → BGĐ duyệt. */
export async function notifyMaterialRequestPmApproved(orderId: string, byUserId: string) {
  const o = await orderBrief(orderId)
  if (!o) return
  await closeMaterialRequestTasks(orderId, byUserId, [MR_TASK_PM])

  const bods = await prisma.user.findMany({ where: { roleCode: 'R01', isActive: true }, select: { id: true } })
  for (const b of bods) {
    await openApprovalTask({
      orderId, code: o.code, projectId: o.projectId, taskType: MR_TASK_BOD,
      userId: b.id, role: 'R01', byUserId,
      title: `Duyệt cấp vật tư: ${o.code}`,
      message: `PM đã duyệt phiếu ${o.code} (${o._count.items} dòng) — dự án ${o.project.projectCode}. Chờ BGĐ duyệt.`,
    })
  }
}

/** Duyệt xong hoặc bị trả lại → báo lại người lập (xưởng) và dọn task duyệt. */
export async function notifyMaterialRequestClosed(orderId: string, byUserId: string, opts: { approved: boolean; reason?: string }) {
  const o = await orderBrief(orderId)
  if (!o) return
  await closeMaterialRequestTasks(orderId, byUserId)

  await prisma.notification.create({
    data: {
      userId: o.createdBy,
      title: opts.approved ? `Phiếu ${o.code} đã được duyệt` : `Phiếu ${o.code} bị trả lại`,
      message: opts.approved
        ? `Kho đã nhận được phiếu và có thể cấp vật tư cho dự án ${o.project.projectCode}.`
        : `Lý do: ${opts.reason || 'không nêu'}. Sửa lại rồi gửi duyệt lần nữa.`,
      type: opts.approved ? 'task_done' : 'task_returned',
      linkUrl: opts.approved ? '/dashboard/warehouse/material-issue' : APPROVAL_PATH,
    },
  }).catch(() => {})
}

export const MR_STATUS_FOR_KHO = MR_STATUS.APPROVED
