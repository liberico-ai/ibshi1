'use client'

import { useState } from 'react'
import {
  Button, Badge, StatusBadge, Card, KPICard, FilterBar, DataTable,
  DetailHeader, Timeline, DiffTable, EmptyState, Pagination, Modal,
  InputField, SelectField, PageHeader, StatCard,
} from '@/components/ui'
import { STATUS_COLORS, SEMANTIC_COLORS } from '@/lib/design-tokens'

const BRAND_COLORS = [
  { name: 'Red IBS', value: '#E1251B', var: '--ibs-red' },
  { name: 'Red Hover', value: '#C01D14', var: '--ibs-red-dark' },
  { name: 'Red BG', value: '#FDECEA', var: '--ibs-red-50' },
  { name: 'Navy', value: '#0a2540', var: '--ibs-navy' },
  { name: 'Navy Light', value: '#163a5f', var: '--ibs-navy-light' },
]

const GRAY_SCALE = [
  { name: 'Ink', value: '#17191D' },
  { name: '900', value: '#2A2D34' },
  { name: '800 Body', value: '#3A3F47' },
  { name: '700 Secondary', value: '#5B6068' },
  { name: '600 Muted', value: '#757B83' },
  { name: '500 Faint', value: '#9AA0A8' },
  { name: '400 Disabled', value: '#C2C7CD' },
  { name: '300 Border Dark', value: '#D5D8DD' },
  { name: '200 Border', value: '#EAECEF' },
  { name: '100 Line', value: '#F0F1F3' },
  { name: '50 BG', value: '#F6F7F9' },
  { name: '25 Surface', value: '#FAFBFC' },
]

const SAMPLE_TABLE_DATA = [
  { id: '1', code: 'WO-2026-001', name: 'Gia công kết cấu thép', status: 'IN_PROGRESS', qty: 120 },
  { id: '2', code: 'WO-2026-002', name: 'Lắp ráp module A3', status: 'DONE', qty: 45 },
  { id: '3', code: 'WO-2026-003', name: 'Hàn đường ống DN150', status: 'OPEN', qty: 88 },
  { id: '4', code: 'WO-2026-004', name: 'Sơn phủ bề mặt block B2', status: 'AWAITING_REVIEW', qty: 200 },
]

const TIMELINE_ITEMS = [
  { id: '1', title: 'Tạo công việc', description: 'Nguyễn Văn A tạo task P2.1', timestamp: '27/06 08:30', color: '#2D6CB5' },
  { id: '2', title: 'Giao cho phòng TK', description: 'Assign → R04 Phòng Thiết kế', timestamp: '27/06 09:15', color: '#C97A0E' },
  { id: '3', title: 'Hoàn thành', description: 'Đã upload bản vẽ, chờ review', timestamp: '27/06 14:20', color: '#1E8E5A' },
]

const DIFF_ROWS = [
  { field: 'Số lượng', before: '100', after: '150' },
  { field: 'Đơn vị', before: 'cái', after: 'cái' },
  { field: 'Ghi chú', before: '', after: 'Tăng do thay đổi thiết kế' },
]

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 48 }}>
      <h2 className="font-heading" style={{ fontSize: '1.1875rem', fontWeight: 700, marginBottom: 16, paddingBottom: 8, borderBottom: '2px solid var(--border)' }}>
        {title}
      </h2>
      {children}
    </section>
  )
}

function ColorSwatch({ name, value }: { name: string; value: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <div style={{
        width: 56, height: 56, borderRadius: 10, background: value,
        border: '1px solid var(--border)', boxShadow: 'var(--shadow-xs)',
      }} />
      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)' }}>{name}</span>
      <span className="font-mono" style={{ fontSize: 10, color: 'var(--text-muted)' }}>{value}</span>
    </div>
  )
}

export default function StyleGuidePage() {
  const [filterValue, setFilterValue] = useState('all')
  const [currentPage, setCurrentPage] = useState(2)
  const [modalOpen, setModalOpen] = useState(false)

  return (
    <div style={{ maxWidth: 1080, margin: '0 auto' }}>
      <PageHeader title="Design System v3" subtitle="IBS Heavy Industry — Token & Component Reference" />

      {/* ── 01 TYPOGRAPHY ── */}
      <Section title="01 — Typography">
        <div style={{ display: 'grid', gap: 16 }}>
          <div>
            <h1 className="font-heading" style={{ fontSize: '1.5rem', fontWeight: 700 }}>Page Title — Space Grotesk 24/700</h1>
            <h2 className="font-heading" style={{ fontSize: '1.1875rem', fontWeight: 600 }}>Section Header — Space Grotesk 19/600</h2>
            <h3 className="font-heading" style={{ fontSize: '0.9375rem', fontWeight: 600 }}>Card Title — Space Grotesk 15/600</h3>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <p style={{ fontSize: '0.875rem', fontWeight: 500 }}>Body text — Geist 14/500 — Quản lý dự án sản xuất công nghiệp nặng</p>
            <p style={{ fontSize: '0.78125rem', fontWeight: 500, color: 'var(--text-secondary)' }}>Subtext — Geist 12.5/500 — Thông tin bổ sung và mô tả chi tiết</p>
            <p style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Caption — Geist 11/600</p>
          </div>
          <div className="font-mono" style={{ display: 'flex', gap: 24, fontSize: 14 }}>
            <span>WO-2026-001</span>
            <span>₫ 1,234,567,890</span>
            <span>27/06/2026 14:30</span>
            <span>R04 · Phòng Thiết kế</span>
          </div>
        </div>
      </Section>

      {/* ── 02 BRAND COLORS ── */}
      <Section title="02 — Brand Colors">
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          {BRAND_COLORS.map(c => <ColorSwatch key={c.var} name={c.name} value={c.value} />)}
        </div>
      </Section>

      {/* ── 03 GRAY SCALE ── */}
      <Section title="03 — Gray Scale">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {GRAY_SCALE.map(c => <ColorSwatch key={c.name} name={c.name} value={c.value} />)}
        </div>
      </Section>

      {/* ── 04 SEMANTIC COLORS ── */}
      <Section title="04 — Semantic Colors">
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          {Object.entries(SEMANTIC_COLORS).map(([name, c]) => (
            <div key={name} style={{ display: 'flex', gap: 8 }}>
              <ColorSwatch name={name} value={c.solid} />
              <ColorSwatch name={`${name} bg`} value={c.bg} />
            </div>
          ))}
        </div>
      </Section>

      {/* ── 05 STATUS BADGES ── */}
      <Section title="05 — Status Badges">
        {(Object.keys(STATUS_COLORS) as (keyof typeof STATUS_COLORS)[]).map(category => (
          <div key={category} style={{ marginBottom: 16 }}>
            <h4 style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8 }}>
              {category}
            </h4>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {Object.keys(STATUS_COLORS[category]).map(status => (
                <StatusBadge key={status} category={category} status={status} />
              ))}
            </div>
          </div>
        ))}

        <h4 style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 8, marginTop: 16 }}>
          Generic Badges
        </h4>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Badge variant="success">Success</Badge>
          <Badge variant="warning">Warning</Badge>
          <Badge variant="danger">Danger</Badge>
          <Badge variant="info">Info</Badge>
          <Badge variant="default">Default</Badge>
        </div>
      </Section>

      {/* ── 06 SPACING & RADIUS ── */}
      <Section title="06 — Spacing (8-pt Grid) & Border Radius">
        <div style={{ display: 'flex', gap: 12, alignItems: 'end', marginBottom: 24 }}>
          {[4, 8, 12, 16, 20, 24, 32, 40].map(s => (
            <div key={s} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <div style={{ width: s, height: s, background: 'var(--info)', borderRadius: 2 }} />
              <span className="font-mono" style={{ fontSize: 10 }}>{s}</span>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          {[
            { name: 'sm', value: '6px' },
            { name: 'base', value: '10px' },
            { name: 'card', value: '14px' },
            { name: 'lg', value: '18px' },
            { name: 'pill', value: '999px' },
          ].map(r => (
            <div key={r.name} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <div style={{ width: 56, height: 40, background: 'var(--ibs-navy-50)', border: '2px solid var(--primary)', borderRadius: r.value }} />
              <span style={{ fontSize: 11, fontWeight: 600 }}>{r.name}</span>
              <span className="font-mono" style={{ fontSize: 10, color: 'var(--text-muted)' }}>{r.value}</span>
            </div>
          ))}
        </div>
      </Section>

      {/* ── 07 BUTTONS ── */}
      <Section title="07 — Buttons">
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <Button variant="primary">Primary</Button>
          <Button variant="accent">Accent</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
          <Button variant="primary" loading>Loading…</Button>
          <Button variant="primary" size="sm">Small</Button>
          <Button variant="primary" size="lg">Large</Button>
          <Button variant="primary" disabled>Disabled</Button>
        </div>
      </Section>

      {/* ── 08 FORM INPUTS ── */}
      <Section title="08 — Form Inputs">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
          <InputField label="Tên dự án" placeholder="Nhập tên…" />
          <InputField label="Email" type="email" placeholder="user@ibs.vn" error="Email không hợp lệ" />
          <SelectField label="Trạng thái" options={[
            { value: '', label: 'Chọn…' },
            { value: 'active', label: 'Hoạt động' },
            { value: 'hold', label: 'Tạm dừng' },
          ]} />
        </div>
      </Section>

      {/* ── 09 CARDS ── */}
      <Section title="09 — Cards & KPI">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 16 }}>
          <KPICard label="Tổng công việc" value={156} delta="+12 tuần này" deltaType="up" accentColor="#2D6CB5" icon="📋" />
          <KPICard label="Hoàn thành" value={89} delta="57%" deltaType="up" accentColor="#1E8E5A" icon="✅" />
          <KPICard label="Quá hạn" value={7} delta="−2 so với tuần trước" deltaType="down" accentColor="#C8372B" icon="⚠️" />
          <KPICard label="Chờ duyệt" value={23} accentColor="#C97A0E" icon="⏳" />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          <StatCard label="Doanh thu tháng" value="₫ 2.4B" color="#1E8E5A" compact />
          <StatCard label="Chi phí" value="₫ 1.8B" color="#C97A0E" compact />
          <StatCard label="Lợi nhuận" value="₫ 600M" color="#2D6CB5" compact />
        </div>
      </Section>

      {/* ── 10 FILTER BAR ── */}
      <Section title="10 — Filter Bar">
        <FilterBar
          filters={[
            { value: 'all', label: 'Tất cả', count: 156 },
            { value: 'progress', label: 'Đang thực hiện', count: 42 },
            { value: 'review', label: 'Chờ duyệt', count: 23 },
            { value: 'done', label: 'Hoàn thành', count: 89 },
          ]}
          value={filterValue}
          onChange={setFilterValue}
          actions={<Button variant="primary" size="sm">+ Tạo mới</Button>}
        />
      </Section>

      {/* ── 11 DATA TABLE ── */}
      <Section title="11 — Data Table">
        <DataTable
          columns={[
            { key: 'code', label: 'Mã', width: '140px', mono: true },
            { key: 'name', label: 'Tên công việc' },
            { key: 'status', label: 'Trạng thái', width: '160px', render: (row) => <StatusBadge category="task" status={row.status} /> },
            { key: 'qty', label: 'SL', width: '80px', align: 'right', mono: true },
          ]}
          data={SAMPLE_TABLE_DATA}
          rowKey={(row) => row.id}
        />
      </Section>

      {/* ── 12 DETAIL HEADER ── */}
      <Section title="12 — Detail Header">
        <Card padding="default">
          <DetailHeader
            code="WO-2026-001"
            title="Gia công kết cấu thép — Block A1"
            subtitle="Dự án: Nhà máy Nhiệt điện Long An · Giai đoạn 2"
            badge={<StatusBadge category="task" status="IN_PROGRESS" />}
            backHref="#"
            actions={
              <>
                <Button variant="outline" size="sm">Trả lại</Button>
                <Button variant="primary" size="sm">Hoàn thành</Button>
              </>
            }
          />
        </Card>
      </Section>

      {/* ── 13 TIMELINE ── */}
      <Section title="13 — Timeline">
        <Card padding="default">
          <Timeline items={TIMELINE_ITEMS} />
        </Card>
      </Section>

      {/* ── 14 DIFF TABLE ── */}
      <Section title="14 — Diff Table">
        <DiffTable rows={DIFF_ROWS} />
      </Section>

      {/* ── 15 EMPTY STATE ── */}
      <Section title="15 — Empty State">
        <Card padding="none">
          <EmptyState
            icon="📭"
            title="Chưa có công việc nào"
            description="Tạo công việc đầu tiên để bắt đầu quản lý dự án"
            action={<Button variant="primary" size="sm">+ Tạo công việc</Button>}
          />
        </Card>
      </Section>

      {/* ── 16 PAGINATION ── */}
      <Section title="16 — Pagination">
        <Pagination page={currentPage} totalPages={12} onPageChange={setCurrentPage} />
      </Section>

      {/* ── 17 MODAL ── */}
      <Section title="17 — Modal">
        <Button variant="outline" onClick={() => setModalOpen(true)}>Mở Modal</Button>
        <Modal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          title="Xác nhận hoàn thành"
          actions={
            <>
              <Button variant="ghost" onClick={() => setModalOpen(false)}>Huỷ</Button>
              <Button variant="primary" onClick={() => setModalOpen(false)}>Xác nhận</Button>
            </>
          }
        >
          <p style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
            Bạn có chắc chắn muốn hoàn thành công việc <strong>WO-2026-001</strong>?
            Hành động này không thể hoàn tác.
          </p>
        </Modal>
      </Section>
    </div>
  )
}
