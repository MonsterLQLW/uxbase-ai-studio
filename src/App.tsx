import { useState, useEffect, lazy, Suspense, Component, type ReactNode } from 'react'
import Layout from './components/Layout'
import AuroraBg from './components/AuroraBg'
import ChatPanel from './components/ChatPanel'
import { setGeminiKey as setGeminiKeyService, setTIMIKey, setTIMIUrl, setTIMIModel, testGeminiConnection, testTIMIConnection } from './services/gemini'
import type { FlowState as AvatarFlowState } from './components/AvatarFrameDesigner'

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

type Tab = 'chat' | 'avatar-frame' | 'ai-matting' | 'output-tool' | 'settings'

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

  return (
    <div className="h-full p-6 overflow-y-auto">
      <div className="max-w-4xl mx-auto">
        <h2 className="text-3xl font-bold text-slate-100 mb-8 text-center">⚙️ 设置</h2>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <div className="bg-slate-900 rounded-3xl p-6 border border-slate-800 shadow-lg">
            <h3 className="text-lg font-semibold text-slate-300 mb-4">API 配置</h3>
            <div className="space-y-4">
              <div>
                <label className="text-sm text-slate-400 mb-2 block">Google Gemini API Key</label>
                <input
                  type="password"
                  placeholder="填入你的 API Key"
                  value={geminiKey}
                  onChange={e => setGeminiKey(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-sm text-slate-200 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
                <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
                  <button
                    onClick={testGeminiConnectionHandler}
                    disabled={geminiResult === 'testing' || !geminiKey.trim()}
                    className="px-4 py-3 bg-sky-600 hover:bg-sky-700 disabled:bg-slate-900 disabled:text-slate-400 text-sm text-white rounded-xl transition"
                  >
                    {geminiResult === 'testing' ? '测试中...' : '测试 Gemini 连接'}
                  </button>
                  {geminiResult === 'success' && <span className="text-xs text-green-400">✅ Gemini 已连接</span>}
                  {geminiResult === 'error' && <span className="text-xs text-red-400">❌ Gemini 连接失败</span>}
                </div>
                {geminiTestDetail && (
                  <p
                    className={`text-xs mt-2 leading-relaxed ${
                      geminiResult === 'success' ? 'text-green-300/90' : 'text-red-300/90'
                    }`}
                  >
                    {geminiTestDetail}
                  </p>
                )}
                <p className="text-xs text-slate-500 mt-2">
                  获取地址: {' '}
                  <a
                    href="https://aistudio.google.com/app/apikey"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-400 hover:underline"
                  >
                    aistudio.google.com/app/apikey
                  </a>
                </p>
              </div>

              <div>
                <label className="text-sm text-slate-400 mb-2 block">TIMI AI API Key</label>
                <input
                  type="password"
                  placeholder="填入 TIMI AI API Key"
                  value={timiKey}
                  onChange={e => setTimiKey(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-sm text-slate-200 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                />
                <div className="mt-3 space-y-3">
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">API 地址</label>
                    <input
                      type="text"
                      placeholder="http://api.timiai.woa.com/ai_api_manage/llmproxy/chat/completions"
                      value={timiUrl}
                      onChange={e => onSetTimiUrl(e.target.value)}
                      className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-500 mb-1 block">模型名称</label>
                    <input
                      type="text"
                      placeholder="gpt-5"
                      value={timiModel}
                      onChange={e => setTimiModel(e.target.value)}
                      className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                  <button
                    onClick={testTIMIConnectionHandler}
                    disabled={timiResult === 'testing' || !timiKey}
                    className="px-4 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-900 disabled:text-slate-400 text-sm text-white rounded-xl transition"
                  >
                    {timiResult === 'testing' ? '测试中...' : '测试 TIMI 连接'}
                  </button>
                  {timiResult === 'success' && <p className="text-xs text-green-400">✅ {timiTestDetail || 'TIMI 已连接'}</p>}
                  {timiResult === 'error' && <p className="text-xs text-red-400">❌ {timiTestDetail || 'TIMI 连接失败，请检查 API Key'}</p>}
                </div>
                <p className="text-xs text-slate-500 mt-2">TIMI AI 内部模型代理服务，支持多种模型（chat/completions）</p>
              </div>
            </div>
          </div>

          <div className="bg-slate-900 rounded-3xl p-6 border border-slate-800 shadow-lg">
            <h3 className="text-lg font-semibold text-slate-300 mb-4">模型设置</h3>
            <div className="space-y-3">
              <label className="flex items-center gap-3 p-4 rounded-2xl bg-slate-800 border border-blue-500/50 cursor-pointer hover:bg-slate-700 transition">
                <input type="radio" name="model" value="gemini-2.5-flash" defaultChecked className="accent-blue-500" />
                <div>
                  <div className="text-sm font-medium text-slate-200">Gemini 2.5 Flash</div>
                  <div className="text-xs text-slate-500">免费 · 速度快 · 支持图片</div>
                </div>
              </label>
              <label className="flex items-center gap-3 p-4 rounded-2xl bg-slate-800 border border-slate-700 cursor-pointer hover:bg-slate-700 transition">
                <input type="radio" name="model" value="gemini-3-flash-preview" className="accent-blue-500" />
                <div>
                  <div className="text-sm font-medium text-slate-200">Gemini 3 Flash</div>
                  <div className="text-xs text-slate-500">最新 · 推理能力更强</div>
                </div>
              </label>
            </div>
          </div>

          <div className="xl:col-span-2 bg-slate-900 rounded-3xl p-6 border border-slate-800 shadow-lg">
            <h3 className="text-lg font-semibold text-slate-300 mb-4">关于</h3>
            <div className="text-sm text-slate-400 space-y-2">
              <p>UXbase AI Studio</p>
              <p>基于 React 19 + Tailwind CSS + Three.js</p>
              <p>AI 模型: Google Gemini</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('chat')
  const [geminiKey, setGeminiKey] = useState(() => localStorage.getItem('geminiApiKey') || '')
  const [timiKey, setTimiKey] = useState(() => localStorage.getItem('timiApiKey') || '')
  const [timiUrl, setTimiUrl] = useState(() => localStorage.getItem('timiApiUrl') || 'http://api.timiai.woa.com/ai_api_manage/llmproxy/chat/completions')
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
        borderWidth: 6,
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

  // AI matting 不做 localStorage 持久化：切换顶部 Tab 保留（内存），刷新网页自动清空往期资源

  return (
    <>
      <AuroraBg />
      <Layout activeTab={activeTab} onTabChange={setActiveTab}>
        {activeTab === 'chat' && <ChatPanel />}
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
            <Suspense fallback={<div className="flex items-center justify-center h-full text-slate-400">加载 AI matting 中...</div>}>
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
