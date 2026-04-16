import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  saveWorkspaceSnapshot,
  clearWorkspaceSnapshot,
  loadWorkspaceSnapshot,
  tryConsumePendingWorkspaceNav,
  OUTPUT_TOOL_DEFAULT_POKE,
  isOutputToolSnapPayloadMeaningful,
  type OutputToolSnapPayload,
} from '../lib/homeWorkspaceSnapshots'
import JSZip from 'jszip'
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
import defaultLayer7Url from '../assets/output-tool-layer7.png'
import { DEFAULT_OUTPUT_TOOL_TEMPLATE } from '../lib/outputToolTemplate'
import {
  drawOutputStyleBottomFadeMask,
  MASK_UI_MAX_FALLOFF,
  MASK_UI_MAX_OPACITY,
  MASK_UI_MAX_REACH,
  MASK_UI_MIN_FALLOFF,
  MASK_UI_MIN_REACH,
} from '../lib/outputStyleMask'
import { generateSimilarReferenceAnalysisWithTIMI } from '../services/gemini'
import {
  PokeFlowContext,
  POKE_ADD_OPTIONS,
  POKE_EDGE_COLOR,
  pokeFlowNodeTypes,
  defaultPokeElementTemplate,
  POKE_MASK_BUILTIN_LAYER,
  type PokeElementTemplateState,
  type PokeFlowCtx,
  type PokeFlowNodeData,
  type PokeRfNodeType,
} from './OutputToolPokeFlow'
import { PokeDeletableBezierEdge } from './OutputToolPokeEdge'
import { RfRangeInput } from './RfRangeInput'
import StageDualFlow from './stageDual/StageDualFlow'

type DataUrlImage = { dataUrl: string; name: string }

type FaceBox = { x: number; y: number; width: number; height: number }

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n))
}

async function fileToDataUrl(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(new Error('read file failed'))
    r.readAsDataURL(file)
  })
}

async function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return await new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('load image failed'))
    img.src = dataUrl
  })
}

function useImageCache() {
  const cacheRef = useRef(new Map<string, Promise<HTMLImageElement>>())
  const get = useCallback((dataUrl: string) => {
    const key = String(dataUrl || '')
    if (!key) return Promise.reject(new Error('empty image'))
    const cache = cacheRef.current
    const hit = cache.get(key)
    if (hit) return hit
    const p = loadImage(key)
    cache.set(key, p)
    return p
  }, [])
  return { get }
}

function drawBackground(ctx: CanvasRenderingContext2D, size: number, theme: { top: string; mid: string; bottom: string; haze: number }) {
  ctx.clearRect(0, 0, size, size)
  const g = ctx.createLinearGradient(0, 0, 0, size)
  g.addColorStop(0, theme.top)
  g.addColorStop(0.45, theme.mid)
  g.addColorStop(1, theme.bottom)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)

  // subtle haze (kept as part of base background)
  if (theme.haze > 0) {
    const rg = ctx.createRadialGradient(size * 0.45, size * 0.15, size * 0.02, size * 0.55, size * 0.25, size * 0.8)
    rg.addColorStop(0, `rgba(255,255,255,${0.22 * theme.haze})`)
    rg.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = rg
    ctx.fillRect(0, 0, size, size)
  }
}

function drawCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  size: number,
  opts: { scale: number; offsetX: number; offsetY: number },
) {
  const s = Math.max(0.2, opts.scale)
  const iw = img.naturalWidth || img.width
  const ih = img.naturalHeight || img.height
  const base = Math.max(size / iw, size / ih)
  const drawW = iw * base * s
  const drawH = ih * base * s
  const x = (size - drawW) / 2 + opts.offsetX
  const y = (size - drawH) / 2 + opts.offsetY
  ctx.drawImage(img, x, y, drawW, drawH)
  return { x, y, w: drawW, h: drawH }
}

function drawLogoWithGlow(
  ctx: CanvasRenderingContext2D,
  logo: HTMLImageElement,
  placement: { x: number; y: number; w: number; h: number },
  glow: { enabled: boolean; color: string; size: number; opacity: number },
) {
  if (glow.enabled && glow.size > 0 && glow.opacity > 0) {
    ctx.save()
    ctx.globalAlpha = clamp(glow.opacity, 0, 1)
    ctx.shadowBlur = clamp(glow.size, 0, 60)
    ctx.shadowColor = glow.color
    ctx.shadowOffsetX = 0
    ctx.shadowOffsetY = 0
    // draw twice for stronger PS-like glow
    ctx.drawImage(logo, placement.x, placement.y, placement.w, placement.h)
    ctx.drawImage(logo, placement.x, placement.y, placement.w, placement.h)
    ctx.restore()
  }
  ctx.drawImage(logo, placement.x, placement.y, placement.w, placement.h)
}

async function detectFace(img: HTMLImageElement): Promise<FaceBox | null> {
  // Use native FaceDetector when available (Chromium)
  const FD = (window as any).FaceDetector as undefined | (new (opts?: any) => any)
  if (!FD) return null
  try {
    const detector = new FD({ fastMode: true, maxDetectedFaces: 1 })
    const faces = await detector.detect(img)
    const bb = faces?.[0]?.boundingBox
    if (!bb) return null
    return { x: bb.x, y: bb.y, width: bb.width, height: bb.height }
  } catch {
    return null
  }
}

function extractFirstJsonObject(text: string): any | null {
  const s = String(text || '').trim()
  if (!s) return null
  try {
    return JSON.parse(s)
  } catch {
    // try to locate the first {...} block
    const start = s.indexOf('{')
    const end = s.lastIndexOf('}')
    if (start >= 0 && end > start) {
      const chunk = s.slice(start, end + 1)
      try {
        return JSON.parse(chunk)
      } catch {
        return null
      }
    }
    return null
  }
}

async function detectFaceWithTIMI(characterDataUrl: string): Promise<FaceBox | null> {
  const prompt = [
    '你是一个视觉检测器。请在图片中找到“主要人物”的脸部（含脸部轮廓+发际线+下巴）。',
    '输出必须是严格 JSON（不要 markdown，不要解释）：',
    '{"face":{"x":number,"y":number,"width":number,"height":number}}',
    '其中 x/y/width/height 都是基于“原图像素坐标系”的像素值（左上角为 0,0）。',
    '如果无法识别脸部，请输出：{"face":null}',
  ].join('\n')

  const out = await generateSimilarReferenceAnalysisWithTIMI({
    prompt,
    imageDataUrls: [characterDataUrl],
  })
  const json = extractFirstJsonObject(out)
  const face = json?.face
  if (!face) return null
  const x = Number(face.x)
  const y = Number(face.y)
  const width = Number(face.width)
  const height = Number(face.height)
  if (![x, y, width, height].every(n => Number.isFinite(n))) return null
  if (width <= 0 || height <= 0) return null
  return { x, y, width, height }
}

type OutputToolFlowCtx = {
  OUT: number
  PREVIEW: number
  character: DataUrlImage | null
  setCharacter: (v: DataUrlImage | null) => void
  logo: DataUrlImage | null
  setLogo: (v: DataUrlImage | null) => void
  layer7: DataUrlImage
  setLayer7: (v: DataUrlImage) => void
  layer7TintBlue: string
  setLayer7TintBlue: (v: string) => void
  layer7TintPurple: string
  setLayer7TintPurple: (v: string) => void
  logoW: number
  setLogoW: (v: number) => void
  logoH: number
  setLogoH: (v: number) => void
  logoMargin: number
  setLogoMargin: (v: number) => void
  glowEnabled: boolean
  setGlowEnabled: (v: boolean) => void
  glowColor: string
  setGlowColor: (v: string) => void
  glowSize: number
  setGlowSize: (v: number) => void
  glowOpacity: number
  setGlowOpacity: (v: number) => void
  charScale: number
  setCharScale: (v: number) => void
  charOffsetX: number
  setCharOffsetX: (v: number) => void
  charOffsetY: number
  setCharOffsetY: (v: number) => void
  faceHint: string
  setFaceHint: (v: string) => void
  previewHint: string
  blueFileName: string
  setBlueFileName: (v: string) => void
  purpleFileName: string
  setPurpleFileName: (v: string) => void
  previewCanvasBlueRef: React.RefObject<HTMLCanvasElement | null>
  previewCanvasPurpleRef: React.RefObject<HTMLCanvasElement | null>
  baseTheme: { top: string; mid: string; bottom: string; haze: number }
  autoFace: () => void
  exportDualPng: () => void | Promise<void>
  exportBlue: () => void | Promise<void>
  exportPurple: () => void | Promise<void>
  onPointerDown: (e: React.PointerEvent<HTMLCanvasElement>) => void
  onPointerMove: (e: React.PointerEvent<HTMLCanvasElement>) => void
  onPointerUp: () => void
  onWheel: (e: React.WheelEvent<HTMLCanvasElement>) => void
  applyDefaultTemplate: () => void
  resetCharacterTransform: () => void
}

type OutputNodeData = {
  title: string
  ctx?: OutputToolFlowCtx
}

function OtShell({ title, children, className = '' }: { title: string; children: ReactNode; className?: string }) {
  return (
    <div
      className={`min-w-[300px] rounded-xl border border-slate-800/42 bg-gradient-to-b from-slate-900/76 to-slate-900/86 shadow-lg shadow-black/25 ${className}`}
    >
      <div className="flex items-center justify-between border-b border-slate-700/22 bg-slate-900/14 px-4 py-3">
        <div className="text-sm font-semibold text-slate-100">{title}</div>
        <div className="text-[11px] text-slate-500">拖拽节点 · 拉线连接</div>
      </div>
      <div className="p-4">{children}</div>
    </div>
  )
}

function OtUploadNode({ data }: NodeProps<OutputNodeData>) {
  const ctx = data.ctx
  if (!ctx) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 min-w-[300px] h-[220px] flex items-center justify-center text-xs text-slate-500">
        加载中…
      </div>
    )
  }
  return (
    <OtShell title={data.title}>
      <Handle id="to-blue" type="source" position={Position.Right} className="!bg-sky-500" style={{ top: '38%' }} />
      <Handle id="to-purple" type="source" position={Position.Right} className="!bg-violet-500" style={{ top: '62%' }} />
      <div className="text-xs text-slate-500 mb-2">角色 / Logo / 中间层（#7）</div>
      <div className="space-y-3">
        <div>
          <div className="text-[11px] text-slate-500 mb-1">角色（#5）</div>
          <label className="block">
            <input
              type="file"
              accept="image/*"
              onChange={async e => {
                const f = e.target.files?.[0]
                if (!f) return
                const dataUrl = await fileToDataUrl(f)
                ctx.setCharacter({ dataUrl, name: f.name })
                ctx.setFaceHint('')
              }}
              className="hidden"
            />
            <div className="rounded-lg border border-slate-700/55 bg-slate-950/34 px-2 py-2 text-xs text-slate-200 hover:border-slate-600/60 hover:bg-slate-950/42 cursor-pointer transition">
              {ctx.character ? `已选：${ctx.character.name}` : '点击上传角色图'}
            </div>
          </label>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void ctx.autoFace()}
              className="rounded-lg border border-slate-700/55 bg-slate-950/22 px-2 py-1.5 text-[11px] text-slate-200 hover:border-slate-600/60 hover:bg-slate-950/32 transition"
            >
              智能识别脸部
            </button>
            <span className="text-[10px] text-slate-500">{ctx.faceHint}</span>
          </div>
        </div>
        <div>
          <div className="text-[11px] text-slate-500 mb-1">Logo（#3）</div>
          <label className="block">
            <input
              type="file"
              accept="image/*"
              onChange={async e => {
                const f = e.target.files?.[0]
                if (!f) return
                const dataUrl = await fileToDataUrl(f)
                ctx.setLogo({ dataUrl, name: f.name })
              }}
              className="hidden"
            />
            <div className="rounded-lg border border-slate-700/55 bg-slate-950/34 px-2 py-2 text-xs text-slate-200 hover:border-slate-600/60 hover:bg-slate-950/42 cursor-pointer transition">
              {ctx.logo ? `已选：${ctx.logo.name}` : '点击上传 Logo'}
            </div>
          </label>
        </div>
        <div>
          <div className="text-[11px] text-slate-500 mb-1">中间层（#7）</div>
          <label className="block">
            <input
              type="file"
              accept="image/*"
              onChange={async e => {
                const f = e.target.files?.[0]
                if (!f) return
                const dataUrl = await fileToDataUrl(f)
                ctx.setLayer7({ dataUrl, name: f.name })
              }}
              className="hidden"
            />
            <div className="rounded-lg border border-slate-700/55 bg-slate-950/34 px-2 py-2 text-xs text-slate-200 hover:border-slate-600/60 hover:bg-slate-950/42 cursor-pointer transition">
              {ctx.layer7 ? `当前：${ctx.layer7.name}` : '上传 #7'}
            </div>
          </label>
        </div>
      </div>
    </OtShell>
  )
}

function OtTemplateBlueNode({ data }: NodeProps<OutputNodeData>) {
  const ctx = data.ctx
  if (!ctx) {
    return <div className="rounded-xl border border-slate-800 bg-slate-900/40 min-w-[300px] h-[180px]" />
  }
  const t = ctx.baseTheme
  return (
    <OtShell title={data.title}>
      <Handle type="target" position={Position.Left} className="!bg-sky-500" />
      <Handle type="source" position={Position.Right} className="!bg-sky-500" />
      <div className="text-xs text-slate-400 mb-2">蓝线：全局 Logo / 外发光 / 尺寸 + 7 号蓝色系着色</div>
      <button
        type="button"
        onClick={() => ctx.applyDefaultTemplate()}
        className="mb-3 w-full rounded-lg border border-indigo-500/40 bg-indigo-500/10 px-2 py-2 text-xs text-indigo-200 hover:bg-indigo-500/15 transition"
      >
        恢复默认模版参数
      </button>
      <div className="rounded-lg border border-slate-800/38 bg-slate-950/32 p-2 text-[10px] text-slate-500 leading-relaxed">
        背景渐变：上 <span className="text-slate-300">{t.top}</span> · 中 <span className="text-slate-300">{t.mid}</span> · 下{' '}
        <span className="text-slate-300">{t.bottom}</span>
        <span className="text-slate-600">（haze {t.haze}）</span>
      </div>
      <div className="mt-3">
        <div className="text-[11px] text-slate-500 mb-1">7 号层着色（蓝线）</div>
        <div className="flex items-center gap-2">
          <input
            value={ctx.layer7TintBlue}
            onChange={e => ctx.setLayer7TintBlue(e.target.value)}
            type="color"
            className="w-12 h-8 rounded-lg bg-slate-950/85 border border-slate-700/50"
          />
          <input
            value={ctx.layer7TintBlue}
            onChange={e => ctx.setLayer7TintBlue(e.target.value)}
            className="flex-1 rounded-lg bg-slate-900/72 border border-slate-700/50 px-2 py-1.5 text-[11px] text-slate-200"
            placeholder="#RRGGBB"
          />
        </div>
        <div className="mt-1 text-[10px] text-slate-500">#FFFFFF 不着色</div>
      </div>
      <div className="mt-3 text-[11px] font-medium text-slate-400">Logo 外发光</div>
      <div className="mt-2 grid grid-cols-2 gap-2 items-center">
        <label className="inline-flex items-center gap-2 text-[11px] text-slate-400 select-none">
          <input type="checkbox" checked={ctx.glowEnabled} onChange={e => ctx.setGlowEnabled(e.target.checked)} className="accent-indigo-500" />
          启用
        </label>
        <input value={ctx.glowColor} onChange={e => ctx.setGlowColor(e.target.value)} type="color" className="w-12 h-8 rounded-lg justify-self-end" />
      </div>
      <div className="mt-2">
        <div className="flex justify-between text-[10px] text-slate-500 mb-0.5">
          <span>宽度</span>
          <span className="text-slate-300 tabular-nums">{ctx.glowSize}</span>
        </div>
        <RfRangeInput
          min={0}
          max={40}
          step={1}
          value={ctx.glowSize}
          onChange={e => ctx.setGlowSize(Number(e.target.value))}
          className="w-full h-1.5 accent-indigo-500"
        />
      </div>
      <div className="mt-2">
        <div className="flex justify-between text-[10px] text-slate-500 mb-0.5">
          <span>透明度</span>
          <span className="text-slate-300 tabular-nums">{Math.round(ctx.glowOpacity * 100)}</span>
        </div>
        <RfRangeInput
          min={0}
          max={1}
          step={0.01}
          value={ctx.glowOpacity}
          onChange={e => ctx.setGlowOpacity(Number(e.target.value))}
          className="w-full h-1.5 accent-indigo-500"
        />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <div>
          <div className="text-[10px] text-slate-500 mb-0.5">Logo 宽</div>
          <input
            value={ctx.logoW}
            onChange={e => ctx.setLogoW(clamp(Number(e.target.value) || 0, 20, 180))}
            className="w-full rounded-lg bg-slate-900/72 border border-slate-700/50 px-2 py-1.5 text-[11px] text-slate-200"
          />
        </div>
        <div>
          <div className="text-[10px] text-slate-500 mb-0.5">Logo 高</div>
          <input
            value={ctx.logoH}
            onChange={e => ctx.setLogoH(clamp(Number(e.target.value) || 0, 10, 120))}
            className="w-full rounded-lg bg-slate-900/72 border border-slate-700/50 px-2 py-1.5 text-[11px] text-slate-200"
          />
        </div>
      </div>
      <div className="mt-2">
        <div className="flex justify-between text-[10px] text-slate-500 mb-0.5">
          <span>右下角边距</span>
          <span className="text-slate-300 tabular-nums">{ctx.logoMargin}px</span>
        </div>
        <RfRangeInput
          min={0}
          max={24}
          step={1}
          value={ctx.logoMargin}
          onChange={e => ctx.setLogoMargin(Number(e.target.value))}
          className="w-full h-1.5 accent-indigo-500"
        />
      </div>
    </OtShell>
  )
}

function OtTemplatePurpleNode({ data }: NodeProps<OutputNodeData>) {
  const ctx = data.ctx
  if (!ctx) {
    return <div className="rounded-xl border border-slate-800 bg-slate-900/40 min-w-[280px] h-[140px]" />
  }
  return (
    <OtShell title={data.title} className="min-w-[280px] border-violet-900/40">
      <Handle type="target" position={Position.Left} className="!bg-violet-500" />
      <Handle type="source" position={Position.Right} className="!bg-violet-500" />
      <div className="text-xs text-slate-400 mb-2">紫线：仅调整 7 号层紫色着色（角色 / Logo / 背景与蓝线共用）</div>
      <div>
        <div className="text-[11px] text-slate-500 mb-1">7 号层着色（紫线）</div>
        <div className="flex items-center gap-2">
          <input
            value={ctx.layer7TintPurple}
            onChange={e => ctx.setLayer7TintPurple(e.target.value)}
            type="color"
            className="w-12 h-8 rounded-lg bg-slate-950/85 border border-slate-700/50"
          />
          <input
            value={ctx.layer7TintPurple}
            onChange={e => ctx.setLayer7TintPurple(e.target.value)}
            className="flex-1 rounded-lg bg-slate-900/72 border border-slate-700/50 px-2 py-1.5 text-[11px] text-slate-200"
            placeholder="#RRGGBB"
          />
        </div>
        <div className="mt-1 text-[10px] text-slate-500">#FFFFFF 不着色</div>
      </div>
    </OtShell>
  )
}

function OtStackNode({ data }: NodeProps<OutputNodeData>) {
  const accent = data.title?.includes('紫') ? 'violet' : 'sky'
  const bar = accent === 'violet' ? '!bg-violet-500' : '!bg-sky-500'
  return (
    <OtShell title={data.title} className="min-w-[240px] max-w-[260px]">
      <Handle type="target" position={Position.Left} className={bar} />
      <Handle type="source" position={Position.Right} className={bar} />
      <div className="rounded-lg border border-dashed border-slate-600/40 bg-slate-950/28 p-3 text-center">
        <div className="text-xs text-slate-300 leading-relaxed">合成顺序（固定）</div>
        <div className="mt-2 text-[11px] text-slate-500 leading-6">
          背景渐变
          <br />
          <span className="text-slate-400">↓</span> 角色层
          <br />
          <span className="text-slate-400">↓</span> 7 号层
          <br />
          <span className="text-slate-400">↓</span> Logo
        </div>
      </div>
    </OtShell>
  )
}

function OtOutputNode({ data }: NodeProps<OutputNodeData>) {
  const ctx = data.ctx
  if (!ctx) {
    return <div className="rounded-xl border border-slate-800 min-w-[780px] h-[420px]" />
  }
  return (
    <OtShell title={data.title} className="min-w-[800px] max-w-[820px]">
      <Handle id="in-merge" type="target" position={Position.Left} className="!bg-indigo-500" style={{ top: '45%' }} />
      <div className="flex flex-col items-stretch gap-3">
        {/* React Flow 默认类名：nowheel / nodrag / nopan — 避免滚轮缩放画布、左键拖节点或拖动画布，仅由下方逻辑控制角色 */}
        <div className="nowheel nodrag nopan rounded-xl border border-slate-700/28 bg-gradient-to-b from-slate-900/42 via-slate-900/45 to-slate-900/52 p-2 shadow-[inset_0_1px_0_0_rgba(56,189,248,0.08)]">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] text-sky-400/90 shrink-0">蓝线</span>
            <input
              type="text"
              value={ctx.blueFileName}
              onChange={e => ctx.setBlueFileName(e.target.value)}
              placeholder="文件名"
              className="flex-1 min-w-0 bg-slate-900/78 border border-slate-700/45 rounded px-2 py-0.5 text-[10px] text-slate-200 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => void ctx.exportBlue()}
              className="rounded-md bg-sky-600 hover:bg-sky-700 px-2 py-0.5 text-[10px] text-white transition shrink-0"
            >
              导出
            </button>
          </div>
          <canvas
            ref={ctx.previewCanvasBlueRef}
            width={ctx.PREVIEW}
            height={ctx.PREVIEW}
            onPointerDown={ctx.onPointerDown}
            onPointerMove={ctx.onPointerMove}
            onPointerUp={ctx.onPointerUp}
            onPointerLeave={ctx.onPointerUp}
            onWheel={ctx.onWheel}
            className="block w-[380px] h-[380px] rounded-lg cursor-grab active:cursor-grabbing touch-none overscroll-contain"
          />
        </div>
        <div className="nowheel nodrag nopan rounded-xl border border-slate-700/28 bg-gradient-to-b from-slate-900/42 via-slate-900/45 to-slate-900/52 p-2 shadow-[inset_0_1px_0_0_rgba(167,139,250,0.08)]">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] text-violet-300/90 shrink-0">紫线</span>
            <input
              type="text"
              value={ctx.purpleFileName}
              onChange={e => ctx.setPurpleFileName(e.target.value)}
              placeholder="文件名"
              className="flex-1 min-w-0 bg-slate-900/78 border border-slate-700/45 rounded px-2 py-0.5 text-[10px] text-slate-200 placeholder:text-slate-600 focus:border-violet-500 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => void ctx.exportPurple()}
              className="rounded-md bg-violet-600 hover:bg-violet-700 px-2 py-0.5 text-[10px] text-white transition shrink-0"
            >
              导出
            </button>
          </div>
          <canvas
            ref={ctx.previewCanvasPurpleRef}
            width={ctx.PREVIEW}
            height={ctx.PREVIEW}
            onPointerDown={ctx.onPointerDown}
            onPointerMove={ctx.onPointerMove}
            onPointerUp={ctx.onPointerUp}
            onPointerLeave={ctx.onPointerUp}
            onWheel={ctx.onWheel}
            className="block w-[380px] h-[380px] rounded-lg cursor-grab active:cursor-grabbing touch-none overscroll-contain"
          />
        </div>
      </div>
      {ctx.previewHint && <div className="mt-2 text-[11px] text-amber-400">{ctx.previewHint}</div>}
      <div className="mt-3 flex justify-center">
        <button
          type="button"
          onClick={() => void ctx.exportDualPng()}
          className="rounded-lg bg-indigo-600 hover:bg-indigo-700 px-6 py-2 text-sm text-white transition"
        >
          一键导出
        </button>
      </div>
    </OtShell>
  )
}


/**
 * 输出工具 · 画布默认间距模板（首次打开 = 平均视图基准）
 * 参考截图：列与列之间留白约 60–80px；上下两路之间约 40–50px；上传/输出相对双路垂直居中。
 */
export const OUTPUT_TOOL_FLOW_LAYOUT_TEMPLATE = {
  /** 中间各列节点大致占位宽度（与 min-w-[300px] 量级一致） */
  nominalNodeWidth: 300,
  /** 列与列之间的水平留白 */
  columnGap: 100,
  canvasMarginLeft: 236, // 56 + 180 (Tab栏宽度)
  /** 蓝线行顶边 */
  rowBlueTop: 56,
  /**
   * 从蓝线行顶到紫线行顶的增量 = 蓝线侧「主高度锚点」+ 两路之间空隙。
   * 锚点按「模版 1」偏高、其余列齐顶对齐的观感取值，使紫线整体更贴近蓝线（避免过疏）。
   */
  blueRowAnchorHeight: 100,
  rowGapBetweenPaths: 340,
  /** 紫线行底边估算（用于整条工作流的垂直范围与居中） */
  purpleRowAnchorHeight: 280,
  /** 上传节点：中心对齐工作流垂直中点时，顶边 = 中点 − 半高 */
  uploadHalfHeight: 112,
  /** 输出预览节点更高，顶边 = 中点 − 半高 */
  outputHalfHeight: 268,
  /** 输出列与模版列之间的额外水平留白 */
  outputColumnExtraGap: 80,
} as const

function flowLayoutColumnStep() {
  const t = OUTPUT_TOOL_FLOW_LAYOUT_TEMPLATE
  return t.nominalNodeWidth + t.columnGap
}

function buildAverageOutputToolNodes(base: Node<OutputNodeData>[]): Node<OutputNodeData>[] {
  const t = OUTPUT_TOOL_FLOW_LAYOUT_TEMPLATE
  const step = flowLayoutColumnStep()
  const x0 = t.canvasMarginLeft
  const x1 = x0 + step
  const x2 = x1 + step

  const yBlue = t.rowBlueTop
  const yPurple = t.rowBlueTop + t.blueRowAnchorHeight + t.rowGapBetweenPaths

  const pos: Record<string, { x: number; y: number }> = {
    upload: { x: x0 + 10, y: yBlue },
    tplBlue: { x: x1, y: yBlue },
    tplPurple: { x: x1, y: yPurple + 300 - 100 - 20 - 20 },
    output: { x: x2 + t.outputColumnExtraGap - 60, y: yBlue },
  }
  return base.map(n => {
    const p = pos[n.id]
    return p ? { ...n, position: { ...p } } : n
  })
}

const STATIC_OT_NODES: Node<OutputNodeData>[] = buildAverageOutputToolNodes([
  { id: 'upload', type: 'otUpload', position: { x: 0, y: 0 }, data: { title: '上传资源' } },
  { id: 'tplBlue', type: 'otTemplateBlue', position: { x: 0, y: 0 }, data: { title: '模版 1（蓝色·着色层）' } },
  { id: 'tplPurple', type: 'otTemplatePurple', position: { x: 0, y: 0 }, data: { title: '模版 2（紫色·着色层）' } },
  { id: 'output', type: 'otOutput', position: { x: 0, y: 0 }, data: { title: '输出资源（2 张对比）' } },
])

const OT_INITIAL_EDGES: Edge[] = [
  { id: 'ot-u-b', source: 'upload', sourceHandle: 'to-blue', target: 'tplBlue', animated: true, style: { stroke: '#38bdf8' } },
  { id: 'ot-u-p', source: 'upload', sourceHandle: 'to-purple', target: 'tplPurple', animated: true, style: { stroke: '#a78bfa' } },
  { id: 'ot-b1', source: 'tplBlue', target: 'output', targetHandle: 'in-merge', animated: true, style: { stroke: '#38bdf8' } },
  { id: 'ot-p1', source: 'tplPurple', target: 'output', targetHandle: 'in-merge', animated: true, style: { stroke: '#a78bfa' } },
]

/** 输出工具 Tab 定义 */
type OutputToolTabId =
  | 'signature_gift'
  | 'poke'
  | 'stage_dual'
  | 'signature_peripheral'
  | 'button_bundle'
  | 'legend_broadcast'
  | 'honor_broadcast'
  | 'mall_discount'
  | 'mall_gift_request'
  | `camp:${string}`

interface OutputToolTab {
  id: OutputToolTabId
  name: string
  built: boolean // 是否已搭建
}

/** 王者国内 · 个性资源模板 */
const OUTPUT_TOOL_TABS: OutputToolTab[] = [
  { id: 'signature_gift', name: '签名·端外索赠图', built: true },
  { id: 'poke', name: '戳戳·配套图', built: true },
  { id: 'stage_dual', name: '模板搭建', built: true },
  { id: 'signature_peripheral', name: '签名·周边图', built: true },
  { id: 'button_bundle', name: '按键·配套图', built: true },
  { id: 'legend_broadcast', name: '传说播报·配套图', built: true },
  { id: 'honor_broadcast', name: '荣耀播报·配套图', built: true },
]

/** 王者国内 · 商城模板 */
const OUTPUT_TOOL_MALL_TABS: OutputToolTab[] = [
  { id: 'mall_discount', name: '特惠图', built: false },
  { id: 'mall_gift_request', name: '索赠图', built: false },
]

const OUTPUT_TOOL_ASSET_TAB_IDS = new Set(OUTPUT_TOOL_TABS.map(t => t.id))
const OUTPUT_TOOL_MALL_TAB_IDS = new Set(OUTPUT_TOOL_MALL_TABS.map(t => t.id))
const OUTPUT_TOOL_STAGE_DUAL_LIKE_TABS = new Set<OutputToolTabId>([
  'poke',
  'stage_dual',
  'signature_peripheral',
  'button_bundle',
  'legend_broadcast',
  'honor_broadcast',
])

export default function OutputTool() {
  const [activeTab, setActiveTab] = useState<OutputToolTabId>('signature_gift')
  const [templateChannel, setTemplateChannel] = useState<'wz-domestic' | 'wz-camp'>('wz-domestic')
  const [wzDomesticSection, setWzDomesticSection] = useState<'assets' | 'mall'>('assets')
  const [wzDomesticSectionOpen, setWzDomesticSectionOpen] = useState(false)
  const [tplChannelOpen, setTplChannelOpen] = useState(false)
  const tplChannelBtnRef = useRef<HTMLButtonElement | null>(null)
  const wzSectionBtnRef = useRef<HTMLButtonElement | null>(null)
  const [ctxMenu, setCtxMenu] = useState<null | { x: number; y: number }>(null)
  const isStageDualLikeTab =
    templateChannel === 'wz-camp' ? true : OUTPUT_TOOL_STAGE_DUAL_LIKE_TABS.has(activeTab)

  // ── 王者营地：可新增/改名的模板切页 ───────────────────────────────────────
  const CAMP_TABS_STORAGE_KEY = 'outputToolCampTabs:v1'
  const [campTabs, setCampTabs] = useState<Array<{ id: OutputToolTabId; name: string }>>(() => {
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(CAMP_TABS_STORAGE_KEY) : null
      if (raw) {
        const parsed = JSON.parse(raw) as unknown
        if (Array.isArray(parsed)) {
          const cleaned = parsed
            .map((t: any) => ({
              id: typeof t?.id === 'string' && t.id.startsWith('camp:') ? (t.id as OutputToolTabId) : null,
              name: typeof t?.name === 'string' ? t.name : '',
            }))
            .filter((t: any) => t.id && t.name)
          if (cleaned.length > 0) return cleaned
        }
      }
    } catch {
      /* ignore */
    }
    return [{ id: 'camp:template-1', name: '模板 1' }]
  })
  const [campRenamingId, setCampRenamingId] = useState<OutputToolTabId | null>(null)
  const [campNameDraft, setCampNameDraft] = useState('')

  useEffect(() => {
    try {
      if (typeof localStorage === 'undefined') return
      localStorage.setItem(CAMP_TABS_STORAGE_KEY, JSON.stringify(campTabs))
    } catch {
      /* ignore */
    }
  }, [campTabs])

  useEffect(() => {
    if (templateChannel === 'wz-camp') setCtxMenu(null)
    if (templateChannel === 'wz-camp') setWzDomesticSection('assets')
    if (templateChannel === 'wz-camp') setWzDomesticSectionOpen(false)
    if (templateChannel === 'wz-camp') {
      setActiveTab(cur => {
        if (typeof cur === 'string' && cur.startsWith('camp:')) return cur
        return campTabs[0]?.id ?? 'camp:template-1'
      })
    } else {
      setActiveTab(cur => (typeof cur === 'string' && cur.startsWith('camp:') ? 'signature_gift' : cur))
    }
  }, [templateChannel])

  const addCampTemplateTab = useCallback(() => {
    const id = `camp:${Date.now()}` as const
    const base = '新模板'
    const existing = new Set(campTabs.map(t => t.name))
    let name = base
    let i = 2
    while (existing.has(name)) {
      name = `${base} ${i}`
      i += 1
    }
    setCampTabs(prev => [...prev, { id: id as OutputToolTabId, name }])
    setActiveTab(id as OutputToolTabId)
    setCampRenamingId(id as OutputToolTabId)
    setCampNameDraft(name)
  }, [campTabs])

  const commitCampRename = useCallback(
    (id: OutputToolTabId, nextName: string) => {
      const trimmed = nextName.trim()
      if (!trimmed) return
      setCampTabs(prev => prev.map(t => (t.id === id ? { ...t, name: trimmed } : t)))
    },
    [setCampTabs],
  )

  const OUT = 190
  const PREVIEW = 380

  // Derived from 图一红框（1009×1007）：
  // bbox=(154,129)-(494,477) => w=341 h=349, center=(324,303)
  // normalized => cx≈0.321, cy≈0.301, w≈0.338, h≈0.347
  const FACE_TARGET = useMemo(
    () => ({
      cx: 0.321,
      cy: 0.301,
      w: 0.338,
      h: 0.347,
    }),
    [],
  )

  const [character, setCharacter] = useState<DataUrlImage | null>(null)
  const [logo, setLogo] = useState<DataUrlImage | null>(null)
  const [layer7, setLayer7] = useState<DataUrlImage>(() => ({ dataUrl: defaultLayer7Url, name: '内置素材（7号）' }))
  const [layer7TintBlue, setLayer7TintBlue] = useState(DEFAULT_OUTPUT_TOOL_TEMPLATE.layer7.tint)
  const [layer7TintPurple, setLayer7TintPurple] = useState(DEFAULT_OUTPUT_TOOL_TEMPLATE.layer7.tintPurple)

  // Base background (fixed for now; we'll redesign the "quality" system next)
  const baseTheme = useMemo(
    () => DEFAULT_OUTPUT_TOOL_TEMPLATE.background,
    [],
  )

  const [logoW, setLogoW] = useState(DEFAULT_OUTPUT_TOOL_TEMPLATE.logo.width)
  const [logoH, setLogoH] = useState(DEFAULT_OUTPUT_TOOL_TEMPLATE.logo.height)
  const [logoMargin, setLogoMargin] = useState(DEFAULT_OUTPUT_TOOL_TEMPLATE.logo.margin)
  const [glowEnabled, setGlowEnabled] = useState(DEFAULT_OUTPUT_TOOL_TEMPLATE.logo.glow.enabled)
  const [glowColor, setGlowColor] = useState(DEFAULT_OUTPUT_TOOL_TEMPLATE.logo.glow.color)
  const [glowSize, setGlowSize] = useState(DEFAULT_OUTPUT_TOOL_TEMPLATE.logo.glow.size)
  const [glowOpacity, setGlowOpacity] = useState(DEFAULT_OUTPUT_TOOL_TEMPLATE.logo.glow.opacity)

  const [charScale, setCharScale] = useState(DEFAULT_OUTPUT_TOOL_TEMPLATE.character.scale)
  const [charOffsetX, setCharOffsetX] = useState(DEFAULT_OUTPUT_TOOL_TEMPLATE.character.offsetX)
  const [charOffsetY, setCharOffsetY] = useState(DEFAULT_OUTPUT_TOOL_TEMPLATE.character.offsetY)
  const [faceHint, setFaceHint] = useState<string>('')
  const [previewHint, setPreviewHint] = useState<string>('')
  /** 导出文件名（不含扩展名） */
  const [blueFileName, setBlueFileName] = useState('output-blue')
  const [purpleFileName, setPurpleFileName] = useState('output-purple')

  // ── 戳戳配套图状态 ───────────────────────────────────────────────────────
  const [pokeBgColor, setPokeBgColor] = useState('#1a1a2e')
  const [pokeText1, setPokeText1] = useState('')
  const [pokeText2, setPokeText2] = useState('')

  useEffect(() => {
    setPokeText1(t => (t === '戳戳' ? '' : t))
    setPokeText2(t => (t === '快乐时刻' ? '' : t))
  }, [])
  const [pokeFontSize, setPokeFontSize] = useState(36)
  const [pokeFontColor, setPokeFontColor] = useState('#ffffff')
  const [pokeMultiSizeDraft, setPokeMultiSizeDraft] = useState('1080×1080\n750×1334\n512×512')
  const [pokeMaskColor, setPokeMaskColor] = useState('#000000')
  const [pokeMaskOpacity, setPokeMaskOpacity] = useState(0)
  const [pokeMaskLayer, setPokeMaskLayer] = useState<DataUrlImage>(() => ({ ...POKE_MASK_BUILTIN_LAYER }))
  const [pokeMaskReach, setPokeMaskReach] = useState(0.76)
  const [pokeMaskFalloff, setPokeMaskFalloff] = useState(1)
  const [pokeOutputW, setPokeOutputW] = useState(400)
  const [pokeOutputH, setPokeOutputH] = useState(400)
  const [pokeNodes, setPokeNodes, onPokeNodesChange] = useNodesState<PokeFlowNodeData>([])
  const [pokeEdges, setPokeEdges, onPokeEdgesChange] = useEdgesState<Edge>([])
  const [pokeNodeCtxMenu, setPokeNodeCtxMenu] = useState<{
    x: number
    y: number
    nodeId: string
  } | null>(null)
  const previewCanvasPokeRef = useRef<HTMLCanvasElement | null>(null)
  /** 与异步 render 解耦：人物自然尺寸在图片加载后即可用于滚轮缩放（charMetaRef 仅在后端 render 成功后才写入，容易一直为 null） */
  const [charNaturalSize, setCharNaturalSize] = useState<{ iw: number; ih: number } | null>(null)
  const [debugCharRect, setDebugCharRect] = useState<null | { x: number; y: number; w: number; h: number }>(null)

  const [dragging, setDragging] = useState(false)
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null)
  const charMetaRef = useRef<null | { iw: number; ih: number }>(null)

  const previewCanvasBlueRef = useRef<HTMLCanvasElement | null>(null)
  const previewCanvasPurpleRef = useRef<HTMLCanvasElement | null>(null)
  /** 供原生 wheel（passive: false）读取最新缩放/位移，避免滚轮穿透导致整页滚动 */
  const previewWheelStateRef = useRef({
    character: null as DataUrlImage | null,
    charScale: 1,
    charOffsetX: 0,
    charOffsetY: 0,
    previewSize: PREVIEW,
    charNaturalSize: null as { iw: number; ih: number } | null,
  })
  const { get: getCachedImage } = useImageCache()

  useEffect(() => {
    if (!character?.dataUrl) {
      setCharNaturalSize(null)
      return
    }
    let cancelled = false
    void getCachedImage(character.dataUrl).then(img => {
      if (cancelled) return
      const iw = img.naturalWidth || img.width
      const ih = img.naturalHeight || img.height
      if (iw > 0 && ih > 0) setCharNaturalSize({ iw, ih })
      else setCharNaturalSize(null)
    }).catch(() => {
      if (!cancelled) setCharNaturalSize(null)
    })
    return () => {
      cancelled = true
    }
  }, [character?.dataUrl, getCachedImage])

  useLayoutEffect(() => {
    const pending = tryConsumePendingWorkspaceNav('output-tool')
    const snap = loadWorkspaceSnapshot('output-tool')
    const p = snap?.payload as OutputToolSnapPayload | null
    if (!p || typeof p !== 'object') return
    if (!pending && !isOutputToolSnapPayloadMeaningful(p)) return
    setActiveTab((p.activeTab as OutputToolTabId) || 'signature_gift')
    setTemplateChannel(p.templateChannel === 'wz-camp' ? 'wz-camp' : 'wz-domestic')
    setWzDomesticSection(p.wzDomesticSection === 'mall' ? 'mall' : 'assets')
    setCharacter(p.character)
    setLogo(p.logo)
    setLayer7(p.layer7 || { dataUrl: defaultLayer7Url, name: '内置素材（7号）' })
    setLayer7TintBlue(p.layer7TintBlue ?? DEFAULT_OUTPUT_TOOL_TEMPLATE.layer7.tint)
    setLayer7TintPurple(p.layer7TintPurple ?? DEFAULT_OUTPUT_TOOL_TEMPLATE.layer7.tintPurple)
    setLogoW(p.logoW ?? DEFAULT_OUTPUT_TOOL_TEMPLATE.logo.width)
    setLogoH(p.logoH ?? DEFAULT_OUTPUT_TOOL_TEMPLATE.logo.height)
    setLogoMargin(p.logoMargin ?? DEFAULT_OUTPUT_TOOL_TEMPLATE.logo.margin)
    setGlowEnabled(p.glowEnabled ?? DEFAULT_OUTPUT_TOOL_TEMPLATE.logo.glow.enabled)
    setGlowColor(p.glowColor ?? DEFAULT_OUTPUT_TOOL_TEMPLATE.logo.glow.color)
    setGlowSize(p.glowSize ?? DEFAULT_OUTPUT_TOOL_TEMPLATE.logo.glow.size)
    setGlowOpacity(p.glowOpacity ?? DEFAULT_OUTPUT_TOOL_TEMPLATE.logo.glow.opacity)
    setCharScale(p.charScale ?? DEFAULT_OUTPUT_TOOL_TEMPLATE.character.scale)
    setCharOffsetX(p.charOffsetX ?? DEFAULT_OUTPUT_TOOL_TEMPLATE.character.offsetX)
    setCharOffsetY(p.charOffsetY ?? DEFAULT_OUTPUT_TOOL_TEMPLATE.character.offsetY)
    setBlueFileName(p.blueFileName || 'output-blue')
    setPurpleFileName(p.purpleFileName || 'output-purple')
    if (typeof p.pokeOutputW === 'number' && p.pokeOutputW >= 32 && p.pokeOutputW <= 4096) {
      setPokeOutputW(Math.round(p.pokeOutputW))
    }
    if (typeof p.pokeOutputH === 'number' && p.pokeOutputH >= 32 && p.pokeOutputH <= 4096) {
      setPokeOutputH(Math.round(p.pokeOutputH))
    }
    if (typeof p.pokeBgColor === 'string' && p.pokeBgColor) setPokeBgColor(p.pokeBgColor)
    if (typeof p.pokeText1 === 'string') {
      setPokeText1(p.pokeText1 === '戳戳' ? '' : p.pokeText1)
    }
    if (typeof p.pokeText2 === 'string') {
      setPokeText2(p.pokeText2 === '快乐时刻' ? '' : p.pokeText2)
    }
    if (typeof p.pokeFontSize === 'number' && p.pokeFontSize >= 8 && p.pokeFontSize <= 200) {
      setPokeFontSize(Math.round(p.pokeFontSize))
    }
    if (typeof p.pokeFontColor === 'string' && p.pokeFontColor) setPokeFontColor(p.pokeFontColor)
    if (typeof p.pokeMultiSizeDraft === 'string') setPokeMultiSizeDraft(p.pokeMultiSizeDraft)
    if (typeof p.pokeMaskColor === 'string' && p.pokeMaskColor) setPokeMaskColor(p.pokeMaskColor)
    if (p.pokeMaskLayer?.dataUrl) {
      setPokeMaskLayer({
        dataUrl: p.pokeMaskLayer.dataUrl,
        name: typeof p.pokeMaskLayer.name === 'string' ? p.pokeMaskLayer.name : '遮罩底图',
      })
    }
    let nextOp =
      typeof p.pokeMaskOpacity === 'number' && !Number.isNaN(p.pokeMaskOpacity) ? p.pokeMaskOpacity : 0
    let nextReach =
      typeof p.pokeMaskReach === 'number' && !Number.isNaN(p.pokeMaskReach) ? p.pokeMaskReach : 0.76
    let nextFall =
      typeof p.pokeMaskFalloff === 'number' && !Number.isNaN(p.pokeMaskFalloff) ? p.pokeMaskFalloff : 1
    if (!p.pokeMaskSliderRangeV2) {
      if (nextReach <= 1.0001) nextReach *= 2
      if (nextOp > 0 && nextOp <= 1.0001) nextOp *= 2
    }
    setPokeMaskOpacity(clamp(nextOp, 0, MASK_UI_MAX_OPACITY))
    setPokeMaskReach(clamp(nextReach, MASK_UI_MIN_REACH, MASK_UI_MAX_REACH))
    setPokeMaskFalloff(clamp(nextFall, MASK_UI_MIN_FALLOFF, MASK_UI_MAX_FALLOFF))
    if (Array.isArray(p.pokeNodes) && p.pokeNodes.length > 0) {
      setPokeNodes(p.pokeNodes as Node<PokeFlowNodeData>[])
      if (Array.isArray(p.pokeEdges)) setPokeEdges(p.pokeEdges as Edge[])
    } else if (p.pokeElementLayer?.dataUrl) {
      setPokeNodes([
        {
          id: `poke-el-mig-${Date.now()}`,
          type: 'otPokeElement',
          position: { x: 120, y: 220 },
          data: {
            title: '元素模板',
            elementTemplate: { ...defaultPokeElementTemplate(), layer: p.pokeElementLayer },
          },
        },
      ])
    }
  }, [])

  const offscreenPreviewRef = useRef<HTMLCanvasElement | null>(null)
  const offscreenOutRef = useRef<HTMLCanvasElement | null>(null)
  const tintCanvasRef = useRef<HTMLCanvasElement | null>(null)

  const rafRef = useRef<number | null>(null)
  const inFlightRef = useRef(false)
  const pendingRef = useRef(false)

  type RenderFrameOpts = {
    layer7TintOverride?: string
    writeCharMeta?: boolean
    writeDebugRect?: boolean
    updatePreviewHint?: boolean
  }

  const render = useCallback(
    async (size: number, target?: HTMLCanvasElement, frameOpts?: RenderFrameOpts) => {
      const tintBlend = String(frameOpts?.layer7TintOverride ?? layer7TintBlue).trim()
      const writeMeta = frameOpts?.writeCharMeta !== false
      const writeDbg = frameOpts?.writeDebugRect !== false
      const updHint = frameOpts?.updatePreviewHint !== false

      // render to offscreen first, then blit to target in one paint
      const off =
        size === PREVIEW
          ? (offscreenPreviewRef.current || (offscreenPreviewRef.current = document.createElement('canvas')))
          : (offscreenOutRef.current || (offscreenOutRef.current = document.createElement('canvas')))

      if (off.width !== size) off.width = size
      if (off.height !== size) off.height = size
      const octx = off.getContext('2d')
      if (!octx) return off

      // preload images (avoid partial paints caused by await between draws)
      const [charImg, layer7Img, logoImg] = await Promise.all([
        character?.dataUrl ? getCachedImage(character.dataUrl).catch(() => null) : Promise.resolve(null),
        layer7?.dataUrl ? getCachedImage(layer7.dataUrl).catch(() => null) : Promise.resolve(null),
        logo?.dataUrl ? getCachedImage(logo.dataUrl).catch(() => null) : Promise.resolve(null),
      ])

      drawBackground(octx, size, baseTheme)

      // character
      if (charImg) {
        if (writeMeta && target && size === PREVIEW) {
          const iw = charImg.naturalWidth || charImg.width
          const ih = charImg.naturalHeight || charImg.height
          if (iw > 0 && ih > 0) charMetaRef.current = { iw, ih }
        }
        const rect = drawCover(octx, charImg, size, {
          scale: charScale,
          offsetX: (charOffsetX / PREVIEW) * size,
          offsetY: (charOffsetY / PREVIEW) * size,
        })
        if (writeDbg && target && size === PREVIEW) setDebugCharRect(rect)
      } else {
        if (writeDbg && target && size === PREVIEW) setDebugCharRect(null)
      }

      // layer7 (optional tint; isolated)
      if (layer7Img) {
        const tint = tintBlend
        if (/^#[0-9a-fA-F]{6}$/.test(tint) && tint.toUpperCase() !== '#FFFFFF') {
          const tc = tintCanvasRef.current || (tintCanvasRef.current = document.createElement('canvas'))
          if (tc.width !== size) tc.width = size
          if (tc.height !== size) tc.height = size
          const tctx = tc.getContext('2d')
          if (tctx) {
            tctx.clearRect(0, 0, size, size)
            tctx.drawImage(layer7Img, 0, 0, size, size)
            tctx.globalCompositeOperation = 'multiply'
            tctx.fillStyle = tint
            tctx.fillRect(0, 0, size, size)
            tctx.globalCompositeOperation = 'destination-in'
            tctx.drawImage(layer7Img, 0, 0, size, size)
            tctx.globalCompositeOperation = 'source-over'
            octx.drawImage(tc, 0, 0)
          } else {
            octx.drawImage(layer7Img, 0, 0, size, size)
          }
        } else {
          octx.drawImage(layer7Img, 0, 0, size, size)
        }
      }

      if (logoImg) {
        const w = (logoW / OUT) * size
        const h = (logoH / OUT) * size
        const m = (logoMargin / OUT) * size
        const x = size - w - m
        const y = size - h - m
        drawLogoWithGlow(
          octx,
          logoImg,
          { x, y, w, h },
          { enabled: glowEnabled, color: glowColor, size: (glowSize / OUT) * size, opacity: glowOpacity },
        )
      }

      if (target) {
        // blit in one go to reduce flicker
        const ctx = target.getContext('2d')
        if (ctx) {
          ctx.clearRect(0, 0, size, size)
          ctx.drawImage(off, 0, 0)
        }
        // hint updates: only when missing/failed (avoid re-render loops during drag)
        if (updHint) {
          if (!character?.dataUrl) setPreviewHint('未上传角色图（#5）')
          else if (!charImg) setPreviewHint('角色图加载失败')
          else setPreviewHint('')
        }
        return target
      }

      return off
    },
    [
      baseTheme,
      charOffsetX,
      charOffsetY,
      charScale,
      character?.dataUrl,
      glowColor,
      glowEnabled,
      glowOpacity,
      glowSize,
      getCachedImage,
      layer7?.dataUrl,
      layer7TintBlue,
      logo?.dataUrl,
      logoH,
      logoMargin,
      logoW,
    ],
  )

  const persistOutputWorkspaceRef = useRef<() => void>(() => {})
  persistOutputWorkspaceRef.current = () => {
    const pokeTouched =
      pokeBgColor !== OUTPUT_TOOL_DEFAULT_POKE.bg ||
      pokeText1 !== OUTPUT_TOOL_DEFAULT_POKE.text1 ||
      pokeText2 !== OUTPUT_TOOL_DEFAULT_POKE.text2 ||
      pokeMultiSizeDraft.trim() !== OUTPUT_TOOL_DEFAULT_POKE.draft ||
      pokeOutputW !== OUTPUT_TOOL_DEFAULT_POKE.outW ||
      pokeOutputH !== OUTPUT_TOOL_DEFAULT_POKE.outH ||
      pokeMaskOpacity > 0.001 ||
      pokeMaskReach !== 0.76 ||
      pokeMaskFalloff !== 1 ||
      pokeMaskLayer.dataUrl !== POKE_MASK_BUILTIN_LAYER.dataUrl
    const hasPokeElement = pokeNodes.some(
      n => n.type === 'otPokeElement' && !!n.data.elementTemplate?.layer?.dataUrl,
    )
    const hasWork = !!(character?.dataUrl || logo?.dataUrl || hasPokeElement) || pokeTouched
    if (!hasWork) {
      clearWorkspaceSnapshot('output-tool')
      return
    }
    const payload: OutputToolSnapPayload = {
      activeTab,
      templateChannel,
      wzDomesticSection,
      character,
      logo,
      layer7,
      layer7TintBlue,
      layer7TintPurple,
      logoW,
      logoH,
      logoMargin,
      glowEnabled,
      glowColor,
      glowSize,
      glowOpacity,
      charScale,
      charOffsetX,
      charOffsetY,
      blueFileName,
      purpleFileName,
      pokeOutputW,
      pokeOutputH,
      pokeBgColor,
      pokeText1,
      pokeText2,
      pokeFontSize,
      pokeFontColor,
      pokeMultiSizeDraft,
      pokeMaskColor,
      pokeMaskOpacity,
      pokeMaskLayer,
      pokeMaskReach,
      pokeMaskFalloff,
      pokeMaskSliderRangeV2: true,
      pokeNodes,
      pokeEdges,
    }
    const firstElUrl = pokeNodes.find(
      n => n.type === 'otPokeElement' && n.data.elementTemplate?.layer?.dataUrl,
    )?.data.elementTemplate?.layer?.dataUrl
    const thumb = character?.dataUrl || logo?.dataUrl || firstElUrl
    const tabName =
      [...OUTPUT_TOOL_TABS, ...OUTPUT_TOOL_MALL_TABS].find((t) => t.id === activeTab)?.name || '输出工具'
    saveWorkspaceSnapshot({
      source: 'output-tool',
      updatedAt: Date.now(),
      title: '输出工具',
      subtitle: tabName,
      thumbDataUrl: thumb && thumb.length < 120_000 ? thumb : undefined,
      payload,
      hasWork: true,
    })
  }

  useEffect(() => {
    const id = window.setTimeout(() => persistOutputWorkspaceRef.current(), 400)
    return () => clearTimeout(id)
  }, [
    activeTab,
    templateChannel,
    wzDomesticSection,
    character,
    logo,
    layer7,
    layer7TintBlue,
    layer7TintPurple,
    logoW,
    logoH,
    logoMargin,
    glowEnabled,
    glowColor,
    glowSize,
    glowOpacity,
    charScale,
    charOffsetX,
    charOffsetY,
    blueFileName,
    purpleFileName,
    pokeOutputW,
    pokeOutputH,
    pokeBgColor,
    pokeText1,
    pokeText2,
    pokeFontSize,
    pokeFontColor,
    pokeMultiSizeDraft,
    pokeMaskColor,
    pokeMaskOpacity,
    pokeMaskLayer,
    pokeMaskReach,
    pokeMaskFalloff,
    pokeNodes,
    pokeEdges,
  ])

  useEffect(() => {
    const flush = () => persistOutputWorkspaceRef.current()
    window.addEventListener('pagehide', flush)
    window.addEventListener('beforeunload', flush)
    return () => {
      window.removeEventListener('pagehide', flush)
      window.removeEventListener('beforeunload', flush)
    }
  }, [])

  // live preview（蓝 / 紫 双画布）
  useEffect(() => {
    const canvasB = previewCanvasBlueRef.current
    const canvasP = previewCanvasPurpleRef.current
    if (!canvasB || !canvasP) return
    // schedule with rAF to coalesce frequent updates
    const schedule = () => {
      if (rafRef.current != null) return
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null
        if (inFlightRef.current) {
          pendingRef.current = true
          return
        }
        inFlightRef.current = true
        void (async () => {
          try {
            await render(PREVIEW, canvasB, { layer7TintOverride: layer7TintBlue })
            await render(PREVIEW, canvasP, {
              layer7TintOverride: layer7TintPurple,
              writeCharMeta: false,
              writeDebugRect: false,
              updatePreviewHint: false,
            })
          } catch {
            // ignore preview render errors
          } finally {
            inFlightRef.current = false
            if (pendingRef.current) {
              pendingRef.current = false
              schedule()
            }
          }
        })()
      })
    }

    schedule()
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
      pendingRef.current = false
    }
  }, [render, layer7TintBlue, layer7TintPurple])

  // draw debug overlays on preview
  useEffect(() => {
    const canvas = previewCanvasBlueRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    if (!debugCharRect) return
    // draw a rectangle overlay without disturbing main render too much:
    // re-render already draws base; overlay here is best-effort (only preview)
    ctx.save()
    ctx.globalCompositeOperation = 'source-over'
    ctx.strokeStyle = 'rgba(255, 80, 80, 0.75)'
    ctx.lineWidth = 2
    ctx.setLineDash([6, 4])
    ctx.strokeRect(debugCharRect.x, debugCharRect.y, debugCharRect.w, debugCharRect.h)
    ctx.restore()
  }, [debugCharRect])

  const autoFace = useCallback(async () => {
    if (!character?.dataUrl) {
      setFaceHint('请先上传角色图')
      return
    }
    setFaceHint('识别中...')
    try {
      const img = await loadImage(character.dataUrl)
      // default: TIMI chat (fallback: native FaceDetector)
      let face: FaceBox | null = null
      try {
        face = await detectFaceWithTIMI(character.dataUrl)
      } catch {
        face = null
      }
      if (!face) face = await detectFace(img)
      if (!face) {
        setFaceHint('未识别到脸部：可用鼠标拖拽手动调整')
        return
      }
      const cx = face.x + face.width / 2
      const cy = face.y + face.height / 2

      const iw = img.naturalWidth || img.width
      const ih = img.naturalHeight || img.height
      const base = Math.max(OUT / iw, OUT / ih)
      const targetFaceW = OUT * FACE_TARGET.w
      const targetFaceH = OUT * FACE_TARGET.h
      const scaleFromW = targetFaceW / (face.width * base)
      const scaleFromH = targetFaceH / (face.height * base)
      const newScale = clamp(Math.max(scaleFromW, scaleFromH), 0.7, 2.4)
      setCharScale(newScale)

      const drawW = iw * base * newScale
      const drawH = ih * base * newScale

      const targetCx = OUT * FACE_TARGET.cx
      const targetCy = OUT * FACE_TARGET.cy
      const drawX = (OUT - drawW) / 2
      const drawY = (OUT - drawH) / 2
      const facePx = drawX + cx * base * newScale
      const facePy = drawY + cy * base * newScale

      const dx = (targetCx - facePx) * (PREVIEW / OUT)
      const dy = (targetCy - facePy) * (PREVIEW / OUT)
      setCharOffsetX(clamp(dx, -220, 220))
      setCharOffsetY(clamp(dy, -220, 220))
      setFaceHint('已按脸部自动放大并对齐（可继续拖拽微调）')
    } catch (e) {
      setFaceHint(e instanceof Error ? e.message : '识别失败：可手动拖拽调整')
    }
  }, [FACE_TARGET, character?.dataUrl])

  /** 一键导出：打包成zip，只需确认一次 */
  const exportDualPng = useCallback(async () => {
    const zip = new JSZip()

    // 生成蓝色图片
    const optBlue = { writeCharMeta: false, writeDebugRect: false, updatePreviewHint: false } as const
    const canvasBlue = await render(OUT, undefined, { ...optBlue, layer7TintOverride: layer7TintBlue })
    const dataUrlBlue = (canvasBlue as HTMLCanvasElement).toDataURL('image/png')
    const base64Blue = dataUrlBlue.split(',')[1]
    const nameBlue = (blueFileName.trim() || 'output').replace(/\.zip$/i, '')
    const finalNameBlue = blueFileName === purpleFileName ? `${nameBlue}(1)` : nameBlue
    zip.file(`${finalNameBlue}-blue-380x380.png`, base64Blue, { base64: true })

    // 生成紫色图片
    const optPurple = { writeCharMeta: false, writeDebugRect: false, updatePreviewHint: false } as const
    const canvasPurple = await render(OUT, undefined, { ...optPurple, layer7TintOverride: layer7TintPurple })
    const dataUrlPurple = (canvasPurple as HTMLCanvasElement).toDataURL('image/png')
    const base64Purple = dataUrlPurple.split(',')[1]
    const namePurple = (purpleFileName.trim() || 'output').replace(/\.zip$/i, '')
    const finalNamePurple = blueFileName === purpleFileName ? `${namePurple}(2)` : namePurple
    zip.file(`${finalNamePurple}-purple-380x380.png`, base64Purple, { base64: true })

    // 生成zip并下载
    const content = await zip.generateAsync({ type: 'blob' })
    const url = URL.createObjectURL(content)
    const a = document.createElement('a')
    a.href = url
    a.download = `${nameBlue}-output.zip`
    a.click()
    URL.revokeObjectURL(url)
  }, [render, layer7TintBlue, layer7TintPurple, blueFileName, purpleFileName])

  /** 单独导出蓝色 */
  const exportBlue = useCallback(async () => {
    const opt = { writeCharMeta: false, writeDebugRect: false, updatePreviewHint: false } as const
    const canvas = await render(OUT, undefined, { ...opt, layer7TintOverride: layer7TintBlue })
    const url = (canvas as HTMLCanvasElement).toDataURL('image/png')
    const name = blueFileName.trim() || 'output-blue'
    const a = document.createElement('a')
    a.href = url
    a.download = `${name}-blue-380x380.png`
    a.click()
  }, [render, layer7TintBlue, blueFileName])

  /** 单独导出紫色 */
  const exportPurple = useCallback(async () => {
    const opt = { writeCharMeta: false, writeDebugRect: false, updatePreviewHint: false } as const
    const canvas = await render(OUT, undefined, { ...opt, layer7TintOverride: layer7TintPurple })
    const url = (canvas as HTMLCanvasElement).toDataURL('image/png')
    const name = purpleFileName.trim() || 'output-purple'
    const a = document.createElement('a')
    a.href = url
    a.download = `${name}-purple-380x380.png`
    a.click()
  }, [render, layer7TintPurple, purpleFileName])

  // ── 戳戳配套图渲染 ───────────────────────────────────────────────────────
  const pokeOffscreenRef = useRef<HTMLCanvasElement | null>(null)
  const pokeMaskComposeRef = useRef<HTMLCanvasElement | null>(null)
  const pokeMaskMatteRef = useRef<HTMLCanvasElement | null>(null)
  const pokeMaskTintCanvasRef = useRef<HTMLCanvasElement | null>(null)

  const renderPoke = useCallback(
    async (cw: number, ch: number, target?: HTMLCanvasElement) => {
      const w = Math.max(1, Math.round(cw))
      const h = Math.max(1, Math.round(ch))
      const off = pokeOffscreenRef.current || (pokeOffscreenRef.current = document.createElement('canvas'))
      if (off.width !== w) off.width = w
      if (off.height !== h) off.height = h
      const octx = off.getContext('2d')
      if (!octx) return off

      octx.fillStyle = pokeBgColor
      octx.fillRect(0, 0, w, h)

      const charImg = character?.dataUrl
        ? await getCachedImage(character.dataUrl).catch(() => null)
        : null
      if (charImg) {
        const iw = charImg.naturalWidth || charImg.width
        const ih = charImg.naturalHeight || charImg.height
        const base = Math.max(w / iw, h / ih)
        const s = charScale
        const drawW = iw * base * s
        const drawH = ih * base * s
        const x = (w - drawW) / 2 + (charOffsetX / PREVIEW) * w
        const y = (h - drawH) / 2 + (charOffsetY / PREVIEW) * h
        octx.drawImage(charImg, x, y, drawW, drawH)
      }

      for (const n of pokeNodes) {
        if (n.type !== 'otPokeElement') continue
        const tmpl = n.data.elementTemplate ?? defaultPokeElementTemplate()
        if (!tmpl.layer?.dataUrl) continue
        const elImg = await getCachedImage(tmpl.layer.dataUrl).catch(() => null)
        if (!elImg) continue
        const ew = elImg.naturalWidth || elImg.width
        const eh = elImg.naturalHeight || elImg.height
        const eb = Math.max(w / ew, h / eh) * 0.88 * tmpl.scale
        const edw = ew * eb
        const edh = eh * eb
        const ex = (w - edw) / 2 + (tmpl.offsetX / PREVIEW) * w
        const ey = (h - edh) / 2 + (tmpl.offsetY / PREVIEW) * h
        drawLogoWithGlow(
          octx,
          elImg,
          { x: ex, y: ey, w: edw, h: edh },
          {
            enabled: tmpl.glow.enabled,
            color: tmpl.glow.color,
            size: tmpl.glow.size,
            opacity: tmpl.glow.opacity,
          },
        )
      }

      if (pokeText1.trim()) {
        octx.save()
        octx.font = `${pokeFontSize}px sans-serif`
        octx.fillStyle = pokeFontColor
        octx.textAlign = 'center'
        octx.textBaseline = 'middle'
        octx.fillText(pokeText1, w / 2, h - pokeFontSize * 1.8)
        octx.restore()
      }

      if (pokeText2.trim()) {
        octx.save()
        octx.font = `${Math.round(pokeFontSize * 0.65)}px sans-serif`
        octx.fillStyle = pokeFontColor
        octx.globalAlpha = 0.7
        octx.textAlign = 'center'
        octx.textBaseline = 'middle'
        octx.fillText(pokeText2, w / 2, h - pokeFontSize * 0.8)
        octx.restore()
      }

      if (pokeMaskOpacity > 0.001) {
        const compose = pokeMaskComposeRef.current || (pokeMaskComposeRef.current = document.createElement('canvas'))
        const matte = pokeMaskMatteRef.current || (pokeMaskMatteRef.current = document.createElement('canvas'))
        const tc = pokeMaskTintCanvasRef.current || (pokeMaskTintCanvasRef.current = document.createElement('canvas'))
        await drawOutputStyleBottomFadeMask(
          octx,
          w,
          h,
          getCachedImage,
          {
            maskLayer: pokeMaskLayer,
            tint: pokeMaskColor,
            opacity: pokeMaskOpacity,
            reach: pokeMaskReach,
            falloff: pokeMaskFalloff,
          },
          { compose, matte, tint: tc },
        )
      }

      if (target) {
        const ctx2d = target.getContext('2d')
        if (ctx2d) {
          if (target.width !== w) target.width = w
          if (target.height !== h) target.height = h
          ctx2d.clearRect(0, 0, w, h)
          ctx2d.drawImage(off, 0, 0)
        }
        return target
      }
      return off
    },
    [
      pokeBgColor,
      character?.dataUrl,
      charScale,
      charOffsetX,
      charOffsetY,
      pokeText1,
      pokeText2,
      pokeFontSize,
      pokeFontColor,
      pokeNodes,
      pokeMaskColor,
      pokeMaskOpacity,
      pokeMaskLayer?.dataUrl,
      pokeMaskReach,
      pokeMaskFalloff,
      getCachedImage,
    ],
  )

  // ── 戳戳配套图实时预览（须在 renderPoke 定义之后）────────────────────────
  const pokeRaffRef = useRef<number | null>(null)
  const pokeInFlightRef = useRef(false)
  const pokePendingRef = useRef(false)

  useEffect(() => {
    // “戳戳·配套图”等页签目前统一复用模板搭建工作台，不启用旧的 poke 实时预览 loop
    if (activeTab !== 'poke' || isStageDualLikeTab) return
    let cancelled = false
    let attachRaf = 0
    let attachAttempts = 0
    const MAX_ATTACH_FRAMES = 90

    const cleanupRenders = () => {
      if (pokeRaffRef.current != null) cancelAnimationFrame(pokeRaffRef.current)
      pokeRaffRef.current = null
      pokePendingRef.current = false
    }

    const startPreviewLoop = (canvas: HTMLCanvasElement) => {
      const schedule = () => {
        if (cancelled || pokeRaffRef.current != null) return
        pokeRaffRef.current = requestAnimationFrame(() => {
          pokeRaffRef.current = null
          if (cancelled) return
          if (pokeInFlightRef.current) {
            pokePendingRef.current = true
            return
          }
          pokeInFlightRef.current = true
          void renderPoke(pokeOutputW, pokeOutputH, canvas).catch(() => {/* ignore */}).finally(() => {
            pokeInFlightRef.current = false
            if (pokePendingRef.current) {
              pokePendingRef.current = false
              schedule()
            }
          })
        })
      }
      schedule()
    }

    const waitForCanvas = () => {
      if (cancelled) return
      const canvas = previewCanvasPokeRef.current
      if (canvas) {
        attachRaf = 0
        startPreviewLoop(canvas)
        return
      }
      attachAttempts += 1
      if (attachAttempts > MAX_ATTACH_FRAMES) return
      attachRaf = requestAnimationFrame(waitForCanvas)
    }

    attachRaf = requestAnimationFrame(waitForCanvas)

    return () => {
      cancelled = true
      if (attachRaf !== 0) cancelAnimationFrame(attachRaf)
      cleanupRenders()
    }
  }, [
    activeTab,
    renderPoke,
    pokeOutputW,
    pokeOutputH,
    pokeBgColor,
    character?.dataUrl,
    charScale,
    charOffsetX,
    charOffsetY,
    pokeText1,
    pokeText2,
    pokeFontSize,
    pokeFontColor,
    pokeNodes,
    pokeMaskColor,
    pokeMaskOpacity,
    pokeMaskLayer?.dataUrl,
    pokeMaskReach,
    pokeMaskFalloff,
  ])

  /** 戳戳配套图导出 */
  const exportPoke = useCallback(async () => {
    const canvas = await renderPoke(pokeOutputW, pokeOutputH, undefined)
    const url = (canvas as HTMLCanvasElement).toDataURL('image/png')
    const a = document.createElement('a')
    a.href = url
    a.download = `poke-output-${pokeOutputW}x${pokeOutputH}.png`
    a.click()
  }, [renderPoke, pokeOutputW, pokeOutputH])

  /** 戳戳画布拖拽 */
  const onPointerDownPoke = useCallback((e: React.PointerEvent) => {
    setDragging(true)
    const rect = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    dragRef.current = { sx: x, sy: y, ox: charOffsetX, oy: charOffsetY }
  }, [charOffsetX, charOffsetY])

  const onPointerMovePoke = useCallback((e: React.PointerEvent) => {
    if (!dragging || !dragRef.current) return
    const rect = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const dx = x - dragRef.current.sx
    const dy = y - dragRef.current.sy
    setCharOffsetX(clamp(dragRef.current.ox + dx, -260, 260))
    setCharOffsetY(clamp(dragRef.current.oy + dy, -260, 260))
  }, [dragging])

  const onPointerUpPoke = useCallback(() => {
    setDragging(false)
    dragRef.current = null
  }, [])

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    setDragging(true)
    const rect = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    dragRef.current = { sx: x, sy: y, ox: charOffsetX, oy: charOffsetY }
  }, [charOffsetX, charOffsetY])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging || !dragRef.current) return
    const rect = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const dx = x - dragRef.current.sx
    const dy = y - dragRef.current.sy
    setCharOffsetX(clamp(dragRef.current.ox + dx, -260, 260))
    setCharOffsetY(clamp(dragRef.current.oy + dy, -260, 260))
  }, [dragging])

  const onPointerUp = useCallback(() => {
    setDragging(false)
    dragRef.current = null
  }, [])

  /** 滚轮缩放人物图 - 直接在 Canvas 上监听，不依赖 useLayoutEffect 绑定 */
  const onWheel = useCallback((e: React.WheelEvent<HTMLCanvasElement>) => {
    if (!character?.dataUrl) return
    e.preventDefault()
    e.stopPropagation()

    const delta = e.deltaY !== 0 ? e.deltaY : e.deltaX
    if (delta === 0) return

    const canvas = e.currentTarget
    const rect = canvas.getBoundingClientRect()
    const meta = charMetaRef.current
    if (!meta) return

    const sx = PREVIEW / rect.width
    const sy = PREVIEW / rect.height
    const px = (e.clientX - rect.left) * sx
    const py = (e.clientY - rect.top) * sy

    const { iw, ih } = meta
    const base = Math.max(PREVIEW / iw, PREVIEW / ih)
    const baseW = iw * base
    const baseH = ih * base

    const s0 = charScale
    const zoomStep = 1.08
    const factor = delta < 0 ? zoomStep : 1 / zoomStep
    const s1 = Math.max(0.7, Math.min(2.4, s0 * factor))
    if (Math.abs(s1 - s0) < 1e-6) return

    const w0 = baseW * s0
    const h0 = baseH * s0
    const x0 = (PREVIEW - w0) / 2 + charOffsetX
    const y0 = (PREVIEW - h0) / 2 + charOffsetY

    const u = Math.max(0, Math.min(1, (px - x0) / w0))
    const v = Math.max(0, Math.min(1, (py - y0) / h0))

    const w1 = baseW * s1
    const h1 = baseH * s1
    const x1NoOff = (PREVIEW - w1) / 2
    const y1NoOff = (PREVIEW - h1) / 2

    const newOffX = px - (x1NoOff + u * w1)
    const newOffY = py - (y1NoOff + v * h1)

    setCharScale(s1)
    setCharOffsetX(Math.max(-260, Math.min(260, newOffX)))
    setCharOffsetY(Math.max(-260, Math.min(260, newOffY)))
  }, [character, charScale, charOffsetX, charOffsetY])

  const onWheelPoke = useCallback(
    (e: React.WheelEvent<HTMLCanvasElement>) => {
      if (!character?.dataUrl) return
      e.preventDefault()
      e.stopPropagation()
      const delta = e.deltaY !== 0 ? e.deltaY : e.deltaX
      if (delta === 0) return
      const canvas = e.currentTarget
      const rect = canvas.getBoundingClientRect()
      const meta = charNaturalSize ?? charMetaRef.current
      if (!meta) return
      const w = pokeOutputW
      const h = pokeOutputH
      const sx = w / rect.width
      const sy = h / rect.height
      const px = (e.clientX - rect.left) * sx
      const py = (e.clientY - rect.top) * sy
      const { iw, ih } = meta
      const base = Math.max(w / iw, h / ih)
      const baseW = iw * base
      const baseH = ih * base
      const s0 = charScale
      const zoomStep = 1.08
      const factor = delta < 0 ? zoomStep : 1 / zoomStep
      const s1 = clamp(s0 * factor, 0.7, 2.4)
      if (Math.abs(s1 - s0) < 1e-6) return
      const w0 = baseW * s0
      const h0 = baseH * s0
      const x0 = (w - w0) / 2 + charOffsetX * (w / PREVIEW)
      const y0 = (h - h0) / 2 + charOffsetY * (h / PREVIEW)
      const u = clamp((px - x0) / w0, 0, 1)
      const v = clamp((py - y0) / h0, 0, 1)
      const w1 = baseW * s1
      const h1 = baseH * s1
      const x1NoOff = (w - w1) / 2
      const y1NoOff = (h - h1) / 2
      const newOffX = px - (x1NoOff + u * w1)
      const newOffY = py - (y1NoOff + v * h1)
      setCharScale(s1)
      setCharOffsetX(clamp(newOffX * (PREVIEW / w), -260, 260))
      setCharOffsetY(clamp(newOffY * (PREVIEW / h), -260, 260))
    },
    [character?.dataUrl, charScale, charOffsetX, charOffsetY, charNaturalSize, pokeOutputW, pokeOutputH],
  )

  const applyPokePreset = useCallback((p: 'default' | 'light' | 'dark') => {
    if (p === 'default') {
      setPokeBgColor('#1a1a2e')
      setPokeText1('')
      setPokeText2('')
      setPokeFontSize(36)
      setPokeFontColor('#ffffff')
      return
    }
    if (p === 'light') {
      setPokeBgColor('#ece8e0')
      setPokeFontColor('#1e293b')
      return
    }
    setPokeBgColor('#0a0a0f')
    setPokeFontColor('#f8fafc')
  }, [])

  const applyDefaultTemplate = useCallback(() => {
    const t = DEFAULT_OUTPUT_TOOL_TEMPLATE
    setLogoW(t.logo.width)
    setLogoH(t.logo.height)
    setLogoMargin(t.logo.margin)
    setGlowEnabled(t.logo.glow.enabled)
    setGlowColor(t.logo.glow.color)
    setGlowSize(t.logo.glow.size)
    setGlowOpacity(t.logo.glow.opacity)
    setLayer7TintBlue(t.layer7.tint)
    setLayer7TintPurple(t.layer7.tintPurple)
    setCharScale(t.character.scale)
    setCharOffsetX(t.character.offsetX)
    setCharOffsetY(t.character.offsetY)
  }, [])

  const resetCharacterTransform = useCallback(() => {
    setCharOffsetX(0)
    setCharOffsetY(0)
    setCharScale(1)
    setFaceHint('')
  }, [])

  const removePokeNode = useCallback(
    (nodeId: string) => {
      setPokeNodes(nds => nds.filter(n => n.id !== nodeId))
      setPokeEdges(eds => eds.filter(e => e.source !== nodeId && e.target !== nodeId))
      setPokeNodeCtxMenu(null)
    },
    [setPokeNodes, setPokeEdges],
  )

  const updatePokeElementTemplate = useCallback(
    (nodeId: string, partial: Partial<PokeElementTemplateState>) => {
      setPokeNodes(nds =>
        nds.map(n => {
          if (n.id !== nodeId || n.type !== 'otPokeElement') return n
          const cur = n.data.elementTemplate ?? defaultPokeElementTemplate()
          const nextGlow = partial.glow ? { ...cur.glow, ...partial.glow } : cur.glow
          return {
            ...n,
            data: {
              ...n.data,
              elementTemplate: { ...cur, ...partial, glow: nextGlow },
            },
          }
        }),
      )
    },
    [setPokeNodes],
  )

  const pokeCtx = useMemo(
    (): PokeFlowCtx => ({
      bgColor: pokeBgColor,
      setBgColor: setPokeBgColor,
      text1: pokeText1,
      setText1: setPokeText1,
      text2: pokeText2,
      setText2: setPokeText2,
      fontSize: pokeFontSize,
      setFontSize: setPokeFontSize,
      fontColor: pokeFontColor,
      setFontColor: setPokeFontColor,
      multiSizeDraft: pokeMultiSizeDraft,
      setMultiSizeDraft: setPokeMultiSizeDraft,
      maskColor: pokeMaskColor,
      setMaskColor: setPokeMaskColor,
      maskOpacity: pokeMaskOpacity,
      setMaskOpacity: setPokeMaskOpacity,
      maskLayer: pokeMaskLayer,
      setMaskLayer: setPokeMaskLayer,
      maskReach: pokeMaskReach,
      setMaskReach: setPokeMaskReach,
      maskFalloff: pokeMaskFalloff,
      setMaskFalloff: setPokeMaskFalloff,
      resetMaskLayerToBuiltin: () => setPokeMaskLayer({ ...POKE_MASK_BUILTIN_LAYER }),
      updatePokeElementTemplate,
      removePokeNode,
      outputWidth: pokeOutputW,
      setOutputWidth: setPokeOutputW,
      outputHeight: pokeOutputH,
      setOutputHeight: setPokeOutputH,
      previewCanvasPokeRef,
      exportPoke,
      onPointerDownPoke,
      onPointerMovePoke,
      onPointerUpPoke,
      onWheelPoke,
      character,
      setCharacter,
      autoFace,
      faceHint,
      applyPokePreset,
      resetCharacterTransform,
    }),
    [
      pokeBgColor,
      pokeText1,
      pokeText2,
      pokeFontSize,
      pokeFontColor,
      pokeMultiSizeDraft,
      pokeMaskColor,
      pokeMaskOpacity,
      pokeMaskLayer,
      pokeMaskReach,
      pokeMaskFalloff,
      updatePokeElementTemplate,
      removePokeNode,
      pokeOutputW,
      pokeOutputH,
      exportPoke,
      onPointerDownPoke,
      onPointerMovePoke,
      onPointerUpPoke,
      onWheelPoke,
      character,
      autoFace,
      faceHint,
      applyPokePreset,
      resetCharacterTransform,
    ],
  )

  const flowCtx = useMemo(
    (): OutputToolFlowCtx => ({
      OUT,
      PREVIEW,
      character,
      setCharacter,
      logo,
      setLogo,
      layer7,
      setLayer7,
      layer7TintBlue,
      setLayer7TintBlue,
      layer7TintPurple,
      setLayer7TintPurple,
      logoW,
      setLogoW,
      logoH,
      setLogoH,
      logoMargin,
      setLogoMargin,
      glowEnabled,
      setGlowEnabled,
      glowColor,
      setGlowColor,
      glowSize,
      setGlowSize,
      glowOpacity,
      setGlowOpacity,
      charScale,
      setCharScale,
      charOffsetX,
      setCharOffsetX,
      charOffsetY,
      setCharOffsetY,
      faceHint,
      setFaceHint,
      previewHint,
      blueFileName,
      setBlueFileName,
      purpleFileName,
      setPurpleFileName,
      previewCanvasBlueRef,
      previewCanvasPurpleRef,
      baseTheme,
      autoFace,
      exportDualPng,
      exportBlue,
      exportPurple,
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onWheel,
      applyDefaultTemplate,
      resetCharacterTransform,
    }),
    [
      OUT,
      PREVIEW,
      character,
      logo,
      layer7,
      layer7TintBlue,
      layer7TintPurple,
      logoW,
      logoH,
      logoMargin,
      glowEnabled,
      glowColor,
      glowSize,
      glowOpacity,
      charScale,
      charOffsetX,
      charOffsetY,
      faceHint,
      setFaceHint,
      previewHint,
      blueFileName,
      setBlueFileName,
      purpleFileName,
      setPurpleFileName,
      baseTheme,
      autoFace,
      exportDualPng,
      onPointerDown,
      onPointerMove,
      onPointerUp,
      applyDefaultTemplate,
      resetCharacterTransform,
    ],
  )

  const rfRef = useRef<any>(null)
  const nodeTypes = useMemo(
    () => ({
      otUpload: OtUploadNode,
      otTemplateBlue: OtTemplateBlueNode,
      otTemplatePurple: OtTemplatePurpleNode,
      otStack: OtStackNode,
      otOutput: OtOutputNode,
    }),
    [],
  )

  const pokeEdgeTypes = useMemo(() => ({ default: PokeDeletableBezierEdge }), [])

  const [pokePaneMenu, setPokePaneMenu] = useState<{
    x: number
    y: number
    flowX: number
    flowY: number
  } | null>(null)

  const [nodes, setNodes, onNodesChange] = useNodesState<OutputNodeData>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])

  previewWheelStateRef.current = {
    character,
    charScale,
    charOffsetX,
    charOffsetY,
    previewSize: PREVIEW,
    charNaturalSize,
  }

  useLayoutEffect(() => {
    if (nodes.length === 0) return

    const opts: AddEventListenerOptions = { passive: false, capture: true }
    let alive = true
    const cleanups: Array<() => void> = []

    const bind = () => {
      for (const c of cleanups) c()
      cleanups.length = 0

      const canvases = [previewCanvasBlueRef.current, previewCanvasPurpleRef.current].filter(
        (c): c is HTMLCanvasElement => !!c,
      )

      for (const canvas of canvases) {
        const wrap = canvas.parentElement
        if (!wrap || !wrap.contains(canvas)) continue

        const handler = (e: WheelEvent) => {
          const st = previewWheelStateRef.current
          if (!st.character?.dataUrl) return
          if (!(e.target instanceof globalThis.Node) || !wrap.contains(e.target)) return

          const delta = e.deltaY !== 0 ? e.deltaY : e.deltaX
          if (delta === 0) return

          e.preventDefault()
          e.stopImmediatePropagation()
          e.stopPropagation()

          const meta = st.charNaturalSize ?? charMetaRef.current
          if (!meta) return

          const rect = canvas.getBoundingClientRect()
          const sx = st.previewSize / rect.width
          const sy = st.previewSize / rect.height
          const px = (e.clientX - rect.left) * sx
          const py = (e.clientY - rect.top) * sy

          const iw = meta.iw
          const ih = meta.ih
          const pv = st.previewSize
          const base = Math.max(pv / iw, pv / ih)
          const baseW = iw * base
          const baseH = ih * base

          const s0 = Math.max(0.2, st.charScale)
          const zoomStep = 1.08
          const factor = delta < 0 ? zoomStep : 1 / zoomStep
          const s1 = clamp(s0 * factor, 0.7, 2.4)
          if (Math.abs(s1 - s0) < 1e-6) return

          const w0 = baseW * s0
          const h0 = baseH * s0
          const x0 = (pv - w0) / 2 + st.charOffsetX
          const y0 = (pv - h0) / 2 + st.charOffsetY

          const u = clamp((px - x0) / w0, 0, 1)
          const v = clamp((py - y0) / h0, 0, 1)

          const w1 = baseW * s1
          const h1 = baseH * s1
          const x1NoOff = (pv - w1) / 2
          const y1NoOff = (pv - h1) / 2

          const newOffX = px - (x1NoOff + u * w1)
          const newOffY = py - (y1NoOff + v * h1)

          setCharScale(s1)
          setCharOffsetX(clamp(newOffX, -260, 260))
          setCharOffsetY(clamp(newOffY, -260, 260))
        }

        wrap.addEventListener('wheel', handler, opts)
        cleanups.push(() => wrap.removeEventListener('wheel', handler, opts))
      }
    }

    bind()
    const raf = requestAnimationFrame(() => {
      if (alive) bind()
    })
    const t0 = window.setTimeout(() => {
      if (alive) bind()
    }, 0)
    const t1 = window.setTimeout(() => {
      if (alive) bind()
    }, 120)
    const t2 = window.setTimeout(() => {
      if (alive) bind()
    }, 400)

    return () => {
      alive = false
      cancelAnimationFrame(raf)
      window.clearTimeout(t0)
      window.clearTimeout(t1)
      window.clearTimeout(t2)
      for (const c of cleanups) c()
    }
  }, [nodes.length])

  // 切换 Tab：模板搭建类页签走同一套工作台；默认输出工具走静态节点
  useEffect(() => {
    if (isStageDualLikeTab) {
      setNodes(STATIC_OT_NODES.map(n => ({
        ...n,
        data: { ...n.data, ctx: flowCtx },
      })))
      setEdges(OT_INITIAL_EDGES)
    } else {
      setNodes(STATIC_OT_NODES.map(n => ({
        ...n,
        data: { ...n.data, ctx: flowCtx },
      })))
      setEdges(OT_INITIAL_EDGES)
    }
  }, [activeTab, flowCtx, isStageDualLikeTab, setNodes, setEdges])

  useEffect(() => {
    if (activeTab !== 'poke') setPokePaneMenu(null)
  }, [activeTab])

  const onConnect = useCallback(
    (params: Connection) =>
      setEdges(eds => addEdge({ ...params, animated: true, style: { stroke: '#6366f1' } }, eds)),
    [setEdges],
  )

  const onConnectPoke = useCallback(
    (params: Connection) =>
      setPokeEdges(eds => addEdge({ ...params, animated: true, style: { stroke: POKE_EDGE_COLOR } }, eds)),
    [setPokeEdges],
  )

  const addPokeNodeAtFlow = useCallback(
    (kind: PokeRfNodeType, flowPos: { x: number; y: number }) => {
      const meta = POKE_ADD_OPTIONS.find(o => o.type === kind)
      const id = `poke-${kind}-${Date.now()}`
      const data: PokeFlowNodeData =
        kind === 'otPokeElement'
          ? { title: meta?.title ?? '元素模板', elementTemplate: defaultPokeElementTemplate() }
          : { title: meta?.title ?? kind }
      setPokeNodes(nds => [
        ...nds,
        {
          id,
          type: kind,
          position: { x: flowPos.x, y: flowPos.y },
          data,
        },
      ])
    },
    [setPokeNodes],
  )

  const averagePokeView = useCallback(() => {
    setPokePaneMenu(null)
    requestAnimationFrame(() => {
      try {
        rfRef.current?.fitView?.({ padding: 0.14, duration: 280 })
      } catch {
        /* ignore */
      }
    })
  }, [])

  useEffect(() => {
    if (!ctxMenu) return
    const onDocClick = (e: MouseEvent) => {
      if (e.button > 0) return
      const t = e.target as Element | null
      if (t?.closest?.('[data-ot-pane-ctx]')) return
      setCtxMenu(null)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCtxMenu(null)
    }
    document.addEventListener('click', onDocClick)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('click', onDocClick)
      window.removeEventListener('keydown', onKey)
    }
  }, [ctxMenu])

  useEffect(() => {
    if (!pokePaneMenu && !pokeNodeCtxMenu) return
    const onDocClick = (e: MouseEvent) => {
      if (e.button > 0) return
      const t = e.target as Element | null
      if (t?.closest?.('[data-poke-flow-ctx]')) return
      setPokePaneMenu(null)
      setPokeNodeCtxMenu(null)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPokePaneMenu(null)
        setPokeNodeCtxMenu(null)
      }
    }
    document.addEventListener('click', onDocClick)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('click', onDocClick)
      window.removeEventListener('keydown', onKey)
    }
  }, [pokePaneMenu, pokeNodeCtxMenu])

  // close template channel dropdown on outside click / Esc
  useEffect(() => {
    if (!tplChannelOpen) return
    const onDown = (e: MouseEvent) => {
      const btn = tplChannelBtnRef.current
      const target = e.target as globalThis.Node | null
      if (!btn || !target) return
      // If click is on the button, keep toggle behavior.
      if (btn.contains(target)) return
      setTplChannelOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setTplChannelOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [tplChannelOpen])

  // close WZ domestic section dropdown on outside click / Esc
  useEffect(() => {
    if (!wzDomesticSectionOpen) return
    const onDown = (e: MouseEvent) => {
      const btn = wzSectionBtnRef.current
      const target = e.target as globalThis.Node | null
      if (!btn || !target) return
      if (btn.contains(target)) return
      setWzDomesticSectionOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setWzDomesticSectionOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [wzDomesticSectionOpen])

  const averageView = useCallback(() => {
    setCtxMenu(null)
    setNodes(prev => buildAverageOutputToolNodes(prev.map(n => ({ ...n }))))
    requestAnimationFrame(() => {
      try {
        rfRef.current?.fitView?.({ padding: 0.14, duration: 280 })
      } catch {
        /* ignore */
      }
    })
  }, [setNodes])

  return (
    <div className="flex h-full w-full min-h-0 flex-col">
      {/* 左侧信息区：保持清晰对比；底栏收口 */}
      <div className="absolute left-0 top-0 bottom-0 w-[156px] z-10 flex flex-col border-r border-slate-800/60 bg-slate-950/55 backdrop-blur-md">
        <div className="pt-4 pb-3">
          <div className="flex items-center justify-between gap-2">
            <div className="relative mx-1.5 w-[calc(100%-12px)]">
              <button
                ref={tplChannelBtnRef}
                type="button"
                onClick={() => setTplChannelOpen(v => !v)}
                className="w-full rounded-xl border border-indigo-500/20 bg-slate-950/55 px-3 py-2 pr-8 text-left text-[12px] font-medium text-slate-100 shadow-[0_12px_40px_rgba(0,0,0,0.35)] outline-none transition hover:border-slate-700/70 hover:bg-slate-950/40 focus:border-indigo-400/60 focus:ring-2 focus:ring-indigo-500/15"
                title="切换模板来源"
              >
                {templateChannel === 'wz-domestic' ? '王者国内' : '王者营地'}
              </button>
              <div className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-slate-300/80">
                <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path
                    fillRule="evenodd"
                    d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 10.94l3.71-3.71a.75.75 0 1 1 1.06 1.06l-4.24 4.25a.75.75 0 0 1-1.06 0L5.21 8.29a.75.75 0 0 1 .02-1.08Z"
                    clipRule="evenodd"
                  />
                </svg>
              </div>
              <div className="pointer-events-none absolute inset-0 rounded-xl ring-1 ring-indigo-500/10" />

              {tplChannelOpen && (
                <div
                  className="absolute left-0 right-0 mt-2 z-20 rounded-xl border border-slate-800/80 bg-slate-950/95 backdrop-blur shadow-[0_18px_60px_rgba(0,0,0,0.55)] overflow-hidden"
                  onMouseDown={e => e.stopPropagation()}
                >
                  {(
                    [
                      { id: 'wz-domestic' as const, label: '王者国内' },
                      { id: 'wz-camp' as const, label: '王者营地' },
                    ] as const
                  ).map(opt => {
                    const active = templateChannel === opt.id
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => {
                          setTemplateChannel(opt.id)
                          setTplChannelOpen(false)
                        }}
                        className={`w-full px-3 py-2 text-left text-[12px] transition ${
                          active
                            ? 'bg-indigo-500/15 text-indigo-200'
                            : 'text-slate-200 hover:bg-slate-800/35'
                        }`}
                      >
                        {opt.label}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
          {templateChannel === 'wz-domestic' && (
            <div className="mt-1 mx-1.5 w-[calc(100%-12px)] text-[10px] text-indigo-300/15">选择一个模板进行编辑</div>
          )}
        </div>
        <div className="flex-1 overflow-y-auto py-2">
          {templateChannel === 'wz-domestic' &&
            (
              <div className="relative mx-1.5 mb-2 w-[calc(100%-12px)]">
                <button
                  ref={wzSectionBtnRef}
                  type="button"
                  onClick={() => setWzDomesticSectionOpen(v => !v)}
                  className="w-full rounded-lg border border-slate-800/50 bg-slate-950/20 px-3 py-2 pr-8 text-left text-[11px] font-medium text-slate-300 outline-none transition hover:border-slate-700/55 hover:bg-slate-950/25 focus:border-slate-700/70 focus:ring-1 focus:ring-indigo-500/10"
                  title="切换王者国内子集"
                >
                  {wzDomesticSection === 'assets' ? '个性资源模板' : '商城模板'}
                </button>
                <div className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-slate-300/80">
                  <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                    <path
                      fillRule="evenodd"
                      d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 10.94l3.71-3.71a.75.75 0 1 1 1.06 1.06l-4.24 4.25a.75.75 0 0 1-1.06 0L5.21 8.29a.75.75 0 0 1 .02-1.08Z"
                      clipRule="evenodd"
                    />
                  </svg>
                </div>

                {wzDomesticSectionOpen && (
                  <div
                    className="absolute left-0 right-0 mt-2 z-10 rounded-lg border border-slate-800/70 bg-slate-950/90 backdrop-blur shadow-[0_12px_36px_rgba(0,0,0,0.45)] overflow-hidden"
                    onMouseDown={e => e.stopPropagation()}
                  >
                    {(
                      [
                        { id: 'assets' as const, label: '个性资源模板' },
                        { id: 'mall' as const, label: '商城模板' },
                      ] as const
                    ).map(opt => {
                      const active = wzDomesticSection === opt.id
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => {
                            setWzDomesticSection(opt.id)
                            setWzDomesticSectionOpen(false)
                            if (opt.id === 'mall') {
                              setActiveTab(cur =>
                                OUTPUT_TOOL_MALL_TAB_IDS.has(cur) ? cur : 'mall_discount',
                              )
                            } else {
                              setActiveTab(cur =>
                                OUTPUT_TOOL_ASSET_TAB_IDS.has(cur) ? cur : 'signature_gift',
                              )
                            }
                          }}
                          className={`w-full px-3 py-2 text-left text-[11px] transition ${
                            active ? 'bg-indigo-500/12 text-indigo-200' : 'text-slate-200 hover:bg-slate-800/30'
                          }`}
                        >
                          {opt.label}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )}

          {templateChannel === 'wz-domestic' && wzDomesticSection === 'assets' &&
            OUTPUT_TOOL_TABS.map(tab => (
              <button
                key={tab.id}
                type="button"
                disabled={!tab.built}
                onClick={() => tab.built && setActiveTab(tab.id)}
                className={`group relative mx-1.5 my-1 w-[calc(100%-12px)] rounded-xl px-2.5 py-2 text-left text-[13px] transition-colors duration-150 ${
                  activeTab === tab.id
                    ? 'bg-indigo-500/12 text-indigo-300'
                    : tab.built
                    ? 'text-slate-300 hover:bg-slate-800/25 hover:text-slate-100'
                    : 'text-slate-500 cursor-not-allowed'
                } ${!tab.built ? 'opacity-40' : ''}`}
              >
                <div className="min-w-0">
                  <div className="truncate">{tab.name}</div>
                </div>
              </button>
            ))}

          {templateChannel === 'wz-domestic' && wzDomesticSection === 'mall' &&
            OUTPUT_TOOL_MALL_TABS.map(tab => (
              <button
                key={tab.id}
                type="button"
                disabled={!tab.built}
                onClick={() => tab.built && setActiveTab(tab.id)}
                className={`group relative mx-1.5 my-1 w-[calc(100%-12px)] rounded-xl px-2.5 py-2 text-left text-[13px] transition-colors duration-150 ${
                  activeTab === tab.id
                    ? 'bg-indigo-500/12 text-indigo-300'
                    : tab.built
                    ? 'text-slate-300 hover:bg-slate-800/25 hover:text-slate-100'
                    : 'text-slate-500 cursor-not-allowed'
                } ${!tab.built ? 'opacity-40' : ''}`}
              >
                <div className="min-w-0">
                  <div className="truncate">{tab.name}</div>
                </div>
              </button>
            ))}

          {templateChannel === 'wz-camp' && (
            <>
              <div className="mx-1.5 mb-2 w-[calc(100%-12px)]">
                <button
                  type="button"
                  onClick={addCampTemplateTab}
                  className="w-full rounded-lg border border-slate-800/60 bg-slate-950/10 px-2 py-1.5 text-left text-[11px] font-medium text-slate-300/90 transition hover:bg-slate-950/20 hover:border-slate-700/70 focus:outline-none focus:ring-1 focus:ring-indigo-500/15"
                  title="新增模板切页"
                >
                  点击新增模板
                </button>
              </div>
              {campTabs.map(tab => {
                const active = activeTab === tab.id
                const renaming = campRenamingId === tab.id
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    onDoubleClick={() => {
                      setCampRenamingId(tab.id)
                      setCampNameDraft(tab.name)
                    }}
                    className={`group relative mx-1.5 my-1 w-[calc(100%-12px)] rounded-xl px-2.5 py-2 text-left text-[13px] transition-colors duration-150 ${
                      active ? 'bg-indigo-500/12 text-indigo-300' : 'text-slate-300 hover:bg-slate-800/25 hover:text-slate-100'
                    }`}
                    title="双击改名"
                  >
                    <div className="min-w-0">
                      {renaming ? (
                        <input
                          value={campNameDraft}
                          autoFocus
                          onChange={e => setCampNameDraft(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') {
                              commitCampRename(tab.id, campNameDraft)
                              setCampRenamingId(null)
                            } else if (e.key === 'Escape') {
                              setCampRenamingId(null)
                              setCampNameDraft('')
                            }
                          }}
                          onBlur={() => {
                            commitCampRename(tab.id, campNameDraft)
                            setCampRenamingId(null)
                          }}
                          className="w-full rounded-md bg-slate-950/40 px-1.5 py-1 text-[12px] text-slate-100 outline-none ring-1 ring-indigo-500/25 focus:ring-2 focus:ring-indigo-500/25"
                        />
                      ) : (
                        <div className="truncate">{tab.name}</div>
                      )}
                    </div>
                  </button>
                )
              })}
            </>
          )}

          {/* 王者国内-商城模板：右侧画布区会显示“模板搭建中” */}
        </div>
        <div className="shrink-0 border-t border-slate-800/60 bg-slate-950/72 px-2.5 py-2 backdrop-blur-md">
          <p
            className={`text-center text-[10px] leading-snug ${
              activeTab === 'poke' ? 'tracking-wide text-slate-500/88' : 'text-slate-500'
            }`}
          >
            {isStageDualLikeTab
                ? '模板搭建：右键组件库 · 改色/外发光节点 · 预览与批量（两路输出）'
                : '右键画布 · 平均视图'}
          </p>
        </div>
      </div>

      {/* 右侧画布区域 */}
      <div
        className="flex-1 min-h-0 w-full relative ml-[156px]"
        onContextMenu={e => {
          if (templateChannel === 'wz-domestic' && wzDomesticSection === 'mall') return
          if (isStageDualLikeTab) {
            e.preventDefault()
            return
          }
          e.preventDefault()
          setCtxMenu({ x: e.clientX, y: e.clientY })
        }}
      >
        {templateChannel === 'wz-domestic' && wzDomesticSection === 'mall' ? (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-950/40">
            <p className="text-sm text-slate-400">模板搭建中</p>
          </div>
        ) : isStageDualLikeTab ? (
          <StageDualFlow />
        ) : (
          <ReactFlow
            className="app-react-flow-marquee !bg-transparent [&_.react-flow__pane]:!bg-transparent"
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            nodeTypes={nodeTypes}
            deleteKeyCode="Delete"
            elementsSelectable
            nodesDraggable
            selectionOnDrag
            panOnDrag={[1, 2]}
            panActivationKeyCode="Space"
            fitView
            fitViewOptions={{ padding: 0.14 }}
            proOptions={{ hideAttribution: true }}
            ref={rfRef}
            onInit={inst => {
              rfRef.current = inst
            }}
          >
            <Background gap={16} size={1} color="#1f2937" />
          </ReactFlow>
        )}

        {ctxMenu && templateChannel === 'wz-domestic' && !isStageDualLikeTab && (
          <div
            data-ot-pane-ctx
            className="fixed z-50 min-w-[160px] rounded-lg border border-slate-800 bg-slate-950/95 backdrop-blur shadow-[0_18px_60px_rgba(0,0,0,0.55)] overflow-hidden"
            style={{ left: ctxMenu.x, top: ctxMenu.y }}
            onMouseDown={e => e.stopPropagation()}
          >
            <button
              type="button"
              className="w-full px-2.5 py-1 text-left text-[11px] leading-tight text-slate-200 hover:bg-slate-800/60 transition"
              onClick={() => averageView()}
            >
              平均视图
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

