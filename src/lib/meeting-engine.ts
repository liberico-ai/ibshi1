import prisma from './db'
import { ROLE_TO_DEPT, DEPT_NAME } from './org-map'

// ── Module Lịch họp: tạo họp, mời người, xác nhận tham gia (RSVP), lưu biên bản ──

export interface CreateMeetingInput {
  title: string
  projectId?: string
  taskId?: string
  agenda?: string
  location?: string
  startsAt: string
  endsAt?: string
  inviteUserIds: string[]
  draftId?: string
}

async function notify(userIds: string[], title: string, message: string, linkUrl: string, type: string) {
  if (!userIds.length) return
  try {
    await prisma.notification.createMany({ data: userIds.map((uid) => ({ userId: uid, title, message, type, linkUrl })) })
  } catch (e) { console.error('meeting notify error', e) }
}

export async function createMeeting(input: CreateMeetingInput, userId: string) {
  const invitees = [...new Set((input.inviteUserIds || []).filter(Boolean))]
  // Tạo từ 1 công việc → tự khớp dự án theo công việc (không phụ thuộc người dùng chọn)
  let projectId = input.projectId || null
  if (!projectId && input.taskId) {
    const t = await prisma.task.findUnique({ where: { id: input.taskId }, select: { projectId: true } })
    projectId = t?.projectId || null
  }
  const meeting = await prisma.meeting.create({
    data: {
      title: input.title,
      projectId,
      taskId: input.taskId || null,
      agenda: input.agenda || null,
      location: input.location || null,
      startsAt: new Date(input.startsAt),
      endsAt: input.endsAt ? new Date(input.endsAt) : null,
      createdBy: userId,
      invites: { create: invitees.map((uid) => ({ userId: uid })) },
    },
  })

  // Gắn tài liệu họp đã upload trước (entityType='Meeting', entityId bắt đầu bằng draftId) → trỏ về meeting
  if (input.draftId) {
    await prisma.fileAttachment.updateMany({
      where: { entityType: 'Meeting', entityId: { startsWith: input.draftId } },
      data: { entityId: meeting.id },
    }).catch(() => {})
  }

  await notify(invitees, `Mời họp: ${input.title}`, 'Bạn được mời tham gia một cuộc họp. Vui lòng xác nhận tham gia.', `/dashboard/work/meetings/${meeting.id}`, 'meeting_invite')
  return meeting
}

export async function respondInvite(meetingId: string, userId: string, status: 'ACCEPTED' | 'DECLINED', note?: string) {
  const invite = await prisma.meetingInvite.findUnique({ where: { meetingId_userId: { meetingId, userId } } })
  if (!invite) throw new Error('Bạn không nằm trong danh sách mời họp này')
  await prisma.meetingInvite.update({ where: { id: invite.id }, data: { status, note: note?.trim() || undefined, respondedAt: new Date() } })
  const meeting = await prisma.meeting.findUnique({ where: { id: meetingId }, select: { title: true, createdBy: true } })
  if (meeting) {
    const me = await prisma.user.findUnique({ where: { id: userId }, select: { fullName: true } })
    await notify([meeting.createdBy], `Phản hồi mời họp: ${meeting.title}`, `${me?.fullName || 'Người dùng'} ${status === 'ACCEPTED' ? 'đã nhận tham gia' : 'từ chối tham gia'}.`, `/dashboard/work/meetings/${meetingId}`, 'meeting_response')
  }
  return { ok: true }
}

export async function closeMeeting(
  meetingId: string,
  userId: string,
  data: { minutesNote?: string; momNumber?: string; preparedBy?: string; place?: string; items?: { noiDung?: string; actionBy?: string; dueDate?: string; remark?: string }[] }
) {
  const meeting = await prisma.meeting.findUnique({ where: { id: meetingId }, select: { createdBy: true } })
  if (!meeting) throw new Error('Không tìm thấy cuộc họp')
  if (meeting.createdBy !== userId) throw new Error('Chỉ người tạo họp mới được lưu biên bản & kết thúc')
  // MOM có cấu trúc (mẫu hệ cũ P1.2A): chỉ giữ các mục hành động có nội dung
  const items = (data.items || [])
    .filter((it) => it.noiDung?.trim() || it.actionBy?.trim())
    .map((it, i) => ({ stt: String(i + 1), noiDung: it.noiDung?.trim() || '', actionBy: it.actionBy?.trim() || '', dueDate: it.dueDate || '', remark: it.remark?.trim() || '' }))
  const minutesData = (data.preparedBy?.trim() || data.place?.trim() || items.length)
    ? { preparedBy: data.preparedBy?.trim() || '', place: data.place?.trim() || '', items }
    : undefined
  await prisma.meeting.update({
    where: { id: meetingId },
    data: {
      status: 'DONE',
      minutesNote: data.minutesNote?.trim() || undefined,
      momNumber: data.momNumber?.trim() || undefined,
      minutesData: minutesData ? JSON.parse(JSON.stringify(minutesData)) : undefined,
    },
  })
  return { ok: true }
}

export async function cancelMeeting(meetingId: string, userId: string) {
  const m = await prisma.meeting.findUnique({ where: { id: meetingId }, include: { invites: { select: { userId: true } } } })
  if (!m) throw new Error('Không tìm thấy cuộc họp')
  if (m.createdBy !== userId) throw new Error('Chỉ người tạo họp mới được hủy')
  await prisma.meeting.update({ where: { id: meetingId }, data: { status: 'CANCELLED' } })
  await notify(m.invites.map((i) => i.userId), `Hủy họp: ${m.title}`, 'Cuộc họp đã bị hủy.', `/dashboard/work/meetings/${meetingId}`, 'meeting_cancel')
  return { ok: true }
}

export async function getMeetings(userId: string) {
  const meetings = await prisma.meeting.findMany({
    where: { OR: [{ createdBy: userId }, { invites: { some: { userId } } }] },
    select: {
      id: true, title: true, status: true, startsAt: true, location: true, createdBy: true,
      project: { select: { projectCode: true, projectName: true } },
      invites: { select: { userId: true, status: true } },
    },
    orderBy: { startsAt: 'desc' },
  })
  return meetings.map((m) => {
    const mine = m.invites.find((i) => i.userId === userId)
    return {
      id: m.id, title: m.title, status: m.status, startsAt: m.startsAt, location: m.location,
      project: m.project, isOrganizer: m.createdBy === userId,
      myStatus: mine?.status || (m.createdBy === userId ? 'ORGANIZER' : null),
      counts: {
        total: m.invites.length,
        accepted: m.invites.filter((i) => i.status === 'ACCEPTED').length,
        declined: m.invites.filter((i) => i.status === 'DECLINED').length,
      },
    }
  })
}

export async function getMeetingDetail(id: string) {
  const m = await prisma.meeting.findUnique({
    where: { id },
    include: { project: { select: { projectCode: true, projectName: true } }, invites: true },
  })
  if (!m) return null
  const userIds = new Set<string>([m.createdBy, ...m.invites.map((i) => i.userId)])
  const users = await prisma.user.findMany({ where: { id: { in: [...userIds] } }, select: { id: true, fullName: true, roleCode: true } })
  const userById = new Map(users.map((u) => [u.id, u]))
  const nameOf = (uid?: string | null) => (uid ? userById.get(uid)?.fullName || 'Người dùng' : null)
  const deptOf = (uid?: string | null) => { const rc = uid ? userById.get(uid)?.roleCode : null; return rc ? DEPT_NAME[ROLE_TO_DEPT[rc]] || rc : null }
  // Tài liệu họp
  const files = await prisma.fileAttachment.findMany({ where: { entityType: 'Meeting', entityId: id }, select: { id: true, fileName: true, fileUrl: true } })
  return {
    ...m,
    createdByName: nameOf(m.createdBy),
    invites: m.invites.map((i) => ({ ...i, userName: nameOf(i.userId), deptName: deptOf(i.userId) })),
    files,
  }
}
