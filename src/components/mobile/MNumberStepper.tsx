'use client'

interface MNumberStepperProps {
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
  label?: string
  /** Cho phép số lẻ (giờ công 4.5). Mặc định chỉ số nguyên. */
  decimal?: boolean
  disabled?: boolean
}

/**
 * Bộ đếm ± cho tay đeo găng — nút 46×52px, ô số 52px cao.
 * Vẫn gõ tay được (bàn phím số) khi số lớn.
 */
export function MNumberStepper({
  value,
  onChange,
  min = 0,
  max,
  step = 1,
  label,
  decimal = false,
  disabled,
}: MNumberStepperProps) {
  const clamp = (v: number) => {
    if (Number.isNaN(v)) return min
    if (v < min) return min
    if (max !== undefined && v > max) return max
    return v
  }

  const bump = (delta: number) => {
    const next = clamp(Number((value + delta).toFixed(decimal ? 2 : 0)))
    onChange(next)
  }

  return (
    <div>
      {label && <label className="m-label">{label}</label>}
      <div className="m-stepper">
        <button
          type="button"
          className="m-stepper-btn"
          onClick={() => bump(-step)}
          disabled={disabled || value <= min}
          aria-label="Giảm"
        >
          −
        </button>
        <input
          className="m-stepper-input"
          type="text"
          inputMode={decimal ? 'decimal' : 'numeric'}
          value={String(value)}
          disabled={disabled}
          onChange={(e) => {
            const raw = e.target.value.replace(',', '.')
            if (raw === '') return onChange(min)
            const n = decimal ? parseFloat(raw) : parseInt(raw, 10)
            if (!Number.isNaN(n)) onChange(clamp(n))
          }}
          aria-label={label || 'Số lượng'}
        />
        <button
          type="button"
          className="m-stepper-btn"
          onClick={() => bump(step)}
          disabled={disabled || (max !== undefined && value >= max)}
          aria-label="Tăng"
        >
          +
        </button>
      </div>
    </div>
  )
}
