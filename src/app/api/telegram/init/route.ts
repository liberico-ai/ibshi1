import { startPolling, isPolling } from '@/lib/telegram'

// Called by Docker HEALTHCHECK to start bot polling
// This runs INSIDE the container (localhost:3000), bypasses nginx
export async function GET() {
  if (isPolling()) {
    return Response.json({ ok: true, status: 'already_running' })
  }
  const started = await startPolling()
  return Response.json({ ok: started, status: started ? 'started' : 'failed' })
}
