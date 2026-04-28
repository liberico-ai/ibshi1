import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(value: string | number | null | undefined, currency = 'VND'): string {
  if (!value) return '-'
  const num = typeof value === 'string' ? parseFloat(value) : value
  // Use 'en-US' locale — always available in Node.js minimal ICU (Alpine Docker).
  // 'vi-VN' is NOT available in Alpine's minimal ICU, causing SSR/client hydration mismatch.
  if (currency === 'VND') return new Intl.NumberFormat('en-US').format(num) + ' ₫'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(num)
}

export function formatCompactVND(value: number | null | undefined): string {
  if (!value) return '0'
  const num = typeof value === 'string' ? parseFloat(value) : value
  if (isNaN(num)) return '0'
  
  if (num >= 1e9) return parseFloat((num / 1e9).toFixed(2)) + ' Tỷ'
  if (num >= 1e6) return parseFloat((num / 1e6).toFixed(1)) + ' Tr'
  if (num >= 1e3) return parseFloat((num / 1e3).toFixed(1)) + ' K'
  return num.toString()
}

export function formatDate(date: string | Date | null | undefined): string {
  if (!date) return '-'
  // Use 'en-GB' (DD/MM/YYYY) — safe in Alpine minimal ICU unlike 'vi-VN'
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(date))
}

export function getStatusColor(status: string): string {
  switch (status) {
    case 'DONE': return 'text-emerald-600'
    case 'IN_PROGRESS': return 'text-sky-600'
    case 'PENDING': return 'text-slate-400'
    case 'BLOCKED': return 'text-red-600'
    case 'OVERDUE': return 'text-red-600'
    case 'REJECTED': return 'text-red-600'
    default: return 'text-slate-400'
  }
}

export function getStatusBg(status: string): string {
  switch (status) {
    case 'DONE': return 'bg-emerald-50 text-emerald-700 border-emerald-200'
    case 'IN_PROGRESS': return 'bg-sky-50 text-sky-700 border-sky-200'
    case 'PENDING': return 'bg-slate-50 text-slate-500 border-slate-200'
    case 'BLOCKED': return 'bg-red-50 text-red-700 border-red-200'
    case 'REJECTED': return 'bg-red-50 text-red-700 border-red-200'
    default: return 'bg-slate-50 text-slate-500 border-slate-200'
  }
}

export function getUrgencyLabel(urgency: string): { label: string; color: string } {
  switch (urgency) {
    case 'overdue': return { label: 'Quá hạn', color: 'bg-red-100 text-red-700' }
    case 'today': return { label: 'Hôm nay', color: 'bg-amber-100 text-amber-700' }
    case 'this_week': return { label: 'Tuần này', color: 'bg-sky-100 text-sky-700' }
    default: return { label: '', color: '' }
  }
}

export function getProgressColor(progress: number): string {
  if (progress >= 80) return 'bg-emerald-500'
  if (progress >= 50) return 'bg-teal-500'
  if (progress >= 25) return 'bg-sky-500'
  return 'bg-slate-300'
}
