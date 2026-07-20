'use client'

import { useEffect, useState, useMemo } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { useAuthStore, apiFetch } from '@/hooks/useAuth'
import { ROLES, MENU_ITEMS, MENU_GROUPS, ROLE_GROUP_PRIORITY, HIDDEN_MENU_KEYS } from '@/lib/constants'
import { resolvePostLoginPath } from '@/lib/mobile-nav'
import { useCapabilities } from '@/hooks/useCapabilities'
import NotificationBell from '@/components/NotificationBell'
import PendingAlerts from '@/components/PendingAlerts'
import {
  LayoutDashboard, FolderKanban, ClipboardList, Users, Package, Factory, ShieldCheck,
  ShoppingCart, ArrowLeftRight, Building, Clipboard, FileCheck, AlertTriangle, Award,
  Pencil, Layers, RefreshCw, UserCheck, DollarSign, Receipt, TrendingUp, BarChart3,
  CreditCard, PieChart, Target, Handshake, BookOpen, Ruler, HardHat, Clock,
  CalendarCheck, Building2, Bell, ScrollText, FileInput, FileOutput, PackageCheck,
  Wrench, FileSpreadsheet, PackageMinus, SearchCheck, FileSignature, Contact,
  Settings, Hammer, BarChart, FileText, TestTube, FolderCheck, Calculator, Truck,
  LogOut, ChevronDown, ChevronLeft, AlertCircle, Barcode, Inbox, Lock,
  type LucideIcon,
} from 'lucide-react'

// Roles thấy menu 'Quản lý mã vật tư' — lấy từ MENU_ITEMS để không lệch khi đổi phân quyền menu
const MATERIAL_CODES_MENU_ROLES = (MENU_ITEMS.find((m) => m.key === 'material-codes')?.roles ?? []) as readonly string[]

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const { user, isAuthenticated, hydrate, logout } = useAuthStore()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [ready, setReady] = useState(false)
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({})
  const [taskCount, setTaskCount] = useState(0)
  const [p45TaskCount, setP45TaskCount] = useState(0)
  const [paymentCount, setPaymentCount] = useState(0)
  const [meetingInviteCount, setMeetingInviteCount] = useState(0)
  const [provisionalCount, setProvisionalCount] = useState(0)

  useEffect(() => {
    hydrate()
    setReady(true)
  }, [hydrate])

  useEffect(() => {
    if (ready && !isAuthenticated) {
      router.push('/login')
    }
  }, [ready, isAuthenticated, router])

  // Xưởng/QC mở dashboard trên điện thoại (kể cả khi đã đăng nhập sẵn) → bản mobile /m.
  // resolvePostLoginPath chỉ trả '/m' khi ĐỦ cả 2: role Xưởng/QC + thiết bị điện thoại,
  // nên trên máy tính và với phòng ban khác thì không đụng gì.
  useEffect(() => {
    if (ready && isAuthenticated && user && resolvePostLoginPath(user.roleCode) === '/m') {
      router.replace('/m')
    }
  }, [ready, isAuthenticated, user, router])

  // Fetch pending task count for current user
  useEffect(() => {
    if (!ready || !isAuthenticated) return
    const isAccountant = user?.roleCode === 'R08' || user?.roleCode === 'R08a'
    const canSeeMaterialCodes = MATERIAL_CODES_MENU_ROLES.includes(user?.roleCode || '')
    const fetchCount = () => {
      apiFetch('/api/work/inbox?tab=assigned').then(res => {
        if (res.ok) {
          const tasks = res.tasks || []
          setTaskCount(tasks.length)
          setP45TaskCount(0)
        }
      })
      apiFetch('/api/work/meetings').then(res => {
        if (res.ok) {
          const meetings = res.meetings || []
          const pending = meetings.filter((m: any) => m.myStatus === 'INVITED').length
          setMeetingInviteCount(pending)
        }
      })
      // Accountants: count POs awaiting payment (status APPROVED) for the Thanh toán badge
      if (isAccountant) {
        apiFetch('/api/purchase-orders?status=APPROVED').then(res => {
          if (res.ok) setPaymentCount(res.pagination?.total || 0)
        })
      }
      // Roles thấy menu 'Quản lý mã vật tư': badge số mã tạm chờ chuẩn hóa
      if (canSeeMaterialCodes) {
        apiFetch('/api/materials?countProvisional=1').then(res => {
          if (res.ok) setProvisionalCount(res.pendingCount || 0)
        })
      }
    }
    fetchCount()
    const interval = setInterval(fetchCount, 30000) // refresh every 30s
    return () => clearInterval(interval)
  }, [ready, isAuthenticated, user?.roleCode])

  const roleCode = user?.roleCode || ''
  const roleName = ROLES[roleCode as keyof typeof ROLES]?.name || roleCode

  // Quyền xem trang lấy từ ma trận phân quyền (DB). Chưa tải xong → dùng luật tĩnh
  // (giống hệt, tránh nhấp nháy). Khi admin chỉnh ma trận, menu & guard đổi theo.
  const caps = useCapabilities()

  const pageBlocked = useMemo(() => {
    const items = MENU_ITEMS
      .filter((m) => m.href !== '/dashboard')
      .slice()
      .sort((a, b) => b.href.length - a.href.length)
    for (const item of items) {
      if (pathname === item.href || pathname.startsWith(item.href + '/')) {
        if (item.roles === 'all') return false
        if (caps) return !caps.has(`page.${item.key}`)
        return !(item.roles as readonly string[]).includes(roleCode)
      }
    }
    return false
  }, [pathname, roleCode, caps])

  // HIDDEN_MENU_KEYS imported from @/lib/constants
  const filteredMenu = MENU_ITEMS.filter((item) => {
    if (HIDDEN_MENU_KEYS.has(item.key)) return false
    if (caps) return caps.has(`page.${item.key}`)          // DB-driven khi đã tải
    if (item.roles === 'all') return true
    return (item.roles as readonly string[]).includes(roleCode)
  })

  // Build grouped menu sorted by role priority
  const groupedMenu = useMemo(() => {
    const rolePriority = ROLE_GROUP_PRIORITY[roleCode] || ['overview']
    const itemsByGroup: Record<string, typeof filteredMenu> = {}
    filteredMenu.forEach(item => {
      const g = item.group
      if (!itemsByGroup[g]) itemsByGroup[g] = []
      itemsByGroup[g].push(item)
    })
    const sortedGroups = MENU_GROUPS
      .filter(g => itemsByGroup[g.key]?.length)
      .sort((a, b) => {
        const ai = rolePriority.indexOf(a.key)
        const bi = rolePriority.indexOf(b.key)
        const aIdx = ai >= 0 ? ai : 99
        const bIdx = bi >= 0 ? bi : 99
        return aIdx - bIdx
      })
    return sortedGroups.map(g => ({ ...g, items: itemsByGroup[g.key] }))
  }, [filteredMenu, roleCode])

  // Mở sẵn các nhóm THUỘC ưu tiên của role; thu gọn nhóm ngoài ưu tiên.
  // (Trước đây chỉ set state cho nhóm ưu tiên → nhóm ngoài ưu tiên bị undefined,
  //  mà render dùng `!== false` nên chúng lại MỞ, còn nhóm ưu tiên thứ 3+ bị ĐÓNG — ngược.)
  useEffect(() => {
    const rolePriority = ROLE_GROUP_PRIORITY[roleCode] || ['overview']
    const initial: Record<string, boolean> = {}
    MENU_GROUPS.forEach((g) => { initial[g.key] = rolePriority.includes(g.key) })
    setExpandedGroups(initial)
  }, [roleCode])

  const toggleGroup = (key: string) => {
    setExpandedGroups(prev => ({ ...prev, [key]: !prev[key] }))
  }

  if (!ready || !isAuthenticated || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg-primary)' }}>
        <div className="animate-spin w-8 h-8 border-2 border-t-transparent rounded-full" style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }} />
      </div>
    )
  }

  const sidebarWidth = sidebarCollapsed ? '72px' : '260px'

  return (
    <div className="min-h-screen flex" style={{ background: 'var(--bg-primary)' }}>
      {/* ═══ Sidebar ═══ */}
      <aside
        className="fixed left-0 top-0 h-full z-30 flex flex-col transition-all"
        style={{
          width: sidebarWidth,
          background: 'linear-gradient(180deg, #0a2540 0%, #163a5f 50%, #0a2540 100%)',
          boxShadow: '2px 0 20px rgba(10, 37, 64, 0.15)',
          transitionDuration: 'var(--duration-normal)',
          transitionTimingFunction: 'var(--ease-out)',
        }}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 px-5" style={{ height: '68px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="flex items-end gap-[2px] flex-shrink-0">
            <div className="w-[5px] rounded-t-sm" style={{ height: '16px', background: 'var(--ibs-red)' }} />
            <div className="w-[5px] rounded-t-sm" style={{ height: '22px', background: 'var(--ibs-red)' }} />
            <div className="w-[5px] rounded-t-sm" style={{ height: '19px', background: 'var(--ibs-red)' }} />
          </div>
          {!sidebarCollapsed && (
            <div className="animate-fade-in">
              <h1 className="text-sm font-extrabold text-white tracking-wider">IBS</h1>
              <p className="text-[9px] text-slate-500 tracking-[0.15em] -mt-0.5">HEAVY INDUSTRY</p>
            </div>
          )}
        </div>

        {/* Nav sections — grouped + collapsible */}
        <nav className="flex-1 py-3 px-3 overflow-y-auto sidebar-nav">
          <div className="space-y-0.5">
            {groupedMenu.map((group) => {
              const isExpanded = expandedGroups[group.key] !== false
              return (
                <div key={group.key} className="sidebar-group">
                  {/* Group Header */}
                  <button
                    onClick={() => toggleGroup(group.key)}
                    className="sidebar-group-header"
                    title={group.label}
                  >
                    {!sidebarCollapsed ? (
                      <>
                        <span className="sidebar-group-icon">{group.icon}</span>
                        <span className="sidebar-group-label">{group.label}</span>
                        <ChevronDown
                          size={12} strokeWidth={2.5}
                          className={`sidebar-group-chevron ${isExpanded ? 'expanded' : ''}`}
                        />
                      </>
                    ) : (
                      <span className="sidebar-group-icon">{group.icon}</span>
                    )}
                  </button>

                  {/* Group Items */}
                  {(isExpanded || sidebarCollapsed) && (
                    <div className={`sidebar-group-items ${sidebarCollapsed ? '' : 'expanded'}`}>
                      {group.items.map((item) => (
                        <Link
                          key={item.key}
                          href={item.href}
                          className={`sidebar-link ${pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href)) ? 'active' : ''}`}
                          title={item.label}
                        >
                          <span style={{ position: 'relative', display: 'inline-flex' }}>
                            <MenuIcon name={item.icon} />
                            {item.key === 'work' && taskCount > 0 && sidebarCollapsed && (
                              <span style={{
                                position: 'absolute', top: -6, right: -8,
                                minWidth: 16, height: 16, borderRadius: 8,
                                background: 'var(--ibs-red)', color: 'white',
                                fontSize: 10, fontWeight: 700,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                padding: '0 4px', lineHeight: 1,
                              }}>{taskCount > 99 ? '99+' : taskCount}</span>
                            )}
                            {item.key === 'work-meetings' && meetingInviteCount > 0 && sidebarCollapsed && (
                              <span style={{
                                position: 'absolute', top: -6, right: -8,
                                minWidth: 16, height: 16, borderRadius: 8,
                                background: '#f59e0b', color: 'white',
                                fontSize: 10, fontWeight: 700,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                padding: '0 4px', lineHeight: 1,
                              }}>{meetingInviteCount}</span>
                            )}
                            {item.key === 'material-issue' && p45TaskCount > 0 && sidebarCollapsed && (
                              <span style={{
                                position: 'absolute', top: -6, right: -8,
                                minWidth: 16, height: 16, borderRadius: 8,
                                background: 'var(--ibs-red)', color: 'white',
                                fontSize: 10, fontWeight: 700,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                padding: '0 4px', lineHeight: 1,
                              }}>{p45TaskCount > 99 ? '99+' : p45TaskCount}</span>
                            )}
                            {item.key === 'payments' && paymentCount > 0 && sidebarCollapsed && (
                              <span style={{
                                position: 'absolute', top: -6, right: -8,
                                minWidth: 16, height: 16, borderRadius: 8,
                                background: 'var(--ibs-red)', color: 'white',
                                fontSize: 10, fontWeight: 700,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                padding: '0 4px', lineHeight: 1,
                              }}>{paymentCount > 99 ? '99+' : paymentCount}</span>
                            )}
                            {item.key === 'material-codes' && provisionalCount > 0 && sidebarCollapsed && (
                              <span style={{
                                position: 'absolute', top: -6, right: -8,
                                minWidth: 16, height: 16, borderRadius: 8,
                                background: 'var(--ibs-red)', color: 'white',
                                fontSize: 10, fontWeight: 700,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                padding: '0 4px', lineHeight: 1,
                              }}>{provisionalCount > 99 ? '99+' : provisionalCount}</span>
                            )}
                          </span>
                          {!sidebarCollapsed && (
                            <>
                              <span>{item.label}</span>
                              {item.key === 'work' && taskCount > 0 && (
                                <span style={{
                                  marginLeft: 'auto',
                                  minWidth: 20, height: 20, borderRadius: 10,
                                  background: 'var(--ibs-red)', color: 'white',
                                  fontSize: 11, fontWeight: 700,
                                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                                  padding: '0 6px', lineHeight: 1,
                                }}>{taskCount > 99 ? '99+' : taskCount}</span>
                              )}
                              {item.key === 'material-issue' && p45TaskCount > 0 && (
                                <span style={{
                                  marginLeft: 'auto',
                                  minWidth: 20, height: 20, borderRadius: 10,
                                  background: 'var(--ibs-red)', color: 'white',
                                  fontSize: 11, fontWeight: 700,
                                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                                  padding: '0 6px', lineHeight: 1,
                                }}>{p45TaskCount > 99 ? '99+' : p45TaskCount}</span>
                              )}
                              {item.key === 'payments' && paymentCount > 0 && (
                                <span style={{
                                  marginLeft: 'auto',
                                  minWidth: 20, height: 20, borderRadius: 10,
                                  background: 'var(--ibs-red)', color: 'white',
                                  fontSize: 11, fontWeight: 700,
                                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                                  padding: '0 6px', lineHeight: 1,
                                }}>{paymentCount > 99 ? '99+' : paymentCount}</span>
                              )}
                              {item.key === 'work-meetings' && meetingInviteCount > 0 && (
                                <span style={{
                                  marginLeft: 'auto',
                                  minWidth: 20, height: 20, borderRadius: 10,
                                  background: '#f59e0b', color: 'white',
                                  fontSize: 11, fontWeight: 700,
                                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                                  padding: '0 6px', lineHeight: 1,
                                }}>{meetingInviteCount}</span>
                              )}
                              {item.key === 'material-codes' && provisionalCount > 0 && (
                                <span style={{
                                  marginLeft: 'auto',
                                  minWidth: 20, height: 20, borderRadius: 10,
                                  background: 'var(--ibs-red)', color: 'white',
                                  fontSize: 11, fontWeight: 700,
                                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                                  padding: '0 6px', lineHeight: 1,
                                }}>{provisionalCount > 99 ? '99+' : provisionalCount}</span>
                              )}
                            </>
                          )}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </nav>

        {/* User */}
        <div className="p-3" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="flex items-center gap-3 p-2.5 rounded-lg" style={{ background: 'rgba(255,255,255,0.04)' }}>
            <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0" style={{
              background: 'linear-gradient(135deg, var(--ibs-red), var(--ibs-red-dark))',
              color: 'white',
              boxShadow: '0 2px 8px rgba(228, 29, 42, 0.3)',
            }}>
              {user.fullName.charAt(0).toUpperCase()}
            </div>
            {!sidebarCollapsed && (
              <div className="flex-1 min-w-0 animate-fade-in">
                <p className="text-sm font-semibold truncate text-slate-200">{user.fullName.replace(/\s*\(.*\)\s*$/, '')}</p>
                <p className="text-xs text-slate-400">{roleName}</p>
              </div>
            )}
          </div>
        </div>

        {/* Collapse Toggle */}
        <button
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          className="absolute -right-2.5 top-20 w-5 h-5 rounded-full flex items-center justify-center cursor-pointer opacity-0 sidebar-toggle-btn"
          style={{
            background: 'white',
            border: '1px solid var(--border)',
            color: 'var(--text-muted)',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
            transition: 'opacity 0.2s ease',
          }}
        >
          <ChevronLeft size={10} strokeWidth={3} className={`transition-transform ${sidebarCollapsed ? 'rotate-180' : ''}`} style={{ transitionDuration: 'var(--duration-normal)' }} />
        </button>
      </aside>

      {/* ═══ Main ═══ */}
      <div className="flex-1 flex flex-col transition-all" style={{
        marginLeft: sidebarWidth,
        scrollPaddingTop: '72px',
        transitionDuration: 'var(--duration-normal)',
        transitionTimingFunction: 'var(--ease-out)',
      }}>
        {/* Topbar */}
        <header className="sticky top-0 z-40 flex items-center justify-between" style={{
          height: '64px',
          padding: '0 32px',
          background: 'var(--bg-primary)',
          borderBottom: '1px solid var(--border)',
          boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
        }}>
          <div>
            <h2 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-heading)' }}>
              {/* khớp chính xác, nếu không thì khớp tiền tố dài nhất (cho trang chi tiết) */}
              {filteredMenu.find((m) => m.href === pathname)?.label
                || filteredMenu.filter((m) => m.href !== '/dashboard' && pathname.startsWith(m.href)).sort((a, b) => b.href.length - a.href.length)[0]?.label
                || 'Bảng điều khiển'}
            </h2>
          </div>

          <div className="flex items-center gap-2">
            <NotificationBell />
            <button
              onClick={() => { logout(); router.push('/login') }}
              className="btn-ghost btn-icon"
              title="Đăng xuất"
            >
              <LogOut size={18} strokeWidth={2} />
            </button>
          </div>
        </header>

        {/* Content */}
        <main style={{ flex: 1, padding: '28px 32px' }}>
          {!pageBlocked && <PendingAlerts />}
          {pageBlocked ? (
            <div className="flex flex-col items-center justify-center py-20 animate-fade-in">
              <div className="mb-4"><Lock size={48} style={{ color: 'var(--text-muted)' }} /></div>
              <h2 className="text-xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>Không có quyền truy cập</h2>
              <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>Bạn không có quyền xem trang này ({roleName})</p>
              <Link href="/dashboard" className="px-4 py-2 rounded-lg text-sm font-semibold text-white" style={{ background: '#0284c7' }}>
                Về trang chính
              </Link>
            </div>
          ) : children}
        </main>
      </div>
    </div>
  )
}

const ICON_MAP: Record<string, LucideIcon> = {
  LayoutDashboard, FolderKanban, ClipboardList, Users, Package, Factory, ShieldCheck,
  ShoppingCart, ArrowLeftRight, Building, Clipboard, FileCheck, AlertTriangle, Award,
  Pencil, Layers, RefreshCw, UserCheck, DollarSign, Receipt, TrendingUp, BarChart3,
  CreditCard, PieChart, Target, Handshake, BookOpen, Ruler, HardHat, Clock,
  CalendarCheck, Building2, Bell, ScrollText, FileInput, FileOutput, PackageCheck,
  Wrench, FileSpreadsheet, PackageMinus, SearchCheck, FileSignature, Contact,
  Settings, Hammer, BarChart, FileText, TestTube, FolderCheck, Calculator, Truck, Barcode, Inbox,
}

function MenuIcon({ name }: { name: string }) {
  const Icon = ICON_MAP[name] || AlertCircle
  return <Icon size={20} strokeWidth={1.75} />
}
