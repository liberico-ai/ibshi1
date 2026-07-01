import prisma from './db'

const TIMEOUT_MS = 15_000
const CACHE_TTL_MS = 5 * 60_000
let configCache: { baseUrl: string; apiKey: string; cachedAt: number } | null = null

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

async function getConfig() {
  if (configCache && Date.now() - configCache.cachedAt < CACHE_TTL_MS) {
    return configCache
  }

  let baseUrl = process.env.SALE_BASE_URL || ''
  let apiKey = process.env.SALE_INBOUND_API_KEY || ''

  if (!baseUrl || !apiKey) {
    const rows = await prisma.systemConfig.findMany({
      where: { key: { in: ['SALE_BASE_URL', 'SALE_INBOUND_API_KEY'] } },
    })
    for (const r of rows) {
      if (r.key === 'SALE_BASE_URL' && !baseUrl) baseUrl = r.value
      if (r.key === 'SALE_INBOUND_API_KEY' && !apiKey) apiKey = r.value
    }
  }

  if (!baseUrl || !apiKey) {
    throw new SaleClientError('SALE_BASE_URL hoặc SALE_INBOUND_API_KEY chưa cấu hình', 503, 'ENV_MISSING')
  }

  configCache = { baseUrl: baseUrl.replace(/\/$/, ''), apiKey, cachedAt: Date.now() }
  return configCache
}

async function saleFetch<T>(path: string, params?: Record<string, string>): Promise<T> {
  const { baseUrl, apiKey } = await getConfig()
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

  return body
}

export interface SaleCustomerDTO {
  customerId: string
  name: string
  taxCode?: string | null
  country?: string | null
  address?: string | null
  paymentTerms?: string | null
  updatedAt?: string
}

export interface ListCustomersRawResponse {
  ok: boolean
  data: SaleCustomerDTO[]
  total: number
  page: number
  pageSize: number
}

export interface ListCustomersResponse {
  customers: SaleCustomerDTO[]
  total: number
  page: number
  pageSize: number
  hasMore: boolean
}

export const saleClient = {
  async listCustomers(opts: { modifiedSince?: string; page?: number }): Promise<ListCustomersResponse> {
    const params: Record<string, string> = {}
    if (opts.modifiedSince) params.modifiedSince = opts.modifiedSince
    if (opts.page) params.page = String(opts.page)
    const raw = await saleFetch<ListCustomersRawResponse>('/api/external/v1/customers', params)
    return {
      customers: raw.data,
      total: raw.total,
      page: raw.page,
      pageSize: raw.pageSize,
      hasMore: raw.page * raw.pageSize < raw.total,
    }
  },

  async getCustomer(id: string): Promise<SaleCustomerDTO> {
    const raw = await saleFetch<{ ok: boolean; data: SaleCustomerDTO }>(`/api/external/v1/customers/${encodeURIComponent(id)}`)
    return raw.data
  },

  async ping(): Promise<{ ok: boolean }> {
    const raw = await saleFetch<ListCustomersRawResponse>('/api/external/v1/customers', { limit: '1' })
    return { ok: raw.ok }
  },
}
