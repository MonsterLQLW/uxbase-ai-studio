export type PixelFramePlacement = {
  imageId: string
  /** 0–1：画布上的中心点 x */
  x: number
  y: number
  /** 相对基准尺寸的比例，约 0.15–1.3 */
  scale: number
  rotateDeg: number
  opacity: number
  zIndex: number
}

export type PixelFramePlan = {
  placements: PixelFramePlacement[]
  borderWidth: number
  borderColor: string
}

export type PixelCompositeImage = { id: string; label: string; dataUrl: string }

function clamp(n: number, a: number, b: number) {
  return Math.min(b, Math.max(a, n))
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('参考图加载失败'))
    img.src = dataUrl
  })
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

function readImageId(entry: Record<string, unknown>): string | null {
  const a = entry.imageId
  const b = entry.image_id
  if (typeof a === 'string' && a) return a
  if (typeof b === 'string' && b) return b
  return null
}

export function normalizeAndValidatePlan(raw: unknown, allowedIds: Set<string>): PixelFramePlan | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const placementsIn = o.placements
  if (!Array.isArray(placementsIn) || placementsIn.length === 0) return null
  const placements: PixelFramePlacement[] = []
  for (const e of placementsIn) {
    if (!e || typeof e !== 'object') continue
    const rec = e as Record<string, unknown>
    const imageId = readImageId(rec)
    if (!imageId || !allowedIds.has(imageId)) continue
    placements.push({
      imageId,
      x: clamp(Number(rec.x), 0, 1),
      y: clamp(Number(rec.y), 0, 1),
      scale: clamp(Number(rec.scale), 0.12, 2.8),
      rotateDeg: clamp(Number(rec.rotateDeg), -180, 180),
      opacity: clamp(Number(rec.opacity), 0.25, 1),
      zIndex: Number.isFinite(Number(rec.zIndex)) ? Math.round(Number(rec.zIndex)) : 0,
    })
  }
  if (placements.length === 0) return null
  const bw = Number(o.borderWidth)
  const bc = o.borderColor
  return {
    placements,
    borderWidth: clamp(Number.isFinite(bw) ? bw : 6, 0, 28),
    borderColor: typeof bc === 'string' && bc.trim() ? bc.trim() : '#6366f1',
  }
}

export function ensureEveryImageUsed(plan: PixelFramePlan, images: Array<{ id: string }>): PixelFramePlan {
  const used = new Set(plan.placements.map(p => p.imageId))
  const placements = [...plan.placements]
  let zMax = placements.reduce((m, p) => Math.max(m, p.zIndex), -1)
  for (const img of images) {
    if (!used.has(img.id)) {
      zMax += 1
      placements.push({
        imageId: img.id,
        x: 0.5,
        y: 0.14,
        scale: 0.52,
        rotateDeg: 0,
        opacity: 0.95,
        zIndex: zMax,
      })
      used.add(img.id)
    }
  }
  return { ...plan, placements }
}

const QUAD_CENTERS: Record<'lt' | 'lb' | 'rt' | 'rb', [number, number]> = {
  lt: [0.24, 0.24],
  rt: [0.76, 0.24],
  lb: [0.24, 0.76],
  rb: [0.76, 0.76],
}

/** JSON 解析失败或模型乱写时的本地布局：按所选象限轮询摆放，内容仍是用户参考图像素 */
export function defaultPixelFramePlan(
  images: Array<{ id: string }>,
  quadrants: Array<'lt' | 'lb' | 'rt' | 'rb'>,
): PixelFramePlan {
  if (images.length === 0) return { placements: [], borderWidth: 6, borderColor: '#6366f1' }
  const qs: Array<'lt' | 'lb' | 'rt' | 'rb'> =
    quadrants.length > 0 ? quadrants : ['lt', 'rt', 'lb', 'rb']
  const placements: PixelFramePlacement[] = images.map((img, idx) => {
    const q = qs[idx % qs.length]
    const [bx, by] = QUAD_CENTERS[q]
    const layer = Math.floor(idx / qs.length)
    const wobble = layer * 0.05
    const ang = idx * 1.17
    return {
      imageId: img.id,
      x: clamp(bx + Math.cos(ang) * wobble, 0.12, 0.88),
      y: clamp(by + Math.sin(ang) * wobble, 0.12, 0.88),
      scale: 0.74 - layer * 0.06,
      rotateDeg: 0,
      opacity: 0.98,
      zIndex: idx,
    }
  })
  return { placements, borderWidth: 6, borderColor: '#6366f1' }
}

export async function renderAvatarFrameFromPlan(options: {
  shape: 'circle' | 'square'
  quadrants: Array<'lt' | 'lb' | 'rt' | 'rb'>
  images: PixelCompositeImage[]
  plan: PixelFramePlan
  variantIndex: number
  referenceSimilarity: number
}): Promise<string> {
  const { shape, images, plan, variantIndex, referenceSimilarity } = options
  if (typeof document === 'undefined') {
    throw new Error('像素合成需要在浏览器环境运行')
  }

  const size = 1024
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建 Canvas')

  ctx.clearRect(0, 0, size, size)

  const cx = size / 2
  const cy = size / 2
  const holeR = size * 0.34

  const imageMap = new Map(images.map(i => [i.id, i]))
  const ordered = [...plan.placements].sort((a, b) => a.zIndex - b.zIndex)

  const highSim = referenceSimilarity >= 78
  const rotNudge = highSim ? variantIndex * 1.2 : variantIndex * 5
  const scaleNudge = highSim ? 1 + variantIndex * 0.003 : 1 + variantIndex * 0.014

  const bitmaps = new Map<string, HTMLImageElement>()
  for (const p of ordered) {
    const ref = imageMap.get(p.imageId)
    if (!ref || bitmaps.has(p.imageId)) continue
    bitmaps.set(p.imageId, await loadImage(ref.dataUrl))
  }

  for (const p of ordered) {
    const ref = imageMap.get(p.imageId)
    if (!ref) continue
    const img = bitmaps.get(p.imageId)
    if (!img) continue
    const w = img.naturalWidth || 1
    const h = img.naturalHeight || 1
    const rot = ((p.rotateDeg + rotNudge * (1 + p.zIndex * 0.02)) * Math.PI) / 180
    const sc = clamp(p.scale, 0.15, 2.5) * scaleNudge
    const px = size * clamp(p.x, 0, 1)
    const py = size * clamp(p.y, 0, 1)
    const target = size * 0.38 * sc
    const dw = w >= h ? target : (target * w) / h
    const dh = h >= w ? target : (target * h) / w

    ctx.save()
    ctx.globalAlpha = clamp(p.opacity, 0.2, 1)
    ctx.translate(px, py)
    ctx.rotate(rot)
    ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh)
    ctx.restore()
  }

  ctx.save()
  ctx.globalCompositeOperation = 'destination-out'
  ctx.beginPath()
  if (shape === 'circle') {
    ctx.arc(cx, cy, holeR, 0, Math.PI * 2)
  } else {
    const rr = size * 0.08
    roundRectPath(ctx, cx - holeR, cy - holeR, holeR * 2, holeR * 2, rr)
  }
  ctx.fill()
  ctx.restore()

  const bw = clamp(plan.borderWidth, 0, 28)
  if (bw > 0) {
    ctx.save()
    ctx.strokeStyle = plan.borderColor || '#6366f1'
    ctx.lineWidth = bw
    ctx.beginPath()
    if (shape === 'circle') {
      ctx.arc(cx, cy, holeR, 0, Math.PI * 2)
    } else {
      const rr = size * 0.08
      roundRectPath(ctx, cx - holeR, cy - holeR, holeR * 2, holeR * 2, rr)
    }
    ctx.stroke()
    ctx.restore()
  }

  return canvas.toDataURL('image/png')
}
