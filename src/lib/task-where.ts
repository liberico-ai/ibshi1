import { todayStart } from './utils'

const DOER_STATUSES = ['OPEN', 'IN_PROGRESS', 'RETURNED']
const REVIEW_GRACE_MS = 2 * 86400000

function reviewCutoff(): Date {
  const d = todayStart()
  d.setTime(d.getTime() - REVIEW_GRACE_MS)
  return d
}

export function whereDoerOverdue() {
  return { status: { in: DOER_STATUSES }, deadline: { lt: todayStart() } }
}

export function whereReviewLate() {
  return {
    status: 'AWAITING_REVIEW' as const,
    OR: [
      { deadline: { lt: todayStart() }, submittedAt: null },
      { submittedAt: { lt: reviewCutoff() } },
    ],
  }
}

export function whereOverdue() {
  return { OR: [whereDoerOverdue(), whereReviewLate()] }
}

export const ACTIVE_STATUSES = ['OPEN', 'IN_PROGRESS', 'RETURNED', 'AWAITING_REVIEW']
