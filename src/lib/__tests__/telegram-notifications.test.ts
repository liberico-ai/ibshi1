import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock grammy before importing telegram modules
vi.mock('grammy', () => ({
  Bot: vi.fn().mockImplementation(() => ({
    api: { sendMessage: vi.fn().mockResolvedValue({}), setMyCommands: vi.fn().mockResolvedValue({}) },
    command: vi.fn(),
  })),
}))

// Mock the telegram module to capture sendGroupMessage calls
const mockSendGroupMessage = vi.fn().mockResolvedValue(undefined)
vi.mock('@/lib/telegram', () => ({
  sendGroupMessage: (...args: unknown[]) => mockSendGroupMessage(...args),
  escapeHtml: (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
  formatDeadline: (d: Date | null) => d ? new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(d)) : 'Không có',
}))

import { notifyTaskActivated, notifyTaskRejected, notifyTaskOverdue, notifyTaskCompleted } from '@/lib/telegram-notifications'

describe('Telegram Notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.NEXT_PUBLIC_APP_URL = 'https://erp.ibs.vn'
  })

  describe('notifyTaskActivated', () => {
    it('sends formatted HTML message to group', async () => {
      await notifyTaskActivated({
        stepCode: 'P4.5',
        stepName: 'Kho cấp vật tư cho nội bộ sản xuất',
        projectCode: 'PRJ-2026-001',
        projectName: 'Tháp nén khí',
        assignedRole: 'R05',
        deadline: new Date('2026-04-08'),
        taskId: 'task-123',
      })

      expect(mockSendGroupMessage).toHaveBeenCalledTimes(1)
      const msg = mockSendGroupMessage.mock.calls[0][0] as string
      expect(msg).toContain('CÔNG VIỆC MỚI')
      expect(msg).toContain('PRJ-2026-001')
      expect(msg).toContain('P4.5')
      expect(msg).toContain('R05')
      expect(msg).toContain('https://erp.ibs.vn/dashboard/tasks/task-123')
    })

    it('omits link when NEXT_PUBLIC_APP_URL is not set', async () => {
      delete process.env.NEXT_PUBLIC_APP_URL

      await notifyTaskActivated({
        stepCode: 'P1.1', stepName: 'Tạo dự án',
        projectCode: 'PRJ-001', projectName: 'Test',
        assignedRole: 'R02', deadline: null, taskId: 'x',
      })

      const msg = mockSendGroupMessage.mock.calls[0][0] as string
      expect(msg).not.toContain('Xem chi tiết')
    })

    it('handles null deadline', async () => {
      await notifyTaskActivated({
        stepCode: 'P1.1', stepName: 'Tạo dự án',
        projectCode: 'PRJ-001', projectName: 'Test',
        assignedRole: 'R02', deadline: null, taskId: 'x',
      })

      const msg = mockSendGroupMessage.mock.calls[0][0] as string
      expect(msg).toContain('Không có')
    })
  })

  describe('notifyTaskRejected', () => {
    it('sends rejection message with reason and returnedTo', async () => {
      await notifyTaskRejected({
        stepCode: 'P5.3', stepName: 'QC kiểm tra',
        projectCode: 'PRJ-001', projectName: 'Test',
        assignedRole: 'R09', deadline: null, taskId: 'x',
        reason: 'Mối hàn không đạt', returnedTo: 'P5.1',
        returnedStepName: 'Tổ sản xuất thực hiện',
      })

      expect(mockSendGroupMessage).toHaveBeenCalledTimes(1)
      const msg = mockSendGroupMessage.mock.calls[0][0] as string
      expect(msg).toContain('TỪ CHỐI')
      expect(msg).toContain('Mối hàn không đạt')
      expect(msg).toContain('P5.1')
      expect(msg).toContain('Tổ sản xuất thực hiện')
    })
  })

  describe('notifyTaskOverdue', () => {
    it('uses warning emoji for < 48h overdue', async () => {
      await notifyTaskOverdue({
        stepCode: 'P3.6', stepName: 'BGĐ duyệt',
        projectCode: 'PRJ-001', projectName: 'Test',
        assignedRole: 'R01', hoursOverdue: 12,
      })

      const msg = mockSendGroupMessage.mock.calls[0][0] as string
      expect(msg).toContain('⏰')
      expect(msg).toContain('CẢNH BÁO QUÁ HẠN')
      expect(msg).toContain('12 giờ')
    })

    it('uses escalation emoji for > 48h overdue', async () => {
      await notifyTaskOverdue({
        stepCode: 'P3.6', stepName: 'BGĐ duyệt',
        projectCode: 'PRJ-001', projectName: 'Test',
        assignedRole: 'R01', hoursOverdue: 72,
      })

      const msg = mockSendGroupMessage.mock.calls[0][0] as string
      expect(msg).toContain('🚨')
      expect(msg).toContain('LEO THANG')
      expect(msg).toContain('72 giờ')
    })
  })

  describe('notifyTaskCompleted', () => {
    it('sends completion message', async () => {
      await notifyTaskCompleted({
        stepCode: 'P2.5', stepName: 'BGĐ phê duyệt',
        projectCode: 'PRJ-001', projectName: 'Test',
        completedBy: 'Nguyễn Văn A',
      })

      const msg = mockSendGroupMessage.mock.calls[0][0] as string
      expect(msg).toContain('HOÀN THÀNH')
      expect(msg).toContain('P2.5')
      expect(msg).toContain('Nguyễn Văn A')
    })
  })
})
