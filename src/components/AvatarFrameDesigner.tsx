import { useCallback, useEffect, useMemo, useState } from 'react'
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
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
import { generateAvatarFrameFromRefs, generateImageWithImagen, generateWithGemini } from '../services/gemini'

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

type FlowState = {
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
  similarReferences: LabeledImage[]
  similarKeywords: string[]
  similarAnalysis: string
}

type CustomNodeData = {
  title: string
  state: FlowState
  setState: (updater: (prev: FlowState) => FlowState) => void
}

function NodeShell({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-900/90 shadow-lg min-w-[320px]">
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

function LayoutNode({ data }: NodeProps<CustomNodeData>) {
  const quadrants = data.state.quadrants
  const items: { id: Quadrant; label: string }[] = [
    { id: 'lt', label: '左上' },
    { id: 'rt', label: '右上' },
    { id: 'lb', label: '左下' },
    { id: 'rb', label: '右下' },
  ]
  return (
    <NodeShell title={data.title}>
      <Handle type="target" position={Position.Left} className="!bg-slate-600" />
      <Handle type="source" position={Position.Right} className="!bg-indigo-500" />
      <div className="text-xs text-slate-400 mb-2">2) 元素布局位置（可多选，最多 4 个）</div>
      <div className="grid grid-cols-2 gap-2">
        {items.map(it => (
          <button
            key={it.id}
            onClick={() =>
              data.setState(prev => {
                const has = prev.quadrants.includes(it.id)
                const next = has ? prev.quadrants.filter(q => q !== it.id) : [...prev.quadrants, it.id]
                return { ...prev, quadrants: next.slice(0, 4) }
              })
            }
            className={`rounded-lg border px-3 py-2 text-sm transition ${
              quadrants.includes(it.id)
                ? 'border-indigo-500 bg-indigo-500/10 text-slate-100'
                : 'border-slate-700 bg-slate-950/30 text-slate-300 hover:border-slate-600'
            }`}
          >
            {it.label}
          </button>
        ))}
      </div>
      <div className="mt-3 text-xs text-slate-500">
        当前:{' '}
        <span className="text-slate-300">
          {quadrants.length > 0 ? quadrants.map(q => items.find(i => i.id === q)?.label).filter(Boolean).join('、') : '未选择'}
        </span>
      </div>
    </NodeShell>
  )
}

function randomId() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16)
}

async function fileToDataUrl(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(new Error('read file failed'))
    r.readAsDataURL(file)
  })
}

function SimilarReferenceNode({ data }: NodeProps<CustomNodeData>) {
  const similarReferences = data.state.similarReferences
  const [analyzing, setAnalyzing] = useState(false)

  const onUploadSimilar = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return
      const remaining = Math.max(0, 5 - similarReferences.length)
      const slice = Array.from(files).slice(0, remaining)
      const dataUrls = await Promise.all(slice.map(fileToDataUrl))
      data.setState(prev => ({
        ...prev,
        similarReferences: [
          ...prev.similarReferences,
          ...dataUrls.map((dataUrl, idx) => ({
            id: randomId() + '-similar-' + idx,
            dataUrl,
            label: `同类型${prev.similarReferences.length + idx + 1}`,
          })),
        ],
      }))
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

      const result = await generateWithGemini({
        model: data.state.aiModel,
        text: prompt,
        imageDataUrls: similarReferences.map(item => item.dataUrl),
      })

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
  }, [data, similarReferences, data.state.aiModel])

  return (
    <NodeShell title={data.title}>
      <Handle type="target" position={Position.Left} className="!bg-slate-600" />
      <Handle type="source" position={Position.Right} className="!bg-indigo-500" />

      <div className="text-xs text-slate-400 mb-2">
        上传 3-5 张同类型头像框图片，AI 会分析它们的共性并给出关键词。
      </div>
      <label className="block mb-3">
        <input
          type="file"
          accept="image/*"
          multiple
          onChange={e => void onUploadSimilar(e.target.files)}
          className="hidden"
        />
        <div className="rounded-lg border border-indigo-500/50 bg-indigo-500/10 px-3 py-2 text-sm text-indigo-200 hover:border-indigo-400 hover:bg-indigo-500/20 cursor-pointer transition">
          上传同类型头像框（最多 5 张）
        </div>
      </label>
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
          <div className="whitespace-pre-wrap">{data.state.similarAnalysis}</div>
          {data.state.similarKeywords.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
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

function ReferenceElementNode({ data }: NodeProps<CustomNodeData>) {
  const images = data.state.images
  const overLimit = images.length > 8
  const underLimit = images.length > 0 && images.length < 3

  const onUpload = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return
      const remaining = Math.max(0, 8 - images.length)
      const slice = Array.from(files).slice(0, remaining)
      const dataUrls = await Promise.all(slice.map(fileToDataUrl))
      data.setState(prev => ({
        ...prev,
        images: [
          ...prev.images,
          ...dataUrls.map((dataUrl, idx) => ({
            id: randomId() + '-' + idx,
            dataUrl,
            label: `参考${prev.images.length + idx + 1}`,
          })),
        ],
      }))
    },
    [data, images.length],
  )

  return (
    <NodeShell title={data.title}>
      <Handle type="target" position={Position.Left} className="!bg-slate-600" />
      <Handle type="source" position={Position.Right} className="!bg-indigo-500" />

      <div className="text-xs text-slate-400 mb-2">
        3) 选择参考元素（上传 3–8 张图片，每张可编辑文案）
      </div>

      <label className="block">
        <input
          type="file"
          accept="image/*"
          multiple
          onChange={e => void onUpload(e.target.files)}
          className="hidden"
        />
        <div className="rounded-lg border border-slate-700 bg-slate-950/30 px-3 py-2 text-sm text-slate-300 hover:border-slate-600 cursor-pointer">
          上传图片（最多 8 张）
        </div>
      </label>

      <div className="mt-2 text-xs text-slate-500">
        已选择: <span className="text-slate-300">{images.length}</span> 张
        {underLimit && <span className="ml-2 text-amber-400">至少需要 3 张</span>}
        {overLimit && <span className="ml-2 text-red-400">最多 8 张</span>}
      </div>

      {images.length > 0 && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          {images.map(img => (
            <div key={img.id} className="rounded-lg border border-slate-800 bg-slate-950/30 p-2">
              <img
                src={img.dataUrl}
                alt={img.label}
                className="w-full h-20 object-cover rounded-md border border-slate-800"
              />
              <input
                value={img.label}
                onChange={e =>
                  data.setState(prev => ({
                    ...prev,
                    images: prev.images.map(it => (it.id === img.id ? { ...it, label: e.target.value } : it)),
                  }))
                }
                className="mt-2 w-full rounded-md bg-slate-900 border border-slate-700 px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                placeholder="输入文案"
              />
              <button
                onClick={() =>
                  data.setState(prev => ({ ...prev, images: prev.images.filter(it => it.id !== img.id) }))
                }
                className="mt-2 w-full text-[11px] rounded-md border border-slate-700 px-2 py-1 text-slate-300 hover:border-slate-600"
              >
                删除
              </button>
            </div>
          ))}
        </div>
      )}
    </NodeShell>
  )
}

function PreviewNode({ data }: NodeProps<CustomNodeData>) {
  const { shape, quadrants, images, aiModel, aiPrompt, aiResult } = data.state
  const quadrantLabels = quadrants.map(q =>
    q === 'lt' ? '左上' : q === 'lb' ? '左下' : q === 'rt' ? '右上' : '右下',
  )

  const valid = images.length >= 3 && images.length <= 8
  const [loading, setLoading] = useState(false)
  const [imgLoading, setImgLoading] = useState(false)
  const [scratchLoading, setScratchLoading] = useState(false)
  const [parseError, setParseError] = useState<string | null>(null)
  const [aiSuggestion, setAiSuggestion] = useState<{
    shape?: ShapeKind
    quadrant?: Quadrant
    labels?: string[]
  } | null>(null)

  const runAi = useCallback(async () => {
    setLoading(true)
    setParseError(null)
    setAiSuggestion(null)
    try {
      const instruction = [
        '你是头像框设计助手。',
        '请根据用户需求和参考元素图片，输出一个 JSON（不要包含 Markdown 代码块），格式为：',
        '{ "shape": "circle|square", "quadrants": ["lt|lb|rt|rb"], "labels": ["..."] }',
        'labels 用于为参考元素命名，长度最多 8，按顺序对应上传的参考图片。',
      ].join('\n')

      const userNeed =
        aiPrompt?.trim() ||
        '请帮我生成一个更好看的头像框设计方案，并给每张参考元素起清晰的名字。'

      const prompt = `${instruction}\n\n用户需求:\n${userNeed}\n\n当前状态:\n- shape=${shape}\n- quadrants=${quadrants.join(',')}\n- images=${images.length}`

      const result = await generateWithGemini({
        model: aiModel,
        text: prompt,
        imageDataUrls: images.map(i => i.dataUrl),
      })

      data.setState(prev => ({ ...prev, aiResult: result }))

      const start = result.indexOf('{')
      const end = result.lastIndexOf('}')
      if (start >= 0 && end > start) {
        const parsed = JSON.parse(result.slice(start, end + 1)) as any
        const parsedQuadrants: Quadrant[] | undefined = Array.isArray(parsed?.quadrants)
          ? parsed.quadrants
          : parsed?.quadrant
            ? [parsed.quadrant]
            : undefined
        setAiSuggestion({
          shape: parsed?.shape,
          quadrant: parsedQuadrants?.[0],
          labels: Array.isArray(parsed?.labels) ? parsed.labels : undefined,
        })
      } else {
        setParseError('AI 返回内容未包含可解析的 JSON。')
      }
    } catch (e: any) {
      setParseError(e?.message || '生成失败')
    }
    setLoading(false)
  }, [aiModel, aiPrompt, data, images, quadrants, shape])

  const applyAi = useCallback(() => {
    if (!aiSuggestion) return
    data.setState(prev => {
      const nextShape = (aiSuggestion.shape as ShapeKind | undefined) ?? prev.shape
      const nextQuadrants = (aiSuggestion.quadrant as Quadrant | undefined)
        ? [aiSuggestion.quadrant as Quadrant]
        : prev.quadrants
      const nextImages =
        aiSuggestion.labels && aiSuggestion.labels.length > 0
          ? prev.images.map((img, idx) => ({
              ...img,
              label: aiSuggestion.labels?.[idx] ?? img.label,
            }))
          : prev.images
      return { ...prev, shape: nextShape, quadrants: nextQuadrants, images: nextImages }
    })
  }, [aiSuggestion, data])

  const generateComposite = useCallback(async () => {
    setImgLoading(true)
    setParseError(null)
    try {
      if (images.length === 0) throw new Error('请先上传参考图片')

      const userNeed =
        aiPrompt?.trim() ||
        '请从参考图里提取主要元素与风格（材质、配色、主题物件、光效），重新设计成一个完整统一的头像框（不是拼图）。'

      const { imageDataUrls, analysisText } = await generateAvatarFrameFromRefs({
        shape,
        quadrants,
        userPrompt: userNeed,
        images: images.map(i => ({ label: i.label, dataUrl: i.dataUrl })),
        model: aiModel,
      })

      data.setState(prev => ({
        ...prev,
        aiResult: analysisText,
        generatedImageDataUrls: imageDataUrls,
      }))
    } catch (e: any) {
      setParseError(e?.message || '合成失败')
    }
    setImgLoading(false)
  }, [aiModel, aiPrompt, data, images, quadrants, shape])

  const generateFromScratch = useCallback(async () => {
    setScratchLoading(true)
    setParseError(null)
    try {
      const first = quadrants[0] || 'lt'
      const q =
        first === 'lt'
          ? 'top-left'
          : first === 'lb'
            ? 'bottom-left'
            : first === 'rt'
              ? 'top-right'
              : 'bottom-right'

      const style = aiPrompt?.trim() || 'high quality, cute, decorative, no text'
      const labels = images
        .map((i, idx) => `${idx + 1}. ${i.label || 'unnamed element'}`)
        .slice(0, 8)
        .join('\n')

      const prompt = [
        'Design an avatar frame PNG (no text) for a profile picture.',
        `Frame shape: ${shape === 'circle' ? 'circle' : 'rounded square'}.`,
        `Decorative element placement quadrant: ${q}.`,
        'Style requirements:',
        style,
        'Reference concepts (optional):',
        labels || '(none)',
      ].join('\n')

      const img = await generateImageWithImagen({
        prompt,
        outputMimeType: 'image/png',
        aspectRatio: '1:1',
        numberOfImages: 1,
      })
      if (!img) throw new Error('图片生成失败：未返回图片数据')
      data.setState(prev => ({ ...prev, generatedImageDataUrls: img }))
    } catch (e: any) {
      setParseError(e?.message || '图片生成失败')
    }
    setScratchLoading(false)
  }, [aiPrompt, data, images, quadrants, shape])

  return (
    <NodeShell title={data.title}>
      <Handle type="target" position={Position.Left} className="!bg-slate-600" />
      <div className="text-xs text-slate-400 mb-3">4) 展示（预览汇总）</div>

      <div className="flex gap-4 items-start">
        <div className="relative">
          <div
            className={`w-40 h-40 border-2 ${
              valid ? 'border-indigo-500' : 'border-slate-600'
            } bg-slate-950/40 ${shape === 'circle' ? 'rounded-full' : 'rounded-2xl'}`}
          />
          <div
            className={`absolute w-10 h-10 rounded-lg border border-slate-700 bg-indigo-500/15`}
            style={{ display: 'none' }}
          />
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
              布局:{' '}
              <span className="text-slate-300">
                {quadrantLabels.length > 0 ? quadrantLabels.join('、') : '未选择'}
              </span>
            </div>
            <div>
              参考元素: <span className="text-slate-300">{images.length}</span> 张{' '}
              {!valid && <span className="text-amber-400">(需要 3–8 张)</span>}
            </div>
          </div>

          {images.length > 0 && (
            <div className="mt-3 grid grid-cols-4 gap-2">
              {images.slice(0, 8).map(img => (
                <div key={img.id} className="group">
                  <img
                    src={img.dataUrl}
                    alt={img.label}
                    className="w-full h-12 object-cover rounded-md border border-slate-800"
                  />
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
                value={aiModel}
                onChange={e =>
                  data.setState(prev => ({
                    ...prev,
                    aiModel: e.target.value as FlowState['aiModel'],
                  }))
                }
                className="rounded-lg bg-slate-900 border border-slate-700 px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
              >
                <option value="gemini-3-flash-preview">Gemini 3</option>
                <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
              </select>
            </div>

            <textarea
              value={aiPrompt}
              onChange={e => data.setState(prev => ({ ...prev, aiPrompt: e.target.value }))}
              rows={3}
              className="mt-2 w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 placeholder:text-slate-500"
              placeholder="描述你想要的头像框风格/元素/氛围（例如：赛博朋克、金属质感、卡通可爱…）"
            />

            <div className="mt-2 flex items-center gap-2">
              <button
                onClick={() => void runAi()}
                disabled={loading || images.length === 0}
                className="rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-900 disabled:text-slate-400 px-3 py-2 text-xs text-white transition"
                title={images.length === 0 ? '请先上传参考元素图片' : '让 AI 给出方案'}
              >
                {loading ? '生成中...' : '点击生成（Gemini）'}
              </button>
              <button
                onClick={applyAi}
                disabled={!aiSuggestion}
                className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-200 hover:border-slate-600 disabled:text-slate-500 disabled:hover:border-slate-700 transition"
              >
                应用 AI 建议
              </button>
              <button
                onClick={() => void generateComposite()}
                disabled={imgLoading}
                className="rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-900 disabled:text-slate-400 px-3 py-2 text-xs text-white transition"
              >
                {imgLoading ? '生成中...' : '生成图片（提取参考元素重设计）'}
              </button>
              <button
                onClick={() => void generateFromScratch()}
                disabled={scratchLoading}
                className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-200 hover:border-slate-600 disabled:text-slate-500 disabled:hover:border-slate-700 transition"
                title="备用：从零生成（可能违背“80%来自参考图”的流程）"
              >
                {scratchLoading ? '生成中...' : '生成图片（从零）'}
              </button>
              {parseError && <div className="text-xs text-amber-400">{parseError}</div>}
            </div>

            {data.state.generatedImageDataUrls.length > 0 && (
              <div className="mt-3">
                <div className="text-[11px] text-slate-500 mb-1">生成结果</div>
                <div className="grid grid-cols-3 gap-2">
                  {data.state.generatedImageDataUrls.slice(0, 3).map((url, idx) => (
                    <div key={idx} className="rounded-xl border border-slate-800 bg-slate-950/40 p-2">
                      <img
                        src={url}
                        alt={`AI 生成头像框 ${idx + 1}`}
                        onError={() => setParseError('图片加载失败（生成结果不是有效的 PNG dataUrl 或被浏览器拦截）')}
                        className="w-full aspect-square rounded-lg object-contain"
                      />
                      <a
                        href={url}
                        download={`avatar-frame-${idx + 1}.png`}
                        className="mt-2 inline-block text-xs text-indigo-400 hover:underline"
                      >
                        下载 PNG
                      </a>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {aiResult?.trim() && (
              <div className="mt-2">
                <div className="text-[11px] text-slate-500 mb-1">AI 输出</div>
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap text-[11px] text-slate-300 bg-slate-950/40 border border-slate-800 rounded-lg p-2">
                  {aiResult}
                </pre>
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

  const setFlowState = useCallback((updater: (prev: FlowState) => FlowState) => {
    onStateChange(updater)
  }, [onStateChange])

  const nodeTypes = useMemo(
    () => ({
      shape: ShapeNode,
      layout: LayoutNode,
      refs: ReferenceElementNode,
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
        id: 'layout',
        type: 'layout',
        position: { x: 420, y: 100 },
        data: { title: '布局', ...common },
      },
      {
        id: 'similarRefs',
        type: 'similarRefs',
        position: { x: 820, y: 100 },
        data: { title: '同类参考', ...common },
      },
      {
        id: 'refs',
        type: 'refs',
        position: { x: 1260, y: 100 },
        data: { title: '参考元素', ...common },
      },
      {
        id: 'preview',
        type: 'preview',
        position: { x: 1700, y: 100 },
        data: { title: '展示', ...common },
      },
    ]
  }, [state, setFlowState])

  const initialEdges = useMemo(
    (): Edge[] => [
      { id: 'e1', source: 'shape', target: 'layout', animated: true, style: { stroke: '#6366f1' } },
      { id: 'e2', source: 'layout', target: 'similarRefs', animated: true, style: { stroke: '#6366f1' } },
      { id: 'e3', source: 'similarRefs', target: 'refs', animated: true, style: { stroke: '#6366f1' } },
      { id: 'e4', source: 'refs', target: 'preview', animated: true, style: { stroke: '#6366f1' } },
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
    <div className="h-full w-full">
      <div className="h-full w-full">
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
          <MiniMap pannable zoomable nodeColor={() => '#6366f1'} maskColor="rgba(2,6,23,0.35)" />
          <Controls />
        </ReactFlow>
      </div>
    </div>
  )
}

