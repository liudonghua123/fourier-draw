import { useMemo } from 'react'
import { motion } from 'motion/react'
import { reconstruct, reconstructionError } from '../lib/fourier'

/** 小型静态缩略图：给定 n 的重建 + error 百分比 */
function Thumb({ result, n, active, onPick, index }) {
  const pts = useMemo(
    () => reconstruct(result.coeffs, result.dc, n, 256),
    [result, n]
  )
  const err = useMemo(
    () => reconstructionError(result.contour, result.coeffs, result.dc, n),
    [result, n]
  )

  const { minX, maxX, minY, maxY } = result.bounds
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2
  const span = Math.max(maxX - minX, maxY - minY) * 1.24
  const S = 100 / span
  const px = (x) => 60 + (x - cx) * S
  const py = (y) => 60 + (y - cy) * S

  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${px(p.x).toFixed(2)},${py(p.y).toFixed(2)}`).join('') + 'Z'

  return (
    <motion.button
      className={`thumb ${active ? 'active' : ''}`}
      onClick={onPick}
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.4, ease: 'easeOut' }}
      whileHover={{ y: -4 }}
      whileTap={{ scale: 0.96 }}
    >
      <svg viewBox="0 0 120 120">
        <path d={d} fill="none" stroke={active ? '#e8543f' : 'rgba(60,66,90,0.75)'} strokeWidth="2" strokeLinejoin="round" />
      </svg>
      <span className="thumb-n mono">N={n}</span>
      <span className="thumb-err mono">{(err * 100).toFixed(1)}%</span>
    </motion.button>
  )
}

export default function MultiView({ result, presets, current, onPick }) {
  return (
    <div className="multiview">
      {presets.map((n, i) => (
        <Thumb
          key={n}
          result={result}
          n={n}
          index={i}
          active={n === current}
          onPick={() => onPick(n)}
        />
      ))}
    </div>
  )
}
