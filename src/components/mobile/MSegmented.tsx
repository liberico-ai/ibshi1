'use client'

import { SEMANTIC_COLORS } from '@/lib/design-tokens'

export type MSegmentTone = 'success' | 'danger' | 'warning' | 'info' | 'neutral'

export interface MSegmentOption<T extends string = string> {
  value: T
  label: string
  tone?: MSegmentTone
}

interface MSegmentedProps<T extends string = string> {
  options: readonly MSegmentOption<T>[]
  value: T | null
  onChange: (v: T) => void
  label?: string
  disabled?: boolean
}

/**
 * Thay <select> bằng dãy nút to — một chạm là chọn xong.
 * Dùng cho verdict ĐẠT / LỖI / ĐẠT ĐK.
 */
export function MSegmented<T extends string = string>({
  options,
  value,
  onChange,
  label,
  disabled,
}: MSegmentedProps<T>) {
  return (
    <div>
      {label && <label className="m-label">{label}</label>}
      <div className="m-segmented" role="group" aria-label={label}>
        {options.map((opt) => {
          const on = value === opt.value
          const tone = SEMANTIC_COLORS[opt.tone || 'neutral']
          return (
            <button
              key={opt.value}
              type="button"
              aria-pressed={on}
              disabled={disabled}
              onClick={() => onChange(opt.value)}
              style={on ? { background: tone.solid } : undefined}
            >
              {opt.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
