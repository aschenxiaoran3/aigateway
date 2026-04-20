import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/** 控制平面（Deep Wiki / Harness / 治理与编排等）；本地可与 docker 端口一致 */
const CONTROL_PLANE = process.env.VITE_CONTROL_PLANE_URL || 'http://127.0.0.1:3104'
const AI_GATEWAY = process.env.VITE_AI_GATEWAY_URL || 'http://127.0.0.1:3001'

/** AI 网关：用量 / 密钥 / 设置 / 门禁 / 审计日志等（勿用 `/api` 兜底抢在 `/api/v1/deepwiki` 之前匹配） */
const gatewayProxy = { target: AI_GATEWAY, changeOrigin: true } as const

export default defineConfig({
  /** 单页应用：开发 / vite preview 均由 Vite 内置 htmlFallbackMiddleware 回退到 index.html */
  appType: 'spa',
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 3000,
    strictPort: true,
    proxy: {
      // —— 控制平面：须排在通用 `/api` 之前；勿使用 `/api/v1/audit`，否则会前缀匹配到 `/api/v1/audit-logs`（误转发到 CP）
      '/api/v1/deepwiki': { target: CONTROL_PLANE, changeOrigin: true },
      '/api/v1/harness': { target: CONTROL_PLANE, changeOrigin: true },
      '/api/v1/doc-bundles': { target: CONTROL_PLANE, changeOrigin: true },
      '/api/v1/program': { target: CONTROL_PLANE, changeOrigin: true },
      '/api/v1/control': { target: CONTROL_PLANE, changeOrigin: true },
      '/api/v1/runtime': { target: CONTROL_PLANE, changeOrigin: true },
      '/api/v1/governance': { target: CONTROL_PLANE, changeOrigin: true },
      '/api/v1/value-assessments': { target: CONTROL_PLANE, changeOrigin: true },
      '/api/v1/contracts': { target: CONTROL_PLANE, changeOrigin: true },
      '/api/v1/evidence': { target: CONTROL_PLANE, changeOrigin: true },
      '/api/v1/audit/events': { target: CONTROL_PLANE, changeOrigin: true },
      '/api/v1/knowledge': { target: CONTROL_PLANE, changeOrigin: true },
      '/api/v1/metrics': { target: CONTROL_PLANE, changeOrigin: true },
      // —— AI 网关（显式前缀，避免误进 CP）
      '/api/v1/settings': gatewayProxy,
      '/api/v1/keys': gatewayProxy,
      '/api/v1/teams': gatewayProxy,
      '/api/v1/usage': gatewayProxy,
      '/api/v1/research': gatewayProxy,
      '/api/v1/audit-logs': gatewayProxy,
      '/api/v1/gates': gatewayProxy,
      // 其余 `/api/*`（如 gateway 上其它 /api/v1 扩展）再走网关
      '/api': gatewayProxy,
    },
  },
})
