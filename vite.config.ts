import { defineConfig, type PluginOption } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import http from 'http'
import https from 'https'
import { URL } from 'url'

/**
 * 动态 API 代理插件：将 /timi-proxy 请求转发到 X-Target-Url 指定的后端，
 * 绕过浏览器 CORS 限制。仅用于开发环境。
 */
function timiProxyPlugin(): PluginOption {
  return {
    name: 'timi-proxy',
    configureServer(server) {
      server.middlewares.use('/timi-proxy', (req, res) => {
        let responded = false
        const safeJson = (status: number, payload: unknown) => {
          if (responded || res.writableEnded) return
          responded = true
          try {
            if (!res.headersSent) {
              res.writeHead(status, {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
              })
            }
          } catch {
            // ignore: headers might already be sent
          }
          try {
            res.end(JSON.stringify(payload))
          } catch {
            try {
              res.end()
            } catch {
              /* ignore */
            }
          }
        }

        // 只允许 POST
        if (req.method !== 'POST') {
          safeJson(405, { error: 'Method not allowed' })
          return
        }

        const targetUrl = req.headers['x-target-url'] as string | undefined
        if (!targetUrl) {
          safeJson(400, { error: 'Missing X-Target-Url header' })
          return
        }

        let parsed: URL
        try {
          parsed = new URL(targetUrl)
        } catch {
          safeJson(400, { error: 'Invalid X-Target-Url' })
          return
        }

        // 收集请求体
        const chunks: Buffer[] = []
        req.on('data', (chunk: Buffer) => chunks.push(chunk))
        req.on('end', () => {
          const body = Buffer.concat(chunks)

          // 构造转发的 headers
          const fwdHeaders: Record<string, string> = {
            'Content-Type': req.headers['content-type'] || 'application/json',
            'Content-Length': String(body.length),
          }
          if (req.headers['authorization']) {
            fwdHeaders['Authorization'] = req.headers['authorization']
          }

          const transport = parsed.protocol === 'https:' ? https : http

          const proxyReq = transport.request(
            {
              hostname: parsed.hostname,
              port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
              path: parsed.pathname + parsed.search,
              method: 'POST',
              headers: fwdHeaders,
              // TIMI 图像生成经常 > 120s（尤其 2K/4K、多参考图）。
              // 这里提高超时阈值，避免开发环境频繁 504。
              timeout: 300_000,
            },
            (proxyRes) => {
              if (responded || res.writableEnded) {
                proxyRes.resume()
                return
              }
              responded = true

              // 流式转发响应
              if (!res.headersSent) {
                res.writeHead(proxyRes.statusCode || 502, {
                  'Content-Type': proxyRes.headers['content-type'] || 'application/json',
                  'Access-Control-Allow-Origin': '*',
                })
              }

              proxyRes.on('error', (err) => {
                console.error('[timi-proxy] proxyRes error:', err?.message || err)
                safeJson(502, { error: 'Proxy response error: ' + (err?.message || String(err)) })
              })

              proxyRes.pipe(res)
            },
          )

          proxyReq.on('error', (err) => {
            console.error('[timi-proxy] forward error:', err.message)
            safeJson(502, { error: 'Proxy error: ' + err.message })
          })

          proxyReq.on('timeout', () => {
            proxyReq.destroy()
            safeJson(504, { error: 'Proxy timeout' })
          })

          // 浏览器端主动断开/取消
          req.on('aborted', () => {
            try {
              proxyReq.destroy()
            } catch {
              /* ignore */
            }
          })
          res.on('close', () => {
            try {
              proxyReq.destroy()
            } catch {
              /* ignore */
            }
          })

          proxyReq.write(body)
          proxyReq.end()
        })
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), timiProxyPlugin()],
  server: {
    host: true,
    // 与 Vite 默认一致，避免一直访问 5173 时实际服务在 5175 导致「打不开」
    port: 5173,
    strictPort: false,
  },
})
