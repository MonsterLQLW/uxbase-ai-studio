import { useState, useEffect, lazy, Suspense } from 'react'
import Layout from './components/Layout'
import AuroraBg from './components/AuroraBg'
import ChatPanel from './components/ChatPanel'
import { setGeminiKey as setGeminiKeyService, setTIMIKey, testGeminiConnection, testTIMIConnection } from './services/gemini'

// Three.js 懒加载，避免初始加载时显存爆炸
const LazyThreeCanvas = lazy(() => import('./components/ThreeCanvas'))
// ReactFlow 懒加载，避免头像框页面卡顿
const LazyAvatarFrameDesigner = lazy(() => import('./components/AvatarFrameDesigner'))

type Tab = 'chat' | '3d' | 'avatar-frame' | 'settings'

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
  aiModel: 'gemini-3-flash-preview' | 'gemini-2.5-flash' | 'timi'
  aiPrompt: string
  aiResult: string
  generatedImageDataUrls: string[]
  composite: {
    elements: CompositeElement[]
    borderWidth: number
    borderColor: string
    glow: number
  }
  // 同类型参考
  similarReferences: LabeledImage[]
  similarKeywords: string[]
  similarAnalysis: string
}

function SettingsPanel({
  geminiKey,
  setGeminiKey,
  timiKey,
  setTimiKey,
  geminiResult,
  setGeminiResult,
  timiResult,
  setTimiResult,
}: {
  geminiKey: string
  setGeminiKey: (value: string) => void
  timiKey: string
  setTimiKey: (value: string) => void
  geminiResult: 'idle' | 'testing' | 'success' | 'error'
  setGeminiResult: (value: 'idle' | 'testing' | 'success' | 'error') => void
  timiResult: 'idle' | 'testing' | 'success' | 'error'
  setTimiResult: (value: 'idle' | 'testing' | 'success' | 'error') => void
}) {
  const testGeminiConnectionHandler = async () => {
    setGeminiResult('testing')
    try {
      const success = await testGeminiConnection()
      const newResult = success ? 'success' : 'error'
      setGeminiResult(newResult)
      localStorage.setItem('geminiConnectionStatus', newResult)
    } catch {
      setGeminiResult('error')
      localStorage.setItem('geminiConnectionStatus', 'error')
    }
  }

  const testTIMIConnectionHandler = async () => {
    setTimiResult('testing')
    try {
      const success = await testTIMIConnection()
      const newResult = success ? 'success' : 'error'
      setTimiResult(newResult)
      localStorage.setItem('timiConnectionStatus', newResult)
    } catch {
      setTimiResult('error')
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
                    disabled={geminiResult === 'testing' || !geminiKey}
                    className="px-4 py-3 bg-sky-600 hover:bg-sky-700 disabled:bg-slate-900 disabled:text-slate-400 text-sm text-white rounded-xl transition"
                  >
                    {geminiResult === 'testing' ? '测试中...' : '测试 Gemini 连接'}
                  </button>
                  {geminiResult === 'success' && <span className="text-xs text-green-400">✅ Gemini 已连接</span>}
                  {geminiResult === 'error' && <span className="text-xs text-red-400">❌ Gemini 连接失败</span>}
                </div>
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
                <div className="flex gap-2">
                  <input
                    type="password"
                    placeholder="填入 TIMI AI API Key"
                    value={timiKey}
                    onChange={e => setTimiKey(e.target.value)}
                    className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 text-sm text-slate-200 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  />
                  <button
                    onClick={testTIMIConnectionHandler}
                    disabled={timiResult === 'testing' || !timiKey}
                    className="px-4 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-900 disabled:text-slate-400 text-sm text-white rounded-xl transition"
                  >
                    {timiResult === 'testing' ? '测试中...' : '测试 TIMI 连接'}
                  </button>
                </div>
                {timiResult === 'success' && <p className="text-xs text-green-400 mt-2">✅ TIMI 连接成功</p>}
                {timiResult === 'error' && <p className="text-xs text-red-400 mt-2">❌ TIMI 连接失败，请检查 API Key</p>}
                <p className="text-xs text-slate-500 mt-2">用于内部 TIMI AI 图像生成服务</p>
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
  const [geminiResult, setGeminiResult] = useState<'idle' | 'testing' | 'success' | 'error'>(() =>
    (localStorage.getItem('geminiConnectionStatus') as 'idle' | 'testing' | 'success' | 'error') || 'idle'
  )
  const [timiResult, setTimiResult] = useState<'idle' | 'testing' | 'success' | 'error'>(() =>
    (localStorage.getItem('timiConnectionStatus') as 'idle' | 'testing' | 'success' | 'error') || 'idle'
  )

  // 头像框设计器状态
  const [avatarFrameState, setAvatarFrameState] = useState<AvatarFrameState>(() => {
    const saved = localStorage.getItem('avatarFrameState')
    if (saved) {
      try {
        return JSON.parse(saved)
      } catch (e) {
        console.warn('Failed to parse saved avatar frame state:', e)
      }
    }
    return {
      shape: 'circle' as ShapeKind,
      quadrants: ['lt'] as Quadrant[],
      images: [] as LabeledImage[],
      aiModel: 'gemini-3-flash-preview' as const,
      aiPrompt: '',
      aiResult: '',
      generatedImageDataUrls: [],
      composite: {
        elements: [],
        borderWidth: 6,
        borderColor: '#6366f1',
        glow: 0.25,
      },
      // 同类型参考
      similarReferences: [],
      similarKeywords: [],
      similarAnalysis: '',
    }
  })

  // 持久化 Gemini / TIMI Key 和连接状态
  useEffect(() => {
    localStorage.setItem('geminiApiKey', geminiKey)
    setGeminiKeyService(geminiKey)
    if (geminiResult === 'success' || geminiResult === 'error') {
      setGeminiResult('idle')
      localStorage.setItem('geminiConnectionStatus', 'idle')
    }
  }, [geminiKey])

  useEffect(() => {
    localStorage.setItem('timiApiKey', timiKey)
    setTIMIKey(timiKey)
    if (timiResult === 'success' || timiResult === 'error') {
      setTimiResult('idle')
      localStorage.setItem('timiConnectionStatus', 'idle')
    }
  }, [timiKey])

  // 持久化头像框设计器状态
  useEffect(() => {
    localStorage.setItem('avatarFrameState', JSON.stringify(avatarFrameState))
  }, [avatarFrameState])

  return (
    <>
      <AuroraBg />
      <Layout activeTab={activeTab} onTabChange={setActiveTab}>
        {activeTab === 'chat' && <ChatPanel />}
        {activeTab === '3d' && (
          <div className="w-full h-full relative">
            <Suspense fallback={<div className="flex items-center justify-center h-full text-slate-400">加载 3D 场景中...</div>}>
              <LazyThreeCanvas />
            </Suspense>
          </div>
        )}
        {activeTab === 'avatar-frame' && (
          <div className="w-full h-full relative">
            <Suspense fallback={<div className="flex items-center justify-center h-full text-slate-400">加载头像框设计器中...</div>}>
              <LazyAvatarFrameDesigner
                state={avatarFrameState}
                onStateChange={setAvatarFrameState}
              />
            </Suspense>
          </div>
        )}
        {activeTab === 'settings' && (
          <SettingsPanel
            geminiKey={geminiKey}
            setGeminiKey={setGeminiKey}
            timiKey={timiKey}
            setTimiKey={setTimiKey}
            geminiResult={geminiResult}
            setGeminiResult={setGeminiResult}
            timiResult={timiResult}
            setTimiResult={setTimiResult}
          />
        )}
      </Layout>
    </>
  )
}
