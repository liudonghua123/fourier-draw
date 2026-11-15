import { useEffect, useRef } from 'react'

/**
 * 主画布：灰色虚线为原轮廓，rAF 驱动的"描绘进度"动画绘制重建曲线。
 * n 变化时曲线快速重描一遍；窗口尺寸变化时自动重绘。
 */
const TRACE_DURATION_MS = 700

export default function CanvasView({ target, recon, bounds }) {
  const canvasRef = useRef(null)
  const progressRef = useRef(1)
  const rafRef = useRef(0)
  // 最新 props 存 ref，动画循环与 ResizeObserver 都能读到当前值
  const propsRef = useRef({ target, recon, bounds })
  useEffect(() => {
    propsRef.current = { target, recon, bounds }
  }, [target, recon, bounds])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    function draw() {
      const dpr = window.devicePixelRatio || 1
      const rect = canvas.getBoundingClientRect()
      if (canvas.width !== Math.round(rect.width * dpr)) {
        canvas.width = Math.round(rect.width * dpr)
        canvas.height = Math.round(rect.height * dpr)
      }
      const ctx = canvas.getContext('2d')
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, rect.width, rect.height)

      const { target: tgt, recon: rcn, bounds: b } = propsRef.current
      if (!tgt || !rcn || rcn.length < 2 || !b) return

      // 以 bounds 居中，四周留 12% 边距
      const { minX, maxX, minY, maxY } = b
      const cx = (minX + maxX) / 2
      const cy = (minY + maxY) / 2
      const span = Math.max(maxX - minX, maxY - minY) * 1.24
      const W = rect.width, H = rect.height
      const S = Math.min(W, H) / span
      const px = (x) => W / 2 + (x - cx) * S
      const py = (y) => H / 2 + (y - cy) * S

      // 原轮廓（灰色虚线）
      ctx.save()
      ctx.strokeStyle = 'rgba(100, 108, 140, 0.35)'
      ctx.lineWidth = 1.5
      ctx.setLineDash([4, 5])
      ctx.beginPath()
      tgt.forEach((p, i) => (i === 0 ? ctx.moveTo(px(p.x), py(p.y)) : ctx.lineTo(px(p.x), py(p.y))))
      ctx.closePath()
      ctx.stroke()
      ctx.restore()

      // 重建曲线（按进度描绘）
      const prog = progressRef.current
      const count = Math.max(2, Math.floor(rcn.length * prog))
      ctx.save()
      ctx.strokeStyle = '#e8543f'
      ctx.lineWidth = 2.4
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      ctx.shadowColor = 'rgba(232, 84, 63, 0.35)'
      ctx.shadowBlur = 8
      ctx.beginPath()
      for (let i = 0; i < count; i++) {
        const p = rcn[i]
        if (i === 0) ctx.moveTo(px(p.x), py(p.y))
        else ctx.lineTo(px(p.x), py(p.y))
      }
      if (prog >= 1) ctx.closePath()
      ctx.stroke()
      ctx.restore()

      // 描绘光标
      if (prog < 1 && count > 0) {
        const p = rcn[count - 1]
        ctx.save()
        ctx.fillStyle = '#ffb03a'
        ctx.beginPath()
        ctx.arc(px(p.x), py(p.y), 4.5, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()
      }
    }

    // n 变化 → 重播描绘动画
    function replay() {
      progressRef.current = 0
      const start = performance.now()
      const tick = (now) => {
        progressRef.current = Math.min(1, (now - start) / TRACE_DURATION_MS)
        draw()
        if (progressRef.current < 1) {
          rafRef.current = requestAnimationFrame(tick)
        }
      }
      cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(tick)
    }

    replay()

    const ro = new ResizeObserver(() => draw())
    ro.observe(canvas)
    return () => {
      ro.disconnect()
      cancelAnimationFrame(rafRef.current)
    }
  }, [recon])

  return <canvas ref={canvasRef} className="main-canvas" />
}
