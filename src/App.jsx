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

          <section className="grid">
            <div className="panel canvas-panel">
              <div className="panel-head">
                <h2>重建 · N = <span className="mono accent">{n}</span></h2>
                <motion.span
                  key={mainError}
                  className="badge"
                  initial={{ scale: 0.9, opacity: 0.4 }}
                  animate={{ scale: 1, opacity: 1 }}
                >
                  error = {(mainError * 100).toFixed(2)}%
                </motion.span>
              </div>
              <CanvasView
                target={result.contour}
                recon={mainRecon}
                bounds={result.bounds}
                n={n}
              />
            </div>

            <div className="panel side-panel">
              <div className="panel-head">
                <h2>系数谱 |c<sub>k</sub>|</h2>
              </div>
              <Spectrum coeffs={result.coeffs} n={n} />
              <p className="hint">
                前几个系数携带绝大部分形状信息 —— 这就是傅里叶级数做轮廓压缩的原理。
              </p>
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

/** |c_k| 频谱条形图，n 以内高亮 */
function Spectrum({ coeffs, n }) {
  const shown = coeffs.slice(0, 48)
  const maxMag = shown[0]?.origMag || 1
  return (
    <div className="spectrum">
      {shown.map((c, i) => (
        <motion.div
          key={c.k}
          className={`bar ${i < n ? 'on' : ''}`}
          initial={{ height: 0 }}
          animate={{ height: `${Math.max(2, (c.origMag / maxMag) * 100)}%` }}
          transition={{ duration: 0.5, delay: i * 0.01, ease: 'easeOut' }}
          title={`k=${c.k}  |c|=${c.origMag.toFixed(3)}`}
        />
      ))}
    </div>
  )
}
