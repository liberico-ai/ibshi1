'use client'

import { useState, useRef } from 'react'

export interface UploadedFile {
  id: string
  fileName: string
  fileUrl: string
  fileSize: number
  mimeType: string | null
  createdAt: string
}

interface MultiFileUploadProps {
  label: string
  entityType: string
  entityId: string
  existingFiles?: UploadedFile[]
  accept?: string         // file types, default: all
  disabled?: boolean
  onUploaded?: (file: UploadedFile) => void
  onDeleted?: (fileId: string) => void
  compact?: boolean       // smaller UI variant
}

const ALL_TYPES = '.pdf,.doc,.docx,.xlsx,.xls,.xls,.pptx,.jpg,.jpeg,.png,.gif,.dwg,.dxf,.zip,.rar,.csv,.txt'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function getFileIcon(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() || ''
  if (['pdf'].includes(ext)) return '📄'
  if (['doc', 'docx'].includes(ext)) return '📝'
  if (['xls', 'xlsx', 'csv'].includes(ext)) return '📊'
  if (['ppt', 'pptx'].includes(ext)) return '📑'
  if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) return '🖼️'
  if (['dwg', 'dxf'].includes(ext)) return '📐'
  if (['zip', 'rar', '7z'].includes(ext)) return '🗂️'
  return '📎'
}

export default function MultiFileUpload({
  label,
  entityType,
  entityId,
  existingFiles = [],
  accept = ALL_TYPES,
  disabled = false,
  onUploaded,
  onDeleted,
  compact = false,
}: MultiFileUploadProps) {
  const [files, setFiles] = useState<UploadedFile[]>(existingFiles)
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  async function uploadFile(file: File) {
    const token = typeof window !== 'undefined' ? sessionStorage.getItem('ibs_token') : null
    const fd = new FormData()
    fd.append('file', file)
    fd.append('entityType', entityType)
    fd.append('entityId', entityId)

    const res = await fetch('/api/upload', {
      method: 'POST',
      body: fd,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }).then(r => r.json())

    return res
  }

  async function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0 || disabled) return
    setError('')
    setUploading(true)

    const results: UploadedFile[] = []
    for (const file of Array.from(fileList)) {
      try {
        const res = await uploadFile(file)
        if (res.ok && res.attachment) {
          results.push(res.attachment)
          onUploaded?.(res.attachment)
        } else {
          setError(`Lỗi upload "${file.name}": ${res.error || 'Unknown error'}`)
        }
      } catch {
        setError(`Lỗi mạng khi upload "${file.name}"`)
      }
    }

    setFiles(prev => [...prev, ...results])
    setUploading(false)

    // Reset input
    if (inputRef.current) inputRef.current.value = ''
  }

  async function handleDelete(fileId: string) {
    setFiles(prev => prev.filter(f => f.id !== fileId))
    onDeleted?.(fileId)
  }

  const borderColor = dragOver ? 'var(--accent)' : disabled ? 'var(--border)' : 'var(--border)'

  return (
    <div style={{ marginBottom: compact ? 0 : 8 }}>
      <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>
        {label}
      </div>

      {/* Uploaded files list */}
      {files.length > 0 && (
        <div style={{ marginBottom: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {files.map(f => (
            <div key={f.id} style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '6px 10px', borderRadius: 6,
              background: '#f0fdf4', border: '1px solid #bbf7d0',
            }}>
              <span style={{ flexShrink: 0 }}>{getFileIcon(f.fileName)}</span>
              <a
                href={f.fileUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ flex: 1, fontSize: '0.8rem', color: '#15803d', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: 'none' }}
              >
                {f.fileName}
              </a>
              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', flexShrink: 0 }}>
                {formatBytes(f.fileSize)}
              </span>
              <a
                href={f.fileUrl}
                download
                style={{ fontSize: '0.75rem', color: '#166534', flexShrink: 0, textDecoration: 'none' }}
                title="Tải xuống"
              >
                ↓
              </a>
              {!disabled && (
                <button
                  type="button"
                  onClick={() => handleDelete(f.id)}
                  title="Xóa"
                  style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: '0.8rem', padding: 0, flexShrink: 0 }}
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Drop zone */}
      {!disabled && (
        <div
          onClick={() => !uploading && inputRef.current?.click()}
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files) }}
          style={{
            border: `2px dashed ${borderColor}`,
            borderRadius: 8,
            padding: compact ? '8px 12px' : '12px',
            textAlign: 'center',
            cursor: uploading ? 'wait' : 'pointer',
            background: dragOver ? 'var(--ibs-navy-50, #f0f7ff)' : 'var(--bg-secondary)',
            transition: 'all 0.2s',
            opacity: disabled ? 0.6 : 1,
          }}
        >
          <input
            ref={inputRef}
            type="file"
            accept={accept}
            multiple
            style={{ display: 'none' }}
            onChange={e => handleFiles(e.target.files)}
            disabled={disabled || uploading}
          />
          {uploading ? (
            <span style={{ fontSize: '0.8rem', color: 'var(--accent)' }}>⏳ Đang upload...</span>
          ) : (
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              {dragOver ? '📂 Thả file vào đây' : `📎 Chọn hoặc kéo thả file${compact ? '' : ' (nhiều file)'}`}
            </span>
          )}
        </div>
      )}

      {disabled && files.length === 0 && (
        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
          Không có tập nào được chọn
        </div>
      )}

      {error && (
        <div style={{ fontSize: '0.75rem', color: '#dc2626', marginTop: 4, fontWeight: 500 }}>⚠️ {error}</div>
      )}
    </div>
  )
}
