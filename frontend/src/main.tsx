import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ConfigProvider } from 'antd'
import { StyleProvider } from '@ant-design/cssinjs'
import './index.css'
import App from './App.tsx'

const theme = {
  token: {
    colorPrimary: '#4f46e5',
    colorBgLayout: '#f5f6fa',
    colorBorderSecondary: '#eceef3',
    borderRadius: 10,
    fontFamily: "'Inter', system-ui, 'Segoe UI', Roboto, sans-serif",
  },
  components: {
    Layout: { siderBg: '#0f172a', headerBg: 'transparent' },
    Menu: {
      darkItemBg: 'transparent',
      darkItemSelectedBg: '#4f46e5',
      darkGroupTitleColor: '#64748b',
      itemBorderRadius: 8,
      itemHeight: 42,
    },
    Card: { headerFontSize: 15 },
    Table: { headerBg: '#f8fafc', headerColor: '#475569' },
  },
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StyleProvider layer>
      <ConfigProvider theme={theme}>
        <App />
      </ConfigProvider>
    </StyleProvider>
  </StrictMode>,
)
