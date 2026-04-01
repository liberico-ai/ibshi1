import { NextRequest } from 'next/server'
import prisma from '@/lib/db'
import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'

// GET /api/notifications — List user's notifications
export async function GET(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()

    const { searchParams } = new URL(req.url)
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') || '20')))

    const [unreadCount, notifications] = await Promise.all([
      prisma.notification.count({
        where: { userId: payload.userId, isRead: false },
      }),
      prisma.notification.findMany({
        where: { userId: payload.userId },
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: {
          id: true, title: true, message: true, type: true,
          isRead: true, linkUrl: true, createdAt: true,
        },
      }),
    ])

    return successResponse({ notifications, unreadCount })
  } catch (err) {
    console.error('GET /api/notifications error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}

// PUT /api/notifications — Mark notifications as read
export async function PUT(req: NextRequest) {
  try {
    const payload = await authenticateRequest(req)
    if (!payload) return unauthorizedResponse()

    const body = await req.json()
    const { notificationId, markAll } = body

    if (markAll) {
      await prisma.notification.updateMany({
        where: { userId: payload.userId, isRead: false },
        data: { isRead: true },
      })
      return successResponse({}, 'Đã đọc tất cả')
    }

    if (notificationId) {
      await prisma.notification.update({
        where: { id: notificationId },
        data: { isRead: true },
      })
      return successResponse({}, 'Đã đọc')
    }

    return errorResponse('Thiếu notificationId hoặc markAll')
  } catch (err) {
    console.error('PUT /api/notifications error:', err)
    return errorResponse('Lỗi hệ thống', 500)
  }
}
