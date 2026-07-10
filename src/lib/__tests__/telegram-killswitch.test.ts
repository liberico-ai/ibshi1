import { describe, it, expect, vi, beforeEach } from 'vitest'
import { prismaMock } from '@/lib/__mocks__/db'

// Spy trên api.sendMessage của bot grammy
const { mockSend } = vi.hoisted(() => ({ mockSend: vi.fn().mockResolvedValue({}) }))
vi.mock('grammy', () => ({
  // class → constructable qua `new Bot(token)` trong getBot()
  Bot: class {
    api = { sendMessage: mockSend, deleteWebhook: vi.fn().mockResolvedValue({}), setMyCommands: vi.fn().mockResolvedValue({}) }
    command = vi.fn()
    stop = vi.fn()
  },
}))
vi.mock('@/lib/telegram-commands', () => ({ registerCommands: vi.fn() }))

import { sendGroupMessage, sendDirectMessage, invalidateConfigCache, resetBot } from '@/lib/telegram'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function cfgRows(rows: Array<{ key: string; value: string }>) {
  prismaMock.systemConfig.findMany.mockResolvedValue(rows as never)
}

describe('Telegram kill-switch (telegram_notify_enabled)', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    await resetBot()
    invalidateConfigCache()
    process.env.TELEGRAM_BOT_TOKEN = '123:ABC'
    process.env.TELEGRAM_GROUP_CHAT_ID = '-100999'
    delete process.env.TELEGRAM_NOTIFY_ENABLED
    prismaMock.user.findUnique.mockResolvedValue({ telegramChatId: '555' } as never)
  })

  it('GỬI khi không có cờ (mặc định bật)', async () => {
    cfgRows([])
    await sendGroupMessage('hello')
    expect(mockSend).toHaveBeenCalledTimes(1)
    expect(mockSend).toHaveBeenCalledWith('-100999', 'hello', { parse_mode: 'HTML' })
  })

  it('GỬI khi cờ = "true"', async () => {
    cfgRows([{ key: 'telegram_notify_enabled', value: 'true' }])
    await sendGroupMessage('hi')
    expect(mockSend).toHaveBeenCalledTimes(1)
  })

  it('KHÔNG gửi group message khi cờ = "false"', async () => {
    cfgRows([{ key: 'telegram_notify_enabled', value: 'false' }])
    await sendGroupMessage('should not send')
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('KHÔNG gửi DM khi cờ = "false"', async () => {
    cfgRows([{ key: 'telegram_notify_enabled', value: 'false' }])
    await sendDirectMessage('user-1', 'dm should not send')
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('KHÔNG gửi khi env TELEGRAM_NOTIFY_ENABLED=false (DB không có cờ)', async () => {
    process.env.TELEGRAM_NOTIFY_ENABLED = 'false'
    cfgRows([])
    await sendGroupMessage('nope')
    expect(mockSend).not.toHaveBeenCalled()
  })
})
