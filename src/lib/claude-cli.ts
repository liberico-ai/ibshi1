import { spawn } from 'node:child_process'

// Gọi Claude CLI (claude -p) bằng tài khoản đã đăng nhập trên máy chạy server.
// Không cần API key trong code. Chỉ dùng được nơi có cài + login `claude`.
export function isClaudeEnabled(): boolean {
  // Bật ở môi trường dev, hoặc khi set CLAUDE_CLI=1
  return process.env.CLAUDE_CLI === '1' || process.env.NODE_ENV !== 'production'
}

export function runClaude(prompt: string, timeoutMs = 90000): Promise<string> {
  return new Promise((resolve, reject) => {
    const bin = process.env.CLAUDE_CLI_PATH || 'claude'
    const args = ['-p', prompt]
    if (process.env.CLAUDE_MODEL) args.push('--model', process.env.CLAUDE_MODEL)
    let out = '', err = ''
    let child
    try {
      child = spawn(bin, args, { env: process.env })
    } catch (e) {
      reject(e); return
    }
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Claude CLI quá thời gian')) }, timeoutMs)
    child.stdout.on('data', (d) => (out += d.toString()))
    child.stderr.on('data', (d) => (err += d.toString()))
    child.on('error', (e: NodeJS.ErrnoException) => {
      clearTimeout(timer)
      reject(new Error(e.code === 'ENOENT' ? 'Không tìm thấy lệnh `claude` trên máy chủ' : e.message))
    })
    child.on('close', (code) => { clearTimeout(timer); code === 0 ? resolve(out) : reject(new Error(err.trim() || `claude thoát mã ${code}`)) })
  })
}

// Trích khối JSON đầu tiên (mảng/đối tượng) từ phản hồi văn bản của AI
export function extractJson<T = unknown>(text: string): T {
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '')
  const start = cleaned.search(/[[{]/)
  if (start < 0) throw new Error('Phản hồi AI không chứa JSON')
  const open = cleaned[start]
  const close = open === '[' ? ']' : '}'
  let depth = 0, inStr = false, esc = false
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
    } else if (ch === '"') inStr = true
    else if (ch === open) depth++
    else if (ch === close) { depth--; if (depth === 0) return JSON.parse(cleaned.slice(start, i + 1)) as T }
  }
  throw new Error('JSON trong phản hồi AI không hợp lệ')
}
