import { motion } from 'motion/react'

/**
 * n 值滑杆（对数刻度）：拖动实时更新，滚轮微调，双击重置。
 * 低 n 区域占更大滑动空间 —— 形状演变最明显的区间。
 */
const MIN = 1
const RESET_N = 8

export default function Slider({ n, setN, max }) {
  const posToN = (pos) => {
    const t = pos / 100
    const v = Math.round(Math.exp(Math.log(MIN) + t * (Math.log(max) - Math.log(MIN))))
    return Math.max(MIN, Math.min(max, v))
  }
  const nToPos = (v) => {
    const t = (Math.log(v) - Math.log(MIN)) / (Math.log(max) - Math.log(MIN))
    return t * 100
  }

  const pos = nToPos(n)
  const pct = ((n / max) * 100).toFixed(0)

  const handleWheel = (e) => {
    e.preventDefault()
    const delta = e.deltaY < 0 ? 1 : -1
    setN((v) => Math.max(MIN, Math.min(max, v + delta)))
  }

  return (
    <div className="slider-wrap" onWheel={handleWheel} onDoubleClick={() => setN(RESET_N)}>
      <div className="slider-labels">
        <span>
          谐波数 <strong className="mono accent n-value">{n}</strong>
        </span>
        <span className="dim">占满谱 {pct}% · 滚轮微调 · 双击回 {RESET_N}</span>
      </div>
      <div className="slider-track-row">
        <input
          type="range"
          min="0"
          max="100"
          step="0.1"
          value={pos}
          onChange={(e) => setN(posToN(parseFloat(e.target.value)))}
          className="slider-input"
          style={{ '--pct': `${pos}%` }}
          aria-label="谐波数 N"
        />
      </div>
      <motion.div
        className="slider-tip"
        key={n}
        initial={{ scale: 0.85, opacity: 0.5 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 500, damping: 26 }}
      >
        <span className="mono">{n}</span>
      </motion.div>
    </div>
  )
}
