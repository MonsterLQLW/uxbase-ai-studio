import { useState, useEffect, lazy, Suspense, Component, type ReactNode } from 'react'
import Layout, { type Tab } from './components/Layout'
import HomePage from './components/HomePage'
import HomeStyleBackdrop from './components/HomeStyleBackdrop'
import AuroraBg from './components/AuroraBg'
import { Settings, Sparkles } from 'lucide-react'
import ChatPanel from './components/ChatPanel'
import { setGeminiKey as setGeminiKeyService, setTIMIKey, setTIMIUrl, setTIMIModel, testGeminiConnection, testTIMIConnection } from './services/gemini'
import type { FlowState as AvatarFlowState } from './components/AvatarFrameDesigner'
import { APP_PASSWORD } from './config'

// 错误边界组件，捕获渲染错误
class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error: string }> {
  constructor(props: { children: ReactNode }) {
    super(props)
    this.state = { hasError: false, error: '' }
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error: error.message || '未知错误' }
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="w-full h-full flex flex-col items-center justify-center bg-slate-900 text-white p-8">
          <div className="text-6xl mb-4">💥</div>
          <div className="text-xl font-bold mb-2">页面出错了</div>
          <div className="text-sm text-slate-400 mb-4 max-w-lg text-center">{this.state.error}</div>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-indigo-500 rounded-lg hover:bg-indigo-600 transition"
          >
            刷新页面
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

// ReactFlow 懒加载，避免头像框页面卡顿
const LazyAvatarFrameDesigner = lazy(() => import('./components/AvatarFrameDesigner'))
const LazyAIMatting = lazy(() => import('./components/AIMatting'))
const LazyOutputTool = lazy(() => import('./components/OutputTool'))

type ShapeKind = 'circle' | 'square'
type Quadrant = 'lt' | 'lb' | 'rt' | 'rb'

type LabeledImage = {
  id: string
  dataUrl: string
  label: string
}

type CompositeElement = {
  imageId: string
  x: number // 0..1
  y: number // 0..1
  scale: number // 0.1..2
  rotateDeg: number // -180..180
  opacity: number // 0..1
  zIndex: number
}

type AvatarFrameState = {
  shape: ShapeKind
  quadrants: Quadrant[]
  images: LabeledImage[]
  aiModel: AvatarFlowState['aiModel']
  aiPrompt: string
  /** 0–100，越大生成结果越贴近参考图风格与元素 */
  referenceSimilarity: number
  aiResult: string
  generatedImageDataUrls: string[]
  timiImageSize: '1K' | '2K'
  composite: {
    elements: CompositeElement[]
    borderWidth: number
    borderColor: string
    glow: number
  }
  colorTheme: any
  // 同类型参考
  similarReferences: LabeledImage[]
  similarKeywords: string[]
  similarAnalysis: string
  similarAnalysisEngine: 'gemini' | 'timi-chat'
  generateImageVariantCount: 1 | 3
  regionalConstraints: Record<string, any>
}

type MattingRGB = { r: number; g: number; b: number }
type MattingMode = 'solid' | 'glass'
type MattingState = {
  mode: MattingMode
  /** 原图 dataUrl（切换顶部功能也需保留） */
  originalDataUrl: string
  /** 处理结果 PNG dataUrl（便于持久化；Canvas 可按需重绘） */
  processedDataUrl: string
  /** 操作记录：撤回/前调（仅记录处理结果） */
  historyPast: string[]
  historyFuture: string[]
  isWhiteBg: boolean
  isPicking: boolean
  customColors: MattingRGB[]
  // Solid
  sTolerance: number
  sBlack: number
  sSmooth: number
  sBlur: number
  sShift: number
  // Glass
  gThresh: number
  gBoost: number
  gShadow: number
  gDegray: number
  gFeather: number
}

function SettingsPanel({
  geminiKey,
  setGeminiKey,
  timiKey,
  setTimiKey,
  timiUrl,
  setTimiUrl: onSetTimiUrl,
  timiModel,
  setTimiModel,
  geminiResult,
  setGeminiResult,
  geminiTestDetail,
  setGeminiTestDetail,
  timiResult,
  setTimiResult,
  timiTestDetail,
  setTimiTestDetail,
}: {
  geminiKey: string
  setGeminiKey: (value: string) => void
  timiKey: string
  setTimiKey: (value: string) => void
  timiUrl: string
  setTimiUrl: (value: string) => void
  timiModel: string
  setTimiModel: (value: string) => void
  geminiResult: 'idle' | 'testing' | 'success' | 'error'
  setGeminiResult: (value: 'idle' | 'testing' | 'success' | 'error') => void
  geminiTestDetail: string
  setGeminiTestDetail: (value: string) => void
  timiResult: 'idle' | 'testing' | 'success' | 'error'
  setTimiResult: (value: 'idle' | 'testing' | 'success' | 'error') => void
  timiTestDetail: string
  setTimiTestDetail: (value: string) => void
}) {
  const testGeminiConnectionHandler = async () => {
    setGeminiResult('testing')
    setGeminiTestDetail('')
    setGeminiKey(geminiKey.trim())
    setGeminiKeyService(geminiKey.trim())
    try {
      const result = await testGeminiConnection(geminiKey)
      if (result.ok) {
        setGeminiResult('success')
        setGeminiTestDetail(result.message)
        localStorage.setItem('geminiConnectionStatus', 'success')
      } else {
        setGeminiResult('error')
        setGeminiTestDetail(result.message)
        localStorage.setItem('geminiConnectionStatus', 'error')
      }
    } catch {
      setGeminiResult('error')
      setGeminiTestDetail('测试过程发生异常，请打开浏览器控制台查看详情。')
      localStorage.setItem('geminiConnectionStatus', 'error')
    }
  }

  const testTIMIConnectionHandler = async () => {
    setTimiResult('testing')
    setTimiTestDetail('')
    setTIMIKey(timiKey.trim())
    setTIMIUrl(timiUrl.trim())
    setTIMIModel(timiModel.trim() || 'gpt-5')
    try {
      const result = await testTIMIConnection()
      if (result.ok) {
        setTimiResult('success')
        setTimiTestDetail(result.message)
        localStorage.setItem('timiConnectionStatus', 'success')
      } else {
        setTimiResult('error')
        setTimiTestDetail(result.message)
        localStorage.setItem('timiConnectionStatus', 'error')
      }
    } catch {
      setTimiResult('error')
      setTimiTestDetail('测试过程发生异常，请打开浏览器控制台查看详情。')
      localStorage.setItem('timiConnectionStatus', 'error')
    }
  }

  const inputClass =
    'w-full rounded-xl border border-white/12 bg-slate-950/50 px-4 py-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-violet-400/45 focus:outline-none focus:ring-2 focus:ring-violet-500/15'
  const inputClassMono =
    'w-full rounded-xl border border-white/12 bg-slate-950/50 px-4 py-2.5 font-mono text-xs text-slate-100 placeholder:text-slate-500 focus:border-violet-400/45 focus:outline-none focus:ring-2 focus:ring-violet-500/15'
  const cardClass =
    'rounded-2xl border border-white/[0.08] bg-slate-950/40 p-6 shadow-[0_12px_48px_rgba(0,0,0,0.38)] backdrop-blur-xl ring-1 ring-white/[0.05]'

  return (
    <div className="relative h-full min-h-0 overflow-y-auto [scrollbar-color:rgba(100,116,139,0.45)_transparent]">
      <HomeStyleBackdrop omitSideGlow />
      <div className="relative z-0 mx-auto max-w-5xl pb-12 pt-2 sm:pt-4">
        <div className="mb-10 text-center">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-violet-400/25 bg-violet-500/[0.08] px-4 py-2 text-xs font-medium text-violet-100 shadow-[0_0_24px_rgba(139,92,246,0.15)] backdrop-blur-md">
            <Sparkles className="h-3.5 w-3.5 shrink-0 text-violet-300" strokeWidth={2} />
            <span>Gemini · TIMI · 连接与偏好</span>
          </div>
          <h2 className="font-brand flex items-center justify-center gap-3 text-3xl font-semibold tracking-tight text-transparent sm:text-4xl">
            <Settings className="h-8 w-8 shrink-0 text-violet-300/90 sm:h-9 sm:w-9" strokeWidth={1.75} />
            <span className="bg-gradient-to-r from-violet-200 via-white to-cyan-200 bg-clip-text drop-shadow-[0_0_28px_rgba(139,92,246,0.2)]">
              设置
            </span>
          </h2>
          <p className="mx-auto mt-3 max-w-lg text-sm leading-relaxed text-slate-400">
            与首页同一套光斑与玻璃质感。在此配置密钥、测试连通性并查看模型说明。
          </p>
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
          <div className={cardClass}>
            <h3 className="mb-1 text-sm font-semibold uppercase tracking-wider text-violet-200/85">API 配置</h3>
            <p className="mb-5 text-xs text-slate-500">密钥仅保存在本机浏览器，不会上传至第三方。</p>
            <div className="space-y-6">
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-300">Google Gemini API Key</label>
                <input
                  type="password"
                  placeholder="填入你的 API Key"
                  value={geminiKey}
                  onChange={e => setGeminiKey(e.target.value)}
                  className={inputClass}
                />
                <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
                  <button
                    type="button"
                    onClick={testGeminiConnectionHandler}
                    disabled={geminiResult === 'testing' || !geminiKey.trim()}
                    className="rounded-xl bg-gradient-to-br from-sky-500 to-cyan-600 px-4 py-3 text-sm font-medium text-white shadow-[0_8px_28px_rgba(14,165,233,0.35)] transition hover:from-sky-400 hover:to-cyan-500 disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none"
                  >
                    {geminiResult === 'testing' ? '测试中...' : '测试 Gemini 连接'}
                  </button>
                  {geminiResult === 'success' && <span className="text-xs text-emerald-300/95">✅ Gemini 已连接</span>}
                  {geminiResult === 'error' && <span className="text-xs text-red-300/95">❌ Gemini 连接失败</span>}
                </div>
                {geminiTestDetail && (
                  <p
                    className={`mt-2 text-xs leading-relaxed ${
                      geminiResult === 'success' ? 'text-emerald-300/90' : 'text-red-300/90'
                    }`}
                  >
                    {geminiTestDetail}
                  </p>
                )}
                <p className="mt-2 text-xs text-slate-500">
                  获取地址{' '}
                  <a
                    href="https://aistudio.google.com/app/apikey"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-cyan-300/90 underline decoration-cyan-500/40 underline-offset-2 transition hover:text-cyan-200"
                  >
                    aistudio.google.com/app/apikey
                  </a>
                </p>
              </div>

              <div className="border-t border-white/[0.06] pt-6">
                <label className="mb-2 block text-sm font-medium text-slate-300">TIMI AI API Key</label>
                <input
                  type="password"
                  placeholder="填入 TIMI AI API Key"
                  value={timiKey}
                  onChange={e => setTimiKey(e.target.value)}
                  className={inputClass}
                />
                <div className="mt-3 space-y-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-500">API 地址</label>
                    <input
                      type="text"
                      placeholder="填入 TIMI API 地址"
                      value={timiUrl}
                      onChange={e => onSetTimiUrl(e.target.value)}
                      className={inputClassMono}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-500">模型名称</label>
                    <input
                      type="text"
                      placeholder="gpt-5"
                      value={timiModel}
                      onChange={e => setTimiModel(e.target.value)}
                      className={inputClassMono}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={testTIMIConnectionHandler}
                    disabled={timiResult === 'testing' || !timiKey}
                    className="rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 px-4 py-3 text-sm font-medium text-white shadow-[0_8px_28px_rgba(99,102,241,0.38)] transition hover:from-indigo-400 hover:to-violet-500 disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none"
                  >
                    {timiResult === 'testing' ? '测试中...' : '测试 TIMI 连接'}
                  </button>
                  {timiResult === 'success' && <p className="text-xs text-emerald-300/95">✅ {timiTestDetail || 'TIMI 已连接'}</p>}
                  {timiResult === 'error' && (
                    <p className="text-xs leading-relaxed text-red-300/95">
                      ❌ {timiTestDetail || 'TIMI 连接失败'}
                      <br />
                      <span className="text-slate-500">请确认内网环境、API Key 与地址是否正确。</span>
                    </p>
                  )}
                </div>
                <p className="mt-3 text-xs leading-relaxed text-slate-500">
                  TIMI 为内部模型代理，支持 chat / completions。
                  <br />
                  <span className="text-amber-400/80">需在内部网络使用并自备 API Key。</span>
                </p>
              </div>
            </div>
          </div>

          <div className={cardClass}>
            <h3 className="mb-1 text-sm font-semibold uppercase tracking-wider text-violet-200/85">模型设置</h3>
            <p className="mb-5 text-xs text-slate-500">默认能力说明（与部分功能页的模型选项对应）。</p>
            <div className="space-y-3">
              <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-violet-400/35 bg-violet-500/[0.08] p-4 backdrop-blur-sm transition hover:border-violet-400/50 hover:bg-violet-500/12">
                <input type="radio" name="model" value="gemini-2.5-flash" defaultChecked className="accent-violet-400" />
                <div>
                  <div className="text-sm font-medium text-slate-100">Gemini 2.5 Flash</div>
                  <div className="text-xs text-slate-400">免费 · 速度快 · 支持图片</div>
                </div>
              </label>
              <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur-sm transition hover:border-white/18 hover:bg-white/[0.07]">
                <input type="radio" name="model" value="gemini-3-flash-preview" className="accent-violet-400" />
                <div>
                  <div className="text-sm font-medium text-slate-100">Gemini 3 Flash</div>
                  <div className="text-xs text-slate-400">最新 · 推理能力更强</div>
                </div>
              </label>
            </div>
          </div>

          <div className={`${cardClass} xl:col-span-2`}>
            <h3 className="mb-1 text-sm font-semibold uppercase tracking-wider text-violet-200/85">关于</h3>
            <p className="mb-4 text-xs text-slate-500">UXbase AI Studio 工作台信息</p>
            <div className="space-y-2 text-sm text-slate-300/95">
              <p className="font-medium text-slate-100">UXbase AI Studio</p>
              <p className="text-slate-400">React 19 · Tailwind CSS · Three.js</p>
              <p className="text-slate-400">
                默认对话与创作能力：<span className="text-cyan-200/90">Google Gemini</span> ·{' '}
                <span className="text-violet-200/90">TIMI</span>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function App() {
  const [isUnlocked, setIsUnlocked] = useState(() => {
    if (!APP_PASSWORD) return true
    return localStorage.getItem('appUnlocked') === 'true'
  })
  const [activeTab, setActiveTab] = useState<Tab>('home')
  const [geminiKey, setGeminiKey] = useState(() => localStorage.getItem('geminiApiKey') || '')
  const [timiKey, setTimiKey] = useState(() => localStorage.getItem('timiApiKey') || '')
  const [timiUrl, setTimiUrl] = useState(() => localStorage.getItem('timiApiUrl') || '')
  const [timiModel, setTimiModel] = useState(() => localStorage.getItem('timiModel') || 'gpt-5')
  const [geminiResult, setGeminiResult] = useState<'idle' | 'testing' | 'success' | 'error'>(() =>
    (localStorage.getItem('geminiConnectionStatus') as 'idle' | 'testing' | 'success' | 'error') || 'idle'
  )
  const [timiResult, setTimiResult] = useState<'idle' | 'testing' | 'success' | 'error'>(() =>
    (localStorage.getItem('timiConnectionStatus') as 'idle' | 'testing' | 'success' | 'error') || 'idle'
  )
  const [geminiTestDetail, setGeminiTestDetail] = useState('')
  const [timiTestDetail, setTimiTestDetail] = useState('')

  // 头像框设计器状态
  const [avatarFrameState, setAvatarFrameState] = useState<AvatarFrameState>(() => {
    const empty: AvatarFrameState = {
      shape: 'circle' as ShapeKind,
      quadrants: ['lt'] as Quadrant[],
      images: [] as LabeledImage[],
      aiModel: 'gemini-3-flash-preview' as const,
      aiPrompt: '',
      referenceSimilarity: 70,
      aiResult: '',
      generatedImageDataUrls: [],
      timiImageSize: '1K',
      composite: {
        elements: [],
        borderWidth: 0,
        borderColor: '#6366f1',
        glow: 0.25,
      },
      colorTheme: { images: [], engine: 'gemini', model: 'gemini-2.5-flash', style: '', bullets: [], keywords: [], colors: [], raw: '' },
      regionalConstraints: {
        lt: { enabled: true, prompt: '', assets: [] },
        rt: { enabled: false, prompt: '', assets: [] },
        lb: { enabled: false, prompt: '', assets: [] },
        rb: { enabled: false, prompt: '', assets: [] },
        frame: { enabled: true, prompt: '', assets: [] },
      },
      similarReferences: [],
      similarKeywords: [],
      similarAnalysis: '',
      similarAnalysisEngine: 'gemini',
      generateImageVariantCount: 1,
    }
    const saved = localStorage.getItem('avatarFrameState')
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as Partial<AvatarFrameState>
        const sim = parsed.referenceSimilarity
        const vc = parsed.generateImageVariantCount
        const size = parsed.timiImageSize
        return {
          ...empty,
          ...parsed,
          referenceSimilarity:
            typeof sim === 'number' && !Number.isNaN(sim) ? Math.min(100, Math.max(0, sim)) : empty.referenceSimilarity,
          generateImageVariantCount: vc === 3 ? 3 : 1,
          timiImageSize: size === '2K' ? '2K' : '1K',
        }
      } catch (e) {
        console.warn('Failed to parse saved avatar frame state:', e)
      }
    }
    return empty
  })

  const [mattingState, setMattingState] = useState<MattingState>(() => {
    const empty: MattingState = {
      mode: 'solid',
      originalDataUrl: '',
      processedDataUrl: '',
      historyPast: [],
      historyFuture: [],
      isWhiteBg: false,
      isPicking: false,
      customColors: [],
      sTolerance: 20,
      sBlack: 30,
      sSmooth: 0,
      sBlur: 10,
      sShift: -2,
      gThresh: 10,
      gBoost: 50,
      gShadow: 50,
      gDegray: 80,
      gFeather: 8,
    }
    return empty
  })

  // 持久化 Gemini Key（内存与 localStorage 同步，供各页面调用 Gemini 时立即生效）
  useEffect(() => {
    localStorage.setItem('geminiApiKey', geminiKey)
    setGeminiKeyService(geminiKey.trim())
  }, [geminiKey])

  useEffect(() => {
    localStorage.setItem('timiApiKey', timiKey)
    setTIMIKey(timiKey)
    if (timiResult === 'success' || timiResult === 'error') {
      setTimiResult('idle')
      localStorage.setItem('timiConnectionStatus', 'idle')
    }
  }, [timiKey])

  useEffect(() => {
    localStorage.setItem('timiApiUrl', timiUrl)
    setTIMIUrl(timiUrl)
  }, [timiUrl])

  useEffect(() => {
    localStorage.setItem('timiModel', timiModel)
    setTIMIModel(timiModel)
  }, [timiModel])

  // 持久化头像框设计器状态
  useEffect(() => {
    const stripHeavy = (s: AvatarFrameState): AvatarFrameState => {
      const stripImages = (arr: any) =>
        Array.isArray(arr) ? arr.map((it: any) => ({ ...it, dataUrl: '' })) : []

      const nextRegionalConstraints: Record<string, any> = {}
      const rc = (s as any).regionalConstraints
      if (rc && typeof rc === 'object') {
        for (const k of Object.keys(rc)) {
          const v = rc[k]
          nextRegionalConstraints[k] = {
            ...(v || {}),
            assets: stripImages(v?.assets),
          }
        }
      }

      return {
        ...s,
        images: stripImages((s as any).images),
        similarReferences: stripImages((s as any).similarReferences),
        colorTheme: {
          ...(s as any).colorTheme,
          images: stripImages((s as any).colorTheme?.images),
        },
        regionalConstraints: nextRegionalConstraints,
      }
    }

    try {
      const raw = JSON.stringify(avatarFrameState)
      // localStorage 配额很小（不同浏览器/策略差异大），大图 base64 会直接卡死/抛异常
      if (raw.length > 800_000) {
        const light = JSON.stringify(stripHeavy(avatarFrameState))
        localStorage.setItem('avatarFrameState', light)
      } else {
        localStorage.setItem('avatarFrameState', raw)
      }
    } catch (e) {
      console.warn('[avatarFrameState] localStorage 持久化失败，已自动瘦身重试：', e)
      try {
        localStorage.setItem('avatarFrameState', JSON.stringify(stripHeavy(avatarFrameState)))
      } catch (e2) {
        console.warn('[avatarFrameState] 轻量持久化仍失败，跳过本次保存：', e2)
      }
    }
  }, [avatarFrameState])

  // 智能抠图不做 localStorage 持久化：切换顶部 Tab 保留（内存），刷新网页自动清空往期资源

  // 密码解锁
  const [unlockInput, setUnlockInput] = useState('')
  const [unlockError, setUnlockError] = useState('')

  const handleUnlock = () => {
    if (unlockInput === APP_PASSWORD) {
      localStorage.setItem('appUnlocked', 'true')
      setIsUnlocked(true)
      setUnlockError('')
    } else {
      setUnlockError('密码错误，请重试')
      setUnlockInput('')
    }
  }

  // 未解锁时显示密码门
  if (!isUnlocked && APP_PASSWORD) {
    return (
      <div className="w-full h-screen flex items-center justify-center bg-slate-900 overflow-hidden">
        <AuroraBg />
        <div className="relative z-10 w-full max-w-sm mx-auto p-8 bg-slate-800 rounded-2xl shadow-2xl border border-slate-700">
          <div className="text-center mb-8">
            <div className="text-4xl mb-3">🔐</div>
            <h1 className="font-brand text-2xl font-semibold tracking-tight text-white mb-1">UXbase AI Studio</h1>
            <p className="text-sm text-slate-400">请输入访问密码</p>
          </div>
          <div className="space-y-4">
            <input
              type="password"
              value={unlockInput}
              onChange={(e) => { setUnlockInput(e.target.value); setUnlockError('') }}
              onKeyDown={(e) => e.key === 'Enter' && handleUnlock()}
              placeholder="输入密码后按回车"
              className="w-full px-4 py-3 bg-slate-900 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition text-center"
              autoFocus
            />
            {unlockError && (
              <p className="text-red-400 text-sm text-center">{unlockError}</p>
            )}
            <button
              onClick={handleUnlock}
              className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-lg transition"
            >
              进入
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <>
      <AuroraBg />
      <Layout activeTab={activeTab} onTabChange={setActiveTab}>
        {activeTab === 'home' && <HomePage onNavigate={setActiveTab} />}
        {/* 常驻挂载：切到其他 Tab 不卸载，保留消息、输入与进行中的请求 */}
        <div
          hidden={activeTab !== 'chat'}
          className="h-full min-h-0 min-w-0 flex flex-col"
          aria-hidden={activeTab !== 'chat'}
        >
          <ChatPanel />
        </div>
        {activeTab === 'avatar-frame' && (
          <div className="w-full h-full relative">
            <ErrorBoundary>
              <Suspense fallback={<div className="flex items-center justify-center h-full text-slate-400">加载头像框设计器中...</div>}>
                <LazyAvatarFrameDesigner
                  state={avatarFrameState}
                  onStateChange={setAvatarFrameState}
                />
              </Suspense>
            </ErrorBoundary>
          </div>
        )}
        {activeTab === 'ai-matting' && (
          <div className="w-full h-full relative">
            <Suspense fallback={<div className="flex items-center justify-center h-full text-slate-400">加载 智能抠图 中...</div>}>
              <LazyAIMatting state={mattingState} onStateChange={setMattingState} />
            </Suspense>
          </div>
        )}
        {activeTab === 'output-tool' && (
          <div className="w-full h-full relative">
            <Suspense fallback={<div className="flex items-center justify-center h-full text-slate-400">加载输出工具中...</div>}>
              <LazyOutputTool />
            </Suspense>
          </div>
        )}
        {activeTab === 'settings' && (
          <SettingsPanel
            geminiKey={geminiKey}
            setGeminiKey={setGeminiKey}
            timiKey={timiKey}
            setTimiKey={setTimiKey}
            timiUrl={timiUrl}
            setTimiUrl={setTimiUrl}
            timiModel={timiModel}
            setTimiModel={setTimiModel}
            geminiResult={geminiResult}
            setGeminiResult={setGeminiResult}
            geminiTestDetail={geminiTestDetail}
            setGeminiTestDetail={setGeminiTestDetail}
            timiResult={timiResult}
            setTimiResult={setTimiResult}
            timiTestDetail={timiTestDetail}
            setTimiTestDetail={setTimiTestDetail}
          />
        )}
      </Layout>
    </>
  )
}
