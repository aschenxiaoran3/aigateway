import React from 'react'
import ReactDOM from 'react-dom/client'
import { ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import dayjs from 'dayjs'
import 'dayjs/locale/zh-cn'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { AppWorkspaceProvider } from './context/AppWorkspaceContext'
import './styles/index.css'

// 设置 dayjs 为中文
dayjs.locale('zh-cn')

ReactDOM.createRoot(document.getElementById('root')!).render(
  <ConfigProvider
    locale={zhCN}
    theme={{
      token: {
        colorPrimary: '#1890ff',
        borderRadius: 4,
      },
    }}
  >
    <AppWorkspaceProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </AppWorkspaceProvider>
  </ConfigProvider>,
)
