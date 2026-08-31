import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse, logAudit, getClientIP } from '@/lib/auth'
import { validateParams } from '@/lib/api-helpers'
import { idParamSchema } from '@/lib/schemas'
import { isProjectPm } from '@/lib/project-pm'

// Danh sách PM phụ trách dự án — NHIỀU người, NGANG QUYỀN nhau.
//   GET → danh sách hiện tại
//   PUT { userIds: [], leadUserId } → đặt lại toàn bộ danh sách
//
// Vì sao vẫn giữ "đầu mối" (leadUserId → projects.pm_user_id): khi chuỗi tự sinh task vai R02,
// hệ phải chọn MỘT người nhận cụ thể. Đầu mối là người đó. Còn quyền thao tác thì mọi PM như nhau
// và ai hoàn thành cũng được — nên không giao task cho cả nhóm (giao cả nhóm sẽ vướng luật
// "việc chỉ xong khi TẤT CẢ người nhận đã xong").
const QLDA_ROLES = ['R02', 'R02a']

// Ai được sửa danh sách PM của một dự án:
//   R01 BGĐ, R10 IT   — toàn quyền
//   R02 Trưởng phòng Dự án — phân công PM cho MỌI dự án, kể cả dự án mình không tham gia;
//                            đây chính là việc của trưởng phòng.
//   ngoài ra: PM đang phụ trách dự án đó được sửa nhóm của mình (xét riêng bên dưới).
// R02a (nhân viên QLDA) KHÔNG nằm ở đây — chỉ sửa được dự án mình đang phụ trách.
const PM_ASSIGN_ROLES = ['R01', 'R10', 'R02']

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()
    const p = validateParams(await params, idParamSchema)
    if (!p.success) return p.response

    const project = await prisma.project.findUnique({
      where: { id: p.data.id },
      select: { id: true, projectCode: true, pmUserId: true },
    })
    if (!project) return errorResponse('Không tìm thấy dự án', 404)

    const rows = await prisma.projectPm.findMany({
      where: { projectId: project.id },
      include: { user: { select: { id: true, fullName: true, username: true, roleCode: true } } },
      orderBy: [{ isLead: 'desc' }, { assignedAt: 'asc' }],
    })
    return successResponse({
      leadUserId: project.pmUserId,
      pms: rows.map(r => ({ ...r.user, isLead: r.isLead, assignedAt: r.assignedAt })),
    })
  } catch (err) {
    console.error('GET /api/projects/[id]/pms error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await authenticateRequest(req)
    if (!user) return unauthorizedResponse()
    const p = validateParams(await params, idParamSchema)
    if (!p.success) return p.response
    const { id } = p.data

    const project = await prisma.project.findUnique({ where: { id }, select: { id: true, projectCode: true, pmUserId: true } })
    if (!project) return errorResponse('Không tìm thấy dự án', 404)

    // BGĐ / IT / Trưởng phòng Dự án phân công được cho mọi dự án;
    // PM đang phụ trách thì sửa được nhóm của chính dự án mình.
    if (!PM_ASSIGN_ROLES.includes(user.roleCode) && !(await isProjectPm(user.userId, id))) {
      return errorResponse('Chỉ BGĐ, IT, Trưởng phòng Dự án hoặc PM đang phụ trách mới được sửa danh sách PM', 403)
    }

    const body = await req.json().catch(() => ({}))
    const rawIds: string[] = (Array.isArray(body?.userIds) ? body.userIds : [])
      .map((x: unknown) => String(x ?? '').trim())
      .filter((x: string) => x.length > 0)
    const userIds: string[] = [...new Set(rawIds)]
    if (userIds.length === 0) return errorResponse('Phải có ít nhất một PM phụ trách')

    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, fullName: true, roleCode: true, isActive: true },
    })
    if (users.length !== userIds.length) return errorResponse('Có tài khoản không tồn tại')
    const bad = users.filter(u => !u.isActive)
    if (bad.length) return errorResponse(`Tài khoản đã khoá: ${bad.map(u => u.fullName).join(', ')}`)
    const notPm = users.filter(u => !QLDA_ROLES.includes(u.roleCode))
    if (notPm.length) return errorResponse(`Không phải vai Quản lý dự án: ${notPm.map(u => u.fullName).join(', ')}`)

    // Đầu mối: lấy theo yêu cầu, không hợp lệ thì giữ đầu mối cũ nếu còn trong danh sách, else người đầu tiên.
    const wanted = String(body?.leadUserId || '').trim()
    const lead = userIds.includes(wanted) ? wanted
      : (project.pmUserId && userIds.includes(project.pmUserId) ? project.pmUserId : userIds[0])

    const oldLead = project.pmUserId
    await prisma.$transaction([
      prisma.projectPm.deleteMany({ where: { projectId: id, userId: { notIn: userIds } } }),
      ...userIds.map(uid => prisma.projectPm.upsert({
        where: { projectId_userId: { projectId: id, userId: uid } },
        create: { projectId: id, userId: uid, isLead: uid === lead, assignedBy: user.userId },
        update: { isLead: uid === lead },
      })),
      prisma.project.update({ where: { id }, data: { pmUserId: lead } }),
    ])

    // Đổi đầu mối → chuyển các task vai R02 đang mở của dự án về đầu mối mới, để việc không
    // đứng tên người đã rời nhóm. Các PM khác vẫn thao tác được nhờ kiểm quyền theo danh sách.
    let reassigned = 0
    if (oldLead !== lead) {
      const tasks = await prisma.task.findMany({
        where: { projectId: id, status: { notIn: ['DONE', 'CANCELLED'] } },
        select: { id: true },
      })
      if (tasks.length) {
        const r = await prisma.taskAssignee.updateMany({
          where: { taskId: { in: tasks.map(t => t.id) }, role: { in: QLDA_ROLES }, done: false },
          data: { userId: lead },
        })
        reassigned = r.count
      }
    }

    await logAudit(user.userId, 'SET_PROJECT_PMS', 'Project', id,
      { projectCode: project.projectCode, userIds, lead, oldLead, reassigned }, getClientIP(req))

    const leadName = users.find(u => u.id === lead)?.fullName || ''
    return successResponse({ leadUserId: lead, count: userIds.length, reassigned },
      `Đã lưu ${userIds.length} PM phụ trách (đầu mối: ${leadName})` + (reassigned ? ` · chuyển ${reassigned} việc sang đầu mối mới` : ''))
  } catch (err) {
    console.error('PUT /api/projects/[id]/pms error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
