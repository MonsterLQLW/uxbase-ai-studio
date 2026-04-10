import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

type Mode = 'solid' | 'glass'
type RGB = { r: number; g: number; b: number }
export type AIMattingState = {
  mode: Mode
  originalDataUrl: string
  processedDataUrl: string
  historyPast: string[]
  historyFuture: string[]
  isWhiteBg: boolean
  isPicking: boolean
  customColors: RGB[]
  sTolerance: number
  sBlack: number
  sSmooth: number
  sBlur: number
  sShift: number
  gThresh: number
  gBoost: number
  gShadow: number
  gDegray: number
  gFeather: number
}

function clamp(n: number, a: number, b: number) {
  return Math.min(b, Math.max(a, n))
}

function toInt(n: number) {
  return Number.isFinite(n) ? Math.round(n) : 0
}

function getBgColor(data: Uint8ClampedArray, w: number, h: number) {
  const points = [0, (w - 1) * 4, w * (h - 1) * 4, (w * h - 1) * 4, Math.floor(w / 2) * 4, Math.floor(w * h - w / 2) * 4]
  let r = 0
  let g = 0
  let b = 0
  let c = 0
  for (const i of points) {
    if (i >= 0 && i + 2 < data.length) {
      r += data[i]
      g += data[i + 1]
      b += data[i + 2]
      c += 1
    }
  }
  if (!c) return { r: 255, g: 255, b: 255 }
  return { r: r / c, g: g / c, b: b / c }
}

function smartFloodFill(
  data: Uint8ClampedArray,
  mask: Uint8Array,
  w: number,
  h: number,
  bg: { r: number; g: number; b: number },
  colorTol: number,
  blackTol: number,
) {
  const stack: Array<{ x: number; y: number }> = []
  const seeds = [
    { x: 0, y: 0 },
    { x: w - 1, y: 0 },
    { x: 0, y: h - 1 },
    { x: w - 1, y: h - 1 },
  ]
  for (const p of seeds) stack.push(p)

  const tolSq = (colorTol * 1.5) ** 2 * 3
  const blackThresh = blackTol * 2.55

  while (stack.length) {
    const p = stack.pop()
    if (!p) break
    const { x, y } = p
    if (x < 0 || x >= w || y < 0 || y >= h) continue
    const i = y * w + x
    if (mask[i]) continue
    const idx = i * 4
    const r = data[idx]
    const g = data[idx + 1]
    const b = data[idx + 2]
    const distSq = (r - bg.r) ** 2 + (g - bg.g) ** 2 + (b - bg.b) ** 2
    let isMatch = distSq < tolSq
    if (!isMatch && blackTol > 0) {
      const luma = 0.299 * r + 0.587 * g + 0.114 * b
      if (luma < blackThresh) isMatch = true
    }
    if (!isMatch) continue

    mask[i] = 1
    if (x > 0) stack.push({ x: x - 1, y })
    if (x < w - 1) stack.push({ x: x + 1, y })
    if (y > 0) stack.push({ x, y: y - 1 })
    if (y < h - 1) stack.push({ x, y: y + 1 })
  }
}

function boxBlur(src: Float32Array, w: number, h: number, radius: number) {
  const r = Math.max(0, toInt(radius))
  if (r <= 0) return
  const temp = new Float32Array(src.length)

  // horizontal
  for (let y = 0; y < h; y++) {
    const row = y * w
    for (let x = 0; x < w; x++) {
      let sum = 0
      let count = 0
      for (let k = -r; k <= r; k++) {
        const px = clamp(x + k, 0, w - 1)
        sum += src[row + px]
        count += 1
      }
      temp[row + x] = sum / count
    }
  }

  // vertical
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let sum = 0
      let count = 0
      for (let k = -r; k <= r; k++) {
        const py = clamp(y + k, 0, h - 1)
        sum += temp[py * w + x]
        count += 1
      }
      src[y * w + x] = sum / count
    }
  }
}

export default function AIMatting({
  state: persisted,
  onStateChange,
}: {
  state: AIMattingState
  onStateChange: (updater: (prev: AIMattingState) => AIMattingState) => void
}) {
  const fileRef = useRef<HTMLInputElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null)
  const originalImgRef = useRef<HTMLImageElement | null>(null)

  const [mode, setMode] = useState<Mode>('solid')
  const [originalDataUrl, setOriginalDataUrl] = useState('')
  const [processedDataUrl, setProcessedDataUrl] = useState('')
  const [historyPast, setHistoryPast] = useState<string[]>([])
  const [historyFuture, setHistoryFuture] = useState<string[]>([])
  const [isPicking, setIsPicking] = useState(false)
  const [customColors, setCustomColors] = useState<RGB[]>([])
  const [processed, setProcessed] = useState<ImageData | null>(null)
  const [isWhiteBg, setIsWhiteBg] = useState(false)
  const [loading, setLoading] = useState(false)
  const [ctxMenu, setCtxMenu] = useState<null | { x: number; y: number }>(null)

  // solid
  const [sTolerance, setSTolerance] = useState(20)
  const [sBlack, setSBlack] = useState(30)
  const [sSmooth, setSSmooth] = useState(0)
  const [sBlur, setSBlur] = useState(10)
  const [sShift, setSShift] = useState(-2)

  // glass
  const [gThresh, setGThresh] = useState(10)
  const [gBoost, setGBoost] = useState(50)
  const [gShadow, setGShadow] = useState(50)
  const [gDegray, setGDegray] = useState(80)
  const [gFeather, setGFeather] = useState(8)

  const canProcess = Boolean((originalImgRef.current || originalDataUrl) && ctxRef.current && canvasRef.current)

  // 防止首次挂载时用“默认空 state”覆盖 App 里已存在的记录
  const syncingRef = useRef(true)

  // 从 App 持久化状态恢复（切换顶部功能回来时会走这里）
  useEffect(() => {
    syncingRef.current = true
    setMode(persisted.mode)
    setOriginalDataUrl(persisted.originalDataUrl || '')
    setProcessedDataUrl(persisted.processedDataUrl || '')
    setHistoryPast(Array.isArray(persisted.historyPast) ? persisted.historyPast.filter(Boolean) : [])
    setHistoryFuture(Array.isArray(persisted.historyFuture) ? persisted.historyFuture.filter(Boolean) : [])
    setIsWhiteBg(Boolean(persisted.isWhiteBg))
    setIsPicking(false)
    setCustomColors(Array.isArray(persisted.customColors) ? persisted.customColors : [])
    setSTolerance(persisted.sTolerance ?? 20)
    setSBlack(persisted.sBlack ?? 30)
    setSSmooth(persisted.sSmooth ?? 0)
    setSBlur(persisted.sBlur ?? 10)
    setSShift(persisted.sShift ?? -2)
    setGThresh(persisted.gThresh ?? 10)
    setGBoost(persisted.gBoost ?? 50)
    setGShadow(persisted.gShadow ?? 50)
    setGDegray(persisted.gDegray ?? 80)
    setGFeather(persisted.gFeather ?? 8)
    syncingRef.current = false
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 允许后续正常同步
  useEffect(() => {
    syncingRef.current = false
  }, [])

  // 将本地操作同步回 App（从而切换顶部功能也保留）
  useEffect(() => {
    if (syncingRef.current) return
    onStateChange(() => ({
      mode,
      originalDataUrl,
      processedDataUrl,
      historyPast,
      historyFuture,
      isWhiteBg,
      isPicking,
      customColors,
      sTolerance,
      sBlack,
      sSmooth,
      sBlur,
      sShift,
      gThresh,
      gBoost,
      gShadow,
      gDegray,
      gFeather,
    }))
  }, [
    customColors,
    gBoost,
    gDegray,
    gFeather,
    gShadow,
    gThresh,
    historyFuture,
    historyPast,
    isPicking,
    isWhiteBg,
    mode,
    onStateChange,
    originalDataUrl,
    processedDataUrl,
    sBlack,
    sBlur,
    sShift,
    sSmooth,
    sTolerance,
  ])

  const resetParams = useCallback(() => {
    setSTolerance(20)
    setSBlack(30)
    setSSmooth(0)
    setSBlur(10)
    setSShift(-2)
    setCustomColors([])
    setGThresh(10)
    setGBoost(50)
    setGShadow(50)
    setGDegray(80)
    setGFeather(8)
  }, [])

  const clearCanvas = useCallback(() => {
    originalImgRef.current = null
    setProcessed(null)
    setCustomColors([])
    setIsPicking(false)
    setIsWhiteBg(false)
    setOriginalDataUrl('')
    setProcessedDataUrl('')
    setHistoryPast([])
    setHistoryFuture([])
    const ctx = ctxRef.current
    const canvas = canvasRef.current
    if (ctx && canvas) {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      canvas.width = 0
      canvas.height = 0
    }
  }, [])

  const stopPicking = useCallback(() => {
    setIsPicking(false)
    const ctx = ctxRef.current
    const canvas = canvasRef.current
    if (!ctx || !canvas) return
    if (processed) ctx.putImageData(processed, 0, 0)
  }, [processed])

  const drawOriginal = useCallback(() => {
    const ctx = ctxRef.current
    const canvas = canvasRef.current
    const img = originalImgRef.current
    if (!ctx || !canvas || !img) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  }, [])

  const drawProcessed = useCallback(() => {
    const ctx = ctxRef.current
    const canvas = canvasRef.current
    if (!ctx) return
    if (processed) {
      ctx.putImageData(processed, 0, 0)
      return
    }
    if (!canvas || !processedDataUrl) return
    const img = new Image()
    img.onload = () => {
      canvas.width = img.naturalWidth || img.width
      canvas.height = img.naturalHeight || img.height
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    }
    img.src = processedDataUrl
  }, [processed, processedDataUrl])

  const processSolid = useCallback(() => {
    const ctx = ctxRef.current
    const canvas = canvasRef.current
    const img = originalImgRef.current
    if (!ctx || !canvas || !img) return

    const w = canvas.width
    const h = canvas.height
    ctx.drawImage(img, 0, 0, w, h)
    const imageData = ctx.getImageData(0, 0, w, h)
    const data = imageData.data

    const tolerance = toInt(sTolerance)
    const blackTol = toInt(sBlack)
    const smoothVal = toInt(sSmooth)
    const blurRadius = toInt(sBlur)
    const shift = toInt(sShift)

    const bg = getBgColor(data, w, h)
    const bgMask = new Uint8Array(w * h)

    // 1) connected background
    smartFloodFill(data, bgMask, w, h, bg, tolerance, blackTol)

    // 2) picker kill
    if (customColors.length > 0) {
      const tolSq = (tolerance * 1.5) ** 2
      for (let i = 0; i < w * h; i++) {
        if (bgMask[i] === 1) continue
        const idx = i * 4
        const r = data[idx]
        const g = data[idx + 1]
        const b = data[idx + 2]
        for (const c of customColors) {
          const dist = (r - c.r) ** 2 + (g - c.g) ** 2 + (b - c.b) ** 2
          if (dist < tolSq) {
            bgMask[i] = 1
            break
          }
        }
      }
    }

    // 3) to alpha
    const alpha = new Float32Array(w * h)
    for (let i = 0; i < w * h; i++) alpha[i] = bgMask[i] === 1 ? 0 : 255

    // 4) smooth -> binarize
    if (smoothVal > 0) {
      const r = Math.max(1, Math.round(smoothVal / 5))
      boxBlur(alpha, w, h, r)
      for (let i = 0; i < w * h; i++) alpha[i] = alpha[i] > 127.5 ? 255 : 0
    }

    // 5) feather blur
    if (blurRadius > 0) boxBlur(alpha, w, h, blurRadius)

    // 6) apply + shift
    for (let i = 0; i < w * h; i++) {
      let a = alpha[i]
      if (shift !== 0) {
        if (shift < 0) {
          const cut = Math.abs(shift) * 5
          a = (a - cut) * (255 / (255 - cut))
        } else {
          const boost = shift * 5
          a = a * (255 / (255 - boost))
        }
      }
      data[i * 4 + 3] = clamp(a, 0, 255)
    }

    ctx.putImageData(imageData, 0, 0)
    setProcessed(imageData)
    const url = canvas.toDataURL('image/png')
    setHistoryPast(prev => (processedDataUrl ? [...prev, processedDataUrl] : prev))
    setHistoryFuture([])
    setProcessedDataUrl(url)
  }, [customColors, processedDataUrl, sBlack, sBlur, sShift, sSmooth, sTolerance])

  const processGlass = useCallback(() => {
    const ctx = ctxRef.current
    const canvas = canvasRef.current
    const img = originalImgRef.current
    if (!ctx || !canvas || !img) return

    const w = canvas.width
    const h = canvas.height
    ctx.drawImage(img, 0, 0, w, h)
    const imageData = ctx.getImageData(0, 0, w, h)
    const data = imageData.data

    const thresh = toInt(gThresh)
    const boost = toInt(gBoost) / 50
    const shadowKeep = toInt(gShadow) / 50
    const deGray = toInt(gDegray) / 100
    const feather = toInt(gFeather)
    // 背景阈值的“过渡带”（避免硬切白边）。Feather 越大，过渡带越宽。
    const threshFeatherBand = feather > 0 ? Math.max(2, Math.round(feather * 1.2)) : 0

    const bg = getBgColor(data, w, h)
    const bgLuma = 0.299 * bg.r + 0.587 * bg.g + 0.114 * bg.b

    for (let i = 0; i < w * h; i++) {
      const idx = i * 4
      const r = data[idx]
      const g = data[idx + 1]
      const b = data[idx + 2]
      const luma = 0.299 * r + 0.587 * g + 0.114 * b
      const diff = luma - bgLuma

      let a = 0
      let nr = r
      let ng = g
      let nb = b

      const mag = Math.abs(diff)

      // 先算“基础 alpha”（不做阈值硬切）
      if (diff > 0) {
        a = Math.min(255, diff * 2 * boost)
        nr = r * (1 - deGray) + 255 * deGray
        ng = g * (1 - deGray) + 255 * deGray
        nb = b * (1 - deGray) + 255 * deGray
      } else {
        a = Math.min(255, mag * 2 * shadowKeep)
        nr = r * (1 - deGray)
        ng = g * (1 - deGray)
        nb = b * (1 - deGray)
      }

      // 再用阈值“羽化带”做门控：mag < thresh → 0；mag > thresh+band → 1；中间 smoothstep
      if (threshFeatherBand <= 0) {
        if (mag < thresh) a = 0
      } else {
        const t = (mag - thresh) / threshFeatherBand
        const s = clamp(t, 0, 1)
        const gate = s * s * (3 - 2 * s)
        a *= gate
      }

      data[idx] = nr
      data[idx + 1] = ng
      data[idx + 2] = nb
      data[idx + 3] = a
    }

    if (feather > 0) {
      // 边缘羽化（玻璃模式更依赖 alpha 的“边缘强度”检测）
      // 1) 先保存原始 alpha；2) 算一个用于羽化的 blurred alpha；3) 用 alpha 梯度找边缘；4) 只在边缘带做混合
      const n = w * h
      const origAlpha = new Float32Array(n)
      for (let i = 0; i < n; i++) origAlpha[i] = data[i * 4 + 3]

      const blurred = new Float32Array(origAlpha)
      boxBlur(blurred, w, h, feather)

      // 简化 Sobel：用 4 邻域差分估计边缘强度（0..255+）
      const edge = new Float32Array(n)
      for (let y = 0; y < h; y++) {
        const y0 = y * w
        const yUp = (y > 0 ? y - 1 : y) * w
        const yDn = (y < h - 1 ? y + 1 : y) * w
        for (let x = 0; x < w; x++) {
          const i = y0 + x
          const l = origAlpha[y0 + (x > 0 ? x - 1 : x)]
          const r = origAlpha[y0 + (x < w - 1 ? x + 1 : x)]
          const u = origAlpha[yUp + x]
          const d = origAlpha[yDn + x]
          edge[i] = Math.abs(r - l) + Math.abs(d - u)
        }
      }

      // 把边缘强度映射成 0..1 的权重，并把权重扩散成“边缘带”
      // feather 越大：允许更宽的边缘带（权重扩散更明显）
      const edgeMask = new Float32Array(n)
      const edgeLow = 14 // 低阈：过滤噪点
      const edgeHigh = 80 // 高阈：强边缘
      for (let i = 0; i < n; i++) {
        const e = edge[i]
        const t = (e - edgeLow) / (edgeHigh - edgeLow)
        // smoothstep
        const s = clamp(t, 0, 1)
        edgeMask[i] = s * s * (3 - 2 * s)
      }
      boxBlur(edgeMask, w, h, Math.max(1, Math.round(feather / 2)))
      for (let i = 0; i < n; i++) edgeMask[i] = clamp(edgeMask[i], 0, 1)

      // 最终：仅在边缘带按权重混合 alpha
      for (let i = 0; i < n; i++) {
        const wgt = edgeMask[i]
        const out = origAlpha[i] * (1 - wgt) + blurred[i] * wgt
        data[i * 4 + 3] = clamp(out, 0, 255)
      }
    }

    ctx.putImageData(imageData, 0, 0)
    setProcessed(imageData)
    const url = canvas.toDataURL('image/png')
    setHistoryPast(prev => (processedDataUrl ? [...prev, processedDataUrl] : prev))
    setHistoryFuture([])
    setProcessedDataUrl(url)
  }, [gBoost, gDegray, gFeather, gShadow, gThresh, processedDataUrl])

  const process = useCallback(() => {
    if (!canProcess) return
    setLoading(true)
    setTimeout(() => {
      if (mode === 'solid') processSolid()
      else processGlass()
      setLoading(false)
    }, 30)
  }, [canProcess, mode, processGlass, processSolid])

  const download = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const link = document.createElement('a')
    link.download = `AI_Matting_${Date.now()}.png`
    link.href = canvas.toDataURL('image/png')
    link.click()
  }, [])

  const onPickClick = useCallback(() => {
    if (mode !== 'solid') return
    setIsPicking(v => !v)
    setTimeout(() => {
      const img = originalImgRef.current
      const ctx = ctxRef.current
      const canvas = canvasRef.current
      if (!img || !ctx || !canvas) return
      // picking needs original visible
      if (!isPicking) {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      } else {
        // turning off
        if (processed) ctx.putImageData(processed, 0, 0)
      }
    }, 0)
  }, [isPicking, mode, processed])

  const slidersKey = useMemo(
    () =>
      [
        // 注意：切换“通用/实物 ↔ 透明/玻璃”不应清空/重算当前结果（保留操作视图）
        sTolerance,
        sBlack,
        sSmooth,
        sBlur,
        sShift,
        gThresh,
        gBoost,
        gShadow,
        gDegray,
        gFeather,
        customColors.length,
      ].join('|'),
    [customColors.length, gBoost, gDegray, gFeather, gShadow, gThresh, sBlack, sBlur, sShift, sSmooth, sTolerance],
  )

  // init context
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return
    ctxRef.current = ctx
  }, [])

  // 恢复后重绘画布（切换顶部功能回来时仍可见）
  useEffect(() => {
    const ctx = ctxRef.current
    const canvas = canvasRef.current
    if (!ctx || !canvas) return
    const url = processedDataUrl || originalDataUrl
    if (!url) return
    const img = new Image()
    img.onload = () => {
      canvas.width = img.naturalWidth || img.width
      canvas.height = img.naturalHeight || img.height
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      if (url === originalDataUrl) originalImgRef.current = img
    }
    img.src = url
  }, [originalDataUrl, processedDataUrl])

  // auto-process when params change (debounced)
  useEffect(() => {
    if (!canProcess) return
    if (isPicking) return
    const t = window.setTimeout(() => process(), 120)
    return () => window.clearTimeout(t)
  }, [canProcess, isPicking, process, slidersKey])

  useEffect(() => {
    if (!ctxMenu) return
    const onDown = () => setCtxMenu(null)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCtxMenu(null)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [ctxMenu])

  const onFile = useCallback(async (file: File) => {
    const url = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result || ''))
      reader.onerror = () => reject(new Error('读取失败'))
      reader.readAsDataURL(file)
    })

    const img = new Image()
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('图片加载失败'))
      img.src = url
    })
    originalImgRef.current = img
    setProcessed(null)
    setCustomColors([])
    setIsPicking(false)
    setOriginalDataUrl(url)
    setProcessedDataUrl('')
    setHistoryPast([])
    setHistoryFuture([])

    const canvas = canvasRef.current
    const ctx = ctxRef.current
    if (!canvas || !ctx) return
    canvas.width = img.naturalWidth || img.width
    canvas.height = img.naturalHeight || img.height
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    process()
  }, [process])

  const undo = useCallback(() => {
    setHistoryPast(prev => {
      if (prev.length === 0) return prev
      const last = prev[prev.length - 1]
      setHistoryFuture(f => (processedDataUrl ? [processedDataUrl, ...f] : f))
      setProcessedDataUrl(last)
      setProcessed(null)
      return prev.slice(0, -1)
    })
  }, [processedDataUrl])

  const redo = useCallback(() => {
    setHistoryFuture(prev => {
      if (prev.length === 0) return prev
      const next = prev[0]
      setHistoryPast(p => (processedDataUrl ? [...p, processedDataUrl] : p))
      setProcessedDataUrl(next)
      setProcessed(null)
      return prev.slice(1)
    })
  }, [processedDataUrl])

  const onCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!isPicking) return
      if (mode !== 'solid') return
      const ctx = ctxRef.current
      const canvas = canvasRef.current
      if (!ctx || !canvas) return
      const rect = canvas.getBoundingClientRect()
      const scaleX = canvas.width / rect.width
      const scaleY = canvas.height / rect.height
      const x = Math.floor((e.clientX - rect.left) * scaleX)
      const y = Math.floor((e.clientY - rect.top) * scaleY)
      const p = ctx.getImageData(x, y, 1, 1).data
      setCustomColors(prev => [...prev, { r: p[0], g: p[1], b: p[2] }])
      stopPicking()
      process()
    },
    [isPicking, mode, process, stopPicking],
  )

  return (
    <div
      className="h-full flex overflow-hidden rounded-3xl border border-slate-800/70 bg-slate-950/30 shadow-[0_0_0_1px_rgba(255,255,255,0.03),0_24px_80px_rgba(0,0,0,0.55)] relative"
      onContextMenu={e => {
        e.preventDefault()
        setCtxMenu({ x: e.clientX, y: e.clientY })
      }}
    >
      {/* Sidebar */}
      <div className="w-[392px] shrink-0 border-r border-slate-800/70 bg-slate-900/55 backdrop-blur-xl p-4 overflow-y-auto">
        <div className="pb-3 border-b border-slate-800/70">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-base font-semibold text-slate-100 tracking-tight">智能抠图</div>
              <div className="text-[11px] text-slate-400 mt-0.5">通用/实物 · 透明/玻璃 · 本地像素算法</div>
            </div>
            <span className="text-[10px] px-2 py-1 rounded-full border border-slate-800/70 bg-slate-950/40 text-slate-400">
              v6
            </span>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            className="rounded-xl border border-slate-800/70 bg-slate-950/30 px-3 py-2 text-xs text-slate-200 hover:bg-slate-950/45 hover:border-slate-700/70 transition"
            onClick={resetParams}
          >
            ↺ 重置参数
          </button>
          <button
            className="rounded-xl border border-slate-800/70 bg-slate-950/30 px-3 py-2 text-xs text-slate-200 hover:bg-slate-950/45 hover:border-slate-700/70 transition"
            onClick={() => fileRef.current?.click()}
          >
            📂 换图
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={e => {
              const f = e.target.files?.[0]
              if (f) void onFile(f)
              e.currentTarget.value = ''
            }}
          />
        </div>

        <div className="mt-3 rounded-2xl border border-slate-800/70 bg-slate-950/35 p-3">
          <div className="text-[11px] font-semibold text-slate-300 mb-2">视觉辅助（按住）</div>
          <div className="grid grid-cols-2 gap-2">
            <button
              className="rounded-xl border border-slate-800/70 bg-slate-950/20 px-3 py-2 text-xs text-slate-200 hover:bg-slate-950/35 hover:border-slate-700/70 transition"
              onPointerDown={() => setIsWhiteBg(true)}
              onPointerUp={() => setIsWhiteBg(false)}
              onPointerLeave={() => setIsWhiteBg(false)}
            >
              ⬜ 白底预览
            </button>
            <button
              className="rounded-xl border border-slate-800/70 bg-slate-950/20 px-3 py-2 text-xs text-slate-200 hover:bg-slate-950/35 hover:border-slate-700/70 transition"
              onPointerDown={() => {
                if (isPicking) return
                drawOriginal()
              }}
              onPointerUp={() => {
                if (isPicking) return
                drawProcessed()
              }}
              onPointerLeave={() => {
                if (isPicking) return
                drawProcessed()
              }}
            >
              👁️ 原图对比
            </button>
          </div>
        </div>

        {/* Mode tabs */}
        <div className="mt-3 flex gap-1 rounded-2xl bg-slate-950/35 p-1 border border-slate-800/70">
          <button
            className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition ${
              mode === 'solid'
                ? 'bg-indigo-500/90 text-white shadow-[0_10px_30px_rgba(99,102,241,0.22)]'
                : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
            }`}
            onClick={() => {
              setMode('solid')
              stopPicking()
            }}
          >
            通用 / 实物
          </button>
          <button
            className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold transition ${
              mode === 'glass'
                ? 'bg-cyan-300/90 text-slate-950 shadow-[0_10px_30px_rgba(34,211,238,0.18)]'
                : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
            }`}
            onClick={() => {
              setMode('glass')
              stopPicking()
            }}
          >
            透明 / 玻璃
          </button>
        </div>

        {/* Solid panel */}
        {mode === 'solid' && (
          <div className="mt-3 space-y-3">
            <div className="rounded-2xl border border-slate-800/70 bg-slate-950/35 p-3">
              <div className="text-[11px] font-semibold text-slate-300 mb-2">吸管点杀（去除残留）</div>
              <button
                className={`w-full rounded-lg px-3 py-2 text-xs border transition ${
                  isPicking
                    ? 'bg-indigo-500/90 text-white border-indigo-300/50'
                    : 'bg-slate-950/20 border-slate-800/70 text-slate-200 hover:bg-slate-950/35 hover:border-slate-700/70'
                }`}
                onClick={onPickClick}
                disabled={!originalImgRef.current}
                title="开启后点击画面吸取残留颜色，再次处理"
              >
                {isPicking ? '🖱️ 请点击画面中的残留点' : '🖌️ 开启吸管（点击画面吸色）'}
              </button>
              <div className="mt-2 text-[11px] text-slate-400">已选颜色（点击删除）</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {customColors.length === 0 && <div className="text-[11px] text-slate-600">（无）</div>}
                {customColors.map((c, idx) => (
                  <button
                    key={idx}
                    className="w-6 h-6 rounded-full border border-white/70 shadow-[0_10px_20px_rgba(0,0,0,0.35)]"
                    style={{ backgroundColor: `rgb(${c.r},${c.g},${c.b})` }}
                    title={`删除 RGB(${c.r},${c.g},${c.b})`}
                    onClick={() => setCustomColors(prev => prev.filter((_, i) => i !== idx))}
                  />
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-800/70 bg-slate-950/35 p-3">
              <div className="text-[11px] font-semibold text-slate-300 mb-2">智能识别</div>
              <Slider label="色彩容差 (Tolerance)" value={sTolerance} onChange={setSTolerance} min={1} max={100} accent="indigo" />
              <Slider label="去黑增强 (Black)" value={sBlack} onChange={setSBlack} min={0} max={100} accent="indigo" />
            </div>

            <div className="rounded-2xl border border-slate-800/70 bg-slate-950/35 p-3">
              <div className="text-[11px] font-semibold text-slate-300 mb-2">边缘重构</div>
              <Slider label="智能平滑 (Liquid)" value={sSmooth} onChange={setSSmooth} min={0} max={100} accent="indigo" />
              <Slider label="羽化半径 (Blur)" value={sBlur} onChange={setSBlur} min={0} max={100} accent="indigo" />
              <Slider label="边缘收缩 (Shift)" value={sShift} onChange={setSShift} min={-20} max={20} accent="indigo" />
            </div>
          </div>
        )}

        {/* Glass panel */}
        {mode === 'glass' && (
          <div className="mt-3 space-y-3">
            <div className="rounded-2xl border border-slate-800/70 bg-slate-950/35 p-3">
              <div className="text-[11px] font-semibold text-slate-300 mb-2">透明材质参数</div>
              <Slider label="背景阈值 (Threshold)" value={gThresh} onChange={setGThresh} min={1} max={100} accent="cyan" />
              <Slider label="边缘羽化 (Feather)" value={gFeather} onChange={setGFeather} min={0} max={40} accent="cyan" />
              <Slider label="高光增强 (Highlight)" value={gBoost} onChange={setGBoost} min={0} max={100} accent="cyan" />
              <Slider label="阴影保留 (Shadow)" value={gShadow} onChange={setGShadow} min={0} max={100} accent="cyan" />
              <Slider label="去灰度 (De-Gray)" value={gDegray} onChange={setGDegray} min={0} max={100} accent="cyan" />
            </div>
          </div>
        )}

        <div className="mt-4 space-y-2">
          <button
            className="w-full rounded-2xl bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-900 disabled:text-slate-500 px-4 py-3 text-sm font-semibold text-white transition shadow-[0_18px_40px_rgba(79,70,229,0.22)]"
            onClick={process}
            disabled={!canProcess || loading}
          >
            {loading ? '正在精细计算…' : '⚡ 智能处理'}
          </button>
          <button
            className="w-full rounded-2xl border border-slate-800/70 bg-slate-950/25 px-4 py-3 text-sm font-semibold text-slate-200 hover:bg-slate-950/40 hover:border-slate-700/70 disabled:text-slate-600 transition"
            onClick={download}
            disabled={!processed}
          >
            📥 下载 PNG
          </button>
        </div>
      </div>

      {ctxMenu && (
        <div
          className="fixed z-50 min-w-[160px] rounded-xl border border-slate-800 bg-slate-950/95 backdrop-blur shadow-[0_18px_60px_rgba(0,0,0,0.55)] overflow-hidden"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          onMouseDown={e => e.stopPropagation()}
        >
          <button
            className="w-full text-left px-3 py-2 text-sm text-slate-200 hover:bg-slate-800/60 transition"
            onClick={() => {
              setCtxMenu(null)
              clearCanvas()
            }}
          >
            清空画布
          </button>
        </div>
      )}

      {/* Workspace */}
      <div
        className={`flex-1 relative flex items-center justify-center ${
          isPicking ? 'cursor-crosshair' : 'cursor-default'
        } ${
          isWhiteBg
            ? 'bg-white'
            : 'bg-slate-950 bg-[linear-gradient(45deg,rgba(30,41,59,0.55)_25%,transparent_25%),linear-gradient(-45deg,rgba(30,41,59,0.55)_25%,transparent_25%),linear-gradient(45deg,transparent_75%,rgba(30,41,59,0.55)_75%),linear-gradient(-45deg,transparent_75%,rgba(30,41,59,0.55)_75%)] bg-[length:24px_24px] bg-[position:0_0,0_12px,12px_-12px,-12px_0]'
        }`}
      >
        {/* 操作记录：撤回/前调 */}
        <div className="absolute top-4 right-4 z-20 flex items-center gap-2">
          <button
            className="h-9 w-9 rounded-xl border border-slate-800/70 bg-slate-950/60 backdrop-blur text-slate-200 hover:bg-slate-950/75 hover:border-slate-700/70 disabled:opacity-40 disabled:hover:bg-slate-950/60 transition"
            onClick={undo}
            disabled={historyPast.length === 0}
            title="撤回"
          >
            ←
          </button>
          <button
            className="h-9 w-9 rounded-xl border border-slate-800/70 bg-slate-950/60 backdrop-blur text-slate-200 hover:bg-slate-950/75 hover:border-slate-700/70 disabled:opacity-40 disabled:hover:bg-slate-950/60 transition"
            onClick={redo}
            disabled={historyFuture.length === 0}
            title="前调"
          >
            →
          </button>
        </div>
        {!originalImgRef.current && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-950/70">
            <button
              className="group rounded-3xl border border-slate-800/70 bg-slate-950/35 px-10 py-10 text-center hover:bg-slate-950/45 transition shadow-[0_24px_80px_rgba(0,0,0,0.55)]"
              onClick={() => fileRef.current?.click()}
            >
              <div className="mx-auto w-12 h-12 rounded-2xl bg-indigo-500/15 border border-indigo-500/25 flex items-center justify-center text-2xl mb-4 group-hover:bg-indigo-500/18 transition">
                📷
              </div>
              <div className="text-lg font-semibold text-slate-100">点击上传图片</div>
              <div className="text-xs text-slate-400 mt-2">支持 JPG / PNG / WebP</div>
            </button>
          </div>
        )}
        <canvas
          ref={canvasRef}
          onClick={onCanvasClick}
          className="max-w-[92%] max-h-[92%] rounded-2xl shadow-[0_28px_90px_rgba(0,0,0,0.65)]"
        />
        {loading && (
          <div className="absolute bottom-6 flex items-center gap-2 rounded-full border border-slate-800/70 bg-slate-950/70 backdrop-blur px-4 py-2 text-xs text-slate-100 shadow-[0_18px_60px_rgba(0,0,0,0.5)]">
            <div className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
            正在精细计算…
          </div>
        )}
      </div>
    </div>
  )
}

function Slider({
  label,
  value,
  onChange,
  min,
  max,
  accent,
}: {
  label: string
  value: number
  onChange: (n: number) => void
  min: number
  max: number
  accent: 'indigo' | 'cyan'
}) {
  const color = accent === 'cyan' ? 'text-cyan-200' : 'text-indigo-300'
  const accentCls = accent === 'cyan' ? 'accent-cyan-400' : 'accent-indigo-500'
  return (
    <div className="mb-3">
      <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
        <span>{label}</span>
        <span className={`tabular-nums font-mono font-semibold ${color}`}>{value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className={`w-full h-1.5 rounded-full bg-slate-800/80 cursor-pointer ${accentCls}`}
      />
    </div>
  )
}

