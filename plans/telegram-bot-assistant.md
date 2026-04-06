# Blueprint: IBS-ERP Telegram Bot Assistant

> **Objective:** Build a Telegram bot integrated into the IBS ERP system that (1) pushes real-time task notifications to the company group chat, and (2) responds to slash commands for project status, progress tracking, and task management.
>
> **Generated:** 2026-04-06
> **Repository:** liberico-ai/ibshi1
> **Base branch:** main
> **Steps:** 8 (2 parallel groups)
> **Estimated PRs:** 8

---

## Problem Statement

Currently, when a workflow task is activated (e.g., P4.5 warehouse issue, P1.3 approval), the ERP only creates in-app `Notification` records. Users must log into the web dashboard to see their tasks. This causes:
- **Delayed response** — users don't check the dashboard frequently
- **No group visibility** — team leads and directors can't see workflow progress without logging in
- **No quick queries** — checking "which tasks are overdue?" requires navigating multiple pages

**Solution:** A Telegram bot that:
1. **Push notifications** to a company group when any task activates, is rejected, or goes overdue
2. **Slash commands** for project status, task lookup, progress reports, and account linking

---

## Proposed Command List

| Command | Description | Example Response |
|---------|-------------|-----------------|
| `/help` | Danh sách tất cả lệnh | Hiển thị bảng lệnh |
| `/link <username>` | Liên kết tài khoản Telegram → ERP | "Đã liên kết @telegram_user với giangdd (PM)" |
| `/unlink` | Hủy liên kết tài khoản | "Đã hủy liên kết" |
| `/mytasks` | Công việc đang chờ tôi | Danh sách IN_PROGRESS tasks theo role/user |
| `/status <mã_DA>` | Tổng quan tiến độ dự án | Progress bar + phase breakdown + current active steps |
| `/overdue` | Tất cả task quá hạn | List sorted by hours overdue |
| `/phase <mã_DA> <1-6>` | Chi tiết phase cụ thể | Task list + done/progress/pending counts |
| `/project <mã_DA>` | Thông tin dự án | Client, PM, contract value, start/end dates |
| `/search <từ_khóa>` | Tìm dự án/task | Top 5 kết quả match projectCode/projectName |
| `/report` | Báo cáo tổng hợp toàn công ty | Active projects count, overdue count, completion rates |
| `/whois <role_code>` | Ai đang giữ role này? | Danh sách users theo role |
| `/deadline <mã_DA>` | Các deadline sắp tới | Tasks sorted by deadline, highlight ≤ 3 days |

### Notification Format (Push to Group)

```
📋 CÔNG VIỆC MỚI
━━━━━━━━━━━━━━━━
📁 Dự án: PRJ-2026-001 — Tháp nén khí
📌 Bước: P4.5 — Kho cấp vật tư cho nội bộ sản xuất
👤 Phụ trách: R05 (Kho)
⏰ Deadline: 08/04/2026
🔗 Chi tiết: https://erp.ibs.vn/dashboard/tasks/xxx
```

### Rejection Notification Format

```
⚠️ CÔNG VIỆC BỊ TỪ CHỐI
━━━━━━━━━━━━━━━━━━━━━
📁 Dự án: PRJ-2026-001 — Tháp nén khí
📌 Bước: P5.3 — QC kiểm tra
❌ Lý do: Mối hàn không đạt — cần sửa lại
🔄 Quay về: P5.1 (Tổ sản xuất thực hiện)
```

### Overdue Notification Format

```
🚨 CẢNH BÁO QUÁ HẠN
━━━━━━━━━━━━━━━━━━━
📁 Dự án: PRJ-2026-001
📌 Bước: P3.6 — BGĐ duyệt báo giá NCC
⏰ Quá hạn: 12 giờ
👤 Phụ trách: R01 (Ban Giám đốc)
```

---

## Dependency Graph

```
[1] Schema migration + Telegram service lib
 │
 ├──[2] Webhook API route + bot registration      ──┐
 ├──[3] Push notification hooks (workflow-engine)    ├─ PARALLEL GROUP A
 │                                                   │
 [4] Command handler framework  (depends on 1 + 2)  ┘
 │
 [5] Core commands (/mytasks, /status, /overdue)
 │
 [6] Info commands (/project, /phase, /search)  (depends on 5 — same file)
 │
 [7] /link account flow + admin /report
 │
 [8] Integration tests + cron extension + deployment
```

> **Critical path:** 1 → 2 → 4 → 5 → 6 → 7 → 8
> **Max parallelism:** 2 concurrent (steps 2+3 only — steps 5+6 serialize on same file)

---

## Invariants (verified after every step)

1. `npx tsc --noEmit 2>&1 | grep -v "__tests__" | grep "error TS"` → empty
2. `npm run build` passes
3. `npx vitest run` → no new failures (278 currently passing)
4. Existing E2E tests (13) not broken
5. No secrets committed (bot token in env only)

---

## Step 1: Schema Migration + Telegram Service Library

- **Branch:** `feat/telegram-bot-schema`
- **Depends on:** none
- **Model tier:** default
- **Files created:** `src/lib/telegram.ts`, `prisma/migrations/xxx_add_telegram_fields/`
- **Files modified:** `prisma/schema.prisma`, `.env.example`

### Context Brief

The IBS ERP uses Prisma 7.5 + PostgreSQL. The `User` model has no Telegram fields. The `Notification` model exists with types like `task_assigned`, `DEADLINE_ALERT`, `ESCALATION`. We need to:
1. Add `telegramChatId` to User model (for `/link` command and DM support)
2. Add a `TelegramConfig` model to store the company group chat ID
3. Create a Telegram service library that wraps the Bot API

No existing Telegram or bot libraries are installed. We'll use `grammy` (lightweight, TypeScript-native, well-maintained) over `node-telegram-bot-api` (older, callback-based).

### Tasks

1. **Install dependency:**
   ```bash
   npm install grammy
   ```

2. **Update `prisma/schema.prisma` — Add Telegram fields to User:**
   ```prisma
   model User {
     // ... existing fields ...
     telegramChatId  String?  @unique @map("telegram_chat_id")
   }
   ```

3. **Group chat ID via env var (MVP):**
   - Use `TELEGRAM_GROUP_CHAT_ID` env var instead of a DB table
   - Avoids an extra Prisma model, migration, and DB query per message
   - If dynamic config is needed later, add a `TelegramConfig` model then

4. **Run migration:**
   ```bash
   npx prisma migrate dev --name add_telegram_fields
   npx prisma generate
   ```

5. **Update `.env.example`:**
   ```env
   # Telegram Bot
   TELEGRAM_BOT_TOKEN=          # From @BotFather
   TELEGRAM_WEBHOOK_SECRET=     # Random string for webhook verification
   TELEGRAM_GROUP_CHAT_ID=      # Company group chat ID (get via getUpdates after adding bot)
   NEXT_PUBLIC_APP_URL=         # e.g., https://erp.ibs.vn (for task links in messages)
   ```

6. **Create `src/lib/telegram.ts`** — Core Telegram service:
   ```typescript
   import { Bot } from 'grammy'
   import prisma from '@/lib/db'

   // Singleton bot instance (lazy init)
   let botInstance: Bot | null = null

   export function getBot(): Bot | null {
     if (!process.env.TELEGRAM_BOT_TOKEN) return null
     if (!botInstance) {
       botInstance = new Bot(process.env.TELEGRAM_BOT_TOKEN)
     }
     return botInstance
   }

   // Get configured group chat ID from env var
   export function getGroupChatId(): string | null {
     return process.env.TELEGRAM_GROUP_CHAT_ID || null
   }

   // Send message to company group
   export async function sendGroupMessage(text: string): Promise<void> {
     const bot = getBot()
     if (!bot) return
     const chatId = await getGroupChatId()
     if (!chatId) return
     try {
       await bot.api.sendMessage(chatId, text, { parse_mode: 'HTML' })
     } catch (err) {
       console.error('Telegram sendGroupMessage error:', err)
     }
   }

   // Send DM to a specific user (by their ERP user ID)
   export async function sendDirectMessage(userId: string, text: string): Promise<void> {
     const bot = getBot()
     if (!bot) return
     const user = await prisma.user.findUnique({
       where: { id: userId },
       select: { telegramChatId: true },
     })
     if (!user?.telegramChatId) return
     try {
       await bot.api.sendMessage(user.telegramChatId, text, { parse_mode: 'HTML' })
     } catch (err) {
       console.error('Telegram sendDM error:', err)
     }
   }

   // Format helpers
   export function escapeHtml(text: string): string {
     return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
   }

   export function formatDeadline(deadline: Date | null): string {
     if (!deadline) return 'Không có'
     return new Intl.DateTimeFormat('vi-VN', {
       day: '2-digit', month: '2-digit', year: 'numeric',
     }).format(new Date(deadline))
   }
   ```

### Verification

```bash
npx prisma migrate dev --name add_telegram_fields
npx prisma generate
npx tsc --noEmit 2>&1 | grep -v "__tests__" | grep "error TS"
npm run build
npx vitest run --reporter=verbose 2>&1 | tail -20
```

### Exit Criteria

- `grammy` installed in package.json
- User model has `telegramChatId` field
- `TelegramConfig` model exists
- `src/lib/telegram.ts` exports `sendGroupMessage`, `sendDirectMessage`, `getBot`
- Migration applied cleanly
- Build passes

### Rollback

```bash
# Dev: reset DB to before migration (destructive — dev only!)
npx prisma migrate reset
# Or: git revert <sha> + manual down migration in production
npm uninstall grammy
```

---

## Step 2: Webhook API Route + Bot Registration

- **Branch:** `feat/telegram-webhook`
- **Depends on:** Step 1
- **Model tier:** default
- **Parallel group:** A (steps 2, 3)
- **Files created:** `src/app/api/telegram/webhook/route.ts`, `src/app/api/telegram/setup/route.ts`
- **Files modified:** `src/middleware.ts` (exclude telegram webhook from JWT auth)

### Context Brief

Telegram bots receive updates via webhook (POST to our server) or long-polling. Since we're on Next.js with API routes, webhook is the right approach. We need:
1. A POST `/api/telegram/webhook` endpoint that receives Telegram updates
2. A GET `/api/telegram/setup` endpoint (admin-only) to register the webhook with Telegram
3. Middleware exclusion for the webhook route (Telegram sends requests, not our users)

The middleware at `src/middleware.ts` (139 lines) protects all `/api/*` routes except `/api/auth/login`, `/api/health`, and cron routes. We need to add `/api/telegram/webhook` to the exclusion list. The cron routes use `X-Cron-Secret` header — we'll use `TELEGRAM_WEBHOOK_SECRET` for the webhook route.

### Tasks

1. **Create `src/app/api/telegram/webhook/route.ts`:**
   ```typescript
   import { NextRequest } from 'next/server'
   import { getBot } from '@/lib/telegram'
   import { webhookCallback } from 'grammy'

   export async function POST(req: NextRequest) {
     // Verify webhook secret
     const secret = req.headers.get('x-telegram-bot-api-secret-token')
     if (secret !== process.env.TELEGRAM_WEBHOOK_SECRET) {
       return new Response('Unauthorized', { status: 401 })
     }

     const bot = getBot()
     if (!bot) {
       return new Response('Bot not configured', { status: 503 })
     }

     // Delegate to grammy's webhook handler
     const handler = webhookCallback(bot, 'std/http')
     return handler(req)
   }
   ```

2. **Create `src/app/api/telegram/setup/route.ts`** (admin-only):
   ```typescript
   import { NextRequest } from 'next/server'
   import { authenticateRequest, successResponse, errorResponse, unauthorizedResponse } from '@/lib/auth'
   import { getBot } from '@/lib/telegram'
   import prisma from '@/lib/db'

   // POST /api/telegram/setup — Register webhook + store group chat ID
   export async function POST(req: NextRequest) {
     const payload = await authenticateRequest(req)
     if (!payload) return unauthorizedResponse()
     if (payload.roleCode !== 'R01' && payload.roleCode !== 'R10') {
       return errorResponse('Only R01/R10 can configure Telegram', 403)
     }

     const bot = getBot()
     if (!bot) return errorResponse('TELEGRAM_BOT_TOKEN not set', 500)

     const appUrl = process.env.NEXT_PUBLIC_APP_URL
     if (!appUrl) return errorResponse('NEXT_PUBLIC_APP_URL not set', 500)

     // Register webhook with Telegram
     await bot.api.setWebhook(`${appUrl}/api/telegram/webhook`, {
       secret_token: process.env.TELEGRAM_WEBHOOK_SECRET,
     })

     // Note: group chat ID is configured via TELEGRAM_GROUP_CHAT_ID env var
     const groupChatId = process.env.TELEGRAM_GROUP_CHAT_ID
     return successResponse({ webhookSet: true, groupChatId: groupChatId || 'not set — add TELEGRAM_GROUP_CHAT_ID to .env' })
   }
   ```

3. **Update `src/middleware.ts`** — Add telegram webhook exclusion:
   - Do NOT add to `PUBLIC_ROUTES` array (that skips all auth including rate limiting)
   - Instead, add a dedicated block AFTER the cron-route check (line ~100), matching existing pattern:
   ```typescript
   // Telegram webhook — verified by its own secret token (in the route handler)
   if (pathname.startsWith('/api/telegram/webhook')) {
     return NextResponse.next()
   }
   ```
   - The webhook route handler itself verifies `TELEGRAM_WEBHOOK_SECRET` header (see Step 2 task 1)

### Verification

```bash
npx tsc --noEmit 2>&1 | grep -v "__tests__" | grep "error TS"
npm run build
```

### Exit Criteria

- Webhook POST route accepts Telegram updates with secret verification
- Setup route (admin-only) registers webhook and stores group chat ID
- Middleware excludes webhook route from JWT auth
- Build passes

### Rollback

```bash
git revert <sha>
```

---

## Step 3: Push Notification Hooks (Workflow Engine Integration)

- **Branch:** `feat/telegram-push-notifications`
- **Depends on:** Step 1
- **Model tier:** strongest (Opus) — modifying critical workflow-engine.ts
- **Parallel group:** A (steps 2, 3)
- **Files modified:** `src/lib/workflow-engine.ts`, `src/lib/telegram.ts`
- **Files created:** `src/lib/telegram-notifications.ts`

### Context Brief

The workflow engine (`src/lib/workflow-engine.ts`, 776 lines) has 3 key notification points:

1. **`activateTask()`** (line 633-682) — Task moves to IN_PROGRESS, creates DB notifications for role users
2. **`rejectTask()`** (approx line 290-316) — Task rejected, creates REJECTED notification
3. **Cron `deadline-check`** (`src/app/api/cron/deadline-check/route.ts`, 97 lines) — Overdue/escalation notifications

We need to add Telegram group messages at each point WITHOUT modifying the existing notification logic. Approach: create a `src/lib/telegram-notifications.ts` that formats and sends messages, then call it from the 3 trigger points.

**CRITICAL:** `workflow-engine.ts` is a HIGH-risk file (used by all 36 steps). Changes must be minimal — add 1 import and 1-3 function calls. All formatting logic goes in the new file.

### Tasks

1. **Create `src/lib/telegram-notifications.ts`:**
   ```typescript
   import { sendGroupMessage, escapeHtml, formatDeadline } from '@/lib/telegram'
   import { ROLES } from '@/lib/constants'

   interface TaskNotifyData {
     stepCode: string
     stepName: string
     projectCode: string
     projectName: string
     assignedRole: string
     deadline: Date | null
     taskId: string
   }

   export async function notifyTaskActivated(data: TaskNotifyData): Promise<void> {
     const roleName = ROLES[data.assignedRole as keyof typeof ROLES]?.name || data.assignedRole
     const appUrl = process.env.NEXT_PUBLIC_APP_URL || ''
     const msg = [
       '📋 <b>CÔNG VIỆC MỚI</b>',
       '━━━━━━━━━━━━━━━━',
       `📁 Dự án: <b>${escapeHtml(data.projectCode)}</b> — ${escapeHtml(data.projectName)}`,
       `📌 Bước: <b>${escapeHtml(data.stepCode)}</b> — ${escapeHtml(data.stepName)}`,
       `👤 Phụ trách: ${escapeHtml(data.assignedRole)} (${escapeHtml(roleName)})`,
       `⏰ Deadline: ${formatDeadline(data.deadline)}`,
       appUrl ? `🔗 <a href="${appUrl}/dashboard/tasks/${data.taskId}">Xem chi tiết</a>` : '',
     ].filter(Boolean).join('\n')
     await sendGroupMessage(msg)
   }

   export async function notifyTaskRejected(data: TaskNotifyData & {
     reason: string; returnedTo: string; returnedStepName: string
   }): Promise<void> {
     const msg = [
       '⚠️ <b>CÔNG VIỆC BỊ TỪ CHỐI</b>',
       '━━━━━━━━━━━━━━━━━━━━━',
       `📁 Dự án: <b>${escapeHtml(data.projectCode)}</b> — ${escapeHtml(data.projectName)}`,
       `📌 Bước: <b>${escapeHtml(data.stepCode)}</b> — ${escapeHtml(data.stepName)}`,
       `❌ Lý do: ${escapeHtml(data.reason)}`,
       `🔄 Quay về: ${escapeHtml(data.returnedTo)} (${escapeHtml(data.returnedStepName)})`,
     ].join('\n')
     await sendGroupMessage(msg)
   }

   export async function notifyTaskOverdue(data: {
     stepCode: string; stepName: string;
     projectCode: string; projectName: string;
     assignedRole: string; hoursOverdue: number
   }): Promise<void> {
     const roleName = ROLES[data.assignedRole as keyof typeof ROLES]?.name || data.assignedRole
     const emoji = data.hoursOverdue > 48 ? '🚨' : '⏰'
     const label = data.hoursOverdue > 48 ? 'LEO THANG — QUÁ HẠN NGHIÊM TRỌNG' : 'CẢNH BÁO QUÁ HẠN'
     const msg = [
       `${emoji} <b>${label}</b>`,
       '━━━━━━━━━━━━━━━━━━━',
       `📁 Dự án: <b>${escapeHtml(data.projectCode)}</b> — ${escapeHtml(data.projectName)}`,
       `📌 Bước: <b>${escapeHtml(data.stepCode)}</b> — ${escapeHtml(data.stepName)}`,
       `⏰ Quá hạn: <b>${data.hoursOverdue} giờ</b>`,
       `👤 Phụ trách: ${escapeHtml(data.assignedRole)} (${escapeHtml(roleName)})`,
     ].join('\n')
     await sendGroupMessage(msg)
   }
   ```

2. **Modify `src/lib/workflow-engine.ts` — Add Telegram push in `activateTask()`:**
   - After the notification createMany block (line ~678), add:
   ```typescript
   import { notifyTaskActivated } from '@/lib/telegram-notifications'
   // ... inside activateTask(), after createMany:
   notifyTaskActivated({
     stepCode, stepName: rule.name, projectCode: project.projectCode,
     projectName: project.projectName, assignedRole: rule.role,
     deadline: rule.deadlineDays ? new Date(Date.now() + rule.deadlineDays * 86400000) : null,
     taskId: task.id,
   }).catch(err => console.error('Telegram notify error:', err))
   ```
   - NOTE: Use `.catch()` fire-and-forget — Telegram failure must NEVER block workflow

3. **Modify `src/lib/workflow-engine.ts` — Add Telegram push in `rejectTask()`:**
   - After rejection notification creation, add `notifyTaskRejected(...)` call

4. **Modify `src/app/api/cron/deadline-check/route.ts` — Add Telegram overdue alerts:**
   - After each `prisma.notification.create()`, add `notifyTaskOverdue(...)` call

### Verification

```bash
npx tsc --noEmit 2>&1 | grep -v "__tests__" | grep "error TS"
npm run build
npx vitest run --reporter=verbose 2>&1 | tail -20
```

### Exit Criteria

- `telegram-notifications.ts` formats 3 notification types (activated, rejected, overdue)
- `workflow-engine.ts` has exactly 2 new lines (import + call in activateTask, import + call in rejectTask)
- `deadline-check/route.ts` has 1 new import + 1 call
- Telegram errors never block workflow — all calls are fire-and-forget
- Build passes, existing tests pass

### Rollback

```bash
git revert <sha>
```

---

## Step 4: Command Handler Framework

- **Branch:** `feat/telegram-commands`
- **Depends on:** Steps 1 + 2
- **Model tier:** default
- **Parallel group:** —
- **Files created:** `src/lib/telegram-commands.ts`
- **Files modified:** `src/lib/telegram.ts`

### Context Brief

Step 2 created the webhook route that receives Telegram updates. Now we need to register command handlers with the grammy Bot instance. The grammy framework uses `bot.command('name', handler)` pattern.

We'll create a single `src/lib/telegram-commands.ts` that registers all commands. The bot initialization in `src/lib/telegram.ts` will call this registration function. Commands are split across Steps 5, 6, 7 — this step just creates the framework and `/help` + `/start`.

### Tasks

1. **Create `src/lib/telegram-commands.ts`:**
   ```typescript
   import { Bot, Context } from 'grammy'
   import prisma from '@/lib/db'

   const COMMAND_LIST = [
     { command: 'help', description: 'Danh sách tất cả lệnh' },
     { command: 'start', description: 'Khởi động bot' },
     { command: 'link', description: 'Liên kết tài khoản ERP: /link <username>' },
     { command: 'unlink', description: 'Hủy liên kết tài khoản' },
     { command: 'mytasks', description: 'Công việc đang chờ tôi' },
     { command: 'status', description: 'Tiến độ dự án: /status <mã_DA>' },
     { command: 'overdue', description: 'Danh sách task quá hạn' },
     { command: 'phase', description: 'Chi tiết phase: /phase <mã_DA> <1-6>' },
     { command: 'project', description: 'Thông tin dự án: /project <mã_DA>' },
     { command: 'search', description: 'Tìm dự án: /search <từ_khóa>' },
     { command: 'report', description: 'Báo cáo tổng hợp toàn công ty' },
     { command: 'whois', description: 'Ai giữ role: /whois <role_code>' },
     { command: 'deadline', description: 'Deadline sắp tới: /deadline <mã_DA>' },
   ]

   export function registerCommands(bot: Bot): void {
     // Register command menu with Telegram
     bot.api.setMyCommands(COMMAND_LIST).catch(console.error)

     // /start
     bot.command('start', async (ctx: Context) => {
       await ctx.reply(
         '👋 Xin chào! Tôi là trợ lý IBS-ERP.\n\n' +
         'Dùng /link <username> để liên kết tài khoản ERP.\n' +
         'Dùng /help để xem danh sách lệnh.',
       )
     })

     // /help
     bot.command('help', async (ctx: Context) => {
       const lines = COMMAND_LIST.map(c => `/${c.command} — ${c.description}`)
       await ctx.reply(
         '📖 <b>DANH SÁCH LỆNH</b>\n━━━━━━━━━━━━━━━━\n' + lines.join('\n'),
         { parse_mode: 'HTML' },
       )
     })
   }

   // Helper: resolve Telegram chat ID → ERP user
   export async function resolveUser(chatId: number) {
     return prisma.user.findUnique({
       where: { telegramChatId: String(chatId) },
       select: { id: true, username: true, fullName: true, roleCode: true },
     })
   }
   ```

2. **Update `src/lib/telegram.ts` — Register commands on bot init:**
   ```typescript
   import { registerCommands } from '@/lib/telegram-commands'

   export function getBot(): Bot | null {
     if (!process.env.TELEGRAM_BOT_TOKEN) return null
     if (!botInstance) {
       botInstance = new Bot(process.env.TELEGRAM_BOT_TOKEN)
       registerCommands(botInstance)  // ← Add this line
     }
     return botInstance
   }
   ```

### Verification

```bash
npx tsc --noEmit 2>&1 | grep -v "__tests__" | grep "error TS"
npm run build
```

### Exit Criteria

- `/start` and `/help` commands respond
- Command menu registered with Telegram
- `resolveUser()` helper maps chatId → ERP user
- Framework ready for commands in Steps 5-7
- Build passes

### Rollback

```bash
git revert <sha>
```

---

## Step 5: Core Commands — /mytasks, /status, /overdue

- **Branch:** `feat/telegram-core-commands`
- **Depends on:** Step 4
- **Model tier:** strongest (Opus) — complex DB queries
- **Parallel group:** B (steps 5, 6)
- **Files modified:** `src/lib/telegram-commands.ts`

### Context Brief

These are the 3 most-used commands. They query Prisma directly using patterns from `task-engine.ts` (getTaskInbox) and `deadline-check/route.ts` (overdue query).

Key query patterns from existing code:
- **User's tasks:** `workflowTask.findMany({ where: { OR: [{ assignedTo: userId }, { assignedRole: roleCode, assignedTo: null }], status: 'IN_PROGRESS' } })`
- **Overdue tasks:** `workflowTask.findMany({ where: { status: 'IN_PROGRESS', deadline: { lt: new Date() } } })`
- **Project progress:** `project.findUnique({ include: { tasks: { select: { stepCode, status } } } })` then count by status

### Tasks

1. **Implement `/mytasks` command:**
   - Resolve Telegram user → ERP user via `resolveUser()`
   - If not linked: reply "Chưa liên kết tài khoản. Dùng /link <username>"
   - Query IN_PROGRESS tasks by user's roleCode or assignedTo
   - Format: numbered list with project code, step code, step name, deadline
   - Limit to 15 tasks, add "... và X task nữa" if more

2. **Implement `/status <projectCode>` command:**
   - Find project by projectCode (case-insensitive)
   - Count tasks by status per phase
   - Calculate overall percentage
   - Format: progress bar per phase + active steps list
   - Example output:
     ```
     📊 TIẾN ĐỘ: PRJ-2026-001
     ━━━━━━━━━━━━━━━━━━
     P1 Khởi tạo    ████████████ 100%  5/5
     P2 Thiết kế     ██████████░░  83%  5/6
     P3 Cung ứng VT  ████░░░░░░░░  29%  2/7
     P4 Sản xuất     ░░░░░░░░░░░░   0%  0/5
     ...
     📈 Tổng: 12/33 (36%)
     🔄 Đang XL: P2.5, P3.2, P3.4
     ```

3. **Implement `/overdue` command:**
   - Query all IN_PROGRESS tasks with deadline < now
   - Sort by hours overdue (most overdue first)
   - Format with warning emoji, project code, step, hours overdue
   - Limit to 20, add count if more

### Verification

```bash
npx tsc --noEmit 2>&1 | grep -v "__tests__" | grep "error TS"
npm run build
```

### Exit Criteria

- `/mytasks` shows user's active tasks
- `/status PRJ-xxx` shows phase-by-phase progress with visual bar
- `/overdue` lists all overdue tasks system-wide
- All handle edge cases (not linked, project not found, no tasks)
- Build passes

### Rollback

```bash
git revert <sha>
```

---

## Step 6: Info Commands — /project, /phase, /search, /whois, /deadline

- **Branch:** `feat/telegram-info-commands`
- **Depends on:** Step 5 (same file: telegram-commands.ts)
- **Model tier:** default
- **Parallel group:** — (serial, after Step 5)
- **Files modified:** `src/lib/telegram-commands.ts`

### Context Brief

These are read-only information commands. They query projects, tasks, and users. All use existing Prisma queries — no workflow mutations.

### Tasks

1. **Implement `/project <code>`:**
   - Lookup project by code (case-insensitive LIKE)
   - Display: code, name, client, PM, contract value, status, start/end dates
   - Include task completion stats

2. **Implement `/phase <code> <1-6>`:**
   - Lookup project + filter tasks by phase
   - Show each task: stepCode, stepName, status emoji, assignee/role, deadline
   - Summary: X/Y completed

3. **Implement `/search <keyword>`:**
   - Search projects by name/code (case-insensitive contains)
   - Return top 5 matches with code, name, status, progress %
   - If no results: "Không tìm thấy dự án"

4. **Implement `/whois <role_code>`:**
   - Lookup users by roleCode (e.g., `/whois R05`)
   - List: fullName, username, active status
   - Include role description from ROLES constant

5. **Implement `/deadline <code>`:**
   - Get project's IN_PROGRESS tasks ordered by deadline ASC
   - Highlight tasks with deadline ≤ 3 days (🔴)
   - Format with countdown: "còn 2 ngày" / "quá hạn 5h"

### Verification

```bash
npx tsc --noEmit 2>&1 | grep -v "__tests__" | grep "error TS"
npm run build
```

### Exit Criteria

- All 5 info commands respond with formatted data
- Edge cases handled (project not found, invalid phase number, empty results)
- Build passes

### Rollback

```bash
git revert <sha>
```

---

## Step 7: /link Account Flow + /report Command

- **Branch:** `feat/telegram-link-report`
- **Depends on:** Step 5
- **Model tier:** default
- **Parallel group:** —
- **Files modified:** `src/lib/telegram-commands.ts`

### Context Brief

The `/link` command connects a Telegram user to their ERP account by username. This enables `/mytasks` and personalized features. The `/report` command gives a company-wide overview for managers.

Security: `/link` requires knowing a valid ERP username. For production, consider adding a verification code flow. For MVP, username match is sufficient since the bot is in a private company group.

### Tasks

1. **Implement `/link <username>`:**
   - Parse username from command arguments
   - Lookup user by username (case-insensitive)
   - If not found: "Không tìm thấy user '...'"
   - If already linked to another Telegram account: "Username đã liên kết với tài khoản Telegram khác"
   - Update `user.telegramChatId = String(ctx.from.id)`
   - Reply: "✅ Đã liên kết @telegram_user với [fullName] ([roleCode])"

2. **Implement `/unlink`:**
   - Find user by current chatId
   - If not linked: "Bạn chưa liên kết tài khoản nào"
   - Clear `telegramChatId`
   - Reply: "✅ Đã hủy liên kết"

3. **Implement `/report`:**
   - Aggregate all ACTIVE projects:
     - Total projects, completed projects
     - Total IN_PROGRESS tasks
     - Total overdue tasks
     - Phase distribution (how many projects in each phase)
   - Per-project summary (top 10 by activity):
     - Code, name, progress %, overdue count
   - Format with clean table layout

### Verification

```bash
npx tsc --noEmit 2>&1 | grep -v "__tests__" | grep "error TS"
npm run build
```

### Exit Criteria

- `/link giangdd` links Telegram user to PM account
- `/unlink` clears the link
- `/report` shows company-wide project summary
- Build passes

### Rollback

```bash
git revert <sha>
```

---

## Step 8: Integration Tests + Cron Extension + Deployment Config

- **Branch:** `feat/telegram-tests-deploy`
- **Depends on:** Step 7
- **Model tier:** default
- **Parallel group:** —
- **Files created:** `src/lib/__tests__/telegram-notifications.test.ts`, `src/lib/__tests__/telegram-commands.test.ts`
- **Files modified:** `src/app/api/cron/deadline-check/route.ts` (if not done in Step 3)

### Context Brief

Final step: add tests for the Telegram integration and deployment configuration. The existing test infrastructure uses Vitest with Prisma mocks (`src/lib/__mocks__/db.ts`). grammy can be mocked via `vi.mock('grammy')`.

### Tasks

1. **Create `src/lib/__tests__/telegram-notifications.test.ts`:**
   - Test `notifyTaskActivated()` — verifies HTML message format
   - Test `notifyTaskRejected()` — verifies rejection message includes reason and returnedTo
   - Test `notifyTaskOverdue()` — verifies escalation emoji for > 48h
   - Test graceful failure when bot token not set (returns silently)
   - Test graceful failure when group chat ID not configured
   - Mock `grammy` Bot instance, verify `sendMessage` called with correct args

2. **Create `src/lib/__tests__/telegram-commands.test.ts`:**
   - Test `/link` — links user, returns confirmation
   - Test `/link` with invalid username — returns error
   - Test `/mytasks` — returns formatted task list
   - Test `/mytasks` without linked account — returns link prompt
   - Test `/status` — returns progress bars
   - Test `/status` with invalid project code — returns "not found"
   - Test `/overdue` — returns sorted overdue list
   - Mock Prisma queries + grammy context

3. **Deployment documentation** — Add to CLAUDE.md:
   ```markdown
   ### Telegram Bot Setup
   1. Create bot via @BotFather → get token
   2. Set env vars: TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, NEXT_PUBLIC_APP_URL
   3. Add bot to company group → get chat ID (use /setup API or `getUpdates`)
   4. Call POST /api/telegram/setup with admin token + groupChatId
   5. Bot is live — tasks will auto-notify to the group
   ```

4. **Verify full integration:**
   ```bash
   npx tsc --noEmit 2>&1 | grep -v "__tests__" | grep "error TS"
   npm run build
   npx vitest run --reporter=verbose
   npx playwright test e2e/workflow.spec.ts  # Ensure E2E not broken
   ```

### Verification

```bash
npx tsc --noEmit 2>&1 | grep -v "__tests__" | grep "error TS"
npm run build
npx vitest run --reporter=verbose 2>&1 | tail -20
```

### Exit Criteria

- 15+ test cases covering notifications and commands
- All 278+ existing tests still pass
- 13 E2E tests still pass
- CLAUDE.md updated with Telegram setup instructions
- Zero TS errors, clean build

### Rollback

```bash
git revert <sha>
```

---

## Execution Summary

| Step | Name | Depends | Parallel | Model | Risk | Files Modified |
|------|------|---------|----------|-------|------|----------------|
| 1 | Schema + Telegram lib | — | — | default | LOW | schema, +2 new |
| 2 | Webhook API route | 1 | A | default | LOW | +2 new, middleware |
| 3 | Push notification hooks | 1 | A | strongest | MEDIUM | workflow-engine.ts, cron, +1 new |
| 4 | Command framework | 1, 2 | — | default | LOW | telegram.ts, +1 new |
| 5 | Core commands | 4 | — | strongest | LOW | telegram-commands.ts |
| 6 | Info commands | 5 | — | default | LOW | telegram-commands.ts |
| 7 | /link + /report | 6 | — | default | LOW | telegram-commands.ts |
| 8 | Tests + deploy | 7 | — | default | LOW | +2 test files, CLAUDE.md |

**Critical path:** 1 → 2 → 4 → 5 → 6 → 7 → 8
**Max parallelism:** 2 concurrent (steps 2+3 only)
**Total new files:** 7
**Total modified files:** 4 (schema, middleware, workflow-engine.ts, deadline-check)

---

## Architecture Diagram

```
┌──────────────────┐     webhook POST      ┌─────────────────────┐
│  Telegram API    │ ──────────────────────▶│ /api/telegram/webhook│
│  (Bot Father)    │ ◀─────────────────────┤ (grammy handler)     │
└──────────────────┘     sendMessage        └──────────┬──────────┘
        │                                              │
        │                                    ┌─────────▼──────────┐
        │                                    │ telegram-commands.ts│
        │                                    │ /help /mytasks etc. │
        │                                    └──────────┬──────────┘
        │                                               │ Prisma queries
        │                                    ┌──────────▼──────────┐
        │         sendGroupMessage()         │    PostgreSQL DB     │
        │◀───────────────────────────────────│  (User, Task, etc.) │
        │                                    └──────────▲──────────┘
        │                                               │
┌───────┴──────────┐                        ┌───────────┴──────────┐
│ Company Group    │                        │ workflow-engine.ts    │
│ Chat             │◀───── push ────────────│ activateTask()       │
│ (notifications)  │                        │ rejectTask()         │
└──────────────────┘                        └──────────────────────┘
```

---

## Security Considerations

1. **Webhook secret** — `TELEGRAM_WEBHOOK_SECRET` header verified on every request
2. **Bot token** — Never committed, env-only
3. **Admin-only setup** — Only R01/R10 can register webhook + set group ID
4. **Link verification** — Username match (MVP); consider OTP for production
5. **Rate limiting** — grammy has built-in throttling; API routes already rate-limited
6. **No write operations** — Bot commands are read-only; no task completion via Telegram
7. **Fire-and-forget** — Telegram API failures never block workflow engine

---

## Plan Mutation Protocol

To modify this plan after execution begins:

- **Split step:** Create step N.1, N.2 with same dependencies. Update downstream refs.
- **Insert step:** Add between existing steps. Renumber downstream.
- **Skip step:** Mark `[SKIPPED]` with reason. Verify no downstream breaks.
- **Reorder:** Only if dependency graph allows. Verify with `depends on` field.
- **Abandon:** Mark `[ABANDONED]` with reason. Document partial state.

All mutations must be logged in this file with timestamp and reason.

---

## Review Log

- **2026-04-06:** Adversarial review by Opus sub-agent identified 3 CRITICAL, 7 WARNING, 3 INFO findings. All 3 criticals fixed:
  - C1: Steps 5+6 parallel file conflict — serialized (Step 6 now depends on Step 5)
  - C2: `import { webhookCallback } from 'grammy/web'` — changed to `from 'grammy'` (Node.js import path)
  - C3: Middleware exclusion — changed from PUBLIC_ROUTES to dedicated block with secret validation, matching cron-route pattern
  - Also fixed: TelegramConfig model removed (simplified to env var), Prisma rollback command corrected, setup route simplified
