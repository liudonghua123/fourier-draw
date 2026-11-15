import { useEffect, useRef } from 'react'
import { epicycleChain } from '../lib/epicycles'

/**
 * 主画布三合一：
 * 1. 灰色虚线 = 原轮廓
 * 2. 红色曲线 = 前 n 项傅里叶重建（n 变化时快速重描）
 * 3. epicycles 模式 = 旋转圆环连杆动画 + 笔尖拖尾渐隐线（速度可调、可暂停）
 */
const TRACE_DURATION_MS = 700
const BASE_ORBIT_MS = 16000 // speed=1 时笔尖走一圈的时长

export default function CanvasView({
  target, recon, bounds, coeffs, dc, n,
  epicycles, speed = 1, paused = false,
}) {
  const canvasRef = useRef(null)
  const progressRef = useRef(1)
  const rafRef = useRef(0)
  const tRef = useRef(0)          // epicycles 相位 0~1
  const lastTsRef = useRef(0)
  const trailRef = useRef([])     // 笔尖拖尾 [{x, y, age}] 归一化坐标
  // 最新 props 存 ref，动画循环与 ResizeObserver 都能读到当前值
  const propsRef = useRef({ target, recon, bounds, coeffs, dc, n, epicycles, speed, paused })
  useEffect(() => {
    propsRef.current = { target, recon, bounds, coeffs, dc, n, epicycles, speed, paused }
  }, [target, recon, bounds, coeffs, dc, n, epicycles, speed, paused])

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

      // epicycles：拖尾 → 圆环 → 连杆 → 笔尖
      if (epi && cfs && d0 && nn >= 1) {
        const chain = epicycleChain(cfs, d0, nn, tRef.current)
        ctx.save()

        // 笔尖拖尾（渐隐金线）：形象表示"点连成线"
        const trail = trailRef.current
        if (trail.length > 2) {
          for (let i = 1; i < trail.length; i++) {
            const a = trail[i - 1]
            const c = trail[i]
            const alpha = (i / trail.length) * 0.9
            ctx.strokeStyle = `rgba(255, 176, 58, ${alpha})`
            ctx.lineWidth = 1.2 + (i / trail.length) * 2
            ctx.beginPath()
            ctx.moveTo(px(a.x), py(a.y))
            ctx.lineTo(px(c.x), py(c.y))
            ctx.stroke()
          }
        }

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

    // 主循环：描绘动画 → epicycles 相位推进（暂停时只重绘不推进）
    function loop(ts) {
      const { epicycles: epi, paused: pse, speed: spd } = propsRef.current
      if (progressRef.current < 1) {
        progressRef.current = Math.min(1, (ts - startRef.current) / TRACE_DURATION_MS)
      } else if (epi && !pse) {
        if (!lastTsRef.current) lastTsRef.current = ts
        const dt = ts - lastTsRef.current
        tRef.current = (tRef.current + (dt * spd) / BASE_ORBIT_MS) % 1
        // 记录笔尖位置到拖尾
        const { coeffs: cfs, dc: d0, n: nn } = propsRef.current
        if (cfs && d0) {
          const chain = epicycleChain(cfs, d0, nn, tRef.current)
          const tip = chain[chain.length - 1]
          trailRef.current.push({ x: tip.x, y: tip.y })
          const MAX_TRAIL = Math.round(320 * spd) + 40
          if (trailRef.current.length > MAX_TRAIL) trailRef.current.shift()
        }
      }
      lastTsRef.current = ts
      draw()
      rafRef.current = requestAnimationFrame(loop)
    }
    const startRef = { current: 0 }

    function replay() {
      progressRef.current = 0
      startRef.current = performance.now()
      trailRef.current = []
      tRef.current = 0
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
