// 应用访问密码配置
// 生产环境由 Vercel Environment Variable 配置: APP_PASSWORD
// 本地开发时设为 '' 可跳过验证
export const APP_PASSWORD = import.meta.env.VITE_APP_PASSWORD || ''
