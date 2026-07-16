'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { apiFetch } from '@/hooks/useAuth'
import { Camera, X } from 'lucide-react'

interface MPhotoCaptureProps {
  /** entityType phải nằm trong allowlist của /api/upload — dùng 'General'. */
  entityType?: string
  /** Khóa nhóm ảnh, vd `inspection_{id}`. Cùng khóa thì desktop đọc lại được. */
  entityId: string
  label?: string
  disabled?: boolean
}

interface Photo {
  id: string
  fileName: string
}

const MAX_EDGE = 1600
const JPEG_QUALITY = 0.8

/**
 * Chụp ảnh hiện trường: gọi camera của OS qua <input capture>, KHÔNG dùng
 * getUserMedia (bị Permissions-Policy chặn). Ảnh được resize client-side
 * xuống ≤1600px trước khi upload — ảnh 12MP qua 4G yếu ở xưởng sẽ fail.
 */
export function MPhotoCapture({
  entityType = 'General',
  entityId,
  label = 'Ảnh hiện trường',
  disabled,
}: MPhotoCaptureProps) {
  const [photos, setPhotos] = useState<Photo[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const loadExisting = useCallback(async () => {
    const res = await apiFetch(
      `/api/upload?entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId)}`,
    )
    if (res.ok && res.attachments) {
      setPhotos(res.attachments.map((a: { id: string; fileName: string }) => ({ id: a.id, fileName: a.fileName })))
    }
  }, [entityType, entityId])

  useEffect(() => { loadExisting() }, [loadExisting])

  async function shrink(file: File): Promise<Blob> {
    const bmp = await createImageBitmap(file)
    const scale = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height))
    const w = Math.round(bmp.width * scale)
    const h = Math.round(bmp.height * scale)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, w, h)
    bmp.close()
    return new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('resize fail'))),
        'image/jpeg',
        JPEG_QUALITY,
      ),
    )
  }

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (inputRef.current) inputRef.current.value = ''
    if (!file) return

    setErr('')
    setBusy(true)
    try {
      const blob = await shrink(file)
      const name = `anh-${Date.now()}.jpg`
      const fd = new FormData()
      fd.append('file', new File([blob], name, { type: 'image/jpeg' }))
      fd.append('entityType', entityType)
      fd.append('entityId', entityId)
      const token = sessionStorage.getItem('ibs_token')
      const res = await fetch('/api/upload', {
        method: 'POST',
        body: fd,
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      }).then((r) => r.json())
      if (res.ok && res.attachment) {
        setPhotos((p) => [{ id: res.attachment.id, fileName: res.attachment.fileName }, ...p])
      } else {
        setErr(res.error || 'Không tải ảnh lên được')
      }
    } catch {
      setErr('Lỗi xử lý ảnh')
    }
    setBusy(false)
  }

  async function remove(id: string) {
    setPhotos((p) => p.filter((x) => x.id !== id))
    await apiFetch(`/api/upload/${id}`, { method: 'DELETE' }).catch(() => {})
  }

  return (
    <div>
      {label && <label className="m-label">{label}{photos.length > 0 && ` (${photos.length})`}</label>}

      {photos.length > 0 && (
        <div className="m-photos" style={{ marginBottom: 10 }}>
          {photos.map((p) => (
            <div className="m-photo" key={p.id}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/upload/${p.id}`} alt={p.fileName} />
              {!disabled && (
                <button type="button" aria-label="Xóa ảnh" onClick={() => remove(p.id)}>
                  <X size={15} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {!disabled && (
        <button
          type="button"
          className="m-btn m-btn-dashed"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          <Camera size={20} color="var(--m-red)" />
          {busy ? 'Đang tải ảnh…' : 'Chụp ảnh hiện trường'}
        </button>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        style={{ display: 'none' }}
        onChange={onPick}
      />

      {err && <div className="m-note m-note-err" style={{ marginTop: 8 }}><span>{err}</span></div>}
    </div>
  )
}
