import { useEffect, useRef } from 'react'

type Ripple = { x: number; y: number; born: number }

/**
 * 水平平铺网点 + 缓慢呼吸；偶尔随机中心泛起水波式涟漪向外荡漾
 */
export default function ParticleFlow() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const cvs = canvas
    const c2d = ctx

    let raf = 0
    let w = 0
    let h = 0
    let cols = 0
    let rows = 0
    let spacing = 34
    const t0 = performance.now()
    const ripples: Ripple[] = []
    let nextRippleAt = performance.now() + 600 + Math.random() * 1000

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      w = window.innerWidth
      h = window.innerHeight
      cvs.width = Math.floor(w * dpr)
      cvs.height = Math.floor(h * dpr)
      cvs.style.width = `${w}px`
      cvs.style.height = `${h}px`
      c2d.setTransform(dpr, 0, 0, dpr, 0, 0)

      spacing = Math.max(24, Math.min(36, Math.floor(Math.min(w, h) / 26)))
      const maxDots = 3200
      let s = spacing
      while (Math.ceil(w / s) * Math.ceil(h / s) > maxDots && s < 46) {
        s += 2
      }
      spacing = s
      cols = Math.ceil(w / spacing) + 2
      rows = Math.ceil(h / spacing) + 2
    }

    resize()
    window.addEventListener('resize', resize)

    function sampleRipple(
      bx: number,
      by: number,
      now: number,
    ): { dAlpha: number; dR: number; px: number; py: number } {
      let dAlpha = 0
      let dR = 0
      let px = 0
      let py = 0

      for (let i = ripples.length - 1; i >= 0; i--) {
        const r = ripples[i]
        const elapsed = (now - r.born) * 0.001
        if (elapsed < 0) continue

        const dx = bx - r.x
        const dy = by - r.y
        const dist = Math.hypot(dx, dy)
        const inv = dist > 0.4 ? 1 / dist : 0

        const speed = 340
        const sigma = 38
        const fade = Math.exp(-elapsed * 0.5)

        const ring1 = dist - speed * elapsed
        const g1 = Math.exp(-(ring1 * ring1) / (2 * sigma * sigma))
        const ring2 = dist - speed * elapsed * 0.88 - 22
        const g2 = Math.exp(-(ring2 * ring2) / (2 * (sigma * 0.85) ** 2)) * 0.45

        const g = g1 + g2
        dAlpha += g * 0.19 * fade
        dR += g * 0.62 * fade

        const push = g * 2.8 * fade
        px += dx * inv * push
        py += dy * inv * push
      }

      return { dAlpha, dR, px, py }
    }

    function tick(now: number) {
      const t = (now - t0) * 0.001
      c2d.clearRect(0, 0, w, h)

      while (ripples.length && now - ripples[0].born > 5200) {
        ripples.shift()
      }

      if (w > 100 && h > 100 && now >= nextRippleAt) {
        ripples.push({
          x: (0.12 + Math.random() * 0.76) * w,
          y: (0.1 + Math.random() * 0.8) * h,
          born: now,
        })
        nextRippleAt = now + 1400 + Math.random() * 2400
        if (ripples.length > 5) ripples.shift()
      }

      const ox = Math.sin(t * 0.055) * spacing * 0.12
      const oy = Math.cos(t * 0.048) * spacing * 0.1

      for (let iy = 0; iy < rows; iy++) {
        for (let ix = 0; ix < cols; ix++) {
          const phase = ix * 0.61 + iy * 0.73 + ix * iy * 0.017
          const slow = Math.sin(t * 0.35 + phase) * 0.5 + 0.5
          const deep = Math.sin(t * 0.14 + phase * 1.4) * 0.5 + 0.5
          const breathe = slow * 0.55 + deep * 0.45

          const driftX =
            Math.sin(t * 0.09 + ix * 0.11 + iy * 0.05) * 1.8 +
            Math.cos(t * 0.06 + phase) * 0.9
          const driftY =
            Math.cos(t * 0.085 + iy * 0.1 + ix * 0.04) * 1.6 +
            Math.sin(t * 0.05 + phase * 0.8) * 0.85

          const bx = ix * spacing + driftX - spacing
          const by = iy * spacing + driftY - spacing

          const { dAlpha, dR, px, py } = sampleRipple(bx, by, now)

          const x = bx + px + ox
          const y = by + py + oy

          const baseA = 0.05 + breathe * 0.09
          const baseR = 0.64 + breathe * 0.44
          const a = Math.min(0.48, baseA + dAlpha)
          const rad = Math.max(0.38, baseR + dR)

          const hl = Math.min(1, dAlpha * 3.2)
          const cr = Math.round(192 + hl * 42)
          const cg = Math.round(206 + hl * 36)
          const cb = Math.round(236 + hl * 20)
          c2d.fillStyle = `rgba(${cr}, ${cg}, ${cb}, ${a})`
          c2d.beginPath()
          c2d.arc(x, y, rad, 0, Math.PI * 2)
          c2d.fill()
        }
      }

      raf = requestAnimationFrame(tick)
    }

    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
    }
  }, [])

  return <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden />
}
