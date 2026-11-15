import { useState, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { extractContourAndCoeffs, reconstruct, reconstructionError } from './lib/fourier'
import CanvasView from './components/CanvasView'
import MultiView from './components/MultiView'
import Slider from './components/Slider'
import './App.css'

const PRESET_N = [1, 2, 3, 5, 8, 15, 30, 64, 128, 256]

const SAMPLES = [
  { id: 'pi', label: 'π', desc: '经典开篇', src: './samples/pi.png' },
  { id: 'e', label: 'e', desc: '自然底数', src: './samples/e.png' },
  { id: 'omega', label: 'Ω', desc: '谐振终点', src: './samples/omega.png' },
  { id: 'cat', label: '猫', desc: '卡通头像', src: './samples/cat.png' },
]

export default function App() {
  const [result, setResult] = useState(null)       // extractContourAndCoeffs 的输出
  const [imageName, setImageName] = useState('')
  const [n, setN] = useState(8)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [showEpicycles, setShowEpicycles] = useState(true)
  const [epiSpeed, setEpiSpeed] = useState(1)
  const [epiPaused, setEpiPaused] = useState(false)
  const [resetToken, setResetToken] = useState(0)
  const fileRef = useRef(null)

  /** 从 URL 加载并处理图片（本地文件 / 内置示例共用） */
  const processImageUrl = useCallback((url, name, cleanup = () => {}) => {
    const img = new Image()
    img.onload = () => {
      try {
        // 降采样到最大边 220 提取轮廓（像素级精度足够）
        const MAX = 220
        const scale = Math.min(1, MAX / Math.max(img.width, img.height))
        const w = Math.max(2, Math.round(img.width * scale))
        const h = Math.max(2, Math.round(img.height * scale))
        const cvs = document.createElement('canvas')
        cvs.width = w; cvs.height = h
        const ctx = cvs.getContext('2d', { willReadFrequently: true })
        ctx.drawImage(img, 0, 0, w, h)
        const data = ctx.getImageData(0, 0, w, h)

        const res = extractContourAndCoeffs(data, { samples: 512 })
        if (!res || res.coeffs.length < 2) {
          setError('未能识别出清晰主体，换一张主体突出的图试试')
          setBusy(false)
          return
        }
        setResult(res)
        setImageName(name)
        setN(8)
        setResetToken(0)
      } catch (e) {
        console.error(e)
        setError('处理失败：' + e.message)
      } finally {
        cleanup()
        setBusy(false)
      }
    }
    img.onerror = () => {
      setError('图片加载失败')
      cleanup()
      setBusy(false)
    }
    img.src = url
  }, [])

  const handleFile = useCallback((file) => {
    if (!file) return
    if (!file.type || !file.type.startsWith('image/')) {
      setError('请上传图片文件')
      return
    }
    setBusy(true)
    setError('')
    const url = URL.createObjectURL(file)
    processImageUrl(url, file.name, () => URL.revokeObjectURL(url))
  }, [processImageUrl])

  const onDrop = useCallback((e) => {
    e.preventDefault()
    setDragOver(false)
    handleFile(e.dataTransfer.files?.[0])
  }, [handleFile])

  // 主画布的重建点 & 误差（对当前 n 实时计算）
  const mainRecon = result ? reconstruct(result.coeffs, result.dc, n, 512) : null
  const mainError = result ? reconstructionError(result.contour, result.coeffs, result.dc, n) : 0

  const maxN = result ? result.coeffs.length : 256

  return (
    <div className="app">
      {/* 动态浅色背景 */}
      <div className="bg-orbs" aria-hidden>
        <span /><span /><span />
      </div>

      <header className="header">
        <motion.h1
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
        >
          Fourier&nbsp;Draw
        </motion.h1>
        <motion.p
          className="subtitle"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2, duration: 0.6 }}
        >
          上传图片 → 提取主体轮廓 → 用前 <em>n</em> 个傅里叶系数把它画回来
        </motion.p>
      </header>

      {/* 上传区 */}
      <AnimatePresence mode="wait">
        {!result && (
          <motion.section
            key="upload"
            className={`dropzone ${dragOver ? 'drag' : ''}`}
            onDrop={onDrop}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onClick={() => fileRef.current?.click()}
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.25 } }}
            whileHover={{ scale: 1.01 }}
            transition={{ duration: 0.4, ease: 'easeOut' }}
          >
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => handleFile(e.target.files?.[0])}
            />
            <motion.div
              className="drop-icon"
              animate={{ y: [0, -8, 0] }}
              transition={{ repeat: Infinity, duration: 2.4, ease: 'easeInOut' }}
            >
              <svg viewBox="0 0 64 64" width="72" height="72" fill="none">
                <circle cx="32" cy="32" r="26" stroke="var(--accent)" strokeWidth="2.5"
                  strokeDasharray="6 5" className="spin-ring" />
                <path d="M32 20v20M24 33l8 8 8-8" stroke="var(--accent)" strokeWidth="3"
                  strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </motion.div>
            <p className="drop-title">拖图片到这里，或点击上传</p>
            <p className="drop-hint">主体轮廓清晰的图片效果最好（如 π、字母、Logo、剪影）</p>
            {busy && <p className="drop-busy">正在提取轮廓…</p>}
            {error && <p className="drop-error">{error}</p>}
          </motion.section>
        )}
      </AnimatePresence>

      {/* 内置示例 */}
      {!result && (
        <motion.section
          className="samples"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25, duration: 0.5, ease: 'easeOut' }}
        >
          <p className="samples-title">或者试试内置示例：</p>
          <div className="samples-row">
            {SAMPLES.map((s) => (
              <motion.button
                key={s.id}
                className="sample-card"
                onClick={() => {
                  setBusy(true)
                  setError('')
                  processImageUrl(s.src, `示例 · ${s.label}`)
                }}
                whileHover={{ y: -5, scale: 1.04 }}
                whileTap={{ scale: 0.95 }}
                transition={{ type: 'spring', stiffness: 400, damping: 22 }}
              >
                <img src={s.src} alt={s.label} loading="lazy" draggable={false} />
                <span className="sample-label">{s.label}</span>
                <span className="sample-desc">{s.desc}</span>
              </motion.button>
            ))}
          </div>
        </motion.section>
      )}

      {/* 结果区 */}
      {result && (
        <motion.main
          key="result"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
        >
          <section className="panel controls">
            <div className="controls-left">
              <button className="btn ghost" onClick={() => { setResult(null); setError('') }}>
                ← 换一张图
              </button>
              <span className="filename">{imageName}</span>
            </div>
            <Slider n={n} setN={setN} max={maxN} />
          </section>

          {/* 公式区 */}
          <section className="panel formulas">
            <div className="formula-item">
              <span className="formula-label">轮廓视为复数序列</span>
              <span className="formula mono">z(t) = x(t) + i·y(t)</span>
            </div>
            <div className="formula-item">
              <span className="formula-label">傅里叶级数</span>
              <span className="formula mono accent formula-main">
                z(t) = Σ<sub>k=-∞</sub><sup>+∞</sup> c<sub>k</sub>·e<sup>ikt</sup>
              </span>
            </div>
            <div className="formula-item">
              <span className="formula-label">取前 n 项重建</span>
              <span className="formula mono">z<sub>n</sub>(t) = c<sub>0</sub> + Σ<sub>k=1</sub><sup>n</sup> c<sub>k</sub>·e<sup>ikt</sup></span>
            </div>
            <div className="formula-item">
              <span className="formula-label">误差上界</span>
              <span className="formula mono">error ≤ Σ<sub>k left out</sub> |c<sub>k</sub>|</span>
            </div>
          </section>

          <section className="grid">
            <div className="panel canvas-panel">
              <div className="panel-head">
                <h2>重建 · N = <span className="mono accent">{n}</span></h2>
                <div className="head-right">
                  <label className="epi-toggle">
                    <input
                      type="checkbox"
                      checked={showEpicycles}
                      onChange={(e) => setShowEpicycles(e.target.checked)}
                    />
                    <span className="epi-track"><span className="epi-thumb" /></span>
                    <span className="epi-label">旋转圆环</span>
                  </label>
                  <motion.span
                    key={mainError}
                    className="badge"
                    initial={{ scale: 0.9, opacity: 0.4 }}
                    animate={{ scale: 1, opacity: 1 }}
                  >
                    error = {(mainError * 100).toFixed(2)}%
                  </motion.span>
                </div>
              </div>
              <CanvasView
                target={result.contour}
                recon={mainRecon}
                bounds={result.bounds}
                coeffs={result.coeffs}
                dc={result.dc}
                n={n}
                epicycles={showEpicycles}
                speed={epiSpeed}
                paused={epiPaused}
                imageKey={imageName}
                resetToken={resetToken}
              />
              {showEpicycles && (
                <div className="epi-controls">
                  <button
                    className="btn ghost epi-play"
                    onClick={() => setEpiPaused((v) => !v)}
                    aria-label={epiPaused ? '继续' : '暂停'}
                  >
                    {epiPaused ? '▶ 继续' : '⏸ 暂停'}
                  </button>
                  <button
                    className="btn ghost epi-reset"
                    onClick={() => setResetToken((v) => v + 1)}
                    aria-label="重置动画"
                    title="清空拖尾，从起点重新开始"
                  >
                    ↺ 重置
                  </button>
                  <div className="epi-speed">
                    <span className="dim">速度</span>
                    <input
                      type="range"
                      min="0.1"
                      max="4"
                      step="0.1"
                      value={epiSpeed}
                      onChange={(e) => setEpiSpeed(parseFloat(e.target.value))}
                      style={{ '--pct': `${((epiSpeed - 0.1) / 3.9) * 100}%` }}
                    />
                    <span className="mono epi-speed-val">{epiSpeed.toFixed(1)}×</span>
                  </div>
                </div>
              )}
              <p className="hint epi-hint">
                {showEpicycles
                  ? '金色拖尾 = 笔尖刚刚走过的点连成的线；它叠加成红色轮廓。圆越大 = 这层谐波越重要。'
                  : '开启「旋转圆环」观看圆环连杆如何一笔画出轮廓。'}
              </p>
            </div>

            <div className="panel side-panel">
              <div className="panel-head">
                <h2>系数谱 · 谁在画这笔画？</h2>
              </div>
              <Spectrum coeffs={result.coeffs} n={n} onPick={setN} max={maxN} />
              <div className="spectrum-legend">
                <p className="hint">
                  把轮廓拆成一层层旋转的圆：<strong>圆越大，这个圆对形状的贡献越大</strong>。
                  画图时只用前 <strong className="accent">{Math.min(n, maxN)}</strong> 个圆（亮色），
                  后面的都被扔掉 —— 扔得越多，丢失的细节越多。
                </p>
                <p className="hint">
                  点击任意柱子可以设定使用前几个圆试试看。
                </p>
              </div>
            </div>
          </section>

          <section className="panel multi-panel">
            <div className="panel-head">
              <h2>不同 N 的对比</h2>
              <span className="hint">点击任意小图同步主画布的 N</span>
            </div>
            <MultiView
              result={result}
              presets={PRESET_N.filter((v) => v <= maxN)}
              current={n}
              onPick={setN}
            />
          </section>
        </motion.main>
      )}

      <footer className="footer">
        纯前端 · 无上传服务器 · 轮廓在本地浏览器内提取与重建
      </footer>
    </div>
  )
}

/**
 * 系数谱（初学者友好版）：
 * - 条高 = |c_k|（圆的半径），条越高圆越大
 * - 前几项高亮显示当前用了几个圆
 * - 头部显示"能量占比"：前 n 项贡献了多少形状信息
 * - 点击柱子设定 n；悬停显示该圆的半径与速度
 */
function Spectrum({ coeffs, n, onPick, max }) {
  const SHOWN = 40
  const shown = coeffs.slice(0, SHOWN)
  const maxMag = shown[0]?.mag || 1

  // 能量占比：Σ前n项|c| / Σ全部|c|（粗略但直观）
  const total = coeffs.reduce((s, c) => s + c.mag, 0) || 1
  const used = coeffs.slice(0, Math.min(n, coeffs.length)).reduce((s, c) => s + c.mag, 0)
  const pct = ((used / total) * 100).toFixed(0)

  return (
    <div className="spectrum-wrap">
      <div className="spectrum-stat">
        <div className="spectrum-energy">
          <div className="spectrum-energy-label">
            前 <strong className="mono accent">{Math.min(n, coeffs.length)}</strong> 个圆
            贡献了 <strong className="mono accent">{pct}%</strong> 的形状
          </div>
          <div className="spectrum-energy-bar">
            <motion.div
              className="spectrum-energy-fill"
              initial={false}
              animate={{ width: `${pct}%` }}
              transition={{ type: 'spring', stiffness: 200, damping: 26 }}
            />
          </div>
        </div>
      </div>
      <div className="spectrum">
        {shown.map((c, i) => (
          <motion.button
            key={c.k}
            className={`bar ${i < n ? 'on' : ''} ${i === n - 1 ? 'edge' : ''}`}
            initial={{ height: 0 }}
            animate={{ height: `${Math.max(3, (c.mag / maxMag) * 100)}%` }}
            transition={{ duration: 0.5, delay: i * 0.012, ease: 'easeOut' }}
            onClick={() => onPick(Math.max(1, Math.min(max, i + 1)))}
            title={`第 ${i + 1} 个圆：半径 ${c.mag.toFixed(2)}，转速 ${c.k}×`}
            aria-label={`设定 N=${i + 1}`}
          />
        ))}
      </div>
      <div className="spectrum-axis">
        <span>第1个圆</span>
        <span>…</span>
        <span>第{SHOWN}个圆</span>
      </div>
    </div>
  )
}
