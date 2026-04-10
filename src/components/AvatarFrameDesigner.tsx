import { useCallback, useEffect, useId, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ChangeEvent } from 'react'
import ReactFlow, {
  Background,
  addEdge,
  useEdgesState,
  useNodesState,
  Handle,
  Position,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from 'reactflow'
import 'reactflow/dist/style.css'
import {
  avatarFrameShapeIntentPromptEn,
  extractAvatarFramePixelLayout,
  generateAvatarFrameRedrawFromRefs,
  generateImageWithImagen,
  generateImageWithTIMI,
  generateSimilarReferenceAnalysisWithTIMI,
  generateWithGemini,
  TIMI_IMAGE_MODEL_MAP,
  type TIMIImageModel,
} from '../services/gemini'
import { renderAvatarFrameFromPlan } from '../lib/avatarFramePixelComposite'
import {
  loadHistory,
  saveHistory,
  addHistoryEntry,
  deleteHistoryEntry,
  clearHistory,
  formatTimestamp,
  getAutoSaveInterval,
  type HistoryEntry,
} from '../lib/stateHistory'

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

export type AIModelOption = 'gemini-3-flash-preview' | 'gemini-2.5-flash' | TIMIImageModel

type RegionId = 'lt' | 'rt' | 'lb' | 'rb' | 'frame'
type RegionConstraint = {
  enabled: boolean
  prompt: string
  assets: LabeledImage[]
}

type ColorThemeSwatch = {
  hex: string
  name?: string
}

type ColorThemeState = {
  images: LabeledImage[]
  engine: 'gemini' | 'timi-chat'
  model: 'gemini-2.5-flash' | 'gemini-3-flash-preview'
  style: string
  bullets: string[]
  keywords: string[]
  colors: ColorThemeSwatch[]
  raw: string
}

export type FlowState = {
  shape: ShapeKind
  quadrants: Quadrant[]
  images: LabeledImage[]
  aiModel: AIModelOption
  aiPrompt: string
  referenceSimilarity: number
  aiResult: string
  generatedImageDataUrls: string[]
  /** TIMI 图像生成出图尺寸 */
  timiImageSize: '1K' | '2K'
  composite: {
    elements: CompositeElement[]
    borderWidth: number
    borderColor: string
    glow: number
  }
  colorTheme: ColorThemeState
  regionalConstraints: Record<RegionId, RegionConstraint>
  similarReferences: LabeledImage[]
  similarKeywords: string[]
  similarAnalysis: string
  similarAnalysisEngine: 'gemini' | 'timi-chat'
  generateImageVariantCount: 1 | 3
}

/** 与首次进入页面对齐的空白状态（清空画布） */
function createEmptyAvatarFrameFlowState(): FlowState {
  return {
    shape: 'circle',
    quadrants: ['lt'],
    images: [],
    aiModel: 'gemini-3-flash-preview',
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
    colorTheme: {
      images: [],
      engine: 'gemini',
      model: 'gemini-2.5-flash',
      style: '',
      bullets: [],
      keywords: [],
      colors: [],
      raw: '',
    },
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
}

type CustomNodeData = {
  title: string
  state: FlowState
  setState: (updater: (prev: FlowState) => FlowState) => void
}

function NodeShell({
  title,
  children,
  className = '',
}: {
  title: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={`rounded-xl border border-slate-700 bg-slate-900/90 shadow-lg min-w-[320px] ${className}`}>
      <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
        <div className="text-sm font-semibold text-slate-100">{title}</div>
        <div className="text-[11px] text-slate-500">拖拽节点 · 拉线连接</div>
      </div>
      <div className="p-4">{children}</div>
    </div>
  )
}

function ShapeNode({ data }: NodeProps<CustomNodeData>) {
  const shape = data.state.shape
  return (
    <NodeShell title={data.title}>
      <Handle type="source" position={Position.Right} className="!bg-indigo-500" />
      <div className="text-xs text-slate-400 mb-2">1) 选择头像框形状</div>
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => data.setState(prev => ({ ...prev, shape: 'circle' }))}
          className={`rounded-lg border px-3 py-2 text-sm transition ${
            shape === 'circle'
              ? 'border-indigo-500 bg-indigo-500/10 text-slate-100'
              : 'border-slate-700 bg-slate-950/30 text-slate-300 hover:border-slate-600'
          }`}
        >
          圆形
        </button>
        <button
          onClick={() => data.setState(prev => ({ ...prev, shape: 'square' }))}
          className={`rounded-lg border px-3 py-2 text-sm transition ${
            shape === 'square'
              ? 'border-indigo-500 bg-indigo-500/10 text-slate-100'
              : 'border-slate-700 bg-slate-950/30 text-slate-300 hover:border-slate-600'
          }`}
        >
          方形
        </button>
      </div>
      <div className="mt-3 text-xs text-slate-500">
        当前: <span className="text-slate-300">{shape === 'circle' ? '圆形' : '方形'}</span>
      </div>
    </NodeShell>
  )
}

function ColorThemeNode({ data }: NodeProps<CustomNodeData>) {
  const theme = data.state.colorTheme
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const uploadId = useId()

  const onUpload = useCallback(
    async (files: File[]) => {
      if (!files || files.length === 0) return
      const remaining = Math.max(0, 3 - (theme?.images?.length || 0))
      if (remaining <= 0) {
        alert('已达到最多3张图片的限制')
        return
      }
      const slice = files.slice(0, remaining)
      
      setUploading(true)
      try {
        console.log(`[颜色定位] 开始上传 ${slice.length} 张图片`)
        const dataUrls = await Promise.all(slice.map(fileToDataUrl))
        console.log(`[颜色定位] 图片处理完成，dataUrls数量: ${dataUrls.length}, 第一张长度: ${dataUrls[0]?.length}`)
        
        data.setState(prev => {
          const prevColorTheme = prev.colorTheme || ({ images: [], engine: 'gemini', model: 'gemini-2.5-flash', style: '', bullets: [], keywords: [], colors: [], raw: '' } as ColorThemeState)
          const currentImages = prevColorTheme.images || []
          const newImages = [
            ...currentImages,
            ...dataUrls.map((dataUrl, idx) => ({
              id: randomId() + '-theme-' + idx,
              dataUrl,
              label: `主题图${currentImages.length + idx + 1}`,
            })),
          ]
          console.log(`[颜色定位] 更新状态，新图片数量: ${newImages.length}`)
          return {
            ...prev,
            colorTheme: {
              ...prevColorTheme,
              images: newImages,
            },
          }
        })
        console.log('[颜色定位] setState 已调用完成')
      } catch (err) {
        console.error('[颜色定位] 上传失败:', err)
        alert('上传图片失败: ' + (err instanceof Error ? err.message : String(err)))
      } finally {
        setUploading(false)
      }
    },
    [data, theme?.images?.length],
  )

  const analyze = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      const imgs = await normalizeImageUrls((data.state.colorTheme?.images || []).map(i => i.dataUrl).filter(Boolean))
      if (imgs.length < 1) throw new Error('请先上传 1-3 张图片')

      const prompt = [
        '你是品牌/皮肤主题设计师。',
        '请根据我提供的图片，提取整体主题风格与主色板，并尽量给出更可落地的设计语言。',
        '',
        '硬性要求：只返回 JSON，禁止 Markdown、禁止多余解释文本。',
        '颜色：只用 6 位 HEX（如 #A1B2C3），给出 6-10 个主色，按重要性排序。',
        '',
        'JSON schema（务必严格匹配字段名）：',
        '{',
        '  "style": "2-4 句主题风格总结（中文）",',
        '  "bullets": ["3-8 条风格要点（中文短句）"],',
        '  "keywords": ["8-16 个关键词（中文/英文都可，短词）"],',
        '  "colors": [ { "name": "可选的颜色名/用途", "hex": "#RRGGBB" } ]',
        '}',
      ].join('\n')

      const engine = data.state.colorTheme?.engine || 'gemini'
      const model = data.state.colorTheme?.model || 'gemini-2.5-flash'
      let result = ''

      if (engine === 'timi-chat') {
        try {
          result = await generateSimilarReferenceAnalysisWithTIMI({ prompt, imageDataUrls: imgs })
        } catch (e: any) {
          const msg = e instanceof Error ? e.message : String(e)
          setErr(`TIMI chat 分析失败：${msg || '未知错误'}。已自动改用 Gemini。`)
          result = await generateWithGemini({ model, text: prompt, imageDataUrls: imgs })
        }
      } else {
        result = await generateWithGemini({ model, text: prompt, imageDataUrls: imgs })
      }

      let style = ''
      let bullets: string[] = []
      let keywords: string[] = []
      let colors: Array<{ name?: string; hex: string }> = []
      let raw = result
      const start = result.indexOf('{')
      const end = result.lastIndexOf('}')
      if (start >= 0 && end > start) {
        raw = result.slice(start, end + 1)
        try {
          const parsed = JSON.parse(raw) as any
          style = String(parsed?.style || '').trim()
          if (Array.isArray(parsed?.bullets)) bullets = parsed.bullets.map((x: any) => String(x || '').trim()).filter(Boolean).slice(0, 12)
          if (Array.isArray(parsed?.keywords)) keywords = parsed.keywords.map((x: any) => String(x || '').trim()).filter(Boolean).slice(0, 24)
          const arr = Array.isArray(parsed?.colors) ? parsed.colors : []
          colors = arr
            .map((c: any) => ({ name: typeof c?.name === 'string' ? c.name.trim() : undefined, hex: String(c?.hex || '').trim() }))
            .filter((c: any) => /^#[0-9a-fA-F]{6}$/.test(c.hex))
            .slice(0, 10)
        } catch {
          /* keep raw */
        }
      }

      data.setState(prev => ({
        ...prev,
        colorTheme: {
          ...(prev.colorTheme || ({ images: [], engine: 'gemini', model: 'gemini-2.5-flash', style: '', bullets: [], keywords: [], colors: [], raw: '' } as ColorThemeState)),
          images: prev.colorTheme?.images || [],
          engine: (prev.colorTheme?.engine || 'gemini') as any,
          model: (prev.colorTheme?.model || 'gemini-2.5-flash') as any,
          style,
          bullets,
          keywords,
          colors,
          raw,
        },
      }))
    } catch (e: any) {
      setErr(e?.message || '分析失败，请重试')
    } finally {
      setLoading(false)
    }
  }, [data])

  return (
    <NodeShell title={data.title} className="max-w-[420px]">
      <Handle type="target" position={Position.Left} className="!bg-slate-600" />
      <Handle type="source" position={Position.Right} className="!bg-indigo-500" />
      <div className="text-xs text-slate-400 mb-2">提取皮肤/主题主色与风格（上传 1-3 张图）</div>

      <div className="mb-3">
        <div className="text-[11px] text-slate-500 mb-1">分析引擎</div>
        <select
          value={theme?.engine || 'gemini'}
          onChange={e =>
            data.setState(prev => ({
              ...prev,
              colorTheme: { ...(prev.colorTheme as any), engine: (e.target.value as any) || 'gemini' },
            }))
          }
          className="w-full rounded-lg bg-slate-900 border border-slate-700 px-2 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
        >
          <option value="gemini">Gemini（看图分析）</option>
          <option value="timi-chat">TIMI chat（更聪明）</option>
        </select>
      </div>

      <div className="mb-3">
        <div className="text-[11px] text-slate-500 mb-1">分析模型</div>
        <select
          value={theme?.model || 'gemini-2.5-flash'}
          onChange={e =>
            data.setState(prev => ({
              ...prev,
              colorTheme: { ...(prev.colorTheme as any), model: (e.target.value as any) || 'gemini-2.5-flash' },
            }))
          }
          className="w-full rounded-lg bg-slate-900 border border-slate-700 px-2 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
        >
          <option value="gemini-2.5-flash">Gemini 2.5 Flash（更快）</option>
          <option value="gemini-3-flash-preview">Gemini 3 Flash（更强）</option>
        </select>
      </div>

      <div className="mb-3 nodrag">
        <input
          id={`theme-upload-${uploadId}`}
          type="file"
          accept="image/*"
          multiple
          disabled={uploading}
          onChange={e => {
            const picked = fileListToArray(e.currentTarget.files)
            e.currentTarget.value = ''
            if (picked.length > 0) {
              onUpload(picked).catch(err => {
                console.error('上传失败:', err)
                alert('上传失败: ' + (err instanceof Error ? err.message : String(err)))
              })
            }
          }}
          className="hidden"
        />
        <label
          htmlFor={`theme-upload-${uploadId}`}
          className={`block w-full rounded-lg border px-3 py-2 text-sm transition text-center cursor-pointer select-none ${
            uploading
              ? 'border-slate-600 bg-slate-800 text-slate-400 cursor-wait'
              : 'border-indigo-500/50 bg-indigo-500/10 text-indigo-200 hover:border-indigo-400 hover:bg-indigo-500/20'
          }`}
        >
          {uploading ? '处理中...' : '上传主题图片（最多 3 张）'}
        </label>
      </div>

      <div className="text-xs text-slate-400 mb-2">
        已上传: <span className="text-indigo-200">{theme?.images?.length || 0}</span> 张
      </div>

      {theme?.images?.length ? (
        <div className="grid grid-cols-3 gap-2 mb-3">
          {theme.images.map(img => (
            <div key={img.id} className="relative rounded-lg overflow-hidden border border-indigo-500/20">
              <img src={img.dataUrl} alt={img.label} className="w-full h-20 object-cover" />
              <button
                onClick={() =>
                  data.setState(prev => ({
                    ...prev,
                    colorTheme: { ...(prev.colorTheme as any), images: (prev.colorTheme?.images || []).filter(it => it.id !== img.id) },
                  }))
                }
                className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full w-5 h-5 text-[10px] flex items-center justify-center nodrag"
                onMouseDown={e => e.stopPropagation()}
                onPointerDown={e => e.stopPropagation()}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <button
        onClick={analyze}
        disabled={loading || (theme?.images?.length || 0) < 1}
        className="w-full rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-900 disabled:text-slate-400 px-3 py-2 text-sm text-white transition"
      >
        {loading ? '提取中...' : 'AI 提取颜色与风格'}
      </button>

      {err && <div className="mt-2 text-xs text-amber-400">{err}</div>}

      {(theme?.style || (theme?.colors?.length || 0) > 0) && (
        <div className="mt-3 rounded-lg border border-indigo-500/20 bg-slate-950/80 p-3 text-xs text-slate-300">
          {theme.style && (
            <div className="mb-2">
              <div className="text-[11px] text-slate-500 mb-1">主题风格</div>
              <div className="text-slate-200 whitespace-pre-wrap">{theme.style}</div>
            </div>
          )}
          {theme.colors?.length ? (
            <div>
              <div className="text-[11px] text-slate-500 mb-2">主色板</div>
              <div className="grid grid-cols-4 gap-2">
                {theme.colors.slice(0, 8).map((c, idx) => (
                  <div key={c.hex + idx} className="rounded-lg border border-slate-800 bg-slate-950/40 p-2">
                    <div className="w-full h-8 rounded-md border border-slate-800" style={{ background: c.hex }} />
                    <div className="mt-1 text-[10px] text-slate-400 truncate">{c.name || ''}</div>
                    <div className="text-[10px] text-slate-200 tabular-nums">{c.hex}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </NodeShell>
  )
}

function LayoutNode({ data }: NodeProps<CustomNodeData>) {
  const regions: Array<{ id: RegionId; title: string; desc: string; dot: string }> = [
    { id: 'lt', title: '左上', desc: '', dot: 'bg-amber-400' },
    { id: 'rt', title: '右上', desc: '', dot: 'bg-indigo-400' },
    { id: 'lb', title: '左下', desc: '', dot: 'bg-sky-400' },
    { id: 'rb', title: '右下', desc: '', dot: 'bg-pink-400' },
    { id: 'frame', title: '框体象限（整体框体）', desc: '约束边框材质/花纹/主风格', dot: 'bg-emerald-400' },
  ]

  const [uploadingRegion, setUploadingRegion] = useState<RegionId | null>(null)
  const stopRF = useCallback((e: any) => e.stopPropagation?.(), [])

  const setRegion = useCallback(
    (regionId: RegionId, next: Partial<RegionConstraint>) => {
      data.setState(prev => {
        const fallback: Record<RegionId, RegionConstraint> = {
          lt: { enabled: true, prompt: '', assets: [] },
          rt: { enabled: false, prompt: '', assets: [] },
          lb: { enabled: false, prompt: '', assets: [] },
          rb: { enabled: false, prompt: '', assets: [] },
          frame: { enabled: true, prompt: '', assets: [] },
        }
        const prevRC = { ...fallback, ...(prev.regionalConstraints as any) } as Record<RegionId, RegionConstraint>
        const cur = prevRC[regionId] || fallback[regionId]
        const merged: RegionConstraint = {
          enabled: next.enabled ?? cur.enabled,
          prompt: next.prompt ?? cur.prompt,
          assets: next.assets ?? cur.assets,
        }
        const nextRC = { ...prevRC, [regionId]: merged }
        const cornerIds: Quadrant[] = ['lt', 'rt', 'lb', 'rb']
        const nextQuadrants = cornerIds.filter(q => nextRC[q]?.enabled)
        return { ...prev, regionalConstraints: nextRC, quadrants: nextQuadrants.slice(0, 4) }
      })
    },
    [data],
  )

  const onUploadRegion = useCallback(
    async (regionId: RegionId, files: File[]) => {
      if (!files || files.length === 0) return
      setUploadingRegion(regionId)
      try {
        const rc = data.state.regionalConstraints?.[regionId]
        const existingAssets = rc?.assets ?? []
        const remaining = Math.max(0, 5 - existingAssets.length)
        const slice = files.slice(0, remaining)
        if (slice.length === 0) {
          alert('该象限已达到最多 5 张素材的限制')
          return
        }
        const dataUrls = await Promise.all(slice.map(fileToDataUrl))
        const next = dataUrls.filter(Boolean)
        if (next.length === 0) return
        setRegion(regionId, {
          enabled: true,
          assets: [
            ...existingAssets,
            ...next.map((dataUrl, idx) => ({
              id: randomId() + '-region-' + regionId + '-' + idx,
              dataUrl,
              label: `${regionId.toUpperCase()}素材${existingAssets.length + idx + 1}`,
            })),
          ],
        })
      } catch (err) {
        console.error('[五象限] 上传失败:', err)
        alert('上传失败: ' + (err instanceof Error ? err.message : String(err)))
      } finally {
        setUploadingRegion(null)
      }
    },
    [data.state.regionalConstraints, setRegion],
  )

  const RegionPanel = useCallback(
    (options: { regionId: RegionId; align?: 'left' | 'right'; maxThumbs?: number; className?: string }) => {
      const { regionId, align = 'left', maxThumbs = 5, className } = options
      const r = regions.find(x => x.id === regionId)
      if (!r) return null

      const rc = data.state.regionalConstraints?.[r.id]
      const enabled = Boolean(rc?.enabled)
      const assets = rc?.assets ?? []
      const prompt = rc?.prompt ?? ''
      const isUploadingThis = uploadingRegion === r.id

      const cardBase =
        `rounded-xl border bg-slate-950/35 backdrop-blur-sm p-3 h-full flex flex-col ` +
        (enabled ? 'border-slate-700/80' : 'border-slate-800/80 opacity-40')

      return (
        <div className={`${cardBase} ${className || ''}`}>
          <div className="flex items-center justify-between gap-3">
            <div className="text-left min-w-0">
              <div className="flex items-center gap-2">
                <span className={`inline-block w-2.5 h-2.5 rounded-full ${r.dot}`} />
                <div className="text-sm font-semibold text-slate-100 truncate">{r.title}</div>
                <span className="text-[11px] text-slate-500 tabular-nums shrink-0">· {assets.length}</span>
              </div>
              {r.id === 'frame' && r.desc ? (
                <div className="text-[11px] text-slate-500 mt-1 leading-snug">{r.desc}</div>
              ) : null}
            </div>

            <label
              className="inline-flex items-center gap-2 text-xs text-slate-300 cursor-pointer select-none shrink-0 nodrag"
              onMouseDown={stopRF}
              onPointerDown={stopRF}
            >
              <input
                type="checkbox"
                className="accent-indigo-500"
                checked={enabled}
                onChange={e => setRegion(r.id, { enabled: e.target.checked })}
              />
              启用
            </label>
          </div>

          <div className="mt-3 flex items-center gap-2">
            <div className="block flex-1 nodrag">
              <input
                id={`region-upload-${r.id}`}
                type="file"
                accept="image/*"
                multiple
                disabled={isUploadingThis}
                onChange={e => {
                  const picked = fileListToArray(e.currentTarget.files)
                  e.currentTarget.value = ''
                  if (picked.length > 0) void onUploadRegion(r.id, picked)
                }}
                className="hidden"
              />
              <label
                htmlFor={`region-upload-${r.id}`}
                onPointerDown={stopRF}
                onMouseDown={stopRF}
                className={`block w-full rounded-lg border px-3 py-2 text-xs transition text-center cursor-pointer select-none ${
                  isUploadingThis
                    ? 'border-slate-600 bg-slate-800 text-slate-400 cursor-wait'
                    : 'border-indigo-500/40 bg-indigo-500/10 text-indigo-200 hover:border-indigo-400 hover:bg-indigo-500/15'
                }`}
              >
                {isUploadingThis ? '处理中...' : '上传素材（最多 5 张）'}
              </label>
            </div>
          </div>

          <textarea
            value={prompt}
            onChange={e => setRegion(r.id, { prompt: e.target.value })}
            rows={2}
            className="mt-3 w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 placeholder:text-slate-500 nodrag"
            placeholder={r.id === 'frame' ? '框体整体约束（材质/花纹/主风格…）' : '该象限约束描述（元素/材质/主题…）'}
            onMouseDown={stopRF}
            onPointerDown={stopRF}
          />

          <div className="mt-3 min-h-[52px]">
            {assets.length > 0 ? (
              <div className={`flex items-center gap-2 overflow-x-auto ${align === 'right' ? 'justify-end' : ''}`}>
                {assets.slice(0, maxThumbs).map(img => (
                  <div key={img.id} className="relative shrink-0">
                    <img src={img.dataUrl} alt={img.label} className="w-12 h-12 object-cover rounded-md border border-slate-800" />
                    <button
                      onClick={() => setRegion(r.id, { assets: assets.filter(it => it.id !== img.id) })}
                      className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-red-500 text-white text-xs leading-5 text-center nodrag"
                      title="删除"
                      onMouseDown={stopRF}
                      onPointerDown={stopRF}
                    >
                      ×
                    </button>
                  </div>
                ))}
                {assets.length > maxThumbs && (
                  <div className="text-[11px] text-slate-500 shrink-0">+{assets.length - maxThumbs}</div>
                )}
              </div>
            ) : (
              <div className={`text-[11px] text-slate-600 ${align === 'right' ? 'text-right' : 'text-left'}`}>
                暂无素材
              </div>
            )}
          </div>
        </div>
      )
    },
    [data, onUploadRegion, regions, setRegion, stopRF, uploadingRegion],
  )

  return (
    <NodeShell title={data.title} className="min-w-[760px]">
      <Handle type="target" position={Position.Left} className="!bg-slate-600" />
      <Handle type="source" position={Position.Right} className="!bg-indigo-500" />
      <div className="text-xs text-slate-400 mb-3">2) 五象限约束（每个象限可单独上传素材 + 描述）</div>

      <div className="w-full rounded-xl border border-slate-800 bg-slate-950/20 p-3">
        <div className="mb-4 flex items-center justify-center">
          {(() => {
            const rc = data.state.regionalConstraints as any
            const getN = (id: RegionId) => (Array.isArray(rc?.[id]?.assets) ? rc[id].assets.length : 0)
            const isOn = (id: RegionId) => Boolean(rc?.[id]?.enabled)
            const Marker = ({ id, dot, pos }: { id: RegionId; dot: string; pos: React.CSSProperties }) => (
              <div className="absolute" style={pos} title={`${id.toUpperCase()} · 素材 ${getN(id)} 张`}>
                <div
                  className={`flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] ${
                    isOn(id) ? 'border-slate-700 bg-slate-950/60 text-slate-200' : 'border-slate-800 bg-slate-950/40 text-slate-500'
                  }`}
                >
                  <span className={`inline-block w-2 h-2 rounded-full ${isOn(id) ? dot : 'bg-slate-600'}`} />
                  <span className="tabular-nums">{getN(id)}</span>
                </div>
              </div>
            )
            return (
              <div className="relative w-[240px] h-[240px]">
                <div
                  className={`absolute inset-0 ${
                    data.state.shape === 'circle' ? 'rounded-full' : 'rounded-[32px]'
                  } bg-slate-950/35 border border-slate-800 shadow-[0_18px_60px_rgba(0,0,0,0.45)]`}
                >
                  <div
                    className={`absolute inset-2 ${
                      data.state.shape === 'circle' ? 'rounded-full' : 'rounded-[26px]'
                    } border ${isOn('frame') ? 'border-emerald-400/70' : 'border-slate-700/60'} bg-slate-950/25`}
                  />
                  <div
                    className={`absolute inset-0 m-auto w-[56%] h-[56%] ${
                      data.state.shape === 'circle' ? 'rounded-full' : 'rounded-2xl'
                    } bg-slate-950/65 border border-slate-800`}
                  />
                </div>
                <Marker id="lt" dot="bg-amber-400" pos={{ left: 10, top: 10 }} />
                <Marker id="rt" dot="bg-indigo-400" pos={{ right: 10, top: 10 }} />
                <Marker id="lb" dot="bg-sky-400" pos={{ left: 10, bottom: 10 }} />
                <Marker id="rb" dot="bg-pink-400" pos={{ right: 10, bottom: 10 }} />
                <Marker id="frame" dot="bg-emerald-400" pos={{ left: '50%', top: 6, transform: 'translateX(-50%)' }} />
              </div>
            )
          })()}
        </div>

        <div className="grid grid-cols-2 gap-4 items-stretch">
          <div className="grid grid-rows-2 gap-4">
            {RegionPanel({ regionId: 'lt', align: 'left' })}
            {RegionPanel({ regionId: 'lb', align: 'left' })}
          </div>
          <div className="grid grid-rows-2 gap-4">
            {RegionPanel({ regionId: 'rt', align: 'right' })}
            {RegionPanel({ regionId: 'rb', align: 'right' })}
          </div>
        </div>

        <div className="mt-4">
          {RegionPanel({ regionId: 'frame', align: 'left', maxThumbs: 6, className: 'min-h-[0]' })}
        </div>
      </div>
    </NodeShell>
  )
}

function randomId() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16)
}

async function fileToDataUrl(file: File): Promise<string> {
  // ReactFlow 场景里偶发 FileReader 不触发/被打断，用户会看到“选了文件但 UI 不更新”。
  // 这里用 blob: 作为强兜底，保证缩略图与计数先更新；需要发给模型时再归一化为 dataURL。
  const previewUrl = URL.createObjectURL(file)
  return await new Promise(resolve => {
    let settled = false
    const settle = (v: string) => {
      if (settled) return
      settled = true
      resolve(v)
    }
    const reader = new FileReader()
    reader.onerror = () => settle(previewUrl)
    reader.onload = () => {
      const v = reader.result
      if (typeof v === 'string' && v.startsWith('data:')) {
        URL.revokeObjectURL(previewUrl)
        settle(v)
      } else {
        settle(previewUrl)
      }
    }
    window.setTimeout(() => settle(previewUrl), 1500)
    try {
      reader.readAsDataURL(file)
    } catch {
      settle(previewUrl)
    }
  })
}

function isTimiModel(m: AIModelOption): m is TIMIImageModel {
  return Object.prototype.hasOwnProperty.call(TIMI_IMAGE_MODEL_MAP as any, m as any)
}

function fileListToArray(files: FileList | null | undefined): File[] {
  if (!files || files.length === 0) return []
  return Array.from(files).filter(Boolean)
}

function buildQuadrantBrief(state: FlowState): string {
  const rc = state.regionalConstraints as any
  const order: Array<{ id: RegionId; name: string }> = [
    { id: 'frame', name: '框体(整体)' },
    { id: 'lt', name: '左上(LT)' },
    { id: 'rt', name: '右上(RT)' },
    { id: 'lb', name: '左下(LB)' },
    { id: 'rb', name: '右下(RB)' },
  ]
  const lines: string[] = []
  lines.push(
    `形状趋势: ${state.shape === 'circle' ? '偏圆形构图（柔和向心，不要画明显圆线描边洞轮廓）' : '偏方正构图（略带回角体量感，不要画明显方框描边洞轮廓）'}`,
  )

  // 同类参考/颜色定位作为“风格锚点”
  const kw = (state.similarKeywords || []).slice(0, 10).filter(Boolean)
  if (kw.length > 0) lines.push(`同类参考关键词: ${kw.join('、')}`)
  const themeStyle = (state.colorTheme as any)?.style
  if (typeof themeStyle === 'string' && themeStyle.trim()) lines.push(`颜色定位风格: ${themeStyle.trim()}`)
  const themeColors = Array.isArray((state.colorTheme as any)?.colors) ? (state.colorTheme as any).colors : []
  const colorHex = themeColors.map((c: any) => String(c?.hex || '')).filter((h: string) => /^#[0-9a-fA-F]{6}$/.test(h)).slice(0, 8)
  if (colorHex.length > 0) lines.push(`主色板: ${colorHex.join(' ')}`)

  lines.push('')
  lines.push('五象限约束（必须严格遵守，不要把元素放错象限；未启用象限请保持干净/不放主元素）：')
  for (const { id, name } of order) {
    const it = rc?.[id]
    const enabled = id === 'frame' ? true : Boolean(it?.enabled)
    const prompt = String(it?.prompt || '').trim()
    const assets = Array.isArray(it?.assets) ? it.assets : []
    const assetNames = assets
      .map((a: any) => String(a?.label || '').trim())
      .filter(Boolean)
      .slice(0, 12)
    const assetLine = assetNames.length > 0 ? `素材: ${assetNames.join('、')}` : '素材: (无)'
    const promptLine = prompt ? `描述: ${prompt}` : '描述: (无)'
    lines.push(`- ${name}: ${enabled ? '启用' : '未启用'}`)
    lines.push(`  ${promptLine}`)
    lines.push(`  ${assetLine}`)
  }
  return lines.join('\n').trim()
}

async function blobUrlToDataUrl(url: string): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`读取 blob 失败: ${res.status}`)
  const blob = await res.blob()
  return await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('读取 blob 失败'))
    reader.onload = () => resolve(String(reader.result || ''))
    reader.readAsDataURL(blob)
  })
}

const _normalizedImageCache = new Map<string, Promise<string>>()
async function normalizeOneImageUrl(url: string): Promise<string> {
  if (!url) return ''
  if (!url.startsWith('blob:')) return url
  const cached = _normalizedImageCache.get(url)
  if (cached) return await cached
  const p = blobUrlToDataUrl(url).catch(e => {
    _normalizedImageCache.delete(url)
    throw e
  })
  _normalizedImageCache.set(url, p)
  return await p
}

async function normalizeImageUrls(urls: string[]): Promise<string[]> {
  return await Promise.all((urls || []).filter(Boolean).map(u => normalizeOneImageUrl(u)))
}

function SimilarReferenceNode({ data }: NodeProps<CustomNodeData>) {
  const similarReferences = data.state.similarReferences
  const [analyzing, setAnalyzing] = useState(false)
  const [uploading, setUploading] = useState(false)
  const uploadId = useId()

  const onUploadSimilar = useCallback(
    async (files: File[]) => {
      try {
        if (!files || files.length === 0) return
        const remaining = Math.max(0, 5 - similarReferences.length)
        const slice = files.slice(0, remaining)
        if (slice.length === 0) {
          alert('已达到最多 5 张图片的限制')
          return
        }
        setUploading(true)
        console.log(`[同类参考] 开始上传 ${slice.length} 张图片`)
        const dataUrls = await Promise.all(slice.map(fileToDataUrl))
        console.log(`[同类参考] 图片处理完成，dataUrls数量: ${dataUrls.length}`)
        if (dataUrls.length === 0) return
        data.setState(prev => ({
          ...prev,
          similarReferences: [
            ...prev.similarReferences,
            ...dataUrls
              .filter(Boolean)
              .map((dataUrl, idx) => ({
                id: randomId() + '-similar-' + idx,
                dataUrl,
                label: `同类型${prev.similarReferences.length + idx + 1}`,
              })),
          ],
        }))
        console.log('[同类参考] 状态更新完成')
      } catch (err) {
        console.error('[同类参考] 上传失败:', err)
        alert('上传失败: ' + (err instanceof Error ? err.message : String(err)))
      } finally {
        setUploading(false)
      }
    },
    [data, similarReferences.length],
  )

  const analyzeSimilarReferences = useCallback(async () => {
    if (similarReferences.length < 3) {
      alert('请至少上传 3 张同类型参考图片进行分析。')
      return
    }
    setAnalyzing(true)
    try {
      const prompt = [
        '你是头像框设计分析师。',
        '我提供了几张同类型头像框图片，请找出它们的共性，并生成 5-8 个关键词。',
        '请直接返回 JSON，不要包含 Markdown 代码块。',
        '{',
        '  "analysis": "...",',
        '  "keywords": ["...", "...", ...]',
        '}',
      ].join('\n')

      const imgs = await normalizeImageUrls(similarReferences.map(item => item.dataUrl))
      const engine = data.state.similarAnalysisEngine || 'gemini'
      let result = ''

      if (engine === 'timi-chat') {
        try {
          result = await generateSimilarReferenceAnalysisWithTIMI({ prompt, imageDataUrls: imgs })
        } catch (e: any) {
          const msg = e instanceof Error ? e.message : String(e)
          console.warn('[同类参考] TIMI chat 分析失败，自动改用 Gemini:', msg)
          result = await generateWithGemini({ model: 'gemini-2.5-flash', text: prompt, imageDataUrls: imgs })
        }
      } else {
        // 同类参考分析永远用 Gemini 文本模型；不要复用 aiModel（它可能是 TIMI 图片模型）。
        result = await generateWithGemini({ model: 'gemini-2.5-flash', text: prompt, imageDataUrls: imgs })
      }

      let keywords: string[] = []
      let analysis = result
      const start = result.indexOf('{')
      const end = result.lastIndexOf('}')
      if (start >= 0 && end > start) {
        try {
          const parsed = JSON.parse(result.slice(start, end + 1)) as any
          analysis = parsed.analysis || result
          if (Array.isArray(parsed.keywords)) {
            keywords = parsed.keywords
          } else if (typeof parsed.keywords === 'string') {
            keywords = parsed.keywords.split(/[，,\n]/).map((k: string) => k.trim()).filter(Boolean)
          }
        } catch {
          analysis = result
        }
      }

      data.setState(prev => ({
        ...prev,
        similarKeywords: keywords,
        similarAnalysis: analysis,
      }))
    } catch (error) {
      console.error('分析同类型参考失败', error)
      data.setState(prev => ({
        ...prev,
        similarKeywords: [],
        similarAnalysis: '分析失败，请重试。',
      }))
    } finally {
      setAnalyzing(false)
    }
  }, [data, similarReferences, data.state.similarAnalysisEngine])

  return (
    <NodeShell title={data.title} className="max-w-[380px] min-w-[340px]">
      <Handle type="target" position={Position.Left} className="!bg-slate-600" />
      <Handle type="source" position={Position.Right} className="!bg-indigo-500" />

      <div className="text-xs text-slate-400 mb-2">
        上传 3-5 张同类型头像框图片，AI 会分析它们的共性并给出关键词。
      </div>
      <div className="mb-3 nodrag">
        <input
          id={`similar-upload-${uploadId}`}
          type="file"
          accept="image/*"
          multiple
          disabled={uploading}
          onChange={e => {
            const picked = fileListToArray(e.currentTarget.files)
            e.currentTarget.value = ''
            if (picked.length > 0) {
              onUploadSimilar(picked).catch(err => {
                console.error('上传失败:', err)
                alert('上传失败: ' + (err instanceof Error ? err.message : String(err)))
              })
            }
          }}
          className="hidden"
        />
        <label
          htmlFor={`similar-upload-${uploadId}`}
          className={`block w-full rounded-lg border px-3 py-2 text-sm transition text-center cursor-pointer select-none ${
            uploading
              ? 'border-slate-600 bg-slate-800 text-slate-400 cursor-wait'
              : 'border-indigo-500/50 bg-indigo-500/10 text-indigo-200 hover:border-indigo-400 hover:bg-indigo-500/20'
          }`}
        >
          {uploading ? '处理中...' : '上传同类型头像框（最多 5 张）'}
        </label>
      </div>
      <div className="text-xs text-slate-400 mb-2">
        已上传: <span className="text-indigo-200">{similarReferences.length}</span> 张
        {similarReferences.length < 3 && <span className="ml-2 text-amber-400">至少 3 张</span>}
      </div>
      {similarReferences.length > 0 && (
        <div className="grid grid-cols-3 gap-2 mb-3">
          {similarReferences.map(img => (
            <div key={img.id} className="relative rounded-lg overflow-hidden border border-indigo-500/20">
              <img src={img.dataUrl} alt={img.label} className="w-full h-20 object-cover" />
              <button
                onClick={() =>
                  data.setState(prev => ({
                    ...prev,
                    similarReferences: prev.similarReferences.filter(it => it.id !== img.id),
                  }))
                }
                className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full w-5 h-5 text-[10px] flex items-center justify-center"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      <button
        onClick={analyzeSimilarReferences}
        disabled={analyzing || similarReferences.length < 3}
        className="w-full rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-900 disabled:text-slate-400 px-3 py-2 text-sm text-white transition"
      >
        {analyzing ? '分析中...' : 'AI 分析共性并生成关键词'}
      </button>
      {data.state.similarAnalysis && (
        <div className="mt-3 rounded-lg border border-indigo-500/20 bg-slate-950/80 p-3 text-xs text-slate-300">
          <div className="font-medium text-slate-100 mb-2">分析结果</div>
          <div className="whitespace-pre-wrap break-words max-h-44 overflow-y-auto pr-1 text-[11px] leading-relaxed">
            {data.state.similarAnalysis}
          </div>
          {data.state.similarKeywords.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2 max-h-24 overflow-y-auto">
              {data.state.similarKeywords.map((keyword, idx) => (
                <span key={idx} className="px-2 py-1 rounded bg-indigo-500/20 text-indigo-200 text-[11px] border border-indigo-500/20">
                  {keyword}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </NodeShell>
  )
}

function PreviewNode({ data }: NodeProps<CustomNodeData>) {
  const { shape, quadrants, aiModel, aiPrompt, referenceSimilarity, generateImageVariantCount, aiResult, timiImageSize } = data.state

  const regionalImages = useMemo(() => {
    const rc = data.state.regionalConstraints as any
    const all: Array<{ label: string; dataUrl: string }> = []
    const ids: RegionId[] = ['lt', 'rt', 'lb', 'rb', 'frame']
    for (const id of ids) {
      const it = rc?.[id]
      if (!it) continue
      if (id !== 'frame' && !it.enabled) continue
      const assets = Array.isArray(it.assets) ? it.assets : []
      for (const a of assets) {
        if (a?.dataUrl) all.push({ label: `[${id.toUpperCase()}] ${a.label || ''}`.trim(), dataUrl: a.dataUrl })
      }
    }
    const seen = new Set<string>()
    return all.filter(it => it.dataUrl && !seen.has(it.dataUrl) && (seen.add(it.dataUrl), true))
  }, [data.state.regionalConstraints])

  const valid = regionalImages.length >= 1 && regionalImages.length <= 20
  const [imgLoading, setImgLoading] = useState(false)
  const [redrawLoading, setRedrawLoading] = useState(false)
  const [scratchLoading, setScratchLoading] = useState(false)
  const [parseError, setParseError] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ active: boolean; value: number }>({ active: false, value: 0 })

  const isAnyGenerating = imgLoading || redrawLoading || scratchLoading

  useEffect(() => {
    if (!isAnyGenerating) {
      // finish animation and hide shortly
      setProgress(p => {
        if (!p.active) return p
        return { active: true, value: 100 }
      })
      const t = window.setTimeout(() => setProgress({ active: false, value: 0 }), 450)
      return () => window.clearTimeout(t)
    }

    // start a fake-but-informative progress ramp
    setProgress({ active: true, value: 6 })
    const startedAt = Date.now()
    const tick = () => {
      const elapsed = Date.now() - startedAt
      // ease to 92% over ~18s (never reach 100% until done)
      const target = 92
      const k = 1 - Math.exp(-elapsed / 5500)
      const next = Math.min(target, Math.max(6, Math.round(6 + (target - 6) * k)))
      setProgress(p => (p.active ? { active: true, value: Math.max(p.value, next) } : p))
    }
    tick()
    const id = window.setInterval(tick, 200)
    return () => window.clearInterval(id)
  }, [isAnyGenerating])

  const jobRef = useRef<{ id: string; cancelled: boolean } | null>(null)
  const startJob = useCallback(() => {
    const id = randomId()
    jobRef.current = { id, cancelled: false }
    return id
  }, [])
  const isCancelled = useCallback((jobId: string) => jobRef.current?.id !== jobId || Boolean(jobRef.current?.cancelled), [])
  const cancelCurrentJob = useCallback(() => {
    if (jobRef.current) jobRef.current.cancelled = true
    setImgLoading(false)
    setRedrawLoading(false)
    setScratchLoading(false)
  }, [])

  const generatePixelComposite = useCallback(async () => {
    const jobId = startJob()
    setImgLoading(true)
    setParseError(null)
    try {
      if (regionalImages.length === 0) throw new Error('请先在「五象限约束」上传素材')
      const userNeed = aiPrompt?.trim() || '请根据参考图安排花环位置：尽量保持原图里的物件形态，只规划摆放与层次。'
      const nOut = Math.min(3, Math.max(1, Math.round(generateImageVariantCount)))

      const normalized = await normalizeImageUrls(regionalImages.map(i => i.dataUrl))
      const { plan, analysisText } = await extractAvatarFramePixelLayout({
        shape,
        quadrants,
        userPrompt: userNeed,
        referenceSimilarity,
        images: regionalImages.map((i, idx) => ({ id: String(idx), label: i.label, dataUrl: normalized[idx] || i.dataUrl })),
      })
      if (isCancelled(jobId)) return

      const pixelImages = regionalImages.map((i, idx) => ({ id: String(idx), label: i.label, dataUrl: i.dataUrl }))
      const urls: string[] = []
      for (let v = 0; v < nOut; v++) {
        if (isCancelled(jobId)) return
        urls.push(
          await renderAvatarFrameFromPlan({
            shape,
            quadrants,
            images: pixelImages,
            plan,
            variantIndex: v,
            referenceSimilarity,
          }),
        )
      }
      if (isCancelled(jobId)) return

      data.setState(prev => ({ ...prev, aiResult: analysisText, generatedImageDataUrls: urls }))
    } catch (e: any) {
      if (!isCancelled(jobId)) setParseError(e?.message || '合成失败')
    }
    if (!isCancelled(jobId)) setImgLoading(false)
  }, [aiModel, aiPrompt, data, generateImageVariantCount, isCancelled, quadrants, referenceSimilarity, regionalImages, shape, startJob])

  const generateRedraw = useCallback(async () => {
    const jobId = startJob()
    setRedrawLoading(true)
    setParseError(null)
    try {
      if (regionalImages.length === 0) throw new Error('请先在「五象限约束」上传素材')

      if (isTimiModel(aiModel)) {
        const userNeed = aiPrompt?.trim() || '参考图片风格的头像框，装饰性边框，透明背景，无文字，统一风格'
        const size = timiImageSize || '1K'
        const imageDataUrls = await generateImageWithTIMI({
          timiModel: aiModel,
          prompt: [
            avatarFrameShapeIntentPromptEn(shape),
            'Fully transparent background, no text, no watermark, no logo.',
            userNeed,
            `Reference similarity: ${referenceSimilarity}/100.`,
          ].join('\n\n'),
          referenceImages: await normalizeImageUrls(regionalImages.map(i => i.dataUrl)),
          aspectRatio: '1:1',
          imageSize: size,
        })
        if (isCancelled(jobId)) return
        data.setState(prev => ({
          ...prev,
          aiResult: `[TIMI ${TIMI_IMAGE_MODEL_MAP[aiModel].name}] 参考生图完成`,
          generatedImageDataUrls: imageDataUrls,
        }))
        return
      }

      const userNeed = aiPrompt?.trim() || '请从参考图提炼统一的风格与母题，重绘成一个整体一致的头像框（不要拼贴）。'
      const normalizedRefs = await normalizeImageUrls(regionalImages.map(i => i.dataUrl))
      const { imageDataUrls, analysisText } = await generateAvatarFrameRedrawFromRefs({
        shape,
        quadrants,
        userPrompt: userNeed,
        referenceSimilarity,
        images: regionalImages.map((i, idx) => ({ ...i, dataUrl: normalizedRefs[idx] || i.dataUrl })),
        imageOutputCount: generateImageVariantCount,
        outputImageSize: timiImageSize || '1K',
      })
      if (isCancelled(jobId)) return
      data.setState(prev => ({ ...prev, aiResult: analysisText, generatedImageDataUrls: imageDataUrls }))
    } catch (e: any) {
      if (!isCancelled(jobId)) setParseError(e?.message || '生成失败')
    }
    if (!isCancelled(jobId)) setRedrawLoading(false)
  }, [aiModel, aiPrompt, data, generateImageVariantCount, isCancelled, quadrants, referenceSimilarity, regionalImages, shape, startJob, timiImageSize])

  const generateFromScratch = useCallback(async () => {
    const jobId = startJob()
    setScratchLoading(true)
    setParseError(null)
    try {
      const first = quadrants[0] || 'lt'
      const q = first === 'lt' ? 'top-left' : first === 'lb' ? 'bottom-left' : first === 'rt' ? 'top-right' : 'bottom-right'
      const style = aiPrompt?.trim() || 'high quality, cute, decorative, no text'

      if (isTimiModel(aiModel)) {
        const size = timiImageSize || '1K'
        const img = await generateImageWithTIMI({
          timiModel: aiModel,
          prompt: [
            'Design an avatar frame PNG (no text) for a profile picture.',
            avatarFrameShapeIntentPromptEn(shape),
            `Decorative element placement quadrant: ${q}.`,
            'Style requirements:',
            style,
          ].join('\n'),
          aspectRatio: '1:1',
          imageSize: size,
        })
        if (isCancelled(jobId)) return
        data.setState(prev => ({ ...prev, generatedImageDataUrls: img }))
        return
      }

      const outSz = timiImageSize || '1K'
      const detail =
        outSz === '2K'
          ? 'Detail tier: HIGH (~2K intent) — crisp ornaments and fine edges.'
          : 'Detail tier: STANDARD (~1K intent) — clean shapes, efficient detail.'
      const img = await generateImageWithImagen({
        prompt: [
          'Design an avatar frame PNG (no text) for a profile picture.',
          detail,
          avatarFrameShapeIntentPromptEn(shape),
          `Decorative element placement quadrant: ${q}.`,
          'Style requirements:',
          style,
        ].join('\n'),
        outputMimeType: 'image/png',
        aspectRatio: '1:1',
        numberOfImages: 1,
      })
      if (isCancelled(jobId)) return
      if (!img) throw new Error('图片生成失败：未返回图片数据')
      data.setState(prev => ({ ...prev, generatedImageDataUrls: img }))
    } catch (e: any) {
      if (!isCancelled(jobId)) setParseError(e?.message || '图片生成失败')
    }
    if (!isCancelled(jobId)) setScratchLoading(false)
  }, [aiModel, aiPrompt, data, isCancelled, quadrants, shape, startJob, timiImageSize])

  return (
    <NodeShell title={data.title}>
      <Handle type="target" position={Position.Left} className="!bg-slate-600" />
      <div className="text-xs text-slate-400 mb-3">4) 展示（预览汇总）</div>

      <div className="mb-3">
        <div className="text-[11px] text-slate-500 mb-1">出图尺寸</div>
        <select
          value={timiImageSize || '1K'}
          onChange={e =>
            data.setState(prev => ({
              ...prev,
              timiImageSize: (e.target.value === '2K' ? '2K' : '1K') as any,
            }))
          }
          className="w-full rounded-lg bg-slate-900 border border-slate-700 px-2 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
        >
          <option value="1K">1K（更快）</option>
          <option value="2K">2K（更清晰、更慢）</option>
        </select>
        <div className="mt-1 text-[11px] text-slate-500">
          {isTimiModel(aiModel)
            ? 'TIMI：作为 image_size 参数下发，并在提示词中再次强调。'
            : 'Gemini / Imagen：无精确像素档位 API，会通过提示词控制细节量；TIMI 模型下才会真正改请求分辨率。'}
          {' '}2K 更容易超时。
        </div>
      </div>

      <div className="flex gap-4 items-start">
        <div className="relative">
          <div className={`w-40 h-40 border-2 ${valid ? 'border-indigo-500' : 'border-slate-600'} bg-slate-950/40 ${shape === 'circle' ? 'rounded-full' : 'rounded-2xl'}`} />
          {quadrants.map(q => (
            <div
              key={q}
              className="absolute w-10 h-10 rounded-lg border border-slate-700 bg-indigo-500/15"
              style={{
                left: q === 'lt' || q === 'lb' ? 6 : undefined,
                right: q === 'rt' || q === 'rb' ? 6 : undefined,
                top: q === 'lt' || q === 'rt' ? 6 : undefined,
                bottom: q === 'lb' || q === 'rb' ? 6 : undefined,
              }}
              title={`元素位置: ${q}`}
            />
          ))}
        </div>

        <div className="flex-1">
          <div className="text-sm text-slate-200 font-medium">当前配置</div>
          <div className="mt-1 text-xs text-slate-500 space-y-1">
            <div>
              形状: <span className="text-slate-300">{shape === 'circle' ? '圆形' : '方形'}</span>
            </div>
            <div>
              约束素材: <span className="text-slate-300">{regionalImages.length}</span> 张 {!valid && <span className="text-amber-400">(请至少上传 1 张)</span>}
            </div>
          </div>

          {regionalImages.length > 0 && (
            <div className="mt-3 grid grid-cols-4 gap-2">
              {regionalImages.slice(0, 8).map((img, idx) => (
                <div key={idx} className="group">
                  <img src={img.dataUrl} alt={img.label} className="w-full h-12 object-cover rounded-md border border-slate-800" />
                  <div className="mt-1 text-[10px] text-slate-400 truncate" title={img.label}>
                    {img.label || '未命名'}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/30 p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-medium text-slate-200">AI 智能编辑</div>
              <select
                value={String(aiModel)}
                onChange={e => data.setState(prev => ({ ...prev, aiModel: e.target.value as any }))}
                className="rounded-lg bg-slate-900 border border-slate-700 px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
              >
                <optgroup label="Gemini（看图推理 + Imagen 出图）">
                  <option value="gemini-3-flash-preview">Gemini 3</option>
                  <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
                </optgroup>
                <optgroup label="TIMI AI（文生图 / 参考生图）">
                  {Object.entries(TIMI_IMAGE_MODEL_MAP).map(([key, { name }]) => (
                    <option key={key} value={key}>{name}</option>
                  ))}
                </optgroup>
              </select>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  const brief = buildQuadrantBrief(data.state)
                  data.setState(prev => {
                    const prevText = (prev.aiPrompt || '').trim()
                    const next =
                      prevText.length > 0
                        ? `${brief}\n\n---\n用户补充:\n${prevText}`
                        : brief
                    return { ...prev, aiPrompt: next }
                  })
                }}
                className="rounded-lg border border-indigo-500/40 bg-indigo-500/10 px-3 py-2 text-xs text-indigo-200 hover:border-indigo-400 hover:bg-indigo-500/15 transition"
                title="把五象限约束/颜色定位/同类参考关键词汇总成提示词，写入到下面的输入框"
              >
                从五象限生成文案
              </button>
              <button
                type="button"
                onClick={() => data.setState(prev => ({ ...prev, aiPrompt: '' }))}
                className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-200 hover:border-slate-600 transition"
              >
                清空文案
              </button>
            </div>

            <textarea
              value={aiPrompt}
              onChange={e => data.setState(prev => ({ ...prev, aiPrompt: e.target.value }))}
              rows={3}
              className="mt-2 w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 placeholder:text-slate-500"
              placeholder="描述你想要的头像框风格/元素/氛围（例如：赛博朋克、金属质感、卡通可爱…）"
            />

            <div className="mt-3">
              <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                <span>参考图相似度</span>
                <span className="tabular-nums text-slate-200">{referenceSimilarity}</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={referenceSimilarity}
                onChange={e => data.setState(prev => ({ ...prev, referenceSimilarity: Math.min(100, Math.max(0, Number(e.target.value))) }))}
                className="w-full h-2 accent-indigo-500 cursor-pointer"
              />
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-500 w-full">
              <span className="w-full sm:w-auto">一次出图：</span>
              <label className="inline-flex items-center gap-1 cursor-pointer">
                <input type="radio" name="variant-count" checked={generateImageVariantCount === 1} onChange={() => data.setState(prev => ({ ...prev, generateImageVariantCount: 1 }))} className="accent-emerald-500" />
                1 张（快）
              </label>
              <label className="inline-flex items-center gap-1 cursor-pointer">
                <input type="radio" name="variant-count" checked={generateImageVariantCount === 3} onChange={() => data.setState(prev => ({ ...prev, generateImageVariantCount: 3 }))} className="accent-emerald-500" />
                3 张（慢）
              </label>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button onClick={() => void generateRedraw()} disabled={redrawLoading} className="rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-900 disabled:text-slate-400 px-3 py-2 text-xs text-white transition">
                {redrawLoading ? '生成中...' : '生成图片（AI 重绘·参考风格）'}
              </button>
              <button onClick={() => void generatePixelComposite()} disabled={imgLoading} className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-200 hover:border-slate-600 disabled:text-slate-500 disabled:hover:border-slate-700 transition">
                {imgLoading ? '生成中...' : '生成图片（像素合成）'}
              </button>
              <button onClick={() => void generateFromScratch()} disabled={scratchLoading} className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-200 hover:border-slate-600 disabled:text-slate-500 disabled:hover:border-slate-700 transition">
                {scratchLoading ? '生成中...' : '生成图片（从零）'}
              </button>
              {(imgLoading || redrawLoading || scratchLoading) && (
                <button onClick={cancelCurrentJob} className="rounded-lg border border-red-500/50 bg-red-500/10 px-3 py-2 text-xs text-red-200 hover:border-red-400 hover:bg-red-500/15 transition">
                  取消生成
                </button>
              )}
              {parseError && <div className="text-xs text-amber-400">{parseError}</div>}
            </div>

            {progress.active && (
              <div className="mt-2">
                <div className="flex items-center justify-between text-[11px] text-slate-400">
                  <span>生成进度</span>
                  <span className="tabular-nums">{Math.min(99, Math.max(1, progress.value))}%</span>
                </div>
                <div className="mt-1 h-2 w-full rounded-full border border-slate-800 bg-slate-950/40 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-indigo-500/70 transition-[width] duration-200"
                    style={{ width: `${Math.min(100, Math.max(2, progress.value))}%` }}
                  />
                </div>
                <div className="mt-1 text-[10px] text-slate-500">
                  若超过 30 秒仍无结果，建议切到 1K、减少参考图数量或换“稳定”模型。
                </div>
              </div>
            )}

            {data.state.generatedImageDataUrls.length > 0 && (
              <div className="mt-3">
                <div className="text-[11px] text-slate-500 mb-1">生成结果</div>
                <div className="grid grid-cols-3 gap-2">
                  {data.state.generatedImageDataUrls.slice(0, 3).map((url, idx) => (
                    <div key={idx} className="rounded-xl border border-slate-800 bg-slate-950/40 p-2">
                      <img src={url} alt={`AI 生成头像框 ${idx + 1}`} onError={() => setParseError('图片加载失败（生成结果不是有效的 PNG dataUrl 或被浏览器拦截）')} className="w-full aspect-square rounded-lg object-contain" />
                      <a href={url} download={`avatar-frame-${idx + 1}.png`} className="mt-2 inline-block text-xs text-indigo-400 hover:underline">下载 PNG</a>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {aiResult?.trim() && (
              <div className="mt-2">
                <div className="text-[11px] text-slate-500 mb-1">AI 输出</div>
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap text-[11px] text-slate-300 bg-slate-950/40 border border-slate-800 rounded-lg p-2">{aiResult}</pre>
              </div>
            )}
          </div>
        </div>
      </div>
    </NodeShell>
  )
}

type AvatarFrameDesignerProps = {
  state: FlowState
  onStateChange: (updater: (prev: FlowState) => FlowState) => void
}

export default function AvatarFrameDesigner({ state, onStateChange }: AvatarFrameDesignerProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<CustomNodeData>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const [paneContextMenu, setPaneContextMenu] = useState<{ x: number; y: number } | null>(null)
  const [creatorNav, setCreatorNav] = useState<'avatar' | 'honor' | 'action' | 'ui' | 'icon'>('avatar')

  // === 历史记录功能 ===
  const [history, setHistory] = useState<HistoryEntry[]>(() => loadHistory())
  const [showHistoryPanel, setShowHistoryPanel] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastStateRef = useRef<string>('')

  const setFlowState = useCallback((updater: (prev: FlowState) => FlowState) => {
    onStateChange(updater)
  }, [onStateChange])

  // 手动保存
  const handleManualSave = useCallback(() => {
    const name = saveName.trim() || `版本 ${history.length + 1}`
    const entry = addHistoryEntry(state as Record<string, unknown>, name, false)
    const newHistory = [...history, entry]
    setHistory(newHistory)
    saveHistory(newHistory)
    setSaveName('')
    setAutoSaveStatus('saved')
    setTimeout(() => setAutoSaveStatus('idle'), 2000)
  }, [state, history, saveName])

  // 自动保存（防抖）
  useEffect(() => {
    const stateKey = JSON.stringify({
      shape: state.shape,
      quadrants: state.quadrants,
      aiPrompt: state.aiPrompt,
      colorTheme: state.colorTheme?.raw,
      similarKeywords: state.similarKeywords,
    })
    
    // 状态没变化则跳过
    if (stateKey === lastStateRef.current) return
    lastStateRef.current = stateKey

    // 清除之前的定时器
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current)
    }

    // 设置新的防抖定时器
    autoSaveTimerRef.current = setTimeout(() => {
      setAutoSaveStatus('saving')
      const entry = addHistoryEntry(state as Record<string, unknown>, '自动保存', true)
      // 只保留最近一个自动保存，避免重复
      const filtered = history.filter(e => !e.auto)
      const newHistory = [...filtered, entry]
      setHistory(newHistory)
      saveHistory(newHistory)
      setAutoSaveStatus('saved')
      setTimeout(() => setAutoSaveStatus('idle'), 1500)
    }, getAutoSaveInterval())

    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current)
      }
    }
  }, [state])

  // 恢复历史版本
  const handleRestore = useCallback((entry: HistoryEntry) => {
    const restored = entry.state as FlowState
    // 恢复时需要补上缺失的默认值（因为轻量版可能省略了某些字段）
    const empty = createEmptyAvatarFrameFlowState()
    const merged: FlowState = {
      ...empty,
      ...restored,
      // 确保数值在合理范围内
      referenceSimilarity: Math.min(100, Math.max(0, restored.referenceSimilarity ?? empty.referenceSimilarity)),
      generateImageVariantCount: restored.generateImageVariantCount === 3 ? 3 : 1,
      timiImageSize: (restored.timiImageSize === '2K' ? '2K' : '1K') as '1K' | '2K',
    }
    onStateChange(() => merged)
    setShowHistoryPanel(false)
  }, [onStateChange])

  // 删除历史条目
  const handleDeleteEntry = useCallback((id: string) => {
    const newHistory = deleteHistoryEntry(history, id)
    setHistory(newHistory)
    saveHistory(newHistory)
  }, [history])

  // 清空历史
  const handleClearHistory = useCallback(() => {
    if (confirm('确定要清空所有历史记录吗？')) {
      setHistory([])
      clearHistory()
    }
  }, [])

  const closePaneContextMenu = useCallback(() => setPaneContextMenu(null), [])

  const clearCanvasToEmpty = useCallback(() => {
    onStateChange(() => createEmptyAvatarFrameFlowState())
    closePaneContextMenu()
  }, [onStateChange, closePaneContextMenu])

  const onFlowPaneContextMenu = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    const el = e.target as HTMLElement
    if (el.closest('.react-flow__node')) return
    if (el.closest('.react-flow__edge')) return
    if (!el.closest('.react-flow__pane')) return
    e.preventDefault()
    setPaneContextMenu({ x: e.clientX, y: e.clientY })
  }, [])

  useEffect(() => {
    if (!paneContextMenu) return
    const onDown = (ev: MouseEvent) => {
      const t = ev.target as HTMLElement
      if (t.closest?.('[data-avatar-frame-ctx-menu]')) return
      closePaneContextMenu()
    }
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') closePaneContextMenu()
    }
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [paneContextMenu, closePaneContextMenu])

  const nodeTypes = useMemo(
    () => ({
      shape: ShapeNode,
      layout: LayoutNode,
      colorTheme: ColorThemeNode,
      similarRefs: SimilarReferenceNode,
      preview: PreviewNode,
    }),
    [],
  )

  const initialNodes = useMemo((): Node<CustomNodeData>[] => {
    const common = { state, setState: setFlowState }
    return [
      {
        id: 'shape',
        type: 'shape',
        position: { x: 40, y: 100 },
        data: { title: '形状', ...common },
      },
      {
        id: 'similarRefs',
        type: 'similarRefs',
        position: { x: 420, y: 100 },
        data: { title: '同类参考', ...common },
      },
      {
        id: 'colorTheme',
        type: 'colorTheme',
        position: { x: 820, y: 100 },
        data: { title: '颜色定位', ...common },
      },
      {
        id: 'layout',
        type: 'layout',
        position: { x: 1250, y: 100 },
        data: { title: '五象限约束', ...common },
      },
      {
        id: 'preview',
        type: 'preview',
        position: { x: 2050, y: 100 },
        data: { title: '展示', ...common },
      },
    ]
  }, [state, setFlowState])

  const initialEdges = useMemo(
    (): Edge[] => [
      { id: 'e1', source: 'shape', target: 'similarRefs', animated: true, style: { stroke: '#6366f1' } },
      { id: 'e2', source: 'similarRefs', target: 'colorTheme', animated: true, style: { stroke: '#6366f1' } },
      { id: 'e3', source: 'colorTheme', target: 'layout', animated: true, style: { stroke: '#6366f1' } },
      { id: 'e4', source: 'layout', target: 'preview', animated: true, style: { stroke: '#6366f1' } },
    ],
    [],
  )

  // initialize once
  useEffect(() => {
    setNodes(initialNodes)
    setEdges(initialEdges)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // keep node data in sync with flow state
  useEffect(() => {
    setNodes(prev =>
      prev.map(n => ({
        ...n,
        data: {
          ...n.data,
          state,
          setState: setFlowState,
        },
      })),
    )
  }, [state, setFlowState])

  const onConnect = useCallback(
    (params: Connection) =>
      setEdges(eds =>
        addEdge({ ...params, animated: true, style: { stroke: '#6366f1' } }, eds),
      ),
    [setEdges],
  )

  return (
    <div className="flex h-full w-full min-h-0 flex-col">
      {/* 左侧导航（与输出工具风格一致） */}
      <div className="absolute left-0 top-0 bottom-0 w-[156px] z-10 flex flex-col border-r border-slate-800/60 bg-slate-950/55 backdrop-blur-md">
        <div className="pt-4 pb-3">
          <div className="mt-1 mx-1.5 w-[calc(100%-12px)] text-[10px] text-indigo-300/15">选择一个模块</div>
        </div>
        <div className="flex-1 overflow-y-auto py-2">
          {(
            [
              { id: 'avatar' as const, name: '头像框' },
              { id: 'honor' as const, name: '荣耀播报' },
              { id: 'action' as const, name: '个性动作' },
              { id: 'ui' as const, name: '按钮/弹窗设计' },
              { id: 'icon' as const, name: '图标细化' },
            ] as const
          ).map(nav => (
            <button
              key={nav.id}
              type="button"
              onClick={() => setCreatorNav(nav.id)}
              className={`group relative mx-1.5 my-1 w-[calc(100%-12px)] rounded-xl px-2.5 py-2 text-left text-[13px] transition-colors duration-150 ${
                creatorNav === nav.id ? 'bg-indigo-500/12 text-indigo-300' : 'text-slate-300 hover:bg-slate-800/25 hover:text-slate-100'
              }`}
            >
              <div className="min-w-0">
                <div className="truncate">{nav.name}</div>
                {nav.id === 'avatar' && <div className="mt-0.5 truncate text-[10px] text-indigo-300/15">Avatar Frame</div>}
              </div>
            </button>
          ))}
        </div>

        {/* === 历史记录区域 === */}
        <div className="border-t border-slate-800/60 pt-3 pb-2">
          {/* 自动保存状态指示 */}
          <div className="mx-1.5 mb-2 flex items-center justify-between">
            <span className="text-[10px] text-slate-500">
              {autoSaveStatus === 'saving' ? '⏳ 保存中...' : 
               autoSaveStatus === 'saved' ? '✓ 已保存' : '自动保存'}
            </span>
            <button
              type="button"
              onClick={() => setShowHistoryPanel(!showHistoryPanel)}
              className="text-[10px] text-indigo-400 hover:text-indigo-300 transition"
            >
              {showHistoryPanel ? '收起' : '历史'}
            </button>
          </div>

          {/* 手动保存输入 */}
          <div className="mx-1.5 mb-2">
            <div className="flex gap-1">
              <input
                type="text"
                placeholder="版本名称..."
                value={saveName}
                onChange={e => setSaveName(e.target.value)}
                className="flex-1 min-w-0 bg-slate-900/60 border border-slate-800/50 rounded-lg px-2 py-1.5 text-[11px] text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-indigo-500/50"
                onKeyDown={e => {
                  if (e.key === 'Enter') handleManualSave()
                }}
              />
              <button
                type="button"
                onClick={handleManualSave}
                className="shrink-0 bg-indigo-500/20 border border-indigo-500/30 rounded-lg px-2 py-1.5 text-[11px] text-indigo-300 hover:bg-indigo-500/30 transition"
              >
                保存
              </button>
            </div>
          </div>

          {/* 历史记录列表 */}
          {showHistoryPanel && history.length > 0 && (
            <div className="mx-1.5 max-h-[180px] overflow-y-auto space-y-1">
              {history.slice().reverse().map(entry => (
                <div
                  key={entry.id}
                  className="group flex items-center gap-2 rounded-lg bg-slate-900/40 border border-slate-800/40 px-2 py-1.5 hover:border-slate-700/60 transition"
                >
                  <div className="flex-1 min-w-0">
                    <div className="truncate text-[11px] text-slate-200">
                      {entry.name}
                      {entry.auto && <span className="ml-1 text-[9px] text-slate-500">(自动)</span>}
                    </div>
                    <div className="text-[9px] text-slate-500">{formatTimestamp(entry.timestamp)}</div>
                  </div>
                  <div className="shrink-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
                    <button
                      type="button"
                      onClick={() => handleRestore(entry)}
                      className="text-[10px] text-indigo-400 hover:text-indigo-300"
                      title="恢复此版本"
                    >
                      恢复
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteEntry(entry.id)}
                      className="text-[10px] text-red-400 hover:text-red-300"
                      title="删除"
                    >
                      删
                    </button>
                  </div>
                </div>
              ))}
              {history.length > 1 && (
                <button
                  type="button"
                  onClick={handleClearHistory}
                  className="w-full text-[10px] text-red-400/70 hover:text-red-400 py-1 text-center"
                >
                  清空历史
                </button>
              )}
            </div>
          )}
          {showHistoryPanel && history.length === 0 && (
            <div className="mx-1.5 text-[10px] text-slate-500 text-center py-2">
              暂无历史记录
            </div>
          )}
        </div>
      </div>

      {/* 右侧画布区域 */}
      <div
        className="flex-1 min-h-0 w-full relative ml-[156px]"
        onContextMenu={e => {
          // 仅“头像框”模块允许右键清空画布
          if (creatorNav !== 'avatar') return
          onFlowPaneContextMenu(e)
        }}
      >
        {creatorNav !== 'avatar' ? (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-950/40">
            <p className="text-sm text-slate-400">模板搭建中</p>
          </div>
        ) : (
          <>
            <div className="absolute inset-0" onContextMenu={onFlowPaneContextMenu}>
              <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                nodeTypes={nodeTypes}
                fitView
                fitViewOptions={{ padding: 0.2 }}
                proOptions={{ hideAttribution: true }}
              >
                <Background gap={16} size={1} color="#1f2937" />
              </ReactFlow>
            </div>
            {paneContextMenu && (
              <div
                data-avatar-frame-ctx-menu
                className="fixed z-50 min-w-[180px] rounded-xl border border-slate-800 bg-slate-950/95 backdrop-blur shadow-[0_18px_60px_rgba(0,0,0,0.55)] overflow-hidden"
                style={{ left: paneContextMenu.x, top: paneContextMenu.y }}
                onMouseDown={e => e.stopPropagation()}
              >
                <button
                  type="button"
                  className="w-full text-left px-3 py-2 text-sm text-slate-200 hover:bg-slate-800/60 transition"
                  onClick={() => clearCanvasToEmpty()}
                >
                  清空画布
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

