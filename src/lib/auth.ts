import bcrypt from 'bcryptjs'
import jwt, { type SignOptions } from 'jsonwebtoken'
import { NextRequest, NextResponse } from 'next/server'
import prisma from './db'

const JWT_EXPIRES_SECONDS = 28800 // 8 hours

let _cachedJwtSecret: string | undefined
function getJwtSecret(): string {
  if (!_cachedJwtSecret) {
    const secret = process.env.JWT_SECRET
    if (!secret) {
      throw new Error('FATAL: JWT_SECRET environment variable is required. Set it in .env file.')
    }
    _cachedJwtSecret = secret
  }
  return _cachedJwtSecret
}

// ── Password Hashing ──

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12)
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

// ── JWT Token ──

export interface TokenPayload {
  userId: string
  username: string
  roleCode: string
  userLevel: number
  fullName: string
}

export function generateToken(payload: TokenPayload): string {
  const options: SignOptions = { expiresIn: JWT_EXPIRES_SECONDS }
  return jwt.sign(payload as object, getJwtSecret(), options)
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    return jwt.verify(token, getJwtSecret()) as TokenPayload
  } catch {
    return null
  }
}

// ── Auth Middleware for API Routes ──

export function getTokenFromRequest(req: NextRequest): string | null {
  const authHeader = req.headers.get('authorization')
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.substring(7)
  }
  return null
}

export async function authenticateRequest(req: NextRequest): Promise<TokenPayload | null> {
  const token = getTokenFromRequest(req)
  if (!token) return null
  return verifyToken(token)
}

export function unauthorizedResponse(message = 'Unauthorized') {
  return NextResponse.json({ ok: false, error: message }, { status: 401 })
}

export function forbiddenResponse(message = 'Forbidden') {
  return NextResponse.json({ ok: false, error: message }, { status: 403 })
}

export function successResponse(data: Record<string, unknown> = {}, message?: string, status = 200) {
  return NextResponse.json({ ok: true, ...data, ...(message ? { message } : {}) }, { status })
}

export function errorResponse(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status })
}

// ── Role Check Helpers ──

export function requireRoles(userRole: string, allowedRoles: string[]): boolean {
  return allowedRoles.includes(userRole)
}

export function requireLevel(userLevel: number, minLevel: number): boolean {
  return userLevel <= minLevel // L1 (1) has higher authority than L2 (2)
}

// ── Audit Logger ──

export async function logAudit(
  userId: string,
  action: string,
  entity: string,
  entityId?: string,
  changes?: Record<string, unknown>,
  ipAddress?: string
) {
  try {
    await prisma.auditLog.create({
      data: { userId, action, entity, entityId, changes: changes ? JSON.parse(JSON.stringify(changes)) : undefined, ipAddress },
    })
  } catch (err) {
    console.error('Audit log failed:', err)
  }
}

// ── Row-Level Security ──

export async function getUserProjectIds(user: TokenPayload): Promise<string[] | null> {
  // R01 (BGĐ) sees everything — return null = no filter
  if (user.roleCode === 'R01') return null

  // R02 (PM) sees projects they manage
  const pmProjects = await prisma.project.findMany({
    where: { pmUserId: user.userId },
    select: { id: true },
  })

  // Also include projects from WO assignments, task assignments etc
  const taskProjects = await prisma.workflowTask.findMany({
    where: { OR: [{ assignedTo: user.userId }, { assignedRole: user.roleCode }] },
    select: { projectId: true },
    distinct: ['projectId'],
  })

  const ids = new Set<string>()
  pmProjects.forEach(p => ids.add(p.id))
  taskProjects.forEach(t => ids.add(t.projectId))

  return Array.from(ids)
}

// Helper to build project filter for Prisma queries
export function projectFilter(projectIds: string[] | null): Record<string, unknown> | undefined {
  if (projectIds === null) return undefined // R01 sees all
  return { projectId: { in: projectIds } }
}

// Get client IP from request
export function getClientIP(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown'
}

