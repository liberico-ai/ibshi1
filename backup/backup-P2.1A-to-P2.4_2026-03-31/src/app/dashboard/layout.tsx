'use client'

import { useEffect, useState, useMemo } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { useAuthStore } from '@/hooks/useAuth'
import { ROLES, MENU_ITEMS, MENU_GROUPS, ROLE_GROUP_PRIORITY } from '@/lib/constants'
import NotificationBell from '@/components/NotificationBell'
import {
  LayoutDashboard, FolderKanban, ClipboardList, Users, Package, Factory, ShieldCheck,
  ShoppingCart, ArrowLeftRight, Building, Clipboard, FileCheck, AlertTriangle, Award,
  Pencil, Layers, RefreshCw, UserCheck, DollarSign, Receipt, TrendingUp, BarChart3,
  CreditCard, PieChart, Target, Handshake, BookOpen, Ruler, HardHat, Clock,
  CalendarCheck, Building2, Bell, ScrollText, FileInput, FileOutput, PackageCheck,
  Wrench, FileSpreadsheet, PackageMinus, SearchCheck, FileSignature, Contact,
  Settings, Hammer, BarChart, FileText, TestTube, FolderCheck, Calculator, Truck,
  LogOut, ChevronDown, ChevronLeft, AlertCircle,
  type LucideIcon,
} from 'lucide-react'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const { user, isAuthenticated, hydrate, logout } = useAuthStore()
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [ready, setReady] = useState(false)
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({})

  useEffect(() => {
    hydrate()
    setReady(true)
  }, [hydrate])

  useEffect(() => {
    if (ready && !isAuthenticated) {
      router.push('/login')
    }
  }, [ready, isAuthenticated, router])

  const roleCode = user?.roleCode || 'R01'
  const roleName = ROLES[roleCode as keyof typeof ROLES]?.name || roleCode

  const filteredMenu = MENU_ITEMS.filter((item) => {
    if (item.roles === 'all') return true
    return (item.roles as readonly string[]).includes(roleCode)
  })

  // Build grouped menu sorted by role priority
  const groupedMenu = useMemo(() => {
    const rolePriority = ROLE_GROUP_PRIORITY[roleCode] || ROLE_GROUP_PRIORITY['R01']
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

  // Auto-expand first 2 groups on role change
  useEffect(() => {
    const rolePriority = ROLE_GROUP_PRIORITY[roleCode] || ROLE_GROUP_PRIORITY['R01']
    const initial: Record<string, boolean> = {}
    rolePriority.forEach((g, i) => { initial[g] = i < 2 })
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
            <div className="w-[5px] rounded-t-sm" style={{ height: '16px', background: '#e63946' }} />
            <div className="w-[5px] rounded-t-sm" style={{ height: '22px', background: '#e63946' }} />
            <div className="w-[5px] rounded-t-sm" style={{ height: '19px', background: '#e63946' }} />
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
                          <MenuIcon name={item.icon} />
                          {!sidebarCollapsed && <span>{item.label}</span>}
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
              background: 'linear-gradient(135deg, #e63946, #c1262f)',
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
        transitionDuration: 'var(--duration-normal)',
        transitionTimingFunction: 'var(--ease-out)',
      }}>
        {/* Topbar */}
        <header className="sticky top-0 z-20 flex items-center justify-between" style={{
          height: '64px',
          padding: '0 32px',
          background: 'rgba(240, 244, 248, 0.9)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          borderBottom: '1px solid var(--border)',
        }}>
          <div>
            <h2 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-heading)' }}>
              {filteredMenu.find((m) => m.href === pathname)?.label || 'Dashboard'}
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
          {children}
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
  Settings, Hammer, BarChart, FileText, TestTube, FolderCheck, Calculator, Truck,
}

function MenuIcon({ name }: { name: string }) {
  const Icon = ICON_MAP[name] || AlertCircle
  return <Icon size={20} strokeWidth={1.75} />
}
