import type { Edge, Node } from 'reactflow'
import {
  drawOutputStyleBottomFadeMask,
  MASK_UI_MAX_FALLOFF,
  MASK_UI_MAX_OPACITY,
  MASK_UI_MAX_REACH,
  MASK_UI_MIN_FALLOFF,
  MASK_UI_MIN_REACH,
} from './outputStyleMask'
import type { StageGlow, StageTplId } from './stageDualTypes'

const LAYER_TYPES = new Set(['stBottom', 'stCharacter', 'stStageElm', 'stMask', 'stElement', 'stFont'])

/** zLevel 相同时的叠放顺序（角色层 → 元素层(舞台) → 遮罩 …） */
const STACK_TIE_ORDER: Record<string, number> = {
  stBottom: 0,
  stCharacter: 1,
  stStageElm: 2,
  stMask: 3,
  stElement: 4,
  stFont: 5,
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n))
}

/** 以短边 ref 为基准等比缩放（cover 正方形 ref×ref 的视觉效果），保证 drawW:drawH = iw:ih */
function drawSizeFromRef(iw: number, ih: number, ref: number, scaleExtra: number): { dw: number; dh: number } {
  const safeIw = Math.max(1, iw)
  const safeIh = Math.max(1, ih)
  const ar = safeIw / safeIh
  const base = Math.max(ref / safeIw, ref / safeIh) * scaleExtra
  const dw = safeIw * base
  const dh = dw / ar
  return { dw, dh }
}

/** 底图等比铺满「内容方」ref，居中画在 w×h 上（与角色层同一缩放基准，避免长条画布底图单独按 w×h 拉伸） */
function drawImageCoverOnCanvas(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  w: number,
  h: number,
  ref: number,
) {
  const iw = img.naturalWidth || img.width
  const ih = img.naturalHeight || img.height
  const { dw, dh } = drawSizeFromRef(iw, ih, ref, 1)
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh)
}

function drawLogoWithGlow(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  placement: { x: number; y: number; w: number; h: number },
  glow: StageGlow,
) {
  if (glow.enabled && glow.size > 0 && glow.opacity > 0) {
    ctx.save()
    ctx.globalAlpha = clamp(glow.opacity, 0, 1)
    ctx.shadowBlur = clamp(glow.size, 0, 60)
    ctx.shadowColor = glow.color
    ctx.shadowOffsetX = 0
    ctx.shadowOffsetY = 0
    ctx.drawImage(img, placement.x, placement.y, placement.w, placement.h)
    ctx.drawImage(img, placement.x, placement.y, placement.w, placement.h)
    ctx.restore()
  }
  ctx.drawImage(img, placement.x, placement.y, placement.w, placement.h)
}

function resolveColor(nodes: Node[], linkedId: string | null, fallback: string): string {
  if (!linkedId) return fallback
  const n = nodes.find(x => x.id === linkedId)
  if (!n || n.type !== 'stColor') return fallback
  const c = (n.data as { color?: string }).color
  return typeof c === 'string' && c ? c : fallback
}

function resolveGlow(nodes: Node[], linkedId: string | null): StageGlow | null {
  if (!linkedId) return null
  const n = nodes.find(x => x.id === linkedId)
  if (!n || n.type !== 'stGlow') return null
  const g = (n.data as { glow?: StageGlow }).glow
  return g && typeof g === 'object' ? g : null
}

const STAGE_Z_MIN = 1
const STAGE_Z_MAX = 7

function stackZLevel(data: Record<string, unknown>): number {
  const v = data.zLevel
  if (typeof v !== 'number' || !Number.isFinite(v)) return 99
  return Math.max(STAGE_Z_MIN, Math.min(STAGE_Z_MAX, Math.round(v)))
}

function sortTplStack(nodes: Node[], tpl: StageTplId): Node[] {
  return nodes
    .filter(n => LAYER_TYPES.has(String(n.type)) && (n.data as { tpl?: string }).tpl === tpl)
    .sort((a, b) => {
      const za = stackZLevel(a.data as Record<string, unknown>)
      const zb = stackZLevel(b.data as Record<string, unknown>)
      if (za !== zb) return za - zb
      const oa = STACK_TIE_ORDER[String(a.type)] ?? 99
      const ob = STACK_TIE_ORDER[String(b.type)] ?? 99
      return oa - ob
    })
}

/** 从该节点沿入边反向可达的节点 id（含自身）；用于「预览连什么画什么」 */
function collectBackwardAncestors(edges: Edge[], startId: string): Set<string> {
  const seen = new Set<string>()
  const stack: string[] = [startId]
  while (stack.length) {
    const cur = stack.pop()!
    if (seen.has(cur)) continue
    seen.add(cur)
    for (const e of edges) {
      if (e.target !== cur) continue
      if (!seen.has(e.source)) stack.push(e.source)
    }
  }
  return seen
}

/** 传入后只绘制能反向走到该预览节点的同轨图层；不传则绘制该模板轨上全部图层（批量默认 A/B 等） */
export type RenderStageDualScope = { previewNodeId: string; edges: Edge[] }

export async function renderStageDualTemplate(
  nodes: Node[],
  tpl: StageTplId,
  w: number,
  h: number,
  previewNorm: number,
  getCachedImage: (dataUrl: string) => Promise<HTMLImageElement | null>,
  scope?: RenderStageDualScope | null,
): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(w))
  canvas.height = Math.max(1, Math.round(h))
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas

  const root = nodes.find(n => n.type === 'stRoot')
  const sharedChar =
    root && (root.data as { sharedCharacter?: { dataUrl?: string } | null }).sharedCharacter
  const stageEl = root && (root.data as { stageElement?: { dataUrl?: string } | null }).stageElement

  const fullStack = sortTplStack(nodes, tpl)
  const anc =
    scope?.previewNodeId && scope.edges ? collectBackwardAncestors(scope.edges, scope.previewNodeId) : null
  const stack = anc ? fullStack.filter(n => anc.has(n.id)) : fullStack
  /**
   * 输出画布 w×h 只决定画幅大小；角色、底图、遮罩等「内容」统一按短边 ref 等比缩放并居中，
   * 不再让底图按整幅 w×h 单独 cover（否则与角色缩放基准不一致，会像把人物压扁）。
   */
  const ref = Math.max(1, Math.min(w, h))
  const sn = (p: number) => (p / previewNorm) * ref

  const maskScratch = {
    compose: document.createElement('canvas'),
    matte: document.createElement('canvas'),
    tint: document.createElement('canvas'),
  }

  const useLegacyStageEl =
    Boolean(stageEl?.dataUrl) && !stack.some(x => String(x.type) === 'stStageElm')
  let stageLegacyDrawn = false

  for (const n of stack) {
    const t = n.type
    const d = n.data as Record<string, unknown>

    if (t === 'stStageElm') {
      if (stageEl?.dataUrl) {
        const simg = await getCachedImage(stageEl.dataUrl).catch(() => null)
        if (simg) {
          const iw = simg.naturalWidth || simg.width
          const ih = simg.naturalHeight || simg.height
          const sc = typeof d.scale === 'number' ? d.scale : 1
          const { dw: drawW, dh: drawH } = drawSizeFromRef(iw, ih, ref, sc)
          const ox = typeof d.offsetX === 'number' ? d.offsetX : 0
          const oy = typeof d.offsetY === 'number' ? d.offsetY : 0
          const x = (w - drawW) / 2 + sn(ox)
          const y = (h - drawH) / 2 + sn(oy)
          ctx.drawImage(simg, x, y, drawW, drawH)
        }
      }
      continue
    }

    if (!stageLegacyDrawn && t === 'stBottom' && useLegacyStageEl && stageEl?.dataUrl) {
      stageLegacyDrawn = true
      const simg = await getCachedImage(stageEl.dataUrl).catch(() => null)
      if (simg) {
        drawImageCoverOnCanvas(ctx, simg, w, h, ref)
      }
    }

    if (t === 'stBottom') {
      const mode = d.mode === 'image' ? 'image' : 'solid'
      const color = resolveColor(nodes, (d.linkedColorSource as string) || null, String(d.color || '#1a1a2e'))
      if (mode === 'solid') {
        ctx.fillStyle = color
        ctx.fillRect(0, 0, w, h)
      } else {
        const im = d.image as { dataUrl?: string } | null
        if (im?.dataUrl) {
          const img = await getCachedImage(im.dataUrl).catch(() => null)
          if (img) {
            drawImageCoverOnCanvas(ctx, img, w, h, ref)
          } else {
            ctx.fillStyle = color
            ctx.fillRect(0, 0, w, h)
          }
        } else {
          ctx.fillStyle = color
          ctx.fillRect(0, 0, w, h)
        }
      }
    }

    if (t === 'stCharacter' && sharedChar?.dataUrl) {
      const img = await getCachedImage(sharedChar.dataUrl).catch(() => null)
      if (img) {
        const iw = img.naturalWidth || img.width
        const ih = img.naturalHeight || img.height
        const sc = typeof d.scale === 'number' ? d.scale : 1
        const { dw: drawW, dh: drawH } = drawSizeFromRef(iw, ih, ref, sc)
        const ox = typeof d.offsetX === 'number' ? d.offsetX : 0
        const oy = typeof d.offsetY === 'number' ? d.offsetY : 0
        const x = (w - drawW) / 2 + sn(ox)
        const y = (h - drawH) / 2 + sn(oy)
        ctx.drawImage(img, x, y, drawW, drawH)
      }
    }

    if (t === 'stMask') {
      const op = typeof d.opacity === 'number' ? clamp(d.opacity, 0, MASK_UI_MAX_OPACITY) : 0
      const color = resolveColor(nodes, (d.linkedColorSource as string) || null, String(d.color || '#000000'))
      const reach =
        typeof d.reach === 'number' && Number.isFinite(d.reach)
          ? clamp(d.reach, MASK_UI_MIN_REACH, MASK_UI_MAX_REACH)
          : 0.76
      const falloff =
        typeof d.falloff === 'number' && Number.isFinite(d.falloff)
          ? clamp(d.falloff, MASK_UI_MIN_FALLOFF, MASK_UI_MAX_FALLOFF)
          : 1
      const ml = d.maskLayer as { dataUrl?: string; name?: string } | undefined
      await drawOutputStyleBottomFadeMask(
        ctx,
        w,
        h,
        getCachedImage,
        {
          maskLayer: ml?.dataUrl ? { dataUrl: ml.dataUrl, name: ml.name } : null,
          tint: color,
          opacity: op,
          reach,
          falloff,
        },
        maskScratch,
      )
    }

    if (t === 'stElement') {
      const layer = d.layer as { dataUrl?: string } | null
      if (!layer?.dataUrl) continue
      const img = await getCachedImage(layer.dataUrl).catch(() => null)
      if (!img) continue
      const ew = img.naturalWidth || img.width
      const eh = img.naturalHeight || img.height
      const { dw: edw, dh: edh } = drawSizeFromRef(ew, eh, ref, 0.88 * (typeof d.scale === 'number' ? d.scale : 1))
      const ox = typeof d.offsetX === 'number' ? d.offsetX : 0
      const oy = typeof d.offsetY === 'number' ? d.offsetY : 0
      const ex = (w - edw) / 2 + sn(ox)
      const ey = (h - edh) / 2 + sn(oy)
      const g = resolveGlow(nodes, (d.linkedGlowSource as string) || null)
      if (g) {
        drawLogoWithGlow(ctx, img, { x: ex, y: ey, w: edw, h: edh }, g)
      } else {
        ctx.drawImage(img, ex, ey, edw, edh)
      }
      const tint = resolveColor(nodes, (d.linkedColorSource as string) || null, '')
      if (tint && /^#/.test(tint)) {
        ctx.save()
        ctx.globalCompositeOperation = 'source-atop'
        ctx.fillStyle = tint
        ctx.globalAlpha = 0.25
        ctx.fillRect(ex, ey, edw, edh)
        ctx.restore()
      }
    }

    if (t === 'stFont') {
      const t1 = String(d.text1 || '').trim()
      const t2 = String(d.text2 || '').trim()
      const fs = typeof d.fontSize === 'number' ? d.fontSize : 36
      const ff = String(d.fontFamily || 'sans-serif')
      const baseColor = String(d.color || '#ffffff')
      const color = resolveColor(nodes, (d.linkedColorSource as string) || null, baseColor)
      const g = resolveGlow(nodes, (d.linkedGlowSource as string) || null)
      /** 字号与基线随 ref 走，避免长条画布仍按整高 h 排版显得「压扁」 */
      const fsScale = ref / previewNorm
      const textY = (fp: number, yMul: number) => (h + ref) / 2 - fp * yMul
      const drawLine = (text: string, fontPx: number, yMul: number, alpha: number) => {
        if (!text) return
        const fp = Math.max(8, Math.round(fontPx * fsScale))
        ctx.save()
        ctx.font = `${fp}px ${ff}`
        ctx.fillStyle = color
        ctx.globalAlpha = alpha
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        if (g?.enabled && g.size > 0 && g.opacity > 0) {
          ctx.shadowBlur = clamp(g.size * fsScale, 0, 48)
          ctx.shadowColor = g.color
          ctx.shadowOffsetX = 0
          ctx.shadowOffsetY = 0
        }
        ctx.fillText(text, w / 2, textY(fp, yMul))
        ctx.restore()
      }
      drawLine(t1, fs, 1.8, 1)
      drawLine(t2, Math.round(fs * 0.65), 0.8, 0.72)
    }
  }

  return canvas
}

export function findPreviewNode(nodes: Node[], tpl: StageTplId): { width: number; height: number; fileName: string } {
  const n = nodes.find(x => x.type === 'stPreview' && (x.data as { tpl?: string }).tpl === tpl)
  const d = (n?.data || {}) as { width?: number; height?: number; fileName?: string }
  return {
    width: clamp(typeof d.width === 'number' ? d.width : 400, 32, 4096),
    height: clamp(typeof d.height === 'number' ? d.height : 400, 32, 4096),
    fileName:
      (d.fileName && String(d.fileName).trim()) || (tpl === 'a' ? 'stage-main' : 'stage-second'),
  }
}

/** 从单个预览节点读取导出尺寸与 tpl（供批量导出按连线收集） */
export function metaFromPreviewNode(n: Node): { width: number; height: number; fileName: string; tpl: StageTplId } | null {
  if (n.type !== 'stPreview') return null
  const tpl: StageTplId = (n.data as { tpl?: string }).tpl === 'b' ? 'b' : 'a'
  const { width, height, fileName } = findPreviewNode([n], tpl)
  return { width, height, fileName, tpl }
}
