import prisma from '../src/lib/db'
import * as fs from 'fs'

async function main() {
  const output: string[] = []
  const log = (s: string) => { output.push(s); console.log(s) }

  // 1. DailyProductionLog
  const logs = await (prisma as any).dailyProductionLog.findMany({ orderBy: { reportDate: 'desc' }, take: 50 })
  log(`\n=== DailyProductionLog (${logs.length} records) ===`)
  log(`| Ngày | LSX Code | Công đoạn | Tổ TH | KL báo cáo | Tổng KL | WBS Item | ProjectID |`)
  log(`|------|----------|-----------|-------|------------|---------|----------|-----------|`)
  for (const l of logs) {
    log(`| ${l.reportDate?.toISOString().slice(0,10) || '-'} | ${l.lsxCode || '-'} | ${l.wbsStage || '-'} | ${l.teamName || '-'} | ${l.reportedVolume || 0} | ${l.totalVolume || 0} | ${l.wbsItemName || '-'} | ${l.projectId?.slice(-8) || '-'} |`)
  }

  // 2. WeeklyAcceptanceLog
  const weeks = await (prisma as any).weeklyAcceptanceLog.findMany({ orderBy: { createdAt: 'desc' }, take: 20 })
  log(`\n=== WeeklyAcceptanceLog (${weeks.length} records) ===`)
  log(`| LSX Code | KL nghiệm thu | Tổng KL | Status | ProjectID |`)
  log(`|----------|---------------|---------|--------|-----------|`)
  for (const w of weeks) {
    log(`| ${w.lsxCode || '-'} | ${w.acceptedVolume || 0} | ${w.totalVolume || 0} | ${w.status || '-'} | ${w.projectId?.slice(-8) || '-'} |`)
  }

  // 3. P5.3/P5.4 tasks
  const p53Tasks = await prisma.workflowTask.findMany({
    where: { stepCode: { in: ['P5.3', 'P5.4'] } },
    select: { id: true, stepCode: true, status: true, resultData: true, project: { select: { projectCode: true } } }
  })
  log(`\n=== P5.3/P5.4 Tasks (${p53Tasks.length}) ===`)
  for (const t of p53Tasks) {
    const rd = (t.resultData as any) || {}
    log(`  ${t.stepCode} [${t.status}] ${t.project.projectCode} | week: ${rd.weekStartDate || 'N/A'} - ${rd.weekEndDate || 'N/A'}`)
  }

  fs.writeFileSync('scripts/production-data-report.txt', output.join('\n'), 'utf8')
  log('\n=> Saved to scripts/production-data-report.txt')
}

main().finally(() => prisma.$disconnect())
