// 应用访问密码配置
// 生产环境由 Vercel Environment Variable 配置: APP_PASSWORD
// 本地开发时设为 '' 可跳过验证
export const APP_PASSWORD = import.meta.env.VITE_APP_PASSWORD || ''

/** 顶部 QClaw 入口：打开登录 / 官网（可按实际登录页改 VITE_QCLAW_LOGIN_URL） */
export const QCLAW_LOGIN_URL =
  (import.meta.env.VITE_QCLAW_LOGIN_URL as string | undefined)?.trim() || 'https://qclaw.qq.com/'
