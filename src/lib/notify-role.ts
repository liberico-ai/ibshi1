import prisma from '@/lib/db'

/**
 * Gửi thông báo cho MỌI user thuộc các role chỉ định (bàn giao chéo giữa role trong flow mua sắm).
 * Non-fatal: lỗi thì nuốt, không chặn nghiệp vụ chính.
 */
export async function notifyRole(
  roleCodes: string[],
  n: { title: string; message: string; linkUrl?: string; type?: string; excludeUserId?: string },
): Promise<number> {
  try {
    const users = await prisma.user.findMany({
      where: { roleCode: { in: roleCodes }, isActive: true, ...(n.excludeUserId ? { id: { not: n.excludeUserId } } : {}) },
      select: { id: true },
    })
    if (users.length === 0) return 0
    await prisma.notification.createMany({
      data: users.map(u => ({ userId: u.id, title: n.title, message: n.message, type: n.type || 'approval_needed', linkUrl: n.linkUrl || null })),
    })
    return users.length
  } catch (e) {
    console.error('[notifyRole] lỗi:', e)
    return 0
  }
}
