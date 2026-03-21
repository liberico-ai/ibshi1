import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(value: string | number | null | undefined, currency = 'VND'): string {
  if (!value) return '-'
  const num = typeof value === 'string' ? parseFloat(value) : value
  if (currency === 'VND') return new Intl.NumberFormat('vi-VN').format(num) + ' ₫'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(num)
}

export function formatDate(date: string | Date | null | undefined): string {
  if (!date) return '-'
  return new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(date))
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
