import { describe, it, expect } from 'vitest'
import { isFlowGeneratedTask } from '@/lib/notify-tasks'

// Quy tắc: chỉ task DO QUY TRÌNH sinh mới redirect vào sidebar; task TẠO TAY (dù trùng nhãn Pxx)
// làm thẳng ở tab Công việc. Phân biệt then chốt: task tay do NGƯỜI THẬT tạo (createdBy != system).
describe('isFlowGeneratedTask', () => {
  it('task do chuỗi sinh (có templateStepId) → true', () => {
    expect(isFlowGeneratedTask({ taskType: 'P3.5', templateStepId: 'step-1', createdBy: 'u1' })).toBe(true)
  })

  it('task hệ thống sinh — activateTask/cron (createdBy system/SYSTEM) → true', () => {
    // vd P3.5 "Lên báo giá" do activateTask sinh (createdBy='system', không templateStepId)
    expect(isFlowGeneratedTask({ taskType: 'P3.5', templateStepId: null, createdBy: 'system' })).toBe(true)
    expect(isFlowGeneratedTask({ taskType: 'P5.1.1', templateStepId: null, createdBy: 'SYSTEM' })).toBe(true)
  })

  it('task auto-handler (P3.6/P4.3/P4.4/P4.5/P5.1/P5.1A/P5.1.1/P5.3A) không có templateStepId → true', () => {
    for (const tt of ['P3.6', 'P4.3', 'P4.4', 'P4.5', 'P5.1', 'P5.1A', 'P5.1.1', 'P5.3A']) {
      expect(isFlowGeneratedTask({ taskType: tt, templateStepId: null, createdBy: 'u-real' })).toBe(true)
    }
  })

  it('task TẠO TAY do người thật, trùng nhãn bước chuỗi (vd Q26.080 taskType P3.5) → false', () => {
    for (const tt of ['P3.5', 'P2.1', 'P1.1B']) {
      expect(isFlowGeneratedTask({ taskType: tt, templateStepId: null, createdBy: 'user-nvthanh' })).toBe(false)
    }
  })

  it('task tạo tay tự do (FREE) → false', () => {
    expect(isFlowGeneratedTask({ taskType: 'FREE', templateStepId: null, createdBy: 'u-real' })).toBe(false)
  })
})
