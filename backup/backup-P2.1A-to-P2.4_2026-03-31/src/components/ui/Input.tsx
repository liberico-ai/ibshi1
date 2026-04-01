import { forwardRef, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'

interface InputFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  helperText?: string
}

const InputField = forwardRef<HTMLInputElement, InputFieldProps>(({
  label,
  error,
  helperText,
  className = '',
  id,
  ...props
}, ref) => {
  const inputId = id || label?.toLowerCase().replace(/\s+/g, '-')

  return (
    <div className="input-field">
      {label && <label htmlFor={inputId} className="input-label">{label}</label>}
      <input
        ref={ref}
        id={inputId}
        className={`input ${error ? 'input-error' : ''} ${className}`}
        {...props}
      />
      {error && <p className="input-error-text">{error}</p>}
      {!error && helperText && <p className="input-helper-text">{helperText}</p>}
    </div>
  )
})
InputField.displayName = 'InputField'

interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string
  error?: string
  options: Array<{ value: string; label: string }>
}

const SelectField = forwardRef<HTMLSelectElement, SelectFieldProps>(({
  label,
  error,
  options,
  className = '',
  id,
  ...props
}, ref) => {
  const selectId = id || label?.toLowerCase().replace(/\s+/g, '-')

  return (
    <div className="input-field">
      {label && <label htmlFor={selectId} className="input-label">{label}</label>}
      <select
        ref={ref}
        id={selectId}
        className={`input ${error ? 'input-error' : ''} ${className}`}
        {...props}
      >
        {options.map(opt => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
      {error && <p className="input-error-text">{error}</p>}
    </div>
  )
})
SelectField.displayName = 'SelectField'

interface TextareaFieldProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
  error?: string
}

const TextareaField = forwardRef<HTMLTextAreaElement, TextareaFieldProps>(({
  label,
  error,
  className = '',
  id,
  ...props
}, ref) => {
  const textareaId = id || label?.toLowerCase().replace(/\s+/g, '-')

  return (
    <div className="input-field">
      {label && <label htmlFor={textareaId} className="input-label">{label}</label>}
      <textarea
        ref={ref}
        id={textareaId}
        className={`input ${error ? 'input-error' : ''} ${className}`}
        {...props}
      />
      {error && <p className="input-error-text">{error}</p>}
    </div>
  )
})
TextareaField.displayName = 'TextareaField'

export { InputField, SelectField, TextareaField }
export type { InputFieldProps, SelectFieldProps, TextareaFieldProps }
