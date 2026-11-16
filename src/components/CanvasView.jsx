import { useEffect, useRef } from 'react'
import { epicycleChain } from '../lib/epicycles'

/**
 * 主画布三合一：
 * 1. 灰色虚线 = 原轮廓
 * 2. 红色曲线 = 前 n 项傅里叶重建（非动画模式下按进度描绘）
 * 3. epicycles 模式 = 旋转圆环连杆动画 + 笔尖累积轨迹
 *
 * epicycles 渲染设计：
 * - 轨迹是"累积路径"：笔尖逐点画出，画满一圈凝固成成品曲线
 *   （与目标幽灵虚线重合），直观呈现"点连成线"
 * - 固定空间步长（相位 ≤ SUBSTEP）：速度/帧率只改变画得多快，
 *   不改变线的形状
 * - 颜色按笔尖相位固定映射（起点金 → 终点红），不随路径长度漂移
 * - 性能：轨迹画在离屏 canvas 上增量追加（每段只画一次），
 *   主帧一次 drawImage 拷贝，圆环/连杆只画半径可感知的层 —— 移动端流畅
 */
const TRACE_DURATION_MS = 700
const BASE_ORBIT_MS = 16000 // speed=1 时笔尖走一圈的时长
const SUBSTEP = 1 / 900     // 轨迹相邻两点的最大相位步长（与速度无关）
const MAX_PATH = 1024       // 一圈轨迹点数上限
const TRAIL_COLOR_FROM = [255, 176, 58] // 金
const TRAIL_COLOR_TO = [232, 84, 63]    // 红

/** 相位 t(0~1) → 轨迹颜色与线宽（固定映射，不漂移） */
function trailStyle(t) {
  const f = Math.min(1, Math.max(0, t))
  const mix = (a, b) => Math.round(a + (b - a) * f)
  const [r, g, b] = [
    mix(TRAIL_COLOR_FROM[0], TRAIL_COLOR_TO[0]),
    mix(TRAIL_COLOR_FROM[1], TRAIL_COLOR_TO[1]),
    mix(TRAIL_COLOR_FROM[2], TRAIL_COLOR_TO[2]),
  ]
  return { color: `rgb(${r}, ${g}, ${b})`, width: 1.6 + f * 1.2 }
}

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
  const pathRef = useRef([])      // 当前圈笔尖轨迹 [{x, y, t}]
  const doneRef = useRef(null)    // 画满一圈凝固的成品曲线
  const drawnCountRef = useRef(0) // 已画到离屏的轨迹段数（增量渲染游标）
  const rebaseRef = useRef(true)  // 离屏需要重建（重放成品+轨迹）
  const trailCanvasRef = useRef(null)
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
      drawnCountRef.current = 0
      rebaseRef.current = true
      tRef.current = 0
    }
  }, [n])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    /** 确保离屏画布尺寸与主画布一致；不符则标记重建 */
    function ensureTrail(dpr, w, h) {
      let tc = trailCanvasRef.current
      const needW = Math.round(w * dpr)
      const needH = Math.round(h * dpr)
      if (!tc || tc.width !== needW || tc.height !== needH) {
        tc = document.createElement('canvas')
        tc.width = needW
        tc.height = needH
        trailCanvasRef.current = tc
        rebaseRef.current = true
      }
      return tc
    }

    /**
     * 增量维护离屏轨迹层：
     * - rebase：清空并重放成品（纯红）+ 轨迹已画部分
     * - 正常：只画 drawnCount 之后的新段（每段终身只画一次）
     */
    function syncTrail(ctx, dpr, S, cx, cy, W, H) {
      const tc = ensureTrail(dpr, W, H)
      if (rebaseRef.current) {
        const tctx = tc.getContext('2d')
        tctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        tctx.clearRect(0, 0, W, H)
        tctx.lineJoin = 'round'
        tctx.lineCap = 'round'
        const px = (x) => W / 2 + (x - cx) * S
        const py = (y) => H / 2 + (y - cy) * S
        const done = doneRef.current
        if (done && done.length > 1) {
          tctx.strokeStyle = '#e8543f'
          tctx.lineWidth = 2.6
          tctx.shadowColor = 'rgba(232, 84, 63, 0.3)'
          tctx.shadowBlur = 6
          tctx.beginPath()
          for (let i = 0; i < done.length; i++) {
            const p = done[i]
            if (i === 0) tctx.moveTo(px(p.x), py(p.y))
            else tctx.lineTo(px(p.x), py(p.y))
          }
          tctx.closePath()
          tctx.stroke()
          tctx.shadowBlur = 0
        }
        drawnCountRef.current = 0
        rebaseRef.current = false
      }
      const path = pathRef.current
      const tctx = tc.getContext('2d')
      tctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      tctx.lineJoin = 'round'
      tctx.lineCap = 'round'
      const px = (x) => W / 2 + (x - cx) * S
      const py = (y) => H / 2 + (y - cy) * S
      while (drawnCountRef.current < path.length - 1) {
        const i = drawnCountRef.current
        const a = path[i]
        const c = path[i + 1]
        const st = trailStyle(c.t)
        tctx.strokeStyle = st.color
        tctx.lineWidth = st.width
        tctx.beginPath()
        tctx.moveTo(px(a.x), py(a.y))
        tctx.lineTo(px(c.x), py(c.y))
        tctx.stroke()
        drawnCountRef.current++
      }
    }

    function draw(ts) {
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

        // 目标幽灵线：完整重建曲线（淡红虚线），笔尖轨迹最终与它重合
        ctx.save()
        ctx.strokeStyle = 'rgba(232, 84, 63, 0.26)'
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

        // 轨迹层（离屏增量，一次 blit）
        syncTrail(ctx, dpr, S, cx, cy, W, H)
        const tc = trailCanvasRef.current
        if (tc) ctx.drawImage(tc, 0, 0, W, H)

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
            ? 'rgba(232, 161, 63, 0.55)'
            : `rgba(100, 120, 200, ${Math.max(0.12, 0.5 - (i / use.length) * 0.4)})`
          ctx.lineWidth = i === 0 ? 1.4 : 1
          ctx.beginPath()
          ctx.arc(px(center.x), py(center.y), r * S, 0, Math.PI * 2)
          ctx.stroke()
        }

        // 笔尖（链末端）+ 呼吸光环
        const tip = chain[chain.length - 1]
        const pulse = 0.5 + 0.5 * Math.sin(ts / 280)
        ctx.fillStyle = '#ffb03a'
        ctx.shadowColor = 'rgba(255, 176, 58, 0.6)'
        ctx.shadowBlur = 10
        ctx.beginPath()
        ctx.arc(px(tip.x), py(tip.y), 5, 0, Math.PI * 2)
        ctx.fill()
        ctx.shadowBlur = 0
        ctx.strokeStyle = `rgba(255, 176, 58, ${(0.45 * (1 - pulse)).toFixed(3)})`
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.arc(px(tip.x), py(tip.y), 7 + pulse * 7, 0, Math.PI * 2)
        ctx.stroke()
        ctx.restore()
      }
    }

    const startRef = { current: 0 }

    // 主循环：非动画模式做描绘进度；动画模式推进相位并按固定
    // 空间步长把笔尖中间点写入累积轨迹（暂停时只重绘不推进）
    function loop(ts) {
      try {
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
          // 画满一圈：当前轨迹凝固为成品曲线，重新开始下一圈
          doneRef.current = pathRef.current.slice()
          pathRef.current = []
          rebaseRef.current = true
        }
        // 细分到固定空间步长：轨迹形状与速度/帧率无关
        const delta = wrapped ? nextT + (1 - prevT) : nextT - prevT
        const steps = Math.max(1, Math.ceil(delta / SUBSTEP))
        const path = pathRef.current
        for (let i = 1; i <= steps; i++) {
          const tt = (prevT + (delta * i) / steps) % 1
          const ch = epicycleChain(cfs, d0, nn, tt)
          const tip = ch[ch.length - 1]
          path.push({ x: tip.x, y: tip.y, t: tt })
        }
        while (path.length > MAX_PATH) {
          path.shift()
          if (drawnCountRef.current > 0) drawnCountRef.current--
        }
      }
      lastTsRef.current = ts
      draw(ts)
      rafRef.current = requestAnimationFrame(loop)
      } catch (err) {
        console.error('[CanvasView] frame error:', err)
        rafRef.current = requestAnimationFrame(loop) // 单帧异常不杀循环
      }
    }

    // 重置：清轨迹与成品曲线、相位归零、重新描绘（暂停状态保持不变）
    function replay() {
      progressRef.current = 0
      startRef.current = 0
      pathRef.current = []
      doneRef.current = null
      drawnCountRef.current = 0
      rebaseRef.current = true
      tRef.current = 0
      lastTsRef.current = 0
    }

    replayRef.current = replay
    replay()
    rafRef.current = requestAnimationFrame(loop)

    const ro = new ResizeObserver(() => draw(performance.now()))
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
