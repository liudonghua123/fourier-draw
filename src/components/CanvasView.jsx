import { useEffect, useRef } from 'react'
import { epicycleChain } from '../lib/epicycles'

/**
 * 主画布三合一：
 * 1. 灰色虚线 = 原轮廓
 * 2. 红色曲线 = 前 n 项傅里叶重建（非动画模式下按进度描绘）
 * 3. epicycles 模式 = 旋转圆环连杆动画 + 笔尖累积轨迹
 *
 * epicycles 渲染原则：
 * - 轨迹是"累积路径"而非渐隐尾巴：笔尖逐点画出，画满一圈正好
 *   就是完整的重建曲线（与目标幽灵线重合），直观呈现"点连成线"
 * - 每帧按固定空间步长（相位 ≤ SUBSTEP）细分插入中间点，
 *   保证任何速度/帧率下画出的线形状完全一致 —— 速度只改变画得多快
 * - n 变化或重置时清空轨迹，从起点重画
 */
const TRACE_DURATION_MS = 700
const BASE_ORBIT_MS = 16000 // speed=1 时笔尖走一圈的时长
const SUBSTEP = 1 / 900     // 轨迹相邻两点的最大相位步长（与速度无关）
const MAX_PATH = 1024       // 一圈轨迹点数上限

export default function CanvasView({
  target, recon, bounds, coeffs, dc, n,
  epicycles, speed = 1, paused = false,
  imageKey = '', resetToken = 0,
}) {
  const canvasRef = useRef(null)
  const progressRef = useRef(1)
  const rafRef = useRef(0)
  const tRef = useRef(0)          // epicycles 相位 0~1
  const lastTsRef = useRef(0)
  const pathRef = useRef([])      // 当前圈笔尖累积轨迹（渐变进行中）
  const doneRef = useRef(null)    // 画满一圈后的成品曲线（常驻红色实线）
  const replayRef = useRef(null)  // 暴露给 resetToken effect 的重置函数
  // 最新 props 存 ref，动画循环与 ResizeObserver 都能读到当前值
  const propsRef = useRef({ target, recon, bounds, coeffs, dc, n, epicycles, speed, paused })
  useEffect(() => {
    propsRef.current = { target, recon, bounds, coeffs, dc, n, epicycles, speed, paused }
  }, [target, recon, bounds, coeffs, dc, n, epicycles, speed, paused])

  // n 变化：曲线形状变了，清空轨迹从起点重画（不影响暂停状态本身）
  const nRef = useRef(n)
  useEffect(() => {
    if (nRef.current !== n) {
      nRef.current = n
      pathRef.current = []
      doneRef.current = null
      tRef.current = 0
    }
  }, [n])

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
      for (let i = 0; i < tgt.length; i++) {
        const p = tgt[i]
        if (i === 0) ctx.moveTo(px(p.x), py(p.y))
        else ctx.lineTo(px(p.x), py(p.y))
      }
      ctx.closePath()
      ctx.stroke()
      ctx.restore()

      if (!epi) {
        // 非动画模式：红色重建曲线按进度描绘
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
        if (prog < 1 && count > 0) {
          const p = rcn[count - 1]
          ctx.save()
          ctx.fillStyle = '#ffb03a'
          ctx.beginPath()
          ctx.arc(px(p.x), py(p.y), 4.5, 0, Math.PI * 2)
          ctx.fill()
          ctx.restore()
        }
      } else if (cfs && d0 && nn >= 1) {
        // epicycles 模式
        const chain = epicycleChain(cfs, d0, nn, tRef.current)

        // 目标幽灵线：完整重建曲线（淡红虚线），笔尖轨迹最终应与它重合
        ctx.save()
        ctx.strokeStyle = 'rgba(232, 84, 63, 0.28)'
        ctx.lineWidth = 1.5
        ctx.setLineDash([3, 4])
        ctx.beginPath()
        for (let i = 0; i < rcn.length; i++) {
          const p = rcn[i]
          if (i === 0) ctx.moveTo(px(p.x), py(p.y))
          else ctx.lineTo(px(p.x), py(p.y))
        }
        ctx.closePath()
        ctx.stroke()
        ctx.restore()

        // 成品曲线：画满一圈的轨迹转为常驻红色实线（= 最终曲线）
        const done = doneRef.current
        if (done && done.length > 1) {
          ctx.save()
          ctx.strokeStyle = '#e8543f'
          ctx.lineWidth = 2.4
          ctx.lineJoin = 'round'
          ctx.lineCap = 'round'
          ctx.shadowColor = 'rgba(232, 84, 63, 0.35)'
          ctx.shadowBlur = 8
          ctx.beginPath()
          for (let i = 0; i < done.length; i++) {
            const p = done[i]
            if (i === 0) ctx.moveTo(px(p.x), py(p.y))
            else ctx.lineTo(px(p.x), py(p.y))
          }
          ctx.closePath()
          ctx.stroke()
          ctx.restore()
        }

        // 笔尖累积轨迹：金 → 红渐变，画满一圈转为成品曲线
        const path = pathRef.current
        if (path.length > 1) {
          ctx.save()
          ctx.lineJoin = 'round'
          ctx.lineCap = 'round'
          for (let i = 1; i < path.length; i++) {
            const a = path[i - 1]
            const c = path[i]
            const f = i / path.length
            const r = Math.round(255 - 23 * f)   // 255 → 232
            const g = Math.round(176 - 92 * f)   // 176 → 84
            const bl = Math.round(58 + 5 * f)    // 58 → 63
            ctx.strokeStyle = `rgba(${r}, ${g}, ${bl}, ${(0.35 + f * 0.6).toFixed(3)})`
            ctx.lineWidth = 1.2 + f * 1.6
            ctx.beginPath()
            ctx.moveTo(px(a.x), py(a.y))
            ctx.lineTo(px(c.x), py(c.y))
            ctx.stroke()
          }
          ctx.restore()
        }

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
      }
    }

    const startRef = { current: 0 }

    // 主循环：非动画模式做描绘进度；动画模式推进相位并按固定
    // 空间步长把笔尖中间点写入累积轨迹（暂停时只重绘不推进）
    function loop(ts) {
      const { epicycles: epi, paused: pse, speed: spd, coeffs: cfs, dc: d0, n: nn } = propsRef.current
      if (!epi) {
        if (progressRef.current < 1) {
          if (!startRef.current) startRef.current = ts
          progressRef.current = Math.min(1, (ts - startRef.current) / TRACE_DURATION_MS)
        }
      } else if (!pse && cfs && d0) {
        if (!lastTsRef.current) lastTsRef.current = ts
        const dt = Math.min(100, ts - lastTsRef.current) // 后台标签页回来时不产生巨帧
        const prevT = tRef.current
        let nextT = prevT + (dt * spd) / BASE_ORBIT_MS
        const wrapped = nextT >= 1
        nextT %= 1
        tRef.current = nextT
        if (wrapped) {
          // 画满一圈：当前轨迹转为成品曲线常驻，重新开始下一圈
          doneRef.current = pathRef.current.slice()
          pathRef.current = []
        }
        // 细分到固定空间步长：轨迹形状与速度/帧率无关
        const delta = wrapped ? nextT + (1 - prevT) : nextT - prevT
        const steps = Math.max(1, Math.ceil(delta / SUBSTEP))
        for (let i = 1; i <= steps; i++) {
          const tt = (prevT + (delta * i) / steps) % 1
          const ch = epicycleChain(cfs, d0, nn, tt)
          const tip = ch[ch.length - 1]
          pathRef.current.push({ x: tip.x, y: tip.y })
        }
        while (pathRef.current.length > MAX_PATH) pathRef.current.shift()
      }
      lastTsRef.current = ts
      draw()
      rafRef.current = requestAnimationFrame(loop)
    }

    // 重置：清轨迹与成品曲线、相位归零、重新描绘（暂停状态保持不变）
    function replay() {
      progressRef.current = 0
      startRef.current = 0
      pathRef.current = []
      doneRef.current = null
      tRef.current = 0
      lastTsRef.current = 0
    }

    replayRef.current = replay
    replay()
    rafRef.current = requestAnimationFrame(loop)

    const ro = new ResizeObserver(() => draw())
    ro.observe(canvas)
    return () => {
      ro.disconnect()
      cancelAnimationFrame(rafRef.current)
      replayRef.current = null
    }
  }, [imageKey])

  // 外部重置按钮：只在 resetToken 变化时触发
  useEffect(() => {
    if (resetToken > 0) replayRef.current?.()
  }, [resetToken])

  return <canvas ref={canvasRef} className="main-canvas" />
}
