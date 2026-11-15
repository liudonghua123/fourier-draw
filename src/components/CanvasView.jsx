import { useEffect, useRef } from 'react'
import { epicycleChain } from '../lib/epicycles'

/**
 * 主画布三合一：
 * 1. 灰色虚线 = 原轮廓
 * 2. 红色曲线 = 前 n 项傅里叶重建（n 变化时快速重描）
 * 3. epicycles 模式 = 旋转圆环连杆动画，笔尖沿轨迹移动（可开关）
 */
const TRACE_DURATION_MS = 700
const ORBIT_PERIOD_MS = 12000 // 笔尖走完一圈的时长

export default function CanvasView({ target, recon, bounds, coeffs, dc, n, epicycles }) {
  const canvasRef = useRef(null)
  const progressRef = useRef(1)
  const rafRef = useRef(0)
  const tRef = useRef(0)          // epicycles 相位 0~1
  const lastTsRef = useRef(0)
  // 最新 props 存 ref，动画循环与 ResizeObserver 都能读到当前值
  const propsRef = useRef({ target, recon, bounds, coeffs, dc, n, epicycles })
  useEffect(() => {
    propsRef.current = { target, recon, bounds, coeffs, dc, n, epicycles }
  }, [target, recon, bounds, coeffs, dc, n, epicycles])

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

      const { target: tgt, recon: rcn, bounds: b, coeffs: cfs, dc: d0, n: nn, epicycles: epi } = propsRef.current
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

      // epicycles：旋转圆环连杆 + 笔尖光点
      if (epi && cfs && d0 && nn >= 1) {
        const chain = epicycleChain(cfs, d0, nn, tRef.current)
        ctx.save()

        // 连杆
        ctx.strokeStyle = 'rgba(60, 66, 90, 0.45)'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(px(chain[0].x), py(chain[0].y))
        for (let i = 1; i < chain.length; i++) ctx.lineTo(px(chain[i].x), py(chain[i].y))
        ctx.stroke()

        // 圆环（半径过小的省略，避免糊成一团）
        const minR = span * 0.004
        const use = cfs.slice(0, nn)
        for (let i = 0; i < use.length; i++) {
          const c = use[i]
          const r = Math.hypot(c.re, c.im)
          if (r < minR) continue
          const center = chain[i]
          ctx.strokeStyle = i === 0
            ? 'rgba(232, 161, 63, 0.5)'
            : `rgba(100, 120, 200, ${Math.max(0.12, 0.5 - (i / use.length) * 0.4)})`
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.arc(px(center.x), py(center.y), r * S, 0, Math.PI * 2)
          ctx.stroke()
        }

        // 笔尖（链末端）
        const tip = chain[chain.length - 1]
        ctx.fillStyle = '#ffb03a'
        ctx.shadowColor = 'rgba(255, 176, 58, 0.6)'
        ctx.shadowBlur = 10
        ctx.beginPath()
        ctx.arc(px(tip.x), py(tip.y), 5, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()
      } else if (prog < 1 && count > 0) {
        // 非动画模式：保留描绘光标
        const p = rcn[count - 1]
        ctx.save()
        ctx.fillStyle = '#ffb03a'
        ctx.beginPath()
        ctx.arc(px(p.x), py(p.y), 4.5, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()
      }
    }

    // 主循环：描绘动画完成后若 epicycles 开启则持续旋转
    function loop(ts) {
      const { epicycles: epi } = propsRef.current
      if (progressRef.current < 1) {
        // 描绘阶段
        progressRef.current = Math.min(1, (ts - startRef.current) / TRACE_DURATION_MS)
      } else if (epi) {
        // epicycles 相位推进
        if (!lastTsRef.current) lastTsRef.current = ts
        const dt = ts - lastTsRef.current
        tRef.current = (tRef.current + dt / ORBIT_PERIOD_MS) % 1
      }
      lastTsRef.current = ts
      draw()
      rafRef.current = requestAnimationFrame(loop)
    }
    const startRef = { current: 0 }

    function replay() {
      progressRef.current = 0
      startRef.current = performance.now()
      cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(loop)
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
