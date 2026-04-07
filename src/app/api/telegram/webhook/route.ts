import { NextRequest } from 'next/server'
import { webhookCallback } from 'grammy'
import { getBot, getWebhookSecret } from '@/lib/telegram'

// POST /api/telegram/webhook — Receives updates from Telegram
// Auth: verified by X-Telegram-Bot-Api-Secret-Token header (set during webhook registration)
// Middleware exclusion: bypasses JWT auth (handled here via secret)
export async function POST(req: NextRequest) {
  const headerSecret = req.headers.get('x-telegram-bot-api-secret-token')
  const expectedSecret = await getWebhookSecret()
  if (!expectedSecret || headerSecret !== expectedSecret) {
    return new Response('Unauthorized', { status: 401 })
  }

  const bot = await getBot()
  if (!bot) {
    return new Response('Bot not configured', { status: 503 })
  }

  try {
    const handler = webhookCallback(bot, 'std/http')
    return handler(req)
  } catch (err) {
    console.error('Telegram webhook error:', err)
    return new Response('Internal error', { status: 500 })
  }
}
