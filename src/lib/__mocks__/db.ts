import { PrismaClient } from '@prisma/client'
import { mockDeep, mockReset, DeepMockProxy } from 'vitest-mock-extended'
import { beforeEach, vi } from 'vitest'

// Create a deep mock of PrismaClient
export const prismaMock = mockDeep<PrismaClient>()

// Reset mock state before each test
beforeEach(() => {
  mockReset(prismaMock)
})

// Auto-mock the db module so any import of '@/lib/db' gets the mock
vi.mock('@/lib/db', () => ({
  __esModule: true,
  default: prismaMock,
  prisma: prismaMock,
}))

export type MockPrismaClient = DeepMockProxy<PrismaClient>
