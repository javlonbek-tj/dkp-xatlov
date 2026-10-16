import { useState, type ReactNode } from 'react'
import { Alert, Avatar, Button, Drawer, Grid, Layout, Menu, Typography } from 'antd'
import type { MenuProps } from 'antd'
import {
  AlertOutlined,
  BarChartOutlined,
  BuildOutlined,
  FileSearchOutlined,
  HomeOutlined,
  LogoutOutlined,
  MenuOutlined,
  PhoneOutlined,
  SafetyCertificateOutlined,
  SolutionOutlined,
  TableOutlined,
  TeamOutlined,
} from '@ant-design/icons'

type Role = 'ADMIN' | 'REPUBLIC_EMPLOYEE' | 'REGIONAL_EMPLOYEE'
type User = { id: string; username: string; fullName: string; role: Role; isGroupLeader?: boolean }
export type Page = 'admin' | 'assignments' | 'report' | 'dashboard' | 'xatlov' | 'mkd' | 'rad' | 'overdue' | 'calls'

const roleLabels: Record<Role, string> = {
  ADMIN: 'Administrator',
  REPUBLIC_EMPLOYEE: 'Respublika xodimi',
  REGIONAL_EMPLOYEE: 'Hududiy xodim',
}

const pageLabels: Record<Page, string> = {
  admin: 'Boshqaruv',
  assignments: 'Tayinlangan xodimlar',
  report: 'Hisobot',
  dashboard: 'Bosh sahifa',
  xatlov: 'Xatlov',
  mkd: 'MKD',
  rad: 'RAD limitlari',
  overdue: 'Muddati o‘tgan arizalar',
  calls: 'Qoʻngʻiroqlar jurnali',
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase()
}

function AppLayout({ user, page, error, onNavigate, onLogout, children }: {
  user: User; page: Page; error: string | null; onNavigate: (page: Page) => void; onLogout: () => Promise<void>; children: ReactNode
}) {
  const screens = Grid.useBreakpoint()
  const isDesktop = screens.lg ?? true
  const [drawerOpen, setDrawerOpen] = useState(false)

  const items: MenuProps['items'] = [
    { type: 'group', label: 'Monitoring', children: [
      { key: 'dashboard', icon: <HomeOutlined />, label: pageLabels.dashboard },
      { key: 'report', icon: <TableOutlined />, label: pageLabels.report },
      { key: 'xatlov', icon: <FileSearchOutlined />, label: pageLabels.xatlov },
      { key: 'mkd', icon: <BuildOutlined />, label: pageLabels.mkd },
      { key: 'rad', icon: <BarChartOutlined />, label: pageLabels.rad },
      { key: 'overdue', icon: <AlertOutlined />, label: 'Muddati o‘tgan' },
      { key: 'calls', icon: <PhoneOutlined />, label: 'Qoʻngʻiroqlar' },
    ] },
    ...(user.role !== 'REGIONAL_EMPLOYEE' ? [{ type: 'group' as const, label: 'Boshqaruv', children: [
      ...(user.role === 'ADMIN' || user.isGroupLeader ? [{ key: 'admin', icon: <TeamOutlined />, label: 'Xodimlar va tayinlovlar' }] : []),
      { key: 'assignments', icon: <SolutionOutlined />, label: pageLabels.assignments },
    ] }] : []),
  ]

  const sidebar = <div className="flex h-full flex-col">
    <div className="flex items-center gap-3 px-6 py-6">
      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-500 text-lg text-white shadow-lg shadow-indigo-500/30"><SafetyCertificateOutlined /></div>
      <div className="leading-tight">
        <div className="text-base font-semibold text-white">Xatlov</div>
        <div className="text-xs text-slate-400">Hududiy monitoring</div>
      </div>
    </div>
    <Menu
      theme="dark"
      mode="inline"
      className="flex-1 !border-none !bg-transparent px-2"
      selectedKeys={[page]}
      items={items}
      onClick={({ key }) => { onNavigate(key as Page); setDrawerOpen(false) }}
    />
    <div className="m-3 rounded-xl bg-white/5 p-3">
      <div className="flex items-center gap-3">
        <Avatar className="!bg-indigo-500 shrink-0">{initials(user.fullName)}</Avatar>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-sm font-medium text-white">{user.fullName}</div>
          <div className="truncate text-xs text-slate-400">{roleLabels[user.role]}</div>
        </div>
      </div>
      <Button block className="mt-3" icon={<LogoutOutlined />} onClick={onLogout}>Chiqish</Button>
    </div>
  </div>

  return <Layout className="min-h-screen">
    {isDesktop
      ? <Layout.Sider width={256} className="!fixed inset-y-0 left-0 z-20 !bg-slate-900">{sidebar}</Layout.Sider>
      : <Drawer placement="left" open={drawerOpen} onClose={() => setDrawerOpen(false)} closable={false} size={256} styles={{ body: { padding: 0, background: '#0f172a' } }}>{sidebar}</Drawer>}
    <Layout className={isDesktop ? 'ml-64' : ''}>
      <Layout.Header className="sticky top-0 z-10 flex !h-16 items-center gap-3 border-b border-slate-200/70 !bg-white/80 !px-3 backdrop-blur md:!px-4">
        {!isDesktop && <Button type="text" icon={<MenuOutlined />} aria-label="Menyu" onClick={() => setDrawerOpen(true)} />}
        <Typography.Text type="secondary">Xatlov <span className="mx-1 text-slate-300">/</span> <span className="font-medium text-slate-800">{pageLabels[page]}</span></Typography.Text>
        <div className="ml-auto flex items-center gap-3">
          <div className="hidden text-right leading-tight sm:block">
            <div className="text-sm font-medium text-slate-800">{user.fullName}</div>
            <div className="text-xs text-slate-500">{roleLabels[user.role]}</div>
          </div>
          <Avatar className="!bg-indigo-500">{initials(user.fullName)}</Avatar>
        </div>
      </Layout.Header>
      <Layout.Content className="p-3 md:p-4">
        <div className="w-full">
          {error && <Alert className="!mb-6" type="error" showIcon message={error} />}
          {children}
        </div>
      </Layout.Content>
    </Layout>
  </Layout>
}

export default AppLayout
