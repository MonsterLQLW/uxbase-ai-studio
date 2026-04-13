/**
 * 戳戳·配套图：与「签名所赠图」相同的节点连线工作流。
 * 空白画布右键 → 添加各大类面板，节点间可拉线串联。
 */
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { Handle, Position, type NodeProps } from 'reactflow'
import { RfRangeInput } from './RfRangeInput'
import {
  MASK_BUILTIN_BASE_LAYER,
  MASK_UI_MAX_FALLOFF,
  MASK_UI_MAX_OPACITY,
  MASK_UI_MAX_REACH,
  MASK_UI_MIN_FALLOFF,
  MASK_UI_MIN_REACH,
  maskParamDisplayPercent,
} from '../lib/outputStyleMask'

export type DataUrlImage = { dataUrl: string; name: string }

/** 与 `MASK_BUILTIN_BASE_LAYER` 同内容，戳戳遮罩默认底图 */
export const POKE_MASK_BUILTIN_LAYER: DataUrlImage = {
  dataUrl: MASK_BUILTIN_BASE_LAYER.dataUrl,
  name: MASK_BUILTIN_BASE_LAYER.name ?? '内置遮罩底图',
}

export type PokeElementGlow = {
  enabled: boolean
  color: string
  size: number
  opacity: number
}

/** 单个「元素模板」节点：画布上的位置 / 缩放 / 发光（与主预览 380 坐标系对齐的 offset） */
export type PokeElementTemplateState = {
  layer: DataUrlImage | null
  offsetX: number
  offsetY: number
  /** 相对默认铺满（短边×0.88）的倍率 */
  scale: number
  glow: PokeElementGlow
}

export function defaultPokeElementTemplate(): PokeElementTemplateState {
  return {
    layer: null,
    offsetX: 0,
    offsetY: 0,
    scale: 1,
    glow: { enabled: false, color: '#ffffff', size: 14, opacity: 0.55 },
  }
}

async function fileToDataUrl(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(new Error('read file failed'))
    r.readAsDataURL(file)
  })
}

/** 与签名端外索赠图新连线一致（indigo） */
export const POKE_EDGE_COLOR = '#6366f1'

export type PokeRfNodeType =
  | 'otPokeAsset'
  | 'otPokeSize'
  | 'otPokeMask'
  | 'otPokeElement'
  | 'otPokeColor'
  | 'otPokeFont'
  | 'otPokePreview'

export interface PokeFlowCtx {
  bgColor: string
  setBgColor: (v: string) => void
  text1: string
  setText1: (v: string) => void
  text2: string
  setText2: (v: string) => void
  fontSize: number
  setFontSize: (v: number) => void
  fontColor: string
  setFontColor: (v: string) => void
  multiSizeDraft: string
  setMultiSizeDraft: (v: string) => void
  maskColor: string
  setMaskColor: (v: string) => void
  maskOpacity: number
  setMaskOpacity: (v: number) => void
  maskLayer: DataUrlImage
  setMaskLayer: (v: DataUrlImage) => void
  maskReach: number
  setMaskReach: (v: number) => void
  maskFalloff: number
  setMaskFalloff: (v: number) => void
  resetMaskLayerToBuiltin: () => void
  /** 更新指定「元素层」节点参数（可多实例） */
  updatePokeElementTemplate: (nodeId: string, partial: Partial<PokeElementTemplateState>) => void
  removePokeNode: (nodeId: string) => void
  /** 预览 / 导出画布像素宽 */
  outputWidth: number
  setOutputWidth: (v: number) => void
  /** 预览 / 导出画布像素高 */
  outputHeight: number
  setOutputHeight: (v: number) => void
  previewCanvasPokeRef: React.RefObject<HTMLCanvasElement | null>
  exportPoke: () => void | Promise<void>
  onPointerDownPoke: (e: React.PointerEvent<HTMLCanvasElement>) => void
  onPointerMovePoke: (e: React.PointerEvent<HTMLCanvasElement>) => void
  onPointerUpPoke: () => void
  onWheelPoke: (e: React.WheelEvent<HTMLCanvasElement>) => void
  character: DataUrlImage | null
  setCharacter: (v: DataUrlImage | null) => void
  autoFace: () => void
  faceHint: string
  applyPokePreset: (p: 'default' | 'light' | 'dark') => void
  resetCharacterTransform: () => void
}

export const PokeFlowContext = createContext<PokeFlowCtx | null>(null)

export function usePokeFlowCtx(): PokeFlowCtx | null {
  return useContext(PokeFlowContext)
}

export const POKE_ADD_OPTIONS: { type: PokeRfNodeType; title: string; desc: string }[] = [
  { type: 'otPokeAsset', title: '素材带入模板', desc: '角色层（元素请用「元素模板」节点，可多开）' },
  { type: 'otPokeSize', title: '尺寸控制', desc: '5–10 种输出尺寸' },
  { type: 'otPokeMask', title: '遮罩层', desc: '底图着色 · 自下而上渐变透明' },
  { type: 'otPokeElement', title: '元素模板', desc: '位置·大小·发光；右键或 Delete 删除节点' },
  { type: 'otPokeColor', title: '颜色调整', desc: '背景与整体色' },
  { type: 'otPokeFont', title: '字体添加', desc: '主副标题' },
  { type: 'otPokePreview', title: '预览输出框', desc: '预览与导出 PNG' },
]

export type PokeFlowNodeData = {
  title: string
  /** 仅 otPokeElement */
  elementTemplate?: PokeElementTemplateState
}

/** 与签名·端外索赠图 Upload 节点把手一致：左 sky / 右 violet */
const POKE_HANDLE_IN = '!bg-sky-500'
const POKE_HANDLE_OUT = '!bg-violet-500'

/** 外壳与 OutputTool `OtShell`（签名端外索赠图）同一套样式 */
function PokeShell({ title, children, className = '' }: { title: string; children: ReactNode; className?: string }) {
  return (
    <div
      className={`min-w-[280px] rounded-xl border border-slate-800/48 bg-gradient-to-b from-slate-900/82 to-slate-950/[0.865] shadow-[0_4px_20px_rgba(0,0,0,0.33)] ring-1 ring-inset ring-white/[0.034] ${className}`}
    >
      <div className="flex items-center justify-between gap-3 border-b border-slate-800/26 bg-black/12 px-4 py-3">
        <div className="min-w-0 truncate text-sm font-semibold tracking-tight text-slate-100">{title}</div>
        <div className="shrink-0 text-[11px] tracking-wide text-slate-400/90">拖拽节点 · 拉线连接</div>
      </div>
      <div className="bg-slate-950/12 p-4">{children}</div>
    </div>
  )
}

function PokeCtxFallback() {
  return (
    <div className="flex min-h-[220px] min-w-[300px] items-center justify-center rounded-xl border border-slate-800/86 bg-slate-950/44 text-xs text-slate-400/90 shadow-md shadow-black/28">
      加载中…
    </div>
  )
}

/** 素材带入模板：角色层（元素装饰请添加「元素模板」节点） */
export function OtPokeAssetNode({ data }: NodeProps<PokeFlowNodeData>) {
  const ctx = usePokeFlowCtx()
  if (!ctx) return <PokeCtxFallback />
  return (
    <PokeShell title={data.title}>
      <Handle type="target" position={Position.Left} id="in" className={POKE_HANDLE_IN} />
      <Handle type="source" position={Position.Right} id="out" className={POKE_HANDLE_OUT} />
      <p className="mb-2 text-[10px] leading-relaxed text-slate-500">接入角色层；装饰图请用独立「元素模板」节点（可多开）</p>
      <div className="space-y-2">
        <div>
          <div className="mb-0.5 text-[10px] text-slate-500">角色层</div>
          <label className="block">
            <input
              type="file"
              accept="image/*"
              onChange={async e => {
                const f = e.target.files?.[0]
                if (!f) return
                const dataUrl = await fileToDataUrl(f)
                ctx.setCharacter({ dataUrl, name: f.name })
              }}
              className="hidden"
            />
            <div className="cursor-pointer rounded-lg border border-slate-700/56 bg-slate-950/36 px-2 py-2 text-xs text-slate-200 transition duration-150 ease-out hover:border-slate-600/60 hover:bg-slate-950/44">
              {ctx.character ? `已选：${ctx.character.name}` : '上传角色图…'}
            </div>
          </label>
          <div className="mt-1.5 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void ctx.autoFace()}
              className="rounded-lg border border-slate-700/56 bg-slate-950/24 px-2 py-1.5 text-[11px] text-slate-200 transition duration-150 ease-out hover:border-slate-600/60 hover:bg-slate-950/34"
            >
              智能识别脸部
            </button>
            <span className="text-[10px] text-slate-500">{ctx.faceHint}</span>
          </div>
        </div>
      </div>
    </PokeShell>
  )
}

/** 尺寸控制：一模板多尺寸（5–10）规划稿 */
export function OtPokeSizeNode({ data }: NodeProps<PokeFlowNodeData>) {
  const ctx = usePokeFlowCtx()
  if (!ctx) return <PokeCtxFallback />
  return (
    <PokeShell title={data.title} className="min-w-[300px]">
      <Handle type="target" position={Position.Left} id="in" className={POKE_HANDLE_IN} />
      <Handle type="source" position={Position.Right} id="out" className={POKE_HANDLE_OUT} />
      <p className="mb-2 text-[10px] text-slate-500">每行一个，例如 1080×1080 或 512,512（后续可批量导出）</p>
      <textarea
        value={ctx.multiSizeDraft}
        onChange={e => ctx.setMultiSizeDraft(e.target.value)}
        rows={6}
        placeholder={'1080×1080\n750×1334\n512×512\n…'}
        className="w-full resize-y rounded-lg border border-slate-700/50 bg-slate-950/52 px-2 py-1.5 font-mono text-[10px] text-slate-200 placeholder:text-slate-600 transition-colors duration-150 ease-out focus:border-sky-500 focus:outline-none"
      />
    </PokeShell>
  )
}

/** 遮罩层 */
export function OtPokeMaskNode({ data }: NodeProps<PokeFlowNodeData>) {
  const ctx = usePokeFlowCtx()
  if (!ctx) return <PokeCtxFallback />
  return (
    <PokeShell title={data.title} className="min-w-[280px] max-w-[min(100vw-10rem,340px)]">
      <Handle type="target" position={Position.Left} id="in" className={POKE_HANDLE_IN} />
      <Handle type="source" position={Position.Right} id="out" className={POKE_HANDLE_OUT} />
      <p className="mb-2 text-[10px] leading-relaxed text-slate-500">
        叠在最上层；底图默认可铺满画布，着色方式与签名流「中间层」一致；底部更实、向上渐隐。
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
                ctx.setMaskLayer({ dataUrl, name: f.name })
              }}
              className="hidden"
            />
            <div className="cursor-pointer rounded-lg border border-slate-700/56 bg-slate-950/36 px-2 py-2 text-xs text-slate-200 transition duration-150 ease-out hover:border-slate-600/60 hover:bg-slate-950/44">
              {ctx.maskLayer.name || '上传底图…'}
            </div>
          </label>
          <button
            type="button"
            onClick={() => ctx.resetMaskLayerToBuiltin()}
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
              value={ctx.maskColor}
              onChange={e => ctx.setMaskColor(e.target.value)}
              className="h-8 w-10 cursor-pointer rounded border border-slate-600 bg-slate-900"
            />
            <input
              value={ctx.maskColor}
              onChange={e => ctx.setMaskColor(e.target.value)}
              className="flex-1 rounded border border-slate-700/50 bg-slate-950/52 px-2 py-1 text-[11px] text-slate-200"
            />
          </div>
        </div>
        <div>
          <div className="mb-0.5 flex justify-between text-[10px] text-slate-500">
            <span>底部强度（整体不透明度）</span>
            <span className="tabular-nums text-slate-400">
              {maskParamDisplayPercent(ctx.maskOpacity, MASK_UI_MAX_OPACITY)}%
            </span>
          </div>
          <RfRangeInput
            min={0}
            max={MASK_UI_MAX_OPACITY}
            step={0.01}
            value={ctx.maskOpacity}
            onChange={e => ctx.setMaskOpacity(Number(e.target.value))}
            className="w-full accent-indigo-500"
          />
        </div>
        <div>
          <div className="mb-0.5 flex justify-between text-[10px] text-slate-500">
            <span>自下而上渐变区域</span>
            <span className="tabular-nums text-slate-400">
              {maskParamDisplayPercent(ctx.maskReach, MASK_UI_MAX_REACH)}%
            </span>
          </div>
          <RfRangeInput
            min={MASK_UI_MIN_REACH}
            max={MASK_UI_MAX_REACH}
            step={0.01}
            value={ctx.maskReach}
            onChange={e => ctx.setMaskReach(Number(e.target.value))}
            className="w-full accent-indigo-500"
          />
          <div className="mt-0.5 text-[10px] text-slate-600">画布高度自下缘起算的过渡带比例，越大越往上延伸。</div>
        </div>
        <div>
          <div className="mb-0.5 flex justify-between text-[10px] text-slate-500">
            <span>过渡虚实（柔和度）</span>
            <span className="tabular-nums text-slate-400">{ctx.maskFalloff.toFixed(2)}</span>
          </div>
          <RfRangeInput
            min={MASK_UI_MIN_FALLOFF}
            max={MASK_UI_MAX_FALLOFF}
            step={0.02}
            value={ctx.maskFalloff}
            onChange={e => ctx.setMaskFalloff(Number(e.target.value))}
            className="w-full accent-indigo-500"
          />
          <div className="mt-0.5 text-[10px] text-slate-600">偏小过渡更匀、更「虚」；偏大底部更实、边缘更利落。</div>
        </div>
      </div>
    </PokeShell>
  )
}

/** 元素模板：每节点独立图 + 位置/缩放/发光；删除节点用右键菜单或选中后 Delete */
export function OtPokeElementLayerNode({ id, data }: NodeProps<PokeFlowNodeData>) {
  const ctx = usePokeFlowCtx()
  if (!ctx) return <PokeCtxFallback />
  const tmpl = data.elementTemplate ?? defaultPokeElementTemplate()
  const g = tmpl.glow

  const patch = (p: Partial<PokeElementTemplateState>) => ctx.updatePokeElementTemplate(id, p)
  const patchGlow = (gp: Partial<PokeElementGlow>) => patch({ glow: { ...g, ...gp } })

  return (
    <PokeShell title={data.title} className="min-w-[300px] max-w-[min(100vw-10rem,360px)]">
      <Handle type="target" position={Position.Left} id="in" className={POKE_HANDLE_IN} />
      <Handle type="source" position={Position.Right} id="out" className={POKE_HANDLE_OUT} />
      <p className="mb-2 text-[10px] leading-relaxed text-slate-500">
        叠在角色之上；可添加多个节点。右键节点或选中后按 Delete 删除。
      </p>
      <label className="block">
        <input
          type="file"
          accept="image/*"
          onChange={async e => {
            const f = e.target.files?.[0]
            if (!f) return
            const dataUrl = await fileToDataUrl(f)
            patch({ layer: { dataUrl, name: f.name } })
          }}
          className="hidden"
        />
        <div className="cursor-pointer rounded-lg border border-slate-700/56 bg-slate-950/36 px-2 py-2 text-xs text-slate-200 transition duration-150 ease-out hover:border-slate-600/60 hover:bg-slate-950/44">
          {tmpl.layer ? `当前：${tmpl.layer.name}` : '上传元素模板图…'}
        </div>
      </label>

      <div className="mt-3 space-y-3 border-t border-slate-800/35 pt-3">
        <div>
          <div className="mb-0.5 flex justify-between text-[10px] text-slate-500">
            <span>水平位置</span>
            <span className="tabular-nums text-slate-400">{Math.round(tmpl.offsetX)}</span>
          </div>
          <RfRangeInput
            min={-400}
            max={400}
            step={1}
            value={tmpl.offsetX}
            onChange={e => patch({ offsetX: Number(e.target.value) })}
            className="w-full accent-indigo-500"
          />
        </div>
        <div>
          <div className="mb-0.5 flex justify-between text-[10px] text-slate-500">
            <span>垂直位置</span>
            <span className="tabular-nums text-slate-400">{Math.round(tmpl.offsetY)}</span>
          </div>
          <RfRangeInput
            min={-400}
            max={400}
            step={1}
            value={tmpl.offsetY}
            onChange={e => patch({ offsetY: Number(e.target.value) })}
            className="w-full accent-indigo-500"
          />
        </div>
        <div>
          <div className="mb-0.5 flex justify-between text-[10px] text-slate-500">
            <span>缩放</span>
            <span className="tabular-nums text-slate-400">{tmpl.scale.toFixed(2)}×</span>
          </div>
          <RfRangeInput
            min={0.15}
            max={2.8}
            step={0.01}
            value={tmpl.scale}
            onChange={e => patch({ scale: Number(e.target.value) })}
            className="w-full accent-indigo-500"
          />
        </div>

        <div className="rounded-lg border border-slate-800/42 bg-slate-950/36 p-2">
          <label className="flex cursor-pointer items-center gap-2 text-[11px] text-slate-200">
            <input
              type="checkbox"
              checked={g.enabled}
              onChange={e => patchGlow({ enabled: e.target.checked })}
              className="rounded border-slate-600 accent-indigo-500"
            />
            发光
          </label>
          {g.enabled && (
            <div className="mt-2 space-y-2">
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={g.color}
                  onChange={e => patchGlow({ color: e.target.value })}
                  className="h-8 w-10 cursor-pointer rounded border border-slate-600"
                />
                <input
                  value={g.color}
                  onChange={e => patchGlow({ color: e.target.value })}
                  className="flex-1 rounded border border-slate-700/50 bg-slate-950/52 px-2 py-1 text-[10px]"
                />
              </div>
              <div>
                <div className="mb-0.5 flex justify-between text-[10px] text-slate-500">
                  <span>发光范围</span>
                  <span className="text-slate-400">{Math.round(g.size)}</span>
                </div>
                <RfRangeInput
                  min={0}
                  max={48}
                  step={1}
                  value={g.size}
                  onChange={e => patchGlow({ size: Number(e.target.value) })}
                  className="w-full accent-indigo-500"
                />
              </div>
              <div>
                <div className="mb-0.5 flex justify-between text-[10px] text-slate-500">
                  <span>发光强度</span>
                  <span className="text-slate-400">{Math.round(g.opacity * 100)}%</span>
                </div>
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
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={() => ctx.removePokeNode(id)}
        className="mt-3 w-full rounded-lg border border-slate-700/56 py-1.5 text-[11px] text-red-300/95 transition duration-150 ease-out hover:bg-slate-950/34"
      >
        删除此节点
      </button>
    </PokeShell>
  )
}

/** 颜色调整 */
export function OtPokeColorNode({ data }: NodeProps<PokeFlowNodeData>) {
  const ctx = usePokeFlowCtx()
  if (!ctx) return <PokeCtxFallback />
  return (
    <PokeShell title={data.title} className="min-w-[260px]">
      <Handle type="target" position={Position.Left} id="in" className={POKE_HANDLE_IN} />
      <Handle type="source" position={Position.Right} id="out" className={POKE_HANDLE_OUT} />
      <div className="mb-2 text-[10px] text-slate-500">背景填充色（预览底色）</div>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={ctx.bgColor}
          onChange={e => ctx.setBgColor(e.target.value)}
          className="h-8 w-10 cursor-pointer rounded border border-slate-600 bg-slate-900"
        />
        <input
          value={ctx.bgColor}
          onChange={e => ctx.setBgColor(e.target.value)}
          className="flex-1 rounded border border-slate-700/50 bg-slate-950/52 px-2 py-1 text-[11px]"
        />
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {(['default', 'light', 'dark'] as const).map(p => (
          <button
            key={p}
            type="button"
            onClick={() => ctx.applyPokePreset(p)}
            className="rounded-lg border border-slate-700/56 px-2 py-1 text-[10px] text-slate-300 transition duration-150 ease-out hover:border-slate-600/60 hover:bg-slate-950/26"
          >
            {p === 'default' ? '预设·默认' : p === 'light' ? '浅色' : '深色'}
          </button>
        ))}
      </div>
    </PokeShell>
  )
}

/** 字体添加 */
export function OtPokeFontNode({ data }: NodeProps<PokeFlowNodeData>) {
  const ctx = usePokeFlowCtx()
  if (!ctx) return <PokeCtxFallback />
  return (
    <PokeShell title={data.title} className="min-w-[280px]">
      <Handle type="target" position={Position.Left} id="in" className={POKE_HANDLE_IN} />
      <Handle type="source" position={Position.Right} id="out" className={POKE_HANDLE_OUT} />
      <div className="space-y-2">
        <input
          value={ctx.text1}
          onChange={e => ctx.setText1(e.target.value)}
          placeholder="主标题"
          className="w-full rounded-lg border border-slate-700/50 bg-slate-950/52 px-2 py-1.5 text-[11px] text-slate-200"
        />
        <input
          value={ctx.text2}
          onChange={e => ctx.setText2(e.target.value)}
          placeholder="副标题"
          className="w-full rounded-lg border border-slate-700/50 bg-slate-950/52 px-2 py-1.5 text-[11px] text-slate-200"
        />
        <div>
          <div className="mb-0.5 flex justify-between text-[10px] text-slate-500">
            <span>字号</span>
            <span className="text-slate-400">{ctx.fontSize}</span>
          </div>
          <RfRangeInput
            min={12}
            max={72}
            value={ctx.fontSize}
            onChange={e => ctx.setFontSize(Number(e.target.value))}
            className="w-full accent-indigo-500"
          />
        </div>
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={ctx.fontColor}
            onChange={e => ctx.setFontColor(e.target.value)}
            className="h-8 w-10 cursor-pointer rounded border border-slate-600"
          />
          <input
            value={ctx.fontColor}
            onChange={e => ctx.setFontColor(e.target.value)}
            className="flex-1 rounded border border-slate-700/50 bg-slate-950/52 px-2 py-1 text-[11px]"
          />
        </div>
      </div>
    </PokeShell>
  )
}

function clampDim(n: number) {
  return Math.max(32, Math.min(4096, Math.round(Number.isFinite(n) ? n : 400)))
}

/** 预览输出框 */
export function OtPokePreviewNode({ data }: NodeProps<PokeFlowNodeData>) {
  const ctx = usePokeFlowCtx()
  if (!ctx) return <PokeCtxFallback />
  const w = ctx.outputWidth
  const h = ctx.outputHeight

  const [wStr, setWStr] = useState(() => String(w))
  const [hStr, setHStr] = useState(() => String(h))
  const wFocusRef = useRef(false)
  const hFocusRef = useRef(false)

  useEffect(() => {
    if (!wFocusRef.current) setWStr(String(ctx.outputWidth))
  }, [ctx.outputWidth])

  useEffect(() => {
    if (!hFocusRef.current) setHStr(String(ctx.outputHeight))
  }, [ctx.outputHeight])

  const commitWidth = (raw: string) => {
    const t = raw.trim()
    if (t === '') {
      setWStr(String(ctx.outputWidth))
      return
    }
    const n = Number(t)
    if (!Number.isFinite(n)) {
      setWStr(String(ctx.outputWidth))
      return
    }
    const next = clampDim(n)
    ctx.setOutputWidth(next)
    setWStr(String(next))
  }

  const commitHeight = (raw: string) => {
    const t = raw.trim()
    if (t === '') {
      setHStr(String(ctx.outputHeight))
      return
    }
    const n = Number(t)
    if (!Number.isFinite(n)) {
      setHStr(String(ctx.outputHeight))
      return
    }
    const next = clampDim(n)
    ctx.setOutputHeight(next)
    setHStr(String(next))
  }

  return (
    <PokeShell title={data.title} className="min-w-[400px] max-w-[min(100vw-12rem,520px)]">
      <Handle type="target" position={Position.Left} id="in" className={POKE_HANDLE_IN} style={{ top: '42%' }} />
      <div className="mb-2 grid grid-cols-2 gap-2">
        <div>
          <div className="mb-0.5 text-[10px] text-slate-500">宽 px</div>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={wStr}
            onFocus={() => {
              wFocusRef.current = true
            }}
            onBlur={() => {
              wFocusRef.current = false
              commitWidth(wStr)
            }}
            onChange={e => setWStr(e.target.value)}
            className="w-full rounded-lg border border-slate-700/50 bg-slate-950/52 px-2 py-1.5 font-mono text-[11px] text-slate-200 tabular-nums"
          />
        </div>
        <div>
          <div className="mb-0.5 text-[10px] text-slate-500">高 px</div>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="off"
            value={hStr}
            onFocus={() => {
              hFocusRef.current = true
            }}
            onBlur={() => {
              hFocusRef.current = false
              commitHeight(hStr)
            }}
            onChange={e => setHStr(e.target.value)}
            className="w-full rounded-lg border border-slate-700/50 bg-slate-950/52 px-2 py-1.5 font-mono text-[11px] text-slate-200 tabular-nums"
          />
        </div>
      </div>
      <p className="mb-2 text-[10px] text-slate-500">画布与导出均为 {w}×{h}；下方按比例缩放显示，大长图可横向滚动查看</p>
      <div className="nowheel nodrag nopan max-h-[min(72vh,560px)] overflow-auto rounded-xl border border-slate-800/34 bg-gradient-to-b from-slate-950/42 via-slate-950/46 to-slate-950/52 p-2 shadow-[inset_0_1px_0_0_rgba(56,189,248,0.08),0_1px_0_0_rgba(255,255,255,0.032)]">
        <canvas
          ref={ctx.previewCanvasPokeRef}
          width={w}
          height={h}
          onPointerDown={ctx.onPointerDownPoke}
          onPointerMove={ctx.onPointerMovePoke}
          onPointerUp={ctx.onPointerUpPoke}
          onPointerLeave={ctx.onPointerUpPoke}
          onWheel={ctx.onWheelPoke}
          className="block cursor-grab touch-none active:cursor-grabbing"
          style={{
            width: 'min(420px, 100%)',
            aspectRatio: `${w} / ${h}`,
            height: 'auto',
          }}
        />
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void ctx.exportPoke()}
          className="flex-1 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white shadow-md shadow-indigo-950/28 transition duration-150 ease-out hover:bg-indigo-700"
        >
          导出 PNG
        </button>
        <button
          type="button"
          onClick={() => ctx.resetCharacterTransform()}
          className="rounded-lg border border-slate-700/56 bg-slate-950/24 px-3 py-2 text-[11px] text-slate-200 transition duration-150 ease-out hover:border-slate-600/60 hover:bg-slate-950/36"
        >
          重置角色变换
        </button>
      </div>
    </PokeShell>
  )
}

export const pokeFlowNodeTypes = {
  otPokeAsset: OtPokeAssetNode,
  otPokeSize: OtPokeSizeNode,
  otPokeMask: OtPokeMaskNode,
  otPokeElement: OtPokeElementLayerNode,
  otPokeColor: OtPokeColorNode,
  otPokeFont: OtPokeFontNode,
  otPokePreview: OtPokePreviewNode,
}
