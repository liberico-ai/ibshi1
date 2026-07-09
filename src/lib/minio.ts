import { Client } from 'minio'

/**
 * MinIO (S3-compatible) client cho lưu trữ tài liệu upload.
 * Cấu hình qua env (đặt ở nơi deploy — KHÔNG hardcode):
 *   MINIO_ENDPOINT   host, vd "minio.liberico.com.vn"
 *   MINIO_PORT       (tuỳ chọn) mặc định 443 nếu SSL, 80 nếu không
 *   MINIO_USE_SSL    "true" (mặc định) | "false"
 *   MINIO_ACCESS_KEY / MINIO_SECRET_KEY
 *   MINIO_BUCKET     mặc định "ibshi"
 *
 * Object key = fileUrl bỏ dấu "/" đầu, vd "/uploads/taskdoc/x/f.pdf" → "uploads/taskdoc/x/f.pdf".
 * Client lazy: chỉ khởi tạo khi gọi thật (build/test không cần env).
 */

const g = globalThis as unknown as { __minioClient?: Client }

function client(): Client {
  if (!g.__minioClient) {
    const endPoint = process.env.MINIO_ENDPOINT
    if (!endPoint) throw new Error('MINIO_ENDPOINT chưa cấu hình (env)')
    const useSSL = (process.env.MINIO_USE_SSL ?? 'true') !== 'false'
    const port = process.env.MINIO_PORT ? parseInt(process.env.MINIO_PORT, 10) : (useSSL ? 443 : 80)
    g.__minioClient = new Client({
      endPoint, port, useSSL,
      accessKey: process.env.MINIO_ACCESS_KEY || '',
      secretKey: process.env.MINIO_SECRET_KEY || '',
    })
  }
  return g.__minioClient
}

export const MINIO_BUCKET = process.env.MINIO_BUCKET || 'ibshi'

/** MinIO đã cấu hình chưa (có endpoint). Dùng để chuyển đổi mềm disk↔MinIO trong giai đoạn migrate. */
export function isMinioConfigured(): boolean {
  return !!process.env.MINIO_ENDPOINT
}

/** fileUrl ("/uploads/...") → object key ("uploads/...") */
export function keyFromFileUrl(fileUrl: string): string {
  return fileUrl.replace(/^\/+/, '')
}

export async function putObject(key: string, buffer: Buffer, mimeType: string): Promise<void> {
  await client().putObject(MINIO_BUCKET, key, buffer, buffer.length, { 'Content-Type': mimeType })
}

export async function getObjectBuffer(key: string): Promise<Buffer> {
  const stream = await client().getObject(MINIO_BUCKET, key)
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks)
}

export async function removeObject(key: string): Promise<void> {
  await client().removeObject(MINIO_BUCKET, key)
}

export async function objectExists(key: string): Promise<boolean> {
  try {
    await client().statObject(MINIO_BUCKET, key)
    return true
  } catch {
    return false
  }
}
