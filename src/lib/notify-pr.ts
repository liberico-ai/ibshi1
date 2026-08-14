import prisma from './db'

/**
 * [Module 3] "Nhận PR vào dự án" — khi 1 PR được tạo cho dự án (tay / từ BOM-ECO),
 * bắn thông báo cho Thương mại (R07/R07a) để đi mua. KHÔNG tạo/không đẩy task workflow
 * → an toàn tuyệt đối, không đụng gate 32 bước. Chỉ để PR không nằm chết ở DRAFT.
 *
 * Không bao giờ được ném lỗi ra ngoài (bọc try/catch) — notify hỏng không được chặn tạo PR.
 */
export async function notifyPrCreatedForProject(opts: {
  prId: string
  prCode: string
  projectId: string
  itemCount: number
  originLabel?: string | null
  createdByUserId?: string // loại người tạo ra khỏi danh sách nhận (tránh tự báo mình)
}): Promise<void> {
  try {
    const users = await prisma.user.findMany({
      where: { roleCode: { in: ['R07', 'R07a'] }, isActive: true },
      select: { id: true },
    })
    const recipients = users.filter(u => u.id !== opts.createdByUserId)
    if (recipients.length === 0) return

    const project = await prisma.project.findUnique({
      where: { id: opts.projectId },
      select: { projectCode: true },
    })
    const src = opts.originLabel ? ` (từ ${opts.originLabel})` : ''

    await prisma.notification.createMany({
      data: recipients.map(u => ({
        userId: u.id,
        title: `Đề nghị mua hàng mới: ${opts.prCode}`,
        message: `Dự án ${project?.projectCode || ''}${src} có PR ${opts.prCode} — ${opts.itemCount} dòng vật tư cần đi mua.`,
        type: 'pr_created',
        linkUrl: `/dashboard/warehouse/purchase-requests`,
      })),
    })
  } catch (e) {
    console.error('[notifyPrCreatedForProject] skip — lỗi notify không chặn tạo PR:', e)
  }
}
