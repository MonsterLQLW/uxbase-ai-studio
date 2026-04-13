import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react'
import JSZip from 'jszip'
import ReactFlow, {
  Background,
  Handle,
  Position,
  addEdge,
  useEdgesState,
  useNodes,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
} from 'reactflow'
import 'reactflow/dist/style.css'
import { RfRangeInput } from '../RfRangeInput'
import { PokeDeletableBezierEdge } from '../OutputToolPokeEdge'
import { findPreviewNode, metaFromPreviewNode, renderStageDualTemplate } from '../../lib/stageDualRender'
import {
  MASK_BUILTIN_BASE_LAYER,
  MASK_UI_MAX_FALLOFF,
  MASK_UI_MAX_OPACITY,
  MASK_UI_MAX_REACH,
  MASK_UI_MIN_FALLOFF,
  MASK_UI_MIN_REACH,
  maskParamDisplayPercent,
} from '../../lib/outputStyleMask'
import type { StageDataUrlImage, StageGlow, StageTplId } from '../../lib/stageDualTypes'

const STORAGE_KEY = 'uxStageDualFlow_v3'

function stageMaskBuiltinLayer(): StageDataUrlImage {
  return {
    dataUrl: MASK_BUILTIN_BASE_LAYER.dataUrl,
    name: MASK_BUILTIN_BASE_LAYER.name ?? '内置遮罩底图',
  }
}
const PREVIEW_NORM = 380

/** 模板搭建连线色：天青虚线（对齐参考图 ~#40C4FF），避免靛紫感 */
const STAGE_EDGE_STROKE_MAIN = '#40C4FF'
const STAGE_EDGE_STROKE_BRIGHT = '#67d4ff'
const STAGE_EDGE_STROKE_MUTED = '#5b8ead'

/** 读档：旧版靛紫/紫罗兰描边改为当前天青体系（只改外观） */
const STAGE_EDGE_LEGACY_MAIN = new Set(['#6163f1', '#6266f1', '#6366f1'])
const STAGE_EDGE_LEGACY_BRIGHT = new Set(['#818cf8', '#7f8bf8', '#7d8af8', '#a78bfa'])
const STAGE_EDGE_LEGACY_MUTED = new Set(['#62748f', '#63748d', '#64748b'])

function migrateStageDualEdgeAppearance(edges: Edge[]): Edge[] {
  return edges.map(e => {
    const raw = e.style && typeof e.style.stroke === 'string' ? e.style.stroke.trim().toLowerCase() : ''
    if (raw && STAGE_EDGE_LEGACY_MAIN.has(raw)) {
      return { ...e, style: { ...e.style, stroke: STAGE_EDGE_STROKE_MAIN } }
    }
    if (raw && STAGE_EDGE_LEGACY_BRIGHT.has(raw)) {
      return { ...e, style: { ...e.style, stroke: STAGE_EDGE_STROKE_BRIGHT } }
    }
    if (raw && STAGE_EDGE_LEGACY_MUTED.has(raw)) {
      return { ...e, style: { ...e.style, stroke: STAGE_EDGE_STROKE_MUTED } }
    }
    if (e.animated && (!e.style || typeof e.style.stroke !== 'string' || !String(e.style.stroke).trim())) {
      return { ...e, style: { ...e.style, stroke: STAGE_EDGE_STROKE_MAIN } }
    }
    return e
  })
}

/** 空白处右键菜单：不超出视口四边；底边始终落在网页底边之上（贴底留边距），靠上滚动看完 */
function stagePaneMenuViewportStyle(screenX: number, screenY: number): CSSProperties {
  const margin = 10
  const approxMenuWidth = 252
  const menuMaxH = 620
  if (typeof window === 'undefined') {
    return { left: screenX, top: screenY, maxHeight: menuMaxH }
  }
  const vw = window.innerWidth
  const vh = window.innerHeight
  const innerH = Math.max(0, vh - 2 * margin)
  const left = Math.min(Math.max(margin, screenX), Math.max(margin, vw - approxMenuWidth - margin))

  let top = Math.max(margin, Math.min(screenY, vh - margin - 1))
  let maxHeight = Math.min(menuMaxH, vh - top - margin)

  const minComfortH = 168
  if (maxHeight < minComfortH) {
    maxHeight = Math.min(menuMaxH, innerH)
    top = vh - margin - maxHeight
    top = Math.max(margin, top)
    maxHeight = Math.min(menuMaxH, vh - top - margin)
  }

  maxHeight = Math.max(0, maxHeight)
  return { left, top, maxHeight }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 避免 toDataURL 产生整段 base64 导致多张大图导出时内存翻倍、标签页崩溃 */
function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob(
        blob => {
          if (blob) resolve(blob)
          else reject(new Error('PNG 编码失败：请尝试缩小预览导出尺寸'))
        },
        'image/png',
        1,
      )
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)))
    }
  })
}

/** 批量导出左侧输入：统一 id=in，可多线接入；兼容旧存档 in-a / in-b */
const BATCH_PREVIEW_TARGET_HANDLES = new Set(['in', 'in-a', 'in-b'])

function orderedPreviewSourcesForBatch(edges: Edge[], batchId: string, nodes: Node[]): string[] {
  const byId = new Map(nodes.map(x => [x.id, x]))
  const cand = edges.filter(
    e => e.target === batchId && BATCH_PREVIEW_TARGET_HANDLES.has(String(e.targetHandle || 'in')),
  )
  cand.sort((a, b) => {
    const rank = (h: string | null | undefined) => (h === 'in-a' ? 0 : h === 'in-b' ? 1 : 2)
    const d = rank(a.targetHandle) - rank(b.targetHandle)
    return d !== 0 ? d : String(a.id).localeCompare(String(b.id))
  })
  const out: string[] = []
  const seen = new Set<string>()
  for (const e of cand) {
    const src = byId.get(e.source)
    if (!src || src.type !== 'stPreview' || seen.has(e.source)) continue
    seen.add(e.source)
    out.push(e.source)
  }
  return out
}

/** 沿边从预览节点反向走，能到达舞台层（stRoot）才视为已接入完整上游链路 */
function stagePreviewLinkedToRoot(edges: Edge[], nodes: Node[], previewId: string): boolean {
  const byId = new Map(nodes.map(n => [n.id, n]))
  const seen = new Set<string>()
  const stack: string[] = [previewId]
  while (stack.length) {
    const cur = stack.pop()!
    if (seen.has(cur)) continue
    seen.add(cur)
    const node = byId.get(cur)
    if (node?.type === 'stRoot') return true
    for (const e of edges) {
      if (e.target !== cur) continue
      if (!seen.has(e.source)) stack.push(e.source)
    }
  }
  return false
}

const STAGE_Z_MIN = 1
const STAGE_Z_MAX = 7

function clampStageZLevel(raw: unknown, fallback: number): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return fallback
  return Math.max(STAGE_Z_MIN, Math.min(STAGE_Z_MAX, Math.round(raw)))
}

function StageStackLevelSelect({ value, onChange }: { value: number; onChange: (z: number) => void }) {
  return (
    <select
      className="nodrag nopan max-w-[4.75rem] cursor-pointer rounded border border-slate-700/55 bg-slate-950/85 py-0.5 pl-1 pr-5 text-[9px] font-medium text-slate-200 shadow-inner"
      value={value}
      title="叠放顺序：1 级最底，7 级最顶（不被更低级遮挡）"
      onChange={e => onChange(Number(e.target.value))}
      onPointerDown={e => e.stopPropagation()}
      onMouseDown={e => e.stopPropagation()}
    >
      {Array.from({ length: STAGE_Z_MAX }, (_, i) => i + 1).map(n => (
        <option key={n} value={n}>
          {n}级
        </option>
      ))}
    </select>
  )
}

const STAGE_OFFSET_PAD_MIN = -400
const STAGE_OFFSET_PAD_MAX = 400

/** 框内拖拽小方块调水平/垂直偏移（与滑条同范围）；nodrag 避免拖画布 */
function StageOffsetPad({
  offsetX,
  offsetY,
  onChange,
  disabled,
}: {
  offsetX: number
  offsetY: number
  onChange: (ox: number, oy: number) => void
  disabled?: boolean
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef(false)
  const rafRef = useRef<number | null>(null)
  const pendingRef = useRef<{ ox: number; oy: number } | null>(null)

  const clamp = (v: number) =>
    Math.max(STAGE_OFFSET_PAD_MIN, Math.min(STAGE_OFFSET_PAD_MAX, Math.round(v)))

  const applyFromPoint = useCallback(
    (clientX: number, clientY: number) => {
      const el = wrapRef.current
      if (!el) return
      const r = el.getBoundingClientRect()
      if (r.width < 1 || r.height < 1) return
      const nx = (clientX - r.left) / r.width
      const ny = (clientY - r.top) / r.height
      const span = STAGE_OFFSET_PAD_MAX - STAGE_OFFSET_PAD_MIN
      const ox = STAGE_OFFSET_PAD_MIN + nx * span
      const oy = STAGE_OFFSET_PAD_MIN + ny * span
      pendingRef.current = { ox: clamp(ox), oy: clamp(oy) }
      if (rafRef.current != null) return
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null
        const p = pendingRef.current
        if (!p) return
        pendingRef.current = null
        onChange(p.ox, p.oy)
      })
    },
    [onChange],
  )

  useEffect(() => {
    const end = () => {
      dragRef.current = false
    }
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    return () => {
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
    }
  }, [])

  useEffect(() => {
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
      rafRef.current = null
      pendingRef.current = null
    }
  }, [])

  const ox = Number.isFinite(offsetX) ? offsetX : 0
  const oy = Number.isFinite(offsetY) ? offsetY : 0
  const span = STAGE_OFFSET_PAD_MAX - STAGE_OFFSET_PAD_MIN
  const pxPct = ((ox - STAGE_OFFSET_PAD_MIN) / span) * 100
  const pyPct = ((oy - STAGE_OFFSET_PAD_MIN) / span) * 100

  return (
    <div className="mb-2">
      <div className="mb-1 flex items-center justify-between text-[9px] text-slate-500">
        <span>拖拽调位置</span>
        <span className="tabular-nums text-slate-400">
          {Math.round(ox)} · {Math.round(oy)}
        </span>
      </div>
      <div
        ref={wrapRef}
        className={`nodrag nopan relative h-[76px] w-full touch-none select-none rounded-md border border-slate-700/55 bg-slate-950/60 ${
          disabled ? 'pointer-events-none cursor-not-allowed opacity-45' : 'cursor-crosshair'
        }`}
        onPointerDown={e => {
          if (disabled) return
          e.stopPropagation()
          e.preventDefault()
          if (e.button !== 0) return
          dragRef.current = true
          wrapRef.current?.setPointerCapture(e.pointerId)
          applyFromPoint(e.clientX, e.clientY)
        }}
        onPointerMove={e => {
          if (disabled || !dragRef.current) return
          e.stopPropagation()
          applyFromPoint(e.clientX, e.clientY)
        }}
        onPointerUp={e => {
          if (!dragRef.current) return
          e.stopPropagation()
          dragRef.current = false
          // flush any pending value immediately when pointer ends
          if (pendingRef.current) {
            const p = pendingRef.current
            pendingRef.current = null
            if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
            rafRef.current = null
            onChange(p.ox, p.oy)
          }
          try {
            wrapRef.current?.releasePointerCapture(e.pointerId)
          } catch {
            /* ignore */
          }
        }}
        onLostPointerCapture={() => {
          dragRef.current = false
        }}
      >
        <div className="pointer-events-none absolute left-1/2 top-0 z-0 h-full w-px bg-slate-600/35" />
        <div className="pointer-events-none absolute left-0 top-1/2 z-0 h-px w-full bg-slate-600/35" />
        <div
          className="pointer-events-none absolute z-10 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded border-2 border-cyan-200/90 bg-[#40C4FF]/90 shadow-md ring-1 ring-sky-200/30"
          style={{ left: `${pxPct}%`, top: `${pyPct}%` }}
        />
      </div>
    </div>
  )
}

/** 坐标显示/粘贴/复制（与偏移滑条、拖拽板同范围 -400～400） */
function StageOffsetCoordBox({
  offsetX,
  offsetY,
  onChange,
  disabled,
}: {
  offsetX: number
  offsetY: number
  onChange: (ox: number, oy: number) => void
  disabled?: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const ox = Number.isFinite(offsetX) ? Math.round(offsetX) : 0
  const oy = Number.isFinite(offsetY) ? Math.round(offsetY) : 0

  useEffect(() => {
    if (!editing) setDraft(`${ox}, ${oy}`)
  }, [ox, oy, editing])

  const clamp = (v: number) =>
    Math.max(STAGE_OFFSET_PAD_MIN, Math.min(STAGE_OFFSET_PAD_MAX, Math.round(v)))

  const parseAndCommit = useCallback(() => {
    const parts = draft
      .split(/[,，;\s]+/)
      .map(s => s.trim())
      .filter(Boolean)
    const nx = Number(parts[0])
    const ny = Number(parts[1])
    if (!Number.isFinite(nx) || !Number.isFinite(ny)) {
      setDraft(`${ox}, ${oy}`)
      return
    }
    onChange(clamp(nx), clamp(ny))
  }, [draft, onChange, ox, oy])

  const line = `${ox}, ${oy}`

  const copy = useCallback(() => {
    void navigator.clipboard?.writeText(line)
  }, [line])

  return (
    <div
      className={`nodrag nopan mt-2 flex flex-wrap items-center justify-end gap-1.5 rounded-md border border-slate-700/50 bg-slate-950/70 px-2 py-1.5 ${
        disabled ? 'pointer-events-none opacity-45' : ''
      }`}
      onPointerDown={e => e.stopPropagation()}
      onMouseDown={e => e.stopPropagation()}
    >
      <span className="text-[8px] text-slate-500">坐标</span>
      <input
        type="text"
        inputMode="text"
        spellCheck={false}
        disabled={disabled}
        className="nodrag nopan h-6 w-[92px] rounded border border-slate-600/60 bg-slate-900/90 px-1.5 font-mono text-[10px] text-slate-200 tabular-nums outline-none focus:border-indigo-500/60"
        value={draft}
        onFocus={() => setEditing(true)}
        onChange={e => setDraft(e.target.value)}
        onBlur={() => {
          parseAndCommit()
          setEditing(false)
        }}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            ;(e.target as HTMLInputElement).blur()
          }
        }}
        title="格式：水平, 垂直（可粘贴如 -120, 80）"
      />
      <button
        type="button"
        disabled={disabled}
        className="nodrag nopan shrink-0 rounded border border-slate-600/55 bg-slate-800/90 px-1.5 py-0.5 text-[9px] text-slate-300 hover:bg-slate-700/90"
        onClick={e => {
          e.stopPropagation()
          copy()
        }}
      >
        复制
      </button>
    </div>
  )
}

function hcls() {
  return '!bg-transparent !border-0 !shadow-none !p-0'
}

/** 卡片标题不出现「模板」；旧图里 tpl b 仅用小后缀区分 */
function stageNodeCardTitle(base: string, tpl: StageTplId): string {
  return tpl === 'b' ? `${base} · 轨 B` : base
}

async function fileToDataUrl(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(new Error('read failed'))
    r.readAsDataURL(file)
  })
}

function useStageImageCache() {
  const cacheRef = useRef(new Map<string, Promise<HTMLImageElement | null>>())
  const get = useCallback((dataUrl: string) => {
    const key = String(dataUrl || '')
    if (!key) return Promise.resolve(null)
    const hit = cacheRef.current.get(key)
    if (hit) return hit
    const p = new Promise<HTMLImageElement | null>(resolve => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => resolve(null)
      img.src = key
    })
    cacheRef.current.set(key, p)
    return p
  }, [])
  return get
}

function Shell({
  title,
  subtitle,
  headerRight,
  children,
  handles,
  className = '',
  onContextMenu,
}: {
  title: string
  subtitle?: string
  /** 默认右上角显示「舞台」；图层节点传入叠放级下拉 */
  headerRight?: ReactNode
  children: ReactNode
  /** 连线口放在卡片主体外一层，便于相对整张卡垂直居中并对齐边缘 */
  handles?: ReactNode
  className?: string
  onContextMenu?: (e: ReactMouseEvent) => void
}) {
  return (
    <div
      className={`relative min-w-[260px] overflow-visible rounded-xl border border-slate-800/42 bg-gradient-to-b from-slate-900/76 to-slate-900/86 shadow-lg shadow-black/25 ${className}`}
      onContextMenu={onContextMenu}
    >
      <div className="flex items-start justify-between gap-2 border-b border-slate-700/22 bg-slate-900/14 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-slate-100">{title}</div>
          {subtitle ? <div className="mt-0.5 text-[11px] leading-tight text-slate-500">{subtitle}</div> : null}
        </div>
        <div className="shrink-0 pt-0.5">
          {headerRight ?? <span className="text-[11px] text-slate-500">舞台</span>}
        </div>
      </div>
      <div className="p-4">{children}</div>
      {handles}
    </div>
  )
}

function StRootNode({ id, data }: NodeProps) {
  const { setNodes } = useReactFlow()
  const d = data as {
    title?: string
    sharedCharacter?: { dataUrl: string; name: string } | null
    stageElement?: { dataUrl: string; name: string } | null
  }
  const patch = useCallback(
    (partial: Record<string, unknown>) => {
      setNodes(nds => nds.map(n => (n.id === id ? { ...n, data: { ...n.data, ...partial } } : n)))
    },
    [id, setNodes],
  )
  return (
    <Shell
      title={d.title || '舞台层'}
      subtitle="上传 · 角色层 / 元素层"
      handles={<Handle type="source" position={Position.Right} id="out" className={hcls()} />}
    >
      <div className="space-y-2 text-[11px]">
        <div>
          <div className="mb-0.5 text-[10px] text-slate-500">角色层</div>
          <label className="block">
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={async e => {
                const f = e.target.files?.[0]
                if (!f) return
                const dataUrl = await fileToDataUrl(f)
                patch({ sharedCharacter: { dataUrl, name: f.name } })
              }}
            />
            <div className="cursor-pointer rounded-lg border border-slate-700/50 bg-slate-950/50 px-2 py-1.5 text-slate-200">
              {d.sharedCharacter ? d.sharedCharacter.name : '上传角色…'}
            </div>
          </label>
        </div>
        <div>
          <div className="mb-0.5 text-[10px] text-slate-500">元素层</div>
          <label className="block">
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={async e => {
                const f = e.target.files?.[0]
                if (!f) return
                const dataUrl = await fileToDataUrl(f)
                patch({ stageElement: { dataUrl, name: f.name } })
              }}
            />
            <div className="cursor-pointer rounded-lg border border-dashed border-slate-600/50 px-2 py-1.5 text-slate-400">
              {d.stageElement ? d.stageElement.name : '上传元素层…'}
            </div>
          </label>
        </div>
      </div>
    </Shell>
  )
}

/** 舞台层与后续图层之间的收口：一路进、多路出（渲染仍直接读 stRoot，本节点负责构图与模板名标注） */
function StTemplateHubNode({ id, data }: NodeProps) {
  const { setNodes } = useReactFlow()
  const d = data as Record<string, unknown>
  const tpl = d.tpl as StageTplId
  const templateName = typeof d.templateName === 'string' ? d.templateName : ''
  const patch = useCallback(
    (partial: Record<string, unknown>) => {
      setNodes(nds => nds.map(n => (n.id === id ? { ...n, data: { ...n.data, ...partial } } : n)))
    },
    [id, setNodes],
  )
  return (
    <Shell
      title={stageNodeCardTitle('模板命名层', tpl)}
      subtitle="接舞台层 · 分路至底层与各图层"
      className="min-w-[200px] max-w-[240px]"
      handles={
        <>
          <Handle type="target" position={Position.Left} id="in" className={hcls()} />
          <Handle
            type="source"
            position={Position.Right}
            id="out"
            className={hcls()}
            isConnectable
            title="可连多条线到各图层"
          />
        </>
      }
    >
      <input
        value={templateName}
        onChange={e => patch({ templateName: e.target.value })}
        placeholder="模板名称（标注）"
        className="mb-2 w-full rounded-lg border border-slate-700/55 bg-slate-950/34 px-2 py-1.5 text-[10px] text-slate-200 placeholder:text-slate-500"
      />
      <p className="mb-1 text-[9px] leading-snug text-slate-500">
        右侧单口可拖多线：接底层 feed、角色层、元素层（舞台图）、遮罩层等；之后仍按 角色→元素层→遮罩→… 串联。
      </p>
    </Shell>
  )
}

function StBottomNode({ id, data }: NodeProps) {
  const { setNodes } = useReactFlow()
  const d = data as Record<string, unknown>
  const tpl = d.tpl as StageTplId
  const zLevel = clampStageZLevel(d.zLevel, 1)
  const patch = useCallback(
    (partial: Record<string, unknown>) => {
      setNodes(nds => nds.map(n => (n.id === id ? { ...n, data: { ...n.data, ...partial } } : n)))
    },
    [id, setNodes],
  )
  return (
    <Shell
      title={stageNodeCardTitle('底层', tpl)}
      subtitle="图或纯色"
      headerRight={<StageStackLevelSelect value={zLevel} onChange={z => patch({ zLevel: z })} />}
      handles={
        <>
          <Handle type="target" position={Position.Left} id="feed" className={hcls()} />
          <Handle type="target" position={Position.Top} id="color" className={hcls()} style={{ left: '30%' }} />
          <Handle type="source" position={Position.Right} id="out" className={hcls()} />
        </>
      }
    >
      <div className="mb-2 flex gap-1">
        <button
          type="button"
          className={`flex-1 rounded px-2 py-1 text-[10px] ${d.mode !== 'image' ? 'bg-indigo-500/20 text-indigo-200' : 'bg-slate-800 text-slate-400'}`}
          onClick={() => patch({ mode: 'solid' })}
        >
          纯色
        </button>
        <button
          type="button"
          className={`flex-1 rounded px-2 py-1 text-[10px] ${d.mode === 'image' ? 'bg-indigo-500/20 text-indigo-200' : 'bg-slate-800 text-slate-400'}`}
          onClick={() => patch({ mode: 'image' })}
        >
          图片
        </button>
      </div>
      {d.mode === 'image' ? (
        <label className="block">
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={async e => {
              const f = e.target.files?.[0]
              if (!f) return
              const dataUrl = await fileToDataUrl(f)
              patch({ image: { dataUrl, name: f.name } })
            }}
          />
          <div className="cursor-pointer rounded border border-slate-700/50 px-2 py-1.5 text-[10px] text-slate-300">
            {(d.image as { name?: string } | null)?.name || '上传底图'}
          </div>
        </label>
      ) : (
        <input
          type="color"
          value={String(d.color || '#1a1a2e')}
          onChange={e => patch({ color: e.target.value })}
          className="h-8 w-full cursor-pointer rounded border border-slate-700"
        />
      )}
      {d.linkedColorSource ? (
        <p className="mt-1 text-[9px] text-indigo-300/90">已接改色节点</p>
      ) : null}
    </Shell>
  )
}

function StCharacterNode({ id, data }: NodeProps) {
  const { setNodes } = useReactFlow()
  const d = data as Record<string, unknown>
  const tpl = d.tpl as StageTplId
  const zLevel = clampStageZLevel(d.zLevel, 2)
  const patch = useCallback(
    (partial: Record<string, unknown>) => {
      setNodes(nds => nds.map(n => (n.id === id ? { ...n, data: { ...n.data, ...partial } } : n)))
    },
    [id, setNodes],
  )
  return (
    <Shell
      title={stageNodeCardTitle('角色层', tpl)}
      subtitle="位置/缩放（角色图在舞台层）"
      headerRight={<StageStackLevelSelect value={zLevel} onChange={z => patch({ zLevel: z })} />}
      handles={
        <>
          <Handle type="target" position={Position.Left} id="in" className={hcls()} />
          <Handle type="source" position={Position.Right} id="out" className={hcls()} />
        </>
      }
    >
      <StageOffsetPad
        offsetX={Number(d.offsetX) || 0}
        offsetY={Number(d.offsetY) || 0}
        onChange={(ox, oy) => patch({ offsetX: ox, offsetY: oy })}
      />
      <div className="space-y-2 text-[10px]">
        <div>
          <div className="mb-0.5 text-slate-500">水平 {Math.round(Number(d.offsetX) || 0)}</div>
          <RfRangeInput
            min={-400}
            max={400}
            value={Number(d.offsetX) || 0}
            onChange={e => patch({ offsetX: Number(e.target.value) })}
            className="w-full accent-indigo-500"
          />
        </div>
        <div>
          <div className="mb-0.5 text-slate-500">垂直 {Math.round(Number(d.offsetY) || 0)}</div>
          <RfRangeInput
            min={-400}
            max={400}
            value={Number(d.offsetY) || 0}
            onChange={e => patch({ offsetY: Number(e.target.value) })}
            className="w-full accent-indigo-500"
          />
        </div>
        <div>
          <div className="mb-0.5 text-slate-500">缩放 {(Number(d.scale) || 1).toFixed(2)}</div>
          <RfRangeInput
            min={0.3}
            max={2.4}
            step={0.02}
            value={Number(d.scale) || 1}
            onChange={e => patch({ scale: Number(e.target.value) })}
            className="w-full accent-indigo-500"
          />
        </div>
      </div>
      <StageOffsetCoordBox
        offsetX={Number(d.offsetX) || 0}
        offsetY={Number(d.offsetY) || 0}
        onChange={(cx, cy) => patch({ offsetX: cx, offsetY: cy })}
      />
    </Shell>
  )
}

/** 绑定舞台层「元素层」上传图，参数逻辑同角色层 */
function StStageElmNode({ id, data }: NodeProps) {
  const { setNodes } = useReactFlow()
  const nodes = useNodes()
  const d = data as Record<string, unknown>
  const tpl = d.tpl as StageTplId
  const zLevel = clampStageZLevel(d.zLevel, 2)
  const root = nodes.find(n => n.type === 'stRoot')
  const stageEl = root && (root.data as { stageElement?: { dataUrl?: string } | null }).stageElement
  const bound = Boolean(stageEl?.dataUrl)
  const patch = useCallback(
    (partial: Record<string, unknown>) => {
      setNodes(nds => nds.map(n => (n.id === id ? { ...n, data: { ...n.data, ...partial } } : n)))
    },
    [id, setNodes],
  )
  return (
    <Shell
      title={stageNodeCardTitle('元素层', tpl)}
      subtitle="绑定舞台层元素图 · 位置与缩放"
      headerRight={<StageStackLevelSelect value={zLevel} onChange={z => patch({ zLevel: z })} />}
      handles={
        <>
          <Handle type="target" position={Position.Left} id="in" className={hcls()} />
          <Handle type="source" position={Position.Right} id="out" className={hcls()} />
        </>
      }
    >
      <p className={`mb-2 text-[9px] leading-tight ${bound ? 'text-indigo-300/90' : 'text-amber-500/90'}`}>
        {bound ? '已绑定舞台层「元素层」图片' : '请先在舞台层上传「元素层」图'}
      </p>
      <StageOffsetPad
        offsetX={Number(d.offsetX) || 0}
        offsetY={Number(d.offsetY) || 0}
        onChange={(ox, oy) => patch({ offsetX: ox, offsetY: oy })}
        disabled={!bound}
      />
      <div className="space-y-2 text-[10px]">
        <div>
          <div className="mb-0.5 text-slate-500">水平 {Math.round(Number(d.offsetX) || 0)}</div>
          <RfRangeInput
            min={-400}
            max={400}
            value={Number(d.offsetX) || 0}
            onChange={e => patch({ offsetX: Number(e.target.value) })}
            className="w-full accent-indigo-500"
          />
        </div>
        <div>
          <div className="mb-0.5 text-slate-500">垂直 {Math.round(Number(d.offsetY) || 0)}</div>
          <RfRangeInput
            min={-400}
            max={400}
            value={Number(d.offsetY) || 0}
            onChange={e => patch({ offsetY: Number(e.target.value) })}
            className="w-full accent-indigo-500"
          />
        </div>
        <div>
          <div className="mb-0.5 text-slate-500">缩放 {(Number(d.scale) || 1).toFixed(2)}</div>
          <RfRangeInput
            min={0.3}
            max={2.4}
            step={0.02}
            value={Number(d.scale) || 1}
            onChange={e => patch({ scale: Number(e.target.value) })}
            className="w-full accent-indigo-500"
          />
        </div>
      </div>
      <StageOffsetCoordBox
        offsetX={Number(d.offsetX) || 0}
        offsetY={Number(d.offsetY) || 0}
        onChange={(cx, cy) => patch({ offsetX: cx, offsetY: cy })}
        disabled={!bound}
      />
    </Shell>
  )
}

function StMaskNode({ id, data }: NodeProps) {
  const { setNodes } = useReactFlow()
  const d = data as Record<string, unknown>
  const tpl = d.tpl as StageTplId
  const zLevel = clampStageZLevel(d.zLevel, 3)
  const maskLayer = (d.maskLayer as StageDataUrlImage | undefined) ?? stageMaskBuiltinLayer()
  const reach = typeof d.reach === 'number' && Number.isFinite(d.reach) ? d.reach : 0.76
  const falloff = typeof d.falloff === 'number' && Number.isFinite(d.falloff) ? d.falloff : 1
  const patch = useCallback(
    (partial: Record<string, unknown>) => {
      setNodes(nds => nds.map(n => (n.id === id ? { ...n, data: { ...n.data, ...partial } } : n)))
    },
    [id, setNodes],
  )
  return (
    <Shell
      title={stageNodeCardTitle('遮罩层', tpl)}
      subtitle="底图着色 · 自下而上渐变透明"
      headerRight={<StageStackLevelSelect value={zLevel} onChange={z => patch({ zLevel: z })} />}
      handles={
        <>
          <Handle type="target" position={Position.Left} id="in" className={hcls()} />
          <Handle type="target" position={Position.Top} id="color" className={hcls()} style={{ left: '35%' }} />
          <Handle type="source" position={Position.Right} id="out" className={hcls()} />
        </>
      }
    >
      <p className="mb-2 text-[10px] leading-relaxed text-slate-500">
        叠在连线栈最上；底图默认可铺满画布，着色与签名流「中间层」一致；底部更实、向上渐隐（与戳戳遮罩层相同）。
      </p>
      <div className="space-y-3">
        <div>
          <div className="mb-0.5 text-[10px] text-slate-500">遮罩底图</div>
          <label className="block">
            <input
              type="file"
              accept="image/*"
              onChange={async e => {
                const f = e.target.files?.[0]
                if (!f) return
                const dataUrl = await fileToDataUrl(f)
                patch({ maskLayer: { dataUrl, name: f.name } })
              }}
              className="hidden"
            />
            <div className="cursor-pointer rounded-lg border border-slate-700/56 bg-slate-950/36 px-2 py-2 text-xs text-slate-200 transition duration-150 ease-out hover:border-slate-600/60 hover:bg-slate-950/44">
              {maskLayer.name || '上传底图…'}
            </div>
          </label>
          <button
            type="button"
            onClick={() => patch({ maskLayer: stageMaskBuiltinLayer() })}
            className="mt-1.5 w-full rounded-lg border border-slate-700/56 bg-slate-950/24 px-2 py-1.5 text-[11px] text-slate-200 transition duration-150 ease-out hover:border-slate-600/60 hover:bg-slate-950/34"
          >
            恢复内置白底图
          </button>
        </div>
        <div>
          <div className="mb-0.5 text-[10px] text-slate-500">着色（#FFFFFF 不着色）</div>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={String(d.color || '#000000')}
              onChange={e => patch({ color: e.target.value })}
              className="h-8 w-10 cursor-pointer rounded border border-slate-600 bg-slate-900"
            />
            <input
              value={String(d.color || '#000000')}
              onChange={e => patch({ color: e.target.value })}
              className="flex-1 rounded border border-slate-700/50 bg-slate-950/52 px-2 py-1 text-[11px] text-slate-200"
            />
          </div>
        </div>
        <div>
          <div className="mb-0.5 flex justify-between text-[10px] text-slate-500">
            <span>底部强度（整体不透明度）</span>
            <span className="tabular-nums text-slate-400">
              {maskParamDisplayPercent(Number(d.opacity) ?? 0, MASK_UI_MAX_OPACITY)}%
            </span>
          </div>
          <RfRangeInput
            min={0}
            max={MASK_UI_MAX_OPACITY}
            step={0.01}
            value={Number(d.opacity) ?? 0}
            onChange={e => patch({ opacity: Number(e.target.value) })}
            className="w-full accent-indigo-500"
          />
        </div>
        <div>
          <div className="mb-0.5 flex justify-between text-[10px] text-slate-500">
            <span>自下而上渐变区域</span>
            <span className="tabular-nums text-slate-400">
              {maskParamDisplayPercent(reach, MASK_UI_MAX_REACH)}%
            </span>
          </div>
          <RfRangeInput
            min={MASK_UI_MIN_REACH}
            max={MASK_UI_MAX_REACH}
            step={0.01}
            value={reach}
            onChange={e => patch({ reach: Number(e.target.value) })}
            className="w-full accent-indigo-500"
          />
          <div className="mt-0.5 text-[10px] text-slate-600">画布高度自下缘起算的过渡带比例，越大越往上延伸。</div>
        </div>
        <div>
          <div className="mb-0.5 flex justify-between text-[10px] text-slate-500">
            <span>过渡虚实（柔和度）</span>
            <span className="tabular-nums text-slate-400">{falloff.toFixed(2)}</span>
          </div>
          <RfRangeInput
            min={MASK_UI_MIN_FALLOFF}
            max={MASK_UI_MAX_FALLOFF}
            step={0.02}
            value={falloff}
            onChange={e => patch({ falloff: Number(e.target.value) })}
            className="w-full accent-indigo-500"
          />
          <div className="mt-0.5 text-[10px] text-slate-600">偏小过渡更匀、更「虚」；偏大底部更实、边缘更利落。</div>
        </div>
      </div>
      {d.linkedColorSource ? <p className="mt-2 text-[9px] text-indigo-300/90">改色节点已接入（覆盖上方着色）</p> : null}
    </Shell>
  )
}

function StElementNode({ id, data }: NodeProps) {
  const { setNodes } = useReactFlow()
  const d = data as Record<string, unknown>
  const tpl = d.tpl as StageTplId
  const zLevel = clampStageZLevel(d.zLevel, 4)
  const patch = useCallback(
    (partial: Record<string, unknown>) => {
      setNodes(nds => nds.map(n => (n.id === id ? { ...n, data: { ...n.data, ...partial } } : n)))
    },
    [id, setNodes],
  )
  const layer = d.layer as { dataUrl?: string; name?: string } | null
  return (
    <Shell
      title={stageNodeCardTitle('元素', tpl)}
      subtitle="位置/缩放；外发光：右侧→外发光左侧，或外发光→顶栏发光口"
      headerRight={<StageStackLevelSelect value={zLevel} onChange={z => patch({ zLevel: z })} />}
      handles={
        <>
          <Handle type="target" position={Position.Left} id="in" className={hcls()} />
          <Handle type="target" position={Position.Top} id="color" className={hcls()} style={{ left: '40%' }} />
          <Handle type="target" position={Position.Top} id="glow" className={hcls()} style={{ left: '60%' }} />
          <Handle type="source" position={Position.Right} id="out" className={hcls()} />
        </>
      }
    >
      <label className="mb-2 block">
        <input
          type="file"
          accept="image/*"
          className="hidden"
          onChange={async e => {
            const f = e.target.files?.[0]
            if (!f) return
            const dataUrl = await fileToDataUrl(f)
            patch({ layer: { dataUrl, name: f.name } })
          }}
        />
        <div className="cursor-pointer rounded border border-slate-700/50 px-2 py-1.5 text-[10px] text-slate-200">
          {layer?.name || '上传元素图'}
        </div>
      </label>
      <div className="space-y-1 text-[10px]">
        <RfRangeInput
          min={-400}
          max={400}
          value={Number(d.offsetX) || 0}
          onChange={e => patch({ offsetX: Number(e.target.value) })}
          className="w-full accent-indigo-500"
        />
        <RfRangeInput
          min={-400}
          max={400}
          value={Number(d.offsetY) || 0}
          onChange={e => patch({ offsetY: Number(e.target.value) })}
          className="w-full accent-indigo-500"
        />
        <RfRangeInput
          min={0.2}
          max={2.5}
          step={0.02}
          value={Number(d.scale) || 1}
          onChange={e => patch({ scale: Number(e.target.value) })}
          className="w-full accent-indigo-500"
        />
      </div>
    </Shell>
  )
}

function StFontNode({ id, data }: NodeProps) {
  const { setNodes } = useReactFlow()
  const d = data as Record<string, unknown>
  const tpl = d.tpl as StageTplId
  const zLevel = clampStageZLevel(d.zLevel, 5)
  const patch = useCallback(
    (partial: Record<string, unknown>) => {
      setNodes(nds => nds.map(n => (n.id === id ? { ...n, data: { ...n.data, ...partial } } : n)))
    },
    [id, setNodes],
  )
  return (
    <Shell
      title={stageNodeCardTitle('字体', tpl)}
      subtitle="文案·字体；外发光：右侧→外发光左侧，或外发光→顶栏发光口"
      headerRight={<StageStackLevelSelect value={zLevel} onChange={z => patch({ zLevel: z })} />}
      handles={
        <>
          <Handle type="target" position={Position.Left} id="in" className={hcls()} />
          <Handle type="target" position={Position.Top} id="color" className={hcls()} style={{ left: '35%' }} />
          <Handle type="target" position={Position.Top} id="glow" className={hcls()} style={{ left: '65%' }} />
          <Handle type="source" position={Position.Right} id="out" className={hcls()} />
        </>
      }
    >
      <input
        value={String(d.text1 || '')}
        onChange={e => patch({ text1: e.target.value })}
        placeholder="主标题"
        className="mb-1 w-full rounded border border-slate-700/50 bg-slate-950/50 px-2 py-1 text-[11px] text-slate-100"
      />
      <input
        value={String(d.text2 || '')}
        onChange={e => patch({ text2: e.target.value })}
        placeholder="副标题"
        className="mb-2 w-full rounded border border-slate-700/50 bg-slate-950/50 px-2 py-1 text-[11px] text-slate-100"
      />
      <input
        value={String(d.fontFamily || 'system-ui, sans-serif')}
        onChange={e => patch({ fontFamily: e.target.value })}
        placeholder="字体 CSS"
        className="mb-1 w-full rounded border border-slate-700/50 bg-slate-950/50 px-2 py-1 text-[10px] text-slate-300"
      />
      <div className="mb-1 flex items-center gap-2">
        <span className="text-[9px] text-slate-500">字号</span>
        <RfRangeInput
          min={12}
          max={96}
          value={Number(d.fontSize) || 36}
          onChange={e => patch({ fontSize: Number(e.target.value) })}
          className="flex-1 accent-indigo-500"
        />
      </div>
      <input
        type="color"
        value={String(d.color || '#ffffff')}
        onChange={e => patch({ color: e.target.value })}
        className="h-7 w-full cursor-pointer rounded border border-slate-700"
      />
    </Shell>
  )
}

function StColorNode({ id, data }: NodeProps) {
  const { setNodes } = useReactFlow()
  const d = data as Record<string, unknown>
  const tpl = d.tpl as StageTplId
  const presets = (Array.isArray(d.presets) ? d.presets : []) as string[]
  const patch = useCallback(
    (partial: Record<string, unknown>) => {
      setNodes(nds => nds.map(n => (n.id === id ? { ...n, data: { ...n.data, ...partial } } : n)))
    },
    [id, setNodes],
  )
  const addPreset = () => {
    const c = String(d.color || '#ffffff')
    if (presets.includes(c)) return
    patch({ presets: [...presets, c].slice(-8) })
  }
  return (
    <Shell
      title={stageNodeCardTitle('改色', tpl)}
      subtitle="连线到遮罩层/底层/元素/字体"
      handles={
        <>
          <Handle type="target" position={Position.Left} id="in" className={hcls()} />
          <Handle type="source" position={Position.Right} id="out" className={hcls()} />
        </>
      }
    >
      <div className="flex gap-2">
        <input
          type="color"
          value={String(d.color || '#ffffff')}
          onChange={e => patch({ color: e.target.value })}
          className="h-10 w-14 cursor-pointer rounded border border-slate-600"
        />
        <button
          type="button"
          onClick={addPreset}
          className="flex-1 rounded border border-slate-600 text-[10px] text-slate-300 hover:bg-slate-800/50"
        >
          加入预设
        </button>
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {presets.map((p, i) => (
          <button
            key={`${p}-${i}`}
            type="button"
            className="h-6 w-6 rounded border border-slate-600"
            style={{ background: p }}
            title={p}
            onClick={() => patch({ color: p })}
          />
        ))}
      </div>
    </Shell>
  )
}

function StGlowNode({ id, data }: NodeProps) {
  const { setNodes } = useReactFlow()
  const d = data as Record<string, unknown>
  const tpl = d.tpl as StageTplId
  const g = (d.glow as StageGlow) || { enabled: true, color: '#fff', size: 14, opacity: 0.55 }
  const patchGlow = useCallback(
    (gp: Partial<StageGlow>) => {
      setNodes(nds =>
        nds.map(n => {
          if (n.id !== id) return n
          const cur = (n.data as { glow?: StageGlow }).glow || g
          return { ...n, data: { ...n.data, glow: { ...cur, ...gp } } }
        }),
      )
    },
    [id, setNodes, g],
  )
  return (
    <Shell
      title={stageNodeCardTitle('外发光', tpl)}
      subtitle="接元素/字体右侧输出，或右侧连到图层顶栏发光口"
      handles={
        <>
          <Handle type="target" position={Position.Left} id="in" className={hcls()} />
          <Handle type="source" position={Position.Right} id="out-elem" className={hcls()} style={{ top: '35%' }} />
          <Handle type="source" position={Position.Right} id="out-font" className={hcls()} style={{ top: '65%' }} />
        </>
      }
    >
      <label className="mb-2 flex items-center gap-2 text-[11px] text-slate-200">
        <input type="checkbox" checked={g.enabled} onChange={e => patchGlow({ enabled: e.target.checked })} />
        启用
      </label>
      <div className="flex gap-2">
        <input type="color" value={g.color} onChange={e => patchGlow({ color: e.target.value })} className="h-8 w-12 rounded border" />
        <div className="flex-1 space-y-1 text-[9px] text-slate-500">
          <div>范围 {Math.round(g.size)}</div>
          <RfRangeInput
            min={0}
            max={48}
            value={g.size}
            onChange={e => patchGlow({ size: Number(e.target.value) })}
            className="w-full accent-indigo-500"
          />
          <div>强度 {Math.round(g.opacity * 100)}%</div>
          <RfRangeInput
            min={0}
            max={1}
            step={0.02}
            value={g.opacity}
            onChange={e => patchGlow({ opacity: Number(e.target.value) })}
            className="w-full accent-indigo-500"
          />
        </div>
      </div>
    </Shell>
  )
}

/** 与 findPreviewNode 一致的导出尺寸钳制，用于缩略预览 CSS 与画布比例一致，避免 max-height + 固定 width 把 canvas 压扁 */
function previewExportSize(d: Record<string, unknown>): { w: number; h: number } {
  const clampDim = (n: number) => Math.max(32, Math.min(4096, n))
  return {
    w: clampDim(typeof d.width === 'number' ? d.width : 400),
    h: clampDim(typeof d.height === 'number' ? d.height : 400),
  }
}

function StPreviewNode({ id, data }: NodeProps) {
  const { setNodes, getNodes, getEdges } = useReactFlow()
  const d = data as Record<string, unknown>
  const tpl = d.tpl as StageTplId
  const [previewReady, setPreviewReady] = useState(false)
  const patch = useCallback(
    (partial: Record<string, unknown>) => {
      setNodes(nds => nds.map(n => (n.id === id ? { ...n, data: { ...n.data, ...partial } } : n)))
    },
    [id, setNodes],
  )
  const setPreviewDimension = useCallback(
    (key: 'width' | 'height', raw: string) => {
      setNodes(nds =>
        nds.map(n => {
          if (n.id !== id) return n
          const next = { ...(n.data as Record<string, unknown>) }
          const t = raw.trim()
          if (t === '') {
            delete next[key]
          } else {
            const num = Number(t)
            if (Number.isFinite(num)) next[key] = num
          }
          return { ...n, data: next }
        }),
      )
    },
    [id, setNodes],
  )
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const getCached = useStageImageCache()

  /** 依赖 flowNodes / flowEdges：连线与上游变化重画；未连回舞台层不渲染；已连接时只画该预览反向可达的图层 */
  useEffect(() => {
    let t = 0
    let alive = true
    const tick = () => {
      t = window.setTimeout(async () => {
        const nodes = getNodes()
        const edges = getEdges()
        const self = nodes.find(n => n.id === id)
        const d0 = (self?.data || {}) as Record<string, unknown>
        const { w: width, h: height } = previewExportSize(d0)
        const c = canvasRef.current
        if (!c || !alive) return
        const ctx = c.getContext('2d')
        if (!ctx) return
        const ready = stagePreviewLinkedToRoot(edges, nodes, id)
        setPreviewReady(prev => (prev === ready ? prev : ready))
        const sw = 200
        const sh = Math.max(1, Math.round((height / width) * sw))
        c.width = sw
        c.height = sh
        ctx.clearRect(0, 0, sw, sh)
        if (!ready) {
          ctx.fillStyle = 'rgb(15 23 42 / 0.92)'
          ctx.fillRect(0, 0, sw, sh)
          ctx.fillStyle = 'rgb(148 163 184 / 0.95)'
          ctx.font = '10px system-ui,sans-serif'
          ctx.textAlign = 'center'
          ctx.textBaseline = 'middle'
          ctx.fillText('请接入画布链路', sw / 2, sh / 2 - 6)
          ctx.fillStyle = 'rgb(100 116 139 / 0.9)'
          ctx.font = '9px system-ui,sans-serif'
          ctx.fillText('左侧连上游至舞台层', sw / 2, sh / 2 + 8)
          return
        }
        const out = await renderStageDualTemplate(nodes, tpl, width, height, PREVIEW_NORM, getCached, {
          previewNodeId: id,
          edges,
        }).catch(() => null)
        if (!out || !alive) return
        ctx.drawImage(out, 0, 0, sw, sh)
      }, 120)
    }
    tick()
    const iv = window.setInterval(tick, 800)
    return () => {
      alive = false
      clearTimeout(t)
      clearInterval(iv)
    }
  }, [getNodes, getEdges, getCached, id, tpl])

  const { w: pvW, h: pvH } = previewExportSize(d)
  const THUMB_BASE = 200
  const thumbBitmapH = Math.max(1, Math.round((pvH / pvW) * THUMB_BASE))
  const MAX_THUMB_CSS_H = 160
  let thumbCssW = THUMB_BASE
  let thumbCssH = thumbBitmapH
  if (thumbCssH > MAX_THUMB_CSS_H) {
    const s = MAX_THUMB_CSS_H / thumbCssH
    thumbCssW = Math.max(1, Math.round(thumbCssW * s))
    thumbCssH = MAX_THUMB_CSS_H
  }

  const exportOne = async () => {
    const nodes = getNodes()
    const edges = getEdges()
    if (!stagePreviewLinkedToRoot(edges, nodes, id)) return
    const { w: width, h: height } = previewExportSize(d)
    const fileName = String(d.fileName || 'stage-export').trim() || 'stage-export'
    const canvas = await renderStageDualTemplate(nodes, tpl, width, height, PREVIEW_NORM, getCached, {
      previewNodeId: id,
      edges,
    })
    const a = document.createElement('a')
    a.href = canvas.toDataURL('image/png')
    a.download = `${fileName.replace(/\.png$/i, '') || 'stage-export'}.png`
    a.click()
  }

  return (
    <Shell
      title={stageNodeCardTitle('预览', tpl)}
      subtitle="尺寸 · 文件名 · 单独导出"
      handles={
        <>
          <Handle type="target" position={Position.Left} id="in" className={hcls()} />
          <Handle
            type="source"
            position={Position.Right}
            id="to-batch"
            className={hcls()}
            title="接到批量导出（可多预览共接一批量节点）"
          />
        </>
      }
    >
      <div className="mb-2 grid grid-cols-2 gap-2 text-[10px]">
        <div>
          <div className="mb-0.5 text-slate-500">宽</div>
          <input
            type="text"
            inputMode="numeric"
            placeholder="默认 400"
            value={typeof d.width === 'number' && Number.isFinite(d.width) ? String(d.width) : ''}
            onChange={e => setPreviewDimension('width', e.target.value)}
            className="w-full rounded border border-slate-700 bg-slate-950/50 px-1 py-1 text-slate-200"
          />
        </div>
        <div>
          <div className="mb-0.5 text-slate-500">高</div>
          <input
            type="text"
            inputMode="numeric"
            placeholder="默认 400"
            value={typeof d.height === 'number' && Number.isFinite(d.height) ? String(d.height) : ''}
            onChange={e => setPreviewDimension('height', e.target.value)}
            className="w-full rounded border border-slate-700 bg-slate-950/50 px-1 py-1 text-slate-200"
          />
        </div>
      </div>
      <input
        value={String(d.fileName || '')}
        onChange={e => patch({ fileName: e.target.value })}
        placeholder="导出文件名"
        className="mb-2 w-full rounded border border-slate-700/50 bg-slate-950/50 px-2 py-1 text-[11px] text-slate-200"
      />
      <div className="mb-2 border border-slate-800 bg-slate-950/40 p-1">
        <canvas
          ref={canvasRef}
          className="mx-auto block rounded-none bg-black/20"
          style={{ width: thumbCssW, height: thumbCssH }}
        />
        <p className="mt-1 text-center text-[9px] text-slate-500">
          {previewReady ? '缩略预览（仅已连线图层）' : '未接舞台层时不生成画面'}
        </p>
      </div>
      <button
        type="button"
        disabled={!previewReady}
        onClick={() => void exportOne()}
        className={`w-full rounded-lg py-2 text-[12px] font-medium text-white ${
          previewReady ? 'bg-indigo-600 hover:bg-indigo-700' : 'cursor-not-allowed bg-slate-700/80 text-slate-400'
        }`}
      >
        单独导出 PNG
      </button>
    </Shell>
  )
}

function StBatchNode({ id }: NodeProps) {
  const { getNodes, getEdges } = useReactFlow()
  const getCached = useStageImageCache()
  const [zipBusy, setZipBusy] = useState(false)
  const zipRunRef = useRef(false)

  const previewAll = useCallback(async () => {
    const nodes = getNodes()
    const edges = getEdges()
    const previewIds = orderedPreviewSourcesForBatch(edges, id, nodes)
    const w = window.open('', '_blank')
    if (!w) return

    type Row = { label: string; dataUrl: string }
    const rows: Row[] = []

    if (previewIds.length > 0) {
      for (const pid of previewIds) {
        const pn = nodes.find(x => x.id === pid)
        const meta = pn ? metaFromPreviewNode(pn) : null
        if (!meta) continue
        const canvas = await renderStageDualTemplate(
          nodes,
          meta.tpl,
          meta.width,
          meta.height,
          PREVIEW_NORM,
          getCached,
          { previewNodeId: pid, edges },
        )
        rows.push({
          label: `${meta.fileName} · ${meta.width}×${meta.height}`,
          dataUrl: canvas.toDataURL('image/png'),
        })
      }
    } else {
      const a = findPreviewNode(nodes, 'a')
      const b = findPreviewNode(nodes, 'b')
      const ca = await renderStageDualTemplate(nodes, 'a', a.width, a.height, PREVIEW_NORM, getCached)
      const cb = await renderStageDualTemplate(nodes, 'b', b.width, b.height, PREVIEW_NORM, getCached)
      rows.push(
        { label: `主画布 ${a.width}×${a.height}`, dataUrl: ca.toDataURL('image/png') },
        { label: `第二画布 ${b.width}×${b.height}`, dataUrl: cb.toDataURL('image/png') },
      )
    }

    if (rows.length === 0) {
      w.document.write(
        `<html><body style="margin:0;background:#0f172a;color:#94a3b8;font:14px sans-serif;padding:24px">未找到预览：请将预览节点右侧接到本节点左侧，或未连线时使用默认 A/B 双画布。</body></html>`,
      )
      return
    }

    const blocks = rows
      .map(
        r =>
          `<div><div style="color:#94a3b8;font:12px sans-serif;margin-bottom:8px">${escapeHtml(r.label)}</div><img src="${r.dataUrl}" style="max-width:45vw;border:1px solid #334155;border-radius:8px"/></div>`,
      )
      .join('')
    w.document.write(
      `<html><body style="margin:0;background:#0f172a;display:flex;gap:16px;padding:16px;flex-wrap:wrap">${blocks}</body></html>`,
    )
  }, [getNodes, getEdges, getCached, id])

  const batchZip = useCallback(async () => {
    if (zipRunRef.current) return
    zipRunRef.current = true
    setZipBusy(true)
    try {
      const nodes = getNodes()
      const edges = getEdges()
      const previewIds = orderedPreviewSourcesForBatch(edges, id, nodes)
      const zip = new JSZip()
      const usedNames = new Set<string>()

      const addPngToZip = async (baseName: string, canvas: HTMLCanvasElement) => {
        let stem = baseName.replace(/\.png$/i, '').replace(/[/\\?%*:|"<>]/g, '_') || 'export'
        let fname = `${stem}.png`
        let n = 1
        while (usedNames.has(fname)) {
          fname = `${stem}-${n}.png`
          n++
        }
        usedNames.add(fname)
        const pngBlob = await canvasToPngBlob(canvas)
        zip.file(fname, pngBlob)
      }

      if (previewIds.length > 0) {
        for (const pid of previewIds) {
          const pn = nodes.find(x => x.id === pid)
          const meta = pn ? metaFromPreviewNode(pn) : null
          if (!meta) continue
          let canvas: HTMLCanvasElement
          try {
            canvas = await renderStageDualTemplate(
              nodes,
              meta.tpl,
              meta.width,
              meta.height,
              PREVIEW_NORM,
              getCached,
              { previewNodeId: pid, edges },
            )
          } catch (e) {
            console.error('[batchZip] render preview', pid, e)
            continue
          }
          await addPngToZip(meta.fileName, canvas)
          await new Promise<void>(r => requestAnimationFrame(() => r()))
        }
      } else {
        const za = findPreviewNode(nodes, 'a')
        const zb = findPreviewNode(nodes, 'b')
        let ca: HTMLCanvasElement
        let cb: HTMLCanvasElement
        try {
          ca = await renderStageDualTemplate(nodes, 'a', za.width, za.height, PREVIEW_NORM, getCached)
        } catch (e) {
          console.error('[batchZip] render A', e)
          throw new Error('主画布渲染失败，请检查舞台与图层连线')
        }
        await addPngToZip(za.fileName, ca)
        await new Promise<void>(r => requestAnimationFrame(() => r()))
        try {
          cb = await renderStageDualTemplate(nodes, 'b', zb.width, zb.height, PREVIEW_NORM, getCached)
        } catch (e) {
          console.error('[batchZip] render B', e)
          throw new Error('第二画布渲染失败，请检查舞台与图层连线')
        }
        await addPngToZip(zb.fileName, cb)
      }

      if (usedNames.size === 0) {
        window.alert('没有可导出的内容：请将预览节点右侧连到本节点左侧，或确认预览已接入舞台链路。')
        return
      }

      const blob = await zip.generateAsync({
        type: 'blob',
        compression: 'STORE',
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'stage-dual-export.zip'
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      console.error('[batchZip]', e)
      const msg =
        e instanceof Error
          ? e.message
          : '导出失败：请缩小各预览的宽/高（建议单张边长 ≤2048）或减少同时导出的预览数量。'
      window.alert(msg)
    } finally {
      zipRunRef.current = false
      setZipBusy(false)
    }
  }, [getNodes, getEdges, getCached, id])

  return (
    <Shell
      title="批量导出"
      subtitle="多预览右侧接入左侧原点 · 新窗口 / ZIP"
      handles={
        <Handle
          type="target"
          position={Position.Left}
          id="in"
          className={hcls()}
          isConnectable
          title="可接多条预览连线"
        />
      }
    >
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => void previewAll()}
          className="rounded-lg border border-slate-700/55 bg-slate-950/22 py-2 text-[12px] text-slate-200 transition hover:border-slate-600/60 hover:bg-slate-950/32"
        >
          全部预览（新窗口）
        </button>
        <button
          type="button"
          disabled={zipBusy}
          onClick={() => void batchZip()}
          className={`rounded-lg py-2 text-[12px] font-medium text-white ${
            zipBusy
              ? 'cursor-wait bg-indigo-900/60 text-indigo-200/80'
              : 'bg-indigo-600 hover:bg-indigo-700'
          }`}
        >
          {zipBusy ? '正在打包…' : '一键导出 ZIP'}
        </button>
      </div>
    </Shell>
  )
}

function createDefaultNodes(): Node[] {
  const y = (i: number) => 20 + i * 118
  const colA = 40
  const colB = 620
  const mk = (
    id: string,
    type: string,
    x: number,
    yi: number,
    data: Record<string, unknown>,
  ): Node => ({
    id,
    type,
    position: { x, y: y(yi) },
    data,
  })
  return [
    mk('root-stage', 'stRoot', -320, 3, {
      title: '舞台层',
      sharedCharacter: null,
      stageElement: null,
    }),
    {
      id: 'a-tpl-hub',
      type: 'stTemplateHub',
      position: { x: -140, y: 156 },
      data: { title: '模板命名层', tpl: 'a', templateName: '' },
    },
    {
      id: 'b-tpl-hub',
      type: 'stTemplateHub',
      position: { x: colB - 180, y: 156 },
      data: { title: '模板命名层', tpl: 'b', templateName: '' },
    },
    mk('a-bottom', 'stBottom', colA, 0, {
      title: '底层',
      tpl: 'a',
      zLevel: 1,
      mode: 'solid',
      color: '#1a1a2e',
      image: null,
      linkedColorSource: null,
    }),
    mk('a-char', 'stCharacter', colA, 1, { title: '角色层', tpl: 'a', zLevel: 2, offsetX: 0, offsetY: 0, scale: 1 }),
    mk('a-stage-elm', 'stStageElm', colA + 270, 1, {
      title: '元素层',
      tpl: 'a',
      zLevel: 2,
      offsetX: 0,
      offsetY: 0,
      scale: 1,
    }),
    mk('a-mask', 'stMask', colA, 2, {
      title: '遮罩层',
      tpl: 'a',
      zLevel: 3,
      color: '#000000',
      opacity: 0,
      linkedColorSource: null,
      maskLayer: stageMaskBuiltinLayer(),
      reach: 0.76,
      falloff: 1,
    }),
    mk('a-elem', 'stElement', colA, 3, {
      title: '元素',
      tpl: 'a',
      zLevel: 4,
      layer: null,
      offsetX: 0,
      offsetY: 0,
      scale: 1,
      linkedColorSource: null,
      linkedGlowSource: null,
    }),
    mk('a-font', 'stFont', colA, 4, {
      title: '字体',
      tpl: 'a',
      zLevel: 5,
      text1: '',
      text2: '',
      fontSize: 36,
      fontFamily: 'system-ui, sans-serif',
      color: '#ffffff',
      linkedColorSource: null,
      linkedGlowSource: null,
    }),
    mk('a-color', 'stColor', colA - 200, 2, { title: '改色', tpl: 'a', color: '#ffffff', presets: [] }),
    mk('a-glow', 'stGlow', colA - 200, 4, {
      title: '外发光',
      tpl: 'a',
      glow: { enabled: false, color: '#ffffff', size: 14, opacity: 0.55 },
    }),
    mk('a-preview', 'stPreview', colA + 320, 2, {
      title: '预览',
      tpl: 'a',
      width: 400,
      height: 400,
      fileName: 'stage-main',
    }),
    mk('b-bottom', 'stBottom', colB, 0, {
      title: '底层',
      tpl: 'b',
      zLevel: 1,
      mode: 'solid',
      color: '#0f172a',
      image: null,
      linkedColorSource: null,
    }),
    mk('b-char', 'stCharacter', colB, 1, { title: '角色层', tpl: 'b', zLevel: 2, offsetX: 0, offsetY: 0, scale: 1 }),
    mk('b-stage-elm', 'stStageElm', colB + 270, 1, {
      title: '元素层',
      tpl: 'b',
      zLevel: 2,
      offsetX: 0,
      offsetY: 0,
      scale: 1,
    }),
    mk('b-mask', 'stMask', colB, 2, {
      title: '遮罩层',
      tpl: 'b',
      zLevel: 3,
      color: '#000000',
      opacity: 0,
      linkedColorSource: null,
      maskLayer: stageMaskBuiltinLayer(),
      reach: 0.76,
      falloff: 1,
    }),
    mk('b-elem', 'stElement', colB, 3, {
      title: '元素',
      tpl: 'b',
      zLevel: 4,
      layer: null,
      offsetX: 0,
      offsetY: 0,
      scale: 1,
      linkedColorSource: null,
      linkedGlowSource: null,
    }),
    mk('b-font', 'stFont', colB, 4, {
      title: '字体',
      tpl: 'b',
      zLevel: 5,
      text1: '',
      text2: '',
      fontSize: 36,
      fontFamily: 'system-ui, sans-serif',
      color: '#e2e8f0',
      linkedColorSource: null,
      linkedGlowSource: null,
    }),
    mk('b-color', 'stColor', colB - 200, 2, { title: '改色', tpl: 'b', color: '#e2e8f0', presets: [] }),
    mk('b-glow', 'stGlow', colB - 200, 4, {
      title: '外发光',
      tpl: 'b',
      glow: { enabled: false, color: '#fff', size: 14, opacity: 0.55 },
    }),
    mk('b-preview', 'stPreview', colB + 320, 2, {
      title: '预览',
      tpl: 'b',
      width: 400,
      height: 400,
      fileName: 'stage-second',
    }),
    mk('batch-out', 'stBatch', colB + 720, 2, { title: '批量导出' }),
  ]
}

function createDefaultEdges(): Edge[] {
  const stroke = { stroke: STAGE_EDGE_STROKE_MAIN }
  return [
    { id: 'e-root-a-hub', source: 'root-stage', target: 'a-tpl-hub', targetHandle: 'in', animated: true, style: stroke },
    { id: 'e-root-b-hub', source: 'root-stage', target: 'b-tpl-hub', targetHandle: 'in', animated: true, style: stroke },
    {
      id: 'e-hub-a-bottom',
      source: 'a-tpl-hub',
      sourceHandle: 'out',
      target: 'a-bottom',
      targetHandle: 'feed',
      animated: true,
      style: stroke,
    },
    {
      id: 'e-hub-b-bottom',
      source: 'b-tpl-hub',
      sourceHandle: 'out',
      target: 'b-bottom',
      targetHandle: 'feed',
      animated: true,
      style: stroke,
    },
    {
      id: 'e-hub-a-char',
      source: 'a-tpl-hub',
      sourceHandle: 'out',
      target: 'a-char',
      targetHandle: 'in',
      animated: true,
      style: { stroke: STAGE_EDGE_STROKE_MUTED },
    },
    {
      id: 'e-hub-b-char',
      source: 'b-tpl-hub',
      sourceHandle: 'out',
      target: 'b-char',
      targetHandle: 'in',
      animated: true,
      style: { stroke: STAGE_EDGE_STROKE_MUTED },
    },
    {
      id: 'e-hub-a-se',
      source: 'a-tpl-hub',
      sourceHandle: 'out',
      target: 'a-stage-elm',
      targetHandle: 'in',
      animated: true,
      style: { stroke: STAGE_EDGE_STROKE_MUTED },
    },
    {
      id: 'e-hub-b-se',
      source: 'b-tpl-hub',
      sourceHandle: 'out',
      target: 'b-stage-elm',
      targetHandle: 'in',
      animated: true,
      style: { stroke: STAGE_EDGE_STROKE_MUTED },
    },
    {
      id: 'e-hub-a-mask',
      source: 'a-tpl-hub',
      sourceHandle: 'out',
      target: 'a-mask',
      targetHandle: 'in',
      animated: true,
      style: { stroke: STAGE_EDGE_STROKE_MUTED },
    },
    {
      id: 'e-hub-b-mask',
      source: 'b-tpl-hub',
      sourceHandle: 'out',
      target: 'b-mask',
      targetHandle: 'in',
      animated: true,
      style: { stroke: STAGE_EDGE_STROKE_MUTED },
    },
    { id: 'e-a-c-se', source: 'a-char', target: 'a-stage-elm', animated: true, style: { stroke: STAGE_EDGE_STROKE_MUTED } },
    { id: 'e-a-se-m', source: 'a-stage-elm', target: 'a-mask', animated: true, style: { stroke: STAGE_EDGE_STROKE_MUTED } },
    { id: 'e-a-m-e', source: 'a-mask', target: 'a-elem', animated: true, style: { stroke: STAGE_EDGE_STROKE_MUTED } },
    { id: 'e-a-e-f', source: 'a-elem', target: 'a-font', animated: true, style: { stroke: STAGE_EDGE_STROKE_MUTED } },
    { id: 'e-a-f-p', source: 'a-font', target: 'a-preview', animated: true, style: { stroke: STAGE_EDGE_STROKE_BRIGHT } },
    { id: 'e-b-c-se', source: 'b-char', target: 'b-stage-elm', animated: true, style: { stroke: STAGE_EDGE_STROKE_MUTED } },
    { id: 'e-b-se-m', source: 'b-stage-elm', target: 'b-mask', animated: true, style: { stroke: STAGE_EDGE_STROKE_MUTED } },
    { id: 'e-b-m-e', source: 'b-mask', target: 'b-elem', animated: true, style: { stroke: STAGE_EDGE_STROKE_MUTED } },
    { id: 'e-b-e-f', source: 'b-elem', target: 'b-font', animated: true, style: { stroke: STAGE_EDGE_STROKE_MUTED } },
    { id: 'e-b-f-p', source: 'b-font', target: 'b-preview', animated: true, style: { stroke: STAGE_EDGE_STROKE_BRIGHT } },
    {
      id: 'e-a-p-batch',
      source: 'a-preview',
      sourceHandle: 'to-batch',
      target: 'batch-out',
      targetHandle: 'in',
      animated: true,
      style: stroke,
    },
    {
      id: 'e-b-p-batch',
      source: 'b-preview',
      sourceHandle: 'to-batch',
      target: 'batch-out',
      targetHandle: 'in',
      animated: true,
      style: stroke,
    },
  ]
}

type StagePaneAddSpec =
  | { rfType: 'stRoot' }
  | { rfType: 'stTemplateHub' }
  | { rfType: 'stBatch' }
  | { rfType: 'stBottom' }
  | { rfType: 'stCharacter' }
  | { rfType: 'stStageElm' }
  | { rfType: 'stMask' }
  | { rfType: 'stElement' }
  | { rfType: 'stFont' }
  | { rfType: 'stColor' }
  | { rfType: 'stGlow' }
  | { rfType: 'stPreview' }

/** 右键菜单新增的图层组件统一走主轨（与渲染管线 tpl 字段一致，仅保留 a） */
const PANE_ADD_TPL: StageTplId = 'a'

function newStageId(s: string): string {
  return `st-${s}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
}

function createStageNodeAt(spec: StagePaneAddSpec, flowPos: { x: number; y: number }): Node {
  const tpl = PANE_ADD_TPL
  switch (spec.rfType) {
    case 'stRoot':
      return {
        id: newStageId('root'),
        type: 'stRoot',
        position: flowPos,
        data: { title: '舞台层', sharedCharacter: null, stageElement: null },
      }
    case 'stTemplateHub':
      return {
        id: newStageId('tplhub'),
        type: 'stTemplateHub',
        position: flowPos,
        data: { title: '模板命名层', tpl, templateName: '' },
      }
    case 'stBatch':
      return {
        id: newStageId('batch'),
        type: 'stBatch',
        position: flowPos,
        data: { title: '批量导出' },
      }
    case 'stBottom':
      return {
        id: newStageId('bottom'),
        type: 'stBottom',
        position: flowPos,
        data: {
          title: '底层',
          tpl,
          zLevel: 1,
          mode: 'solid',
          color: '#1a1a2e',
          image: null,
          linkedColorSource: null,
        },
      }
    case 'stCharacter':
      return {
        id: newStageId('char'),
        type: 'stCharacter',
        position: flowPos,
        data: { title: '角色层', tpl, zLevel: 2, offsetX: 0, offsetY: 0, scale: 1 },
      }
    case 'stStageElm':
      return {
        id: newStageId('stagel'),
        type: 'stStageElm',
        position: flowPos,
        data: { title: '元素层', tpl, zLevel: 2, offsetX: 0, offsetY: 0, scale: 1 },
      }
    case 'stMask':
      return {
        id: newStageId('mask'),
        type: 'stMask',
        position: flowPos,
        data: {
          title: '遮罩层',
          tpl,
          zLevel: 3,
          color: '#000000',
          opacity: 0,
          linkedColorSource: null,
          maskLayer: stageMaskBuiltinLayer(),
          reach: 0.76,
          falloff: 1,
        },
      }
    case 'stElement':
      return {
        id: newStageId('elem'),
        type: 'stElement',
        position: flowPos,
        data: {
          title: '元素',
          tpl,
          zLevel: 4,
          layer: null,
          offsetX: 0,
          offsetY: 0,
          scale: 1,
          linkedColorSource: null,
          linkedGlowSource: null,
        },
      }
    case 'stFont':
      return {
        id: newStageId('font'),
        type: 'stFont',
        position: flowPos,
        data: {
          title: '字体',
          tpl,
          zLevel: 5,
          text1: '',
          text2: '',
          fontSize: 36,
          fontFamily: 'system-ui, sans-serif',
          color: '#ffffff',
          linkedColorSource: null,
          linkedGlowSource: null,
        },
      }
    case 'stColor':
      return {
        id: newStageId('color'),
        type: 'stColor',
        position: flowPos,
        data: { title: '改色', tpl, color: '#ffffff', presets: [] },
      }
    case 'stGlow':
      return {
        id: newStageId('glow'),
        type: 'stGlow',
        position: flowPos,
        data: {
          title: '外发光',
          tpl,
          glow: { enabled: false, color: '#ffffff', size: 14, opacity: 0.55 },
        },
      }
    case 'stPreview':
      return {
        id: newStageId('preview'),
        type: 'stPreview',
        position: flowPos,
        data: {
          title: '预览',
          tpl,
          width: 400,
          height: 400,
          fileName: 'stage-export',
        },
      }
    default: {
      const _exhaust: never = spec
      throw new Error(`unexpected stage spec ${String(_exhaust)}`)
    }
  }
}

const STAGE_PANE_OPTIONS: { section?: string; spec: StagePaneAddSpec; title: string; desc: string }[] = [
  {
    section: '基础',
    spec: { rfType: 'stRoot' },
    title: '舞台层',
    desc: '角色层与元素层；建议经「模板命名层」再分路到各图层',
  },
  {
    spec: { rfType: 'stTemplateHub' },
    title: '模板命名层',
    desc: '舞台层与各图层间收口：左侧接舞台，右侧单口可拖多线到底层/角色/元素层/遮罩层等',
  },
  {
    section: '组件',
    spec: { rfType: 'stBottom' },
    title: '底层',
    desc: '纯色或底图；可多放几个，用 Z 排序',
  },
  {
    spec: { rfType: 'stCharacter' },
    title: '角色层',
    desc: '位置与缩放（角色图在舞台层上传）',
  },
  {
    spec: { rfType: 'stStageElm' },
    title: '元素层',
    desc: '控制舞台层「元素层」图的位置与缩放（需先在舞台层上传该图）',
  },
  { spec: { rfType: 'stMask' }, title: '遮罩层', desc: '底图着色 · 自下而上渐变透明（同戳戳）' },
  { spec: { rfType: 'stFont' }, title: '字体', desc: '主副标题文案' },
  { spec: { rfType: 'stColor' }, title: '改色', desc: '拖线到各层顶部改色口' },
  { spec: { rfType: 'stGlow' }, title: '外发光', desc: '元素/字体右侧接入，或拖到顶栏发光口' },
  {
    section: '输出',
    spec: { rfType: 'stPreview' },
    title: '预览',
    desc: '缩略预览与单张 PNG；右侧可接批量导出',
  },
  {
    spec: { rfType: 'stBatch' },
    title: '批量导出',
    desc: '左侧单口可多线接各预览右侧；新窗口 / ZIP',
  },
]

const nodeTypes = {
  stRoot: StRootNode,
  stTemplateHub: StTemplateHubNode,
  stBottom: StBottomNode,
  stCharacter: StCharacterNode,
  stStageElm: StStageElmNode,
  stMask: StMaskNode,
  stElement: StElementNode,
  stFont: StFontNode,
  stColor: StColorNode,
  stGlow: StGlowNode,
  stPreview: StPreviewNode,
  stBatch: StBatchNode,
}

const edgeTypes = { default: PokeDeletableBezierEdge }

/** 旧版只在外发光→顶栏发光口时写入 linkedGlowSource；补全「元素/字体 out → 外发光 in」的持久化数据 */
function syncGlowLinksFromEdges(nodes: Node[], edges: Edge[]): Node[] {
  const byId = new Map(nodes.map(n => [n.id, n]))
  const elemToGlow = new Map<string, string>()
  for (const e of edges) {
    if (e.targetHandle !== 'in') continue
    const src = byId.get(e.source)
    const tgt = byId.get(e.target)
    if (
      src &&
      tgt &&
      (src.type === 'stElement' || src.type === 'stFont') &&
      tgt.type === 'stGlow'
    ) {
      elemToGlow.set(e.source, e.target)
    }
  }
  if (elemToGlow.size === 0) return nodes
  return nodes.map(n => {
    const glowId = elemToGlow.get(n.id)
    if (!glowId) return n
    const d = n.data as Record<string, unknown>
    if (typeof d.linkedGlowSource === 'string' && d.linkedGlowSource) return n
    return { ...n, data: { ...d, linkedGlowSource: glowId } }
  })
}

/** 旧版模板命名层四个 sourceHandle → 现统一为 out，避免读档后断线 */
function migrateTemplateHubOutEdges(nodes: Node[], edges: Edge[]): Edge[] {
  const old = new Set(['out-bottom', 'out-char', 'out-stageElm', 'out-mask'])
  const byId = new Map(nodes.map(n => [n.id, n]))
  return edges.map(e => {
    const src = byId.get(e.source)
    if (src?.type !== 'stTemplateHub') return e
    if (!e.sourceHandle || !old.has(e.sourceHandle)) return e
    return { ...e, sourceHandle: 'out' }
  })
}

/** 遮罩节点与戳戳遮罩层对齐：补全底图 / 渐变参数，去掉旧版位移缩放字段 */
function migrateStageMaskNodes(nodes: Node[]): Node[] {
  return nodes.map(n => {
    if (n.type !== 'stMask') return n
    const d = n.data as Record<string, unknown>
    const mlRaw = d.maskLayer as { dataUrl?: string; name?: string } | undefined
    const maskLayer: StageDataUrlImage =
      mlRaw?.dataUrl
        ? { dataUrl: mlRaw.dataUrl, name: typeof mlRaw.name === 'string' ? mlRaw.name : '遮罩底图' }
        : stageMaskBuiltinLayer()
    const reach =
      typeof d.reach === 'number' && Number.isFinite(d.reach)
        ? Math.max(MASK_UI_MIN_REACH, Math.min(MASK_UI_MAX_REACH, d.reach))
        : 0.76
    const falloff =
      typeof d.falloff === 'number' && Number.isFinite(d.falloff)
        ? Math.max(MASK_UI_MIN_FALLOFF, Math.min(MASK_UI_MAX_FALLOFF, d.falloff))
        : 1
    return {
      ...n,
      data: {
        title: String(d.title ?? '遮罩层'),
        tpl: d.tpl as StageTplId,
        zLevel: typeof d.zLevel === 'number' ? d.zLevel : 3,
        color: String(d.color ?? '#000000'),
        opacity:
          typeof d.opacity === 'number'
            ? Math.max(0, Math.min(MASK_UI_MAX_OPACITY, d.opacity))
            : 0,
        linkedColorSource: (d.linkedColorSource as string | null) ?? null,
        maskLayer,
        reach,
        falloff,
      },
    }
  })
}

const STAGE_FLOW_VER_MASK_SLIDER_200 = 4

function loadStored(): { nodes: Node[]; edges: Edge[] } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as { nodes?: Node[]; edges?: Edge[]; flowVer?: number }
    if (!Array.isArray(p.nodes)) return null
    const edgesIn = Array.isArray(p.edges) ? p.edges : []
    let nodesRaw = p.nodes
    let flowVer = typeof p.flowVer === 'number' ? p.flowVer : 3
    if (flowVer < STAGE_FLOW_VER_MASK_SLIDER_200) {
      nodesRaw = nodesRaw.map(n => {
        if (n.type !== 'stMask') return n
        const d = n.data as Record<string, unknown>
        const r = typeof d.reach === 'number' && Number.isFinite(d.reach) ? d.reach : 0.38
        const nextReach = r <= 1.0001 ? Math.min(MASK_UI_MAX_REACH, r * 2) : Math.min(MASK_UI_MAX_REACH, r)
        const op = typeof d.opacity === 'number' && Number.isFinite(d.opacity) ? d.opacity : 0
        const nextOp =
          op <= 0 ? op : op <= 1.0001 ? Math.min(MASK_UI_MAX_OPACITY, op * 2) : Math.min(MASK_UI_MAX_OPACITY, op)
        return { ...n, data: { ...d, reach: nextReach, opacity: nextOp } }
      })
      flowVer = STAGE_FLOW_VER_MASK_SLIDER_200
      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ ...p, nodes: nodesRaw, edges: edgesIn, flowVer }),
        )
      } catch {
        /* ignore */
      }
    }
    const edges = edgesIn
    const nodes = migrateStageMaskNodes(syncGlowLinksFromEdges(nodesRaw, edges))
    const migrated = migrateStageDualEdgeAppearance(edges)
    return { nodes, edges: migrateTemplateHubOutEdges(nodesRaw, migrated) }
  } catch {
    return null
  }
}

export default function StageDualFlow() {
  const initial = useMemo(() => loadStored() ?? { nodes: [] as Node[], edges: [] as Edge[] }, [])
  const [nodes, setNodes, onNodesChange] = useNodesState(initial.nodes)
  const [edges, setEdges, onEdgesChangeBase] = useEdgesState(initial.edges)
  const rfInst = useRef<ReactFlowInstance | null>(null)
  const [paneMenu, setPaneMenu] = useState<{
    x: number
    y: number
    flowX: number
    flowY: number
  } | null>(null)
  const [nodeCtxMenu, setNodeCtxMenu] = useState<{ x: number; y: number; nodeId: string } | null>(null)
  const [connectingLine, setConnectingLine] = useState(false)

  const addNodeAt = useCallback(
    (spec: StagePaneAddSpec, flowPos: { x: number; y: number }) => {
      const n = createStageNodeAt(spec, flowPos)
      setNodes(nds => [...nds, n])
      setPaneMenu(null)
    },
    [setNodes],
  )

  const removeStageNode = useCallback(
    (nodeId: string) => {
      setNodes(nds =>
        nds
          .filter(n => n.id !== nodeId)
          .map(n => {
            const data = n.data as Record<string, unknown>
            let next = n
            if (data.linkedColorSource === nodeId) {
              next = { ...n, data: { ...data, linkedColorSource: null } }
            }
            const d2 = next.data as Record<string, unknown>
            if (d2.linkedGlowSource === nodeId) {
              next = { ...next, data: { ...d2, linkedGlowSource: null } }
            }
            return next
          }),
      )
      setEdges(eds => eds.filter(e => e.source !== nodeId && e.target !== nodeId))
      setNodeCtxMenu(null)
    },
    [setNodes, setEdges],
  )

  const clearCanvas = useCallback(() => {
    if (!window.confirm('清空画布？当前图（含连线）将删除。')) return
    setNodes([])
    setEdges([])
    setPaneMenu(null)
  }, [setNodes, setEdges])

  const loadSampleGraph = useCallback(() => {
    setNodes(createDefaultNodes())
    setEdges(createDefaultEdges())
    setPaneMenu(null)
    requestAnimationFrame(() => {
      try {
        rfInst.current?.fitView?.({ padding: 0.12, duration: 280 })
      } catch {
        /* ignore */
      }
    })
  }, [setNodes, setEdges])

  const averageView = useCallback(() => {
    setPaneMenu(null)
    requestAnimationFrame(() => {
      try {
        rfInst.current?.fitView?.({ padding: 0.12, duration: 280 })
      } catch {
        /* ignore */
      }
    })
  }, [])

  const closeCtxMenus = useCallback(() => {
    setPaneMenu(null)
    setNodeCtxMenu(null)
  }, [])

  const handleNodesDelete = useCallback(
    (deleted: Node[]) => {
      setNodeCtxMenu(null)
      const ids = new Set(deleted.map(n => n.id))
      setEdges(eds => eds.filter(e => !ids.has(e.source) && !ids.has(e.target)))
      setNodes(nds =>
        nds.map(n => {
          const data = { ...(n.data as Record<string, unknown>) }
          let changed = false
          if (typeof data.linkedColorSource === 'string' && ids.has(data.linkedColorSource)) {
            data.linkedColorSource = null
            changed = true
          }
          if (typeof data.linkedGlowSource === 'string' && ids.has(data.linkedGlowSource)) {
            data.linkedGlowSource = null
            changed = true
          }
          return changed ? { ...n, data } : n
        }),
      )
    },
    [setEdges, setNodes],
  )

  useEffect(() => {
    if (!paneMenu && !nodeCtxMenu) return
    const onDocClick = (e: MouseEvent) => {
      // click 在部分浏览器/合成事件里 button 可能非 0；仅排除明确的右键/中键
      if (e.button > 0) return
      const t = e.target as Element | null
      if (t?.closest?.('[data-stage-dual-ctx]')) return
      setPaneMenu(null)
      setNodeCtxMenu(null)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPaneMenu(null)
        setNodeCtxMenu(null)
      }
    }
    document.addEventListener('click', onDocClick)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('click', onDocClick)
      window.removeEventListener('keydown', onKey)
    }
  }, [paneMenu, nodeCtxMenu])
  const edgesRef = useRef(edges)
  edgesRef.current = edges

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      for (const ch of changes) {
        if (ch.type === 'remove') {
          const removed = edgesRef.current.find(e => e.id === ch.id)
          if (removed?.target || removed?.source) {
            setNodes(nds =>
              nds.map(n => {
                const data = { ...(n.data as Record<string, unknown>) }
                let changed = false
                if (removed.target && n.id === removed.target) {
                  if (removed.targetHandle === 'color') {
                    data.linkedColorSource = null
                    changed = true
                  }
                  if (removed.targetHandle === 'glow') {
                    data.linkedGlowSource = null
                    changed = true
                  }
                }
                if (
                  removed.source &&
                  removed.target &&
                  n.id === removed.source &&
                  removed.targetHandle === 'in'
                ) {
                  const tgt = nds.find(x => x.id === removed.target)
                  if (
                    (n.type === 'stElement' || n.type === 'stFont') &&
                    tgt?.type === 'stGlow' &&
                    data.linkedGlowSource === removed.target
                  ) {
                    data.linkedGlowSource = null
                    changed = true
                  }
                }
                return changed ? { ...n, data } : n
              }),
            )
          }
        }
      }
      onEdgesChangeBase(changes)
    },
    [onEdgesChangeBase, setNodes],
  )

  const onConnect = useCallback(
    (params: Connection) => {
      setEdges(eds => addEdge({ ...params, animated: true, style: { stroke: STAGE_EDGE_STROKE_MAIN } }, eds))
      if (!params.target || !params.source) return
      setNodes(nds =>
        nds.map(n => {
          const src = nds.find(x => x.id === params.source)
          const tgt = nds.find(x => x.id === params.target)
          const data = { ...(n.data as Record<string, unknown>) }
          let changed = false
          if (n.id === params.target) {
            if (src?.type === 'stColor' && params.targetHandle === 'color') {
              data.linkedColorSource = params.source
              changed = true
            }
            if (src?.type === 'stGlow' && params.targetHandle === 'glow') {
              data.linkedGlowSource = params.source
              changed = true
            }
          }
          /** 流水线习惯：元素/字体 out → 外发光 in；此前只支持 外发光 → 顶栏 glow 口，导致预览读不到 linkedGlowSource */
          if (
            n.id === params.source &&
            (n.type === 'stElement' || n.type === 'stFont') &&
            tgt?.type === 'stGlow' &&
            params.targetHandle === 'in'
          ) {
            data.linkedGlowSource = params.target
            changed = true
          }
          return changed ? { ...n, data } : n
        }),
      )
    },
    [setEdges, setNodes],
  )

  useEffect(() => {
    const id = window.setTimeout(() => {
      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ nodes, edges, flowVer: STAGE_FLOW_VER_MASK_SLIDER_200 }),
        )
      } catch {
        /* quota */
      }
    }, 500)
    return () => clearTimeout(id)
  }, [nodes, edges])

  return (
    <div className="absolute inset-0 min-h-[480px]">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onConnectStart={() => setConnectingLine(true)}
        onConnectEnd={() => setConnectingLine(false)}
        connectionLineStyle={{ stroke: STAGE_EDGE_STROKE_MAIN, strokeWidth: 2 }}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView={nodes.length > 0}
        fitViewOptions={{ padding: 0.12 }}
        minZoom={0.22}
        maxZoom={1.2}
        connectionRadius={64}
        proOptions={{ hideAttribution: true }}
        deleteKeyCode="Delete"
        elementsSelectable
        nodesDraggable
        selectionOnDrag
        panOnDrag={[1, 2]}
        panActivationKeyCode="Space"
        onNodesDelete={handleNodesDelete}
        onPaneClick={closeCtxMenus}
        onNodeContextMenu={(e, node) => {
          e.preventDefault()
          setNodeCtxMenu({ x: e.clientX, y: e.clientY, nodeId: node.id })
        }}
        onPaneContextMenu={e => {
          e.preventDefault()
          const p = rfInst.current?.screenToFlowPosition?.({ x: e.clientX, y: e.clientY })
          setPaneMenu({
            x: e.clientX,
            y: e.clientY,
            flowX: p?.x ?? 0,
            flowY: p?.y ?? 0,
          })
        }}
        onInit={inst => {
          rfInst.current = inst
        }}
        className={`app-react-flow-marquee stage-dual-react-flow !bg-transparent [&_.react-flow__pane]:!bg-slate-950/40${connectingLine ? ' stage-dual-connecting' : ''}`}
      >
        <Background gap={18} size={1} color="#1f2937" />
      </ReactFlow>
      {paneMenu ? (
        <div
          data-stage-dual-ctx
          className="fixed z-[60] min-w-[220px] max-w-[min(100vw-20px,320px)] overflow-hidden rounded-lg border border-slate-800 bg-slate-950/95 shadow-[0_18px_60px_rgba(0,0,0,0.55)] backdrop-blur"
          style={stagePaneMenuViewportStyle(paneMenu.x, paneMenu.y)}
          onMouseDown={e => e.stopPropagation()}
        >
          <div className="border-b border-slate-800 px-2.5 py-1 text-[10px] leading-tight text-slate-400">
            组件搭建库 · 空白处右键
          </div>
          <div className="max-h-[min(72vh,520px)] overflow-y-auto overflow-x-hidden overscroll-contain py-0.5">
            {STAGE_PANE_OPTIONS.map((opt, i) => (
              <div key={`${opt.section ?? ''}-${opt.title}-${opt.spec.rfType}-${i}`}>
                {opt.section ? (
                  <div className="px-2.5 pb-0 pt-1 text-[9px] font-semibold uppercase tracking-wide leading-none text-slate-500">
                    {opt.section}
                  </div>
                ) : null}
                <button
                  type="button"
                  className="w-full px-2.5 py-1 text-left transition hover:bg-slate-800/60"
                  onClick={() => addNodeAt(opt.spec, { x: paneMenu.flowX, y: paneMenu.flowY })}
                >
                  <div className="text-[11px] font-medium leading-tight text-slate-200">{opt.title}</div>
                  <div className="mt-px text-[8px] leading-[1.2] text-slate-500">{opt.desc}</div>
                </button>
              </div>
            ))}
          </div>
          <div className="border-t border-slate-800">
            <button
              type="button"
              className="w-full px-2.5 py-1 text-left text-[11px] leading-tight text-slate-200 transition hover:bg-slate-800/60"
              onClick={() => averageView()}
            >
              平均视图
            </button>
            <button
              type="button"
              className="w-full px-2.5 py-1 text-left text-[11px] leading-tight text-slate-200 transition hover:bg-slate-800/60"
              onClick={() => loadSampleGraph()}
            >
              加载示例画布…
            </button>
            <button
              type="button"
              className="w-full px-2.5 py-1 text-left text-[11px] leading-tight text-red-200/95 transition hover:bg-slate-800/60"
              onClick={() => clearCanvas()}
            >
              清空画布
            </button>
          </div>
        </div>
      ) : null}
      {nodeCtxMenu ? (
        <div
          data-stage-dual-ctx
          className="fixed z-[61] min-w-[160px] overflow-hidden rounded-lg border border-slate-800 bg-slate-950/95 shadow-[0_18px_60px_rgba(0,0,0,0.55)] backdrop-blur"
          style={{ left: nodeCtxMenu.x, top: nodeCtxMenu.y }}
          onMouseDown={e => e.stopPropagation()}
        >
          <button
            type="button"
            className="w-full px-2.5 py-1 text-left text-[11px] leading-tight text-red-200/95 transition hover:bg-slate-800/60"
            onClick={() => removeStageNode(nodeCtxMenu.nodeId)}
          >
            删除节点
          </button>
          <button
            type="button"
            className="w-full px-2.5 py-1 text-left text-[11px] leading-tight text-slate-200 transition hover:bg-slate-800/60"
            onClick={() => setNodeCtxMenu(null)}
          >
            取消
          </button>
        </div>
      ) : null}
      <div className="pointer-events-none absolute bottom-3 left-3 right-3 z-10 rounded-lg border border-slate-800/60 bg-slate-950/80 px-3 py-2 text-[10px] leading-relaxed text-slate-400 backdrop-blur">
        <span className="pointer-events-auto text-slate-200">空白画布</span>
        ：在画布里
        <span className="text-slate-300">右键</span>
        打开组件库添加面板；
        <span className="text-slate-300">左键空白处拖动</span>
        框选多个面板，可一起拖动；按
        <span className="text-slate-300">Delete</span>
        批量删除。平移画布：
        <span className="text-slate-300">中键/右键拖动</span>
        或
        <span className="text-slate-300">按住空格 + 左键拖动</span>
        ；滚轮缩放。
        <span className="pointer-events-auto text-slate-200"> 模板命名层</span>
        接舞台层出口，右侧单口可连多线到各图层（构图用，供图仍来自舞台层）。
        <span className="pointer-events-auto text-slate-200"> 元素层节点</span>
        控制舞台层上传的「元素层」图位置与缩放，叠在角色层之上（默认同级时先角色后元素层）。
        <span className="pointer-events-auto text-slate-200"> 改色/外发光</span>
        ：从改色/外发光节点拖线到目标顶部接口；连线可在边上
        <span className="text-slate-300">右键删除</span>。叠放顺序：图层卡片右上角
        <span className="text-slate-300">1–7 级</span>
        （1 最底、7 最顶）。
      </div>
    </div>
  )
}
