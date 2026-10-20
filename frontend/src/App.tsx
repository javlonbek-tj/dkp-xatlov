import { useState } from 'react'
import { Alert, Button, Form, Input, Space, Typography } from 'antd'
import { LockOutlined, SafetyCertificateOutlined, UserOutlined } from '@ant-design/icons'
import AdminPanel from './AdminPanel'
import AssignmentsPage from './AssignmentsPage'
import ReportPage from './ReportPage'
import XatlovPage from './XatlovPage'
import XatlovEmployeesTab from './XatlovEmployeesTab'
import MkdPage from './MkdPage'
import RadLimitPage from './RadLimitPage'
import OverdueApplicationsPage from './OverdueApplicationsPage'
import DashboardPage from './DashboardPage'
import CallLogPage from './CallLogPage'
import AppLayout, { type Page } from './AppLayout'
import { queryClient } from './api'

type User = {
  id: string
  username: string
  fullName: string
  role: 'ADMIN' | 'REPUBLIC_EMPLOYEE' | 'REGIONAL_EMPLOYEE' | 'VIEWER' | 'DISTRICT_HEAD'
  isGroupLeader?: boolean
}

type LoginValues = { username: string; password: string }

function App() {
  const [token, setToken] = useState<string | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState<Page>('dashboard')

  async function signIn(values: LoginValues) {
    setError(null)
    setLoading(true)
    try {
      const loginResponse = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      })
      const loginData = await loginResponse.json()
      if (!loginResponse.ok) {
        throw new Error(loginData.error?.message ?? 'Kirish amalga oshmadi')
      }

      const currentUserResponse = await fetch('/api/auth/me', {
        headers: { Authorization: `Bearer ${loginData.token}` },
      })
      const currentUserData = await currentUserResponse.json()
      if (!currentUserResponse.ok) {
        throw new Error(currentUserData.error?.message ?? 'Foydalanuvchini tekshirib bo‘lmadi')
      }

      setToken(loginData.token)
      setUser(currentUserData.user)
      setPage(currentUserData.user.role === 'ADMIN' ? 'admin' : currentUserData.user.role === 'DISTRICT_HEAD' ? 'xatlov' : 'dashboard')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Kirish amalga oshmadi')
    } finally {
      setLoading(false)
    }
  }

  async function signOut() {
    if (token) {
      try {
        const response = await fetch('/api/auth/logout', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!response.ok) {
          throw new Error('Sessiyani yakunlab bo‘lmadi. Qayta urinib ko‘ring.')
        }
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Chiqish amalga oshmadi')
        return
      }
    }
    // Drop cached data so the next user never sees the previous user's records.
    queryClient.clear()
    setToken(null)
    setUser(null)
    setError(null)
  }

  if (user && token) {
    const props = { token, user }
    return (
      <AppLayout user={user} page={page} error={error} onNavigate={setPage} onLogout={signOut}>
        {user.role === 'DISTRICT_HEAD' ? <XatlovEmployeesTab {...props} />
          : page === 'admin' && (user.role === 'ADMIN' || user.isGroupLeader) ? <AdminPanel {...props} />
          : page === 'assignments' && (user.role === 'ADMIN' || user.role === 'REPUBLIC_EMPLOYEE') ? <AssignmentsPage {...props} />
          : page === 'report' ? <ReportPage {...props} />
          : page === 'xatlov' ? <XatlovPage {...props} />
          : page === 'mkd' ? <MkdPage {...props} />
          : page === 'rad' ? <RadLimitPage {...props} />
          : page === 'overdue' ? <OverdueApplicationsPage {...props} />
          : page === 'calls' && user.role !== 'VIEWER' ? <CallLogPage {...props} />
          : <DashboardPage {...props} />}
      </AppLayout>
    )
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-950 p-4">
      <div className="pointer-events-none absolute -left-32 -top-32 h-96 w-96 rounded-full bg-indigo-600/30 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-40 -right-24 h-[28rem] w-[28rem] rounded-full bg-sky-500/20 blur-3xl" />
      <div className="relative grid w-full max-w-4xl overflow-hidden rounded-3xl bg-white shadow-2xl md:grid-cols-2">
        <div className="hidden flex-col justify-between bg-gradient-to-br from-indigo-600 to-sky-600 p-10 text-white md:flex">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/15 text-xl">
              <SafetyCertificateOutlined />
            </div>
            <span className="text-xl font-semibold">Xatlov</span>
          </div>
          <div>
            <h2 className="mb-3 text-3xl font-semibold leading-tight">Hududiy monitoring tizimi</h2>
            <p className="text-indigo-100">Xatlov, MKD, RAD limit, muddati o‘tgan arizalar va qo‘ng‘iroqlar bo‘yicha kunlik ma’lumotlar bir joyda.</p>
          </div>
          <span className="text-sm text-indigo-200">© {new Date().getFullYear()} Xatlov</span>
        </div>

        <div className="p-8 sm:p-10">
          <Space direction="vertical" size="large" className="w-full">
            <div>
              <div className="mb-6 flex items-center gap-3 md:hidden">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500 text-lg text-white">
                  <SafetyCertificateOutlined />
                </div>
                <span className="text-lg font-semibold">Xatlov</span>
              </div>
              <Typography.Title level={2} className="!mb-1">Tizimga kirish</Typography.Title>
              <Typography.Text type="secondary">Login va parolingizni kiriting</Typography.Text>
            </div>

            {error && <Alert type="error" showIcon message={error} />}

            {/* Browser autofill is turned off: the login and password are typed every time. */}
            <Form<LoginValues> layout="vertical" size="large" onFinish={signIn} requiredMark={false} autoComplete="off" className="[&_.ant-form-item-label]:!pb-1">
              <Form.Item
                label="Login"
                name="username"
                rules={[{ required: true, whitespace: true, message: 'Loginni kiriting' }]}
              >
                <Input prefix={<UserOutlined className="text-slate-400" />} placeholder="Login" autoComplete="off" autoFocus maxLength={100} />
              </Form.Item>
              <Form.Item
                label="Parol"
                name="password"
                rules={[{ required: true, message: 'Parolni kiriting' }]}
              >
                <Input.Password prefix={<LockOutlined className="text-slate-400" />} placeholder="Parol" autoComplete="new-password" maxLength={200} />
              </Form.Item>
              <Button type="primary" htmlType="submit" block loading={loading} className="mt-2 !h-12 !rounded-xl !font-medium">
                Kirish
              </Button>
            </Form>
          </Space>
        </div>
      </div>
    </main>
  )
}

export default App
