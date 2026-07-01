import prisma from './db'
import { todayStart } from './utils'

export interface CertCheckResult {
  valid: boolean
  reason: string | null
  warning: string | null
}

const WARN_DAYS = 30

export async function isCertValid(
  certId: string,
  expectedType: 'welder_cert' | 'wps',
  holderId?: string | null,
): Promise<CertCheckResult> {
  const cert = await prisma.certificateRegistry.findUnique({ where: { id: certId } })

  if (!cert) return { valid: false, reason: 'Chứng chỉ không tồn tại', warning: null }
  if (!cert.isActive) return { valid: false, reason: `Chứng chỉ ${cert.certNumber} đã bị thu hồi (isActive=false)`, warning: null }
  if (cert.certType !== expectedType) {
    return { valid: false, reason: `Chứng chỉ ${cert.certNumber} loại ${cert.certType}, cần ${expectedType}`, warning: null }
  }

  const today = todayStart()
  const expiry = new Date(cert.expiryDate)
  expiry.setHours(0, 0, 0, 0)

  if (expiry < today) {
    return { valid: false, reason: `Chứng chỉ ${cert.certNumber} hết hạn ${cert.expiryDate.toISOString().slice(0, 10)}`, warning: null }
  }

  let warning: string | null = null
  const daysLeft = Math.ceil((expiry.getTime() - today.getTime()) / 86_400_000)
  if (daysLeft <= WARN_DAYS) {
    warning = `Chứng chỉ ${cert.certNumber} còn ${daysLeft} ngày hết hạn`
  }

  if (expectedType === 'welder_cert' && holderId && cert.holderId && cert.holderId !== holderId) {
    warning = `Chứng chỉ ${cert.certNumber} thuộc người khác (holderId=${cert.holderId}, welderId=${holderId})`
  }

  return { valid: true, reason: null, warning }
}
