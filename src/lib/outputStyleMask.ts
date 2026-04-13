/**
 * 输出工具「戳戳 / 模板搭建」共用：全幅遮罩底图 + multiply 着色 + 自下而上渐隐。
 */

export type OutputStyleMaskLayer = { dataUrl: string; name?: string }

export const MASK_BUILTIN_BASE_LAYER: OutputStyleMaskLayer = {
  dataUrl:
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  name: '内置遮罩底图',
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n))
}

/** 与 UI 滑块上限一致（原为 1 / 1 / 3，现为 200% 强度） */
export const MASK_UI_MAX_OPACITY = 2
export const MASK_UI_MAX_REACH = 2
export const MASK_UI_MAX_FALLOFF = 6
export const MASK_UI_MIN_REACH = 0.06
export const MASK_UI_MIN_FALLOFF = 0.2

/** 滑块仍为 0–100% 读数：内部值按当前上限折算（上限加倍后满档仍显示 100%） */
export function maskParamDisplayPercent(value: number, max: number): number {
  if (max <= 0) return 0
  return Math.round((clamp(value, 0, max) / max) * 100)
}

/** 自下而上 alpha：底部最实、向上按幂次渐隐（与戳戳遮罩一致） */
export function fillMaskBottomAlphaMatte(canvas: HTMLCanvasElement, h: number, reach: number, falloff: number) {
  const pow = clamp(falloff, 0.15, 8)
  const reachClamped = clamp(reach, 0.02, MASK_UI_MAX_REACH)
  const yTop = Math.floor(h * (1 - reachClamped))
  const band = Math.max(1, h - yTop)
  if (canvas.width !== 1) canvas.width = 1
  if (canvas.height !== h) canvas.height = h
  const mctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!mctx) return
  const img = mctx.createImageData(1, h)
  const d = img.data
  for (let y = 0; y < h; y++) {
    const i = y * 4
    d[i] = 255
    d[i + 1] = 255
    d[i + 2] = 255
    if (y < yTop) {
      d[i + 3] = 0
    } else if (band <= 1) {
      d[i + 3] = 255
    } else {
      const t = (y - yTop) / (band - 1)
      d[i + 3] = Math.round(255 * Math.pow(clamp(t, 0, 1), pow))
    }
  }
  mctx.putImageData(img, 0, 0)
}

export type OutputStyleMaskScratch = {
  compose: HTMLCanvasElement
  matte: HTMLCanvasElement
  tint: HTMLCanvasElement
}

export async function drawOutputStyleBottomFadeMask(
  octx: CanvasRenderingContext2D,
  w: number,
  h: number,
  getCachedImage: (dataUrl: string) => Promise<HTMLImageElement | null>,
  opts: {
    maskLayer: OutputStyleMaskLayer | null | undefined
    tint: string
    opacity: number
    reach: number
    falloff: number
  },
  scratch: OutputStyleMaskScratch,
): Promise<void> {
  const op = clamp(opts.opacity, 0, MASK_UI_MAX_OPACITY)
  if (op <= 0.001) return
  const url = opts.maskLayer?.dataUrl || MASK_BUILTIN_BASE_LAYER.dataUrl
  const maskImg = await getCachedImage(url).catch(() => null)
  if (!maskImg) return

  const { compose, matte, tint: tc } = scratch
  if (compose.width !== w) compose.width = w
  if (compose.height !== h) compose.height = h
  const cctx = compose.getContext('2d')
  if (!cctx) return

  cctx.clearRect(0, 0, w, h)
  cctx.drawImage(maskImg, 0, 0, w, h)
  const tintStr = String(opts.tint || '').trim()
  if (/^#[0-9a-fA-F]{6}$/.test(tintStr) && tintStr.toUpperCase() !== '#FFFFFF') {
    if (tc.width !== w) tc.width = w
    if (tc.height !== h) tc.height = h
    const tctx = tc.getContext('2d')
    if (tctx) {
      tctx.clearRect(0, 0, w, h)
      tctx.drawImage(maskImg, 0, 0, w, h)
      tctx.globalCompositeOperation = 'multiply'
      tctx.fillStyle = tintStr
      tctx.fillRect(0, 0, w, h)
      tctx.globalCompositeOperation = 'destination-in'
      tctx.drawImage(maskImg, 0, 0, w, h)
      tctx.globalCompositeOperation = 'source-over'
      cctx.clearRect(0, 0, w, h)
      cctx.drawImage(tc, 0, 0)
    }
  }

  fillMaskBottomAlphaMatte(
    matte,
    h,
    clamp(opts.reach, MASK_UI_MIN_REACH, MASK_UI_MAX_REACH),
    clamp(opts.falloff, MASK_UI_MIN_FALLOFF, MASK_UI_MAX_FALLOFF),
  )
  cctx.save()
  cctx.globalCompositeOperation = 'destination-in'
  cctx.drawImage(matte, 0, 0, 1, h, 0, 0, w, h)
  cctx.restore()

  octx.save()
  const a1 = Math.min(1, op)
  octx.globalAlpha = a1
  octx.drawImage(compose, 0, 0)
  const a2 = Math.max(0, op - 1)
  if (a2 > 0.001) {
    octx.globalAlpha = a2
    octx.drawImage(compose, 0, 0)
  }
  octx.restore()
}
