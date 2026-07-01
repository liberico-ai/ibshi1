const TIMEOUT_MS = 15_000

export class SaleClientError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
  ) {
    super(message)
    this.name = 'SaleClientError'
  }
}

function getConfig() {
  const baseUrl = process.env.SALE_BASE_URL
  const apiKey = process.env.SALE_INBOUND_API_KEY
  if (!baseUrl || !apiKey) {
    throw new SaleClientError('SALE_BASE_URL hoặc SALE_INBOUND_API_KEY chưa cấu hình', 503, 'ENV_MISSING')
  }
  return { baseUrl: baseUrl.replace(/\/$/, ''), apiKey }
}

async function saleFetch<T>(path: string, params?: Record<string, string>): Promise<T> {
  const { baseUrl, apiKey } = getConfig()
  const url = new URL(path, baseUrl)
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v) url.searchParams.set(k, v)
    }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  let res: Response
  try {
    res = await fetch(url.toString(), {
      headers: { 'X-API-Key': apiKey, Accept: 'application/json' },
      signal: controller.signal,
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new SaleClientError('Sale API timeout (15s)', 504, 'TIMEOUT')
    }
    throw new SaleClientError(`Sale API unreachable: ${(err as Error).message}`, 503, 'NETWORK')
  } finally {
    clearTimeout(timer)
  }

  if (res.status === 401) {
    throw new SaleClientError('Sale API key không hợp lệ', 401, 'UNAUTHORIZED')
  }
  if (res.status === 503) {
    throw new SaleClientError('Sale API đang bảo trì', 503, 'UNAVAILABLE')
  }

  const body = await res.json().catch(() => null)
  if (!res.ok || !body) {
    throw new SaleClientError(
      `Sale API lỗi ${res.status}: ${body?.error || res.statusText}`,
      res.status,
      'API_ERROR',
    )
  }

  if (body.ok === false) {
    throw new SaleClientError(body.error || 'Sale API trả lỗi', 422, 'SALE_ERROR')
  }

  return body.data ?? body
}

export interface SaleCustomerDTO {
  id: string
  name: string
  code?: string
  taxCode?: string
  country?: string
  address?: string
  paymentTerms?: string
  updatedAt?: string
}

interface ListCustomersResponse {
  customers: SaleCustomerDTO[]
  nextCursor?: string
  hasMore: boolean
}

export const saleClient = {
  async listCustomers(opts: { modifiedSince?: string; limit?: number; page?: number }): Promise<ListCustomersResponse> {
    const params: Record<string, string> = {}
    if (opts.modifiedSince) params.modifiedSince = opts.modifiedSince
    if (opts.limit) params.limit = String(opts.limit)
    if (opts.page) params.page = String(opts.page)
    return saleFetch<ListCustomersResponse>('/api/v1/customers', params)
  },

  async getCustomer(id: string): Promise<SaleCustomerDTO> {
    return saleFetch<SaleCustomerDTO>(`/api/v1/customers/${encodeURIComponent(id)}`)
  },

  async ping(): Promise<{ ok: boolean }> {
    return saleFetch<{ ok: boolean }>('/api/v1/ping')
  },
}
