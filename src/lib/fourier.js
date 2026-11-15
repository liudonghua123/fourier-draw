/**
 * 图像 → 主体轮廓 → 复数傅里叶描述子
 *
 * 流程：
 * 1. Otsu 自适应阈值二值化（前景极性异常时自动翻转）
 * 2. 取面积最大的连通域作为"主体"
 * 3. Moore 邻域追踪得到有序轮廓点
 * 4. 等距重采样 N 点，做 DFT 得到复数傅里叶系数 c_k
 * 5. 系数按 |c_k| 降序排列（保留原始复数值，保证重建坐标与原轮廓一致）
 */

// ---------- 1. 二值化 ----------

/**
 * Otsu 自适应阈值：最大化类间方差
 */
export function otsuThreshold(gray, len) {
  const hist = new Float64Array(256)
  for (let i = 0; i < len; i++) hist[gray[i]]++

  const total = len
  let sum = 0
  for (let t = 0; t < 256; t++) sum += t * hist[t]

  let sumB = 0, wB = 0, maxVar = -1, threshold = 127
  for (let t = 0; t < 256; t++) {
    wB += hist[t]
    if (wB === 0) continue
    const wF = total - wB
    if (wF === 0) break
    sumB += t * hist[t]
    const mB = sumB / wB
    const mF = (sum - sumB) / wF
    const between = wB * wF * (mB - mF) * (mB - mF)
    if (between > maxVar) { maxVar = between; threshold = t }
  }
  return threshold
}

/**
 * 二值化：返回 { mask, w, h, threshold, inverted }
 * mask 中 1 = 前景主体；透明像素视作背景；极性异常时自动翻转
 */
export function extractSubjectMask(imageData) {
  const w = imageData.width
  const h = imageData.height
  const { data } = imageData
  const n = w * h
  const gray = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    const a = data[i * 4 + 3] / 255
    const lum = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]
    gray[i] = a < 0.5 ? 0 : Math.round(lum)
  }

  const th = otsuThreshold(gray, n)
  const mask = new Uint8Array(n)
  let fgCount = 0
  for (let i = 0; i < n; i++) {
    mask[i] = gray[i] <= th ? 1 : 0
    if (mask[i]) fgCount++
  }

  // 若前景占比异常（>70% 或 <1%），翻转极性再试（背景可能是深色，主体亮）
  if (fgCount > n * 0.7 || fgCount < n * 0.01) {
    const flipped = new Uint8Array(n)
    let fc2 = 0
    for (let i = 0; i < n; i++) { flipped[i] = mask[i] ? 0 : 1; if (flipped[i]) fc2++ }
    if (fc2 >= n * 0.01 && fc2 <= n * 0.7) {
      return { mask: flipped, w, h, gray, threshold: th, inverted: true }
    }
  }

  return { mask, w, h, gray, threshold: th, inverted: false }
}

// ---------- 2. 最大连通域 ----------

/** BFS 找最大 8 连通域，返回只含该连通域的 mask */
export function largestComponent(mask, w, h) {
  const labels = new Int32Array(w * h).fill(-1)
  const queue = new Int32Array(w * h)
  let bestSize = 0, bestLabel = -1
  let label = 0

  for (let start = 0; start < w * h; start++) {
    if (!mask[start] || labels[start] !== -1) continue
    let head = 0, tail = 0
    queue[tail++] = start
    labels[start] = label
    let size = 0
    while (head < tail) {
      const p = queue[head++]
      size++
      const x = p % w, y = (p / w) | 0
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue
          const nx = x + dx, ny = y + dy
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
          const np = ny * w + nx
          if (mask[np] && labels[np] === -1) {
            labels[np] = label
            queue[tail++] = np
          }
        }
      }
    }
    if (size > bestSize) { bestSize = size; bestLabel = label }
    label++
  }

  const out = new Uint8Array(w * h)
  if (bestLabel < 0) return out
  for (let i = 0; i < w * h; i++) out[i] = labels[i] === bestLabel ? 1 : 0
  return out
}

// ---------- 3. Moore 邻域轮廓追踪 ----------

const DIRS = [
  [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1],
]

/** Moore 邻域追踪外边界，返回有序点列 [{x,y}]（像素坐标，顺时针） */
export function traceContour(mask, w, h) {
  // 起始点：扫描序最靠前的前景像素
  let start = -1
  for (let y = 0; y < h && start < 0; y++)
    for (let x = 0; x < w; x++)
      if (mask[y * w + x]) { start = y * w + x; break }

  if (start < 0) return []
  const sx = start % w, sy = (start / w) | 0

  const contour = [{ x: sx, y: sy }]
  let prevDir = 6 // 初始来自西侧
  let cx = sx, cy = sy
  const maxSteps = w * h * 2

  for (let step = 0; step < maxSteps; step++) {
    let found = false
    for (let k = 0; k < 8; k++) {
      const dir = (prevDir + 6 + k) % 8 // 从 backtrack 方向顺时针扫
      const nx = cx + DIRS[dir][0]
      const ny = cy + DIRS[dir][1]
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
      if (mask[ny * w + nx]) {
        contour.push({ x: nx, y: ny })
        cx = nx; cy = ny
        prevDir = dir
        found = true
        break
      }
    }
    if (!found) break // 孤立点
    if (cx === sx && cy === sy) break // 回到起点
  }

  return contour
}

// ---------- 4. 重采样 + DFT ----------

/** 按弧长等距重采样为 N 点 */
export function resample(points, N) {
  if (points.length < 2) return points.slice(0, N).map((p) => ({ ...p }))
  const d = [0]
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x
    const dy = points[i].y - points[i - 1].y
    d.push(d[i - 1] + Math.hypot(dx, dy))
  }
  const total = d[d.length - 1]
  if (total === 0) return points.slice(0, N).map((p) => ({ ...p }))

  const out = []
  const step = total / N
  let j = 0
  for (let i = 0; i < N; i++) {
    const target = i * step
    while (j < d.length - 2 && d[j + 1] < target) j++
    const seg = d[j + 1] - d[j] || 1e-9
    const t = (target - d[j]) / seg
    out.push({
      x: points[j].x + (points[j + 1].x - points[j].x) * t,
      y: points[j].y + (points[j + 1].y - points[j].y) * t,
    })
  }
  return out
}

/**
 * 复数 DFT：z_i = x_i + i·y_i
 * c_k = (1/N) Σ z_i · e^{-2πi·k·i/N}
 * 返回系数数组 [{k, re, im, mag}]，k=0 为直流项
 */
export function computeFourier(points) {
  const N = points.length
  const coeffs = []
  for (let k = 0; k < N; k++) {
    let re = 0, im = 0
    for (let i = 0; i < N; i++) {
      const theta = (2 * Math.PI * k * i) / N
      const zr = points[i].x
      const zi = points[i].y
      // z·e^{-iθ} = (zr·cosθ + zi·sinθ) + i(zi·cosθ - zr·sinθ)
      re += zr * Math.cos(theta) + zi * Math.sin(theta)
      im += zi * Math.cos(theta) - zr * Math.sin(theta)
    }
    coeffs.push({ k, re: re / N, im: im / N, mag: Math.hypot(re, im) / N })
  }
  return coeffs
}

/** 跳过 k=0，按 |c_k| 降序排列（保留原始复数值，保证重建坐标与原轮廓一致） */
export function normalizeCoeffs(coeffs) {
  const dc = coeffs[0]
  const ordered = coeffs.slice(1).sort((a, b) => b.mag - a.mag)
  return { dc, ordered }
}

/**
 * 完整管线：ImageData → { rawContour, contour, coeffs, dc, bounds, ... }
 */
export function extractContourAndCoeffs(imageData, { samples = 512 } = {}) {
  const { mask, w, h, threshold, inverted } = extractSubjectMask(imageData)
  const comp = largestComponent(mask, w, h)
  const rawContour = traceContour(comp, w, h)
  if (rawContour.length < 8) return null

  const contour = resample(rawContour, samples)
  const coeffs = computeFourier(contour)
  const { dc, ordered } = normalizeCoeffs(coeffs)

  // 覆盖范围（用于归一化绘制尺度）
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const p of rawContour) {
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }

  return {
    rawContour,
    contour,
    coeffs: ordered, // 已按 |c| 降序，slice(0, n) 即前 n 项
    dc,
    threshold,
    inverted,
    bounds: { minX, maxX, minY, maxY, w, h },
  }
}

/**
 * 用前 n 个系数（+ 直流项）重建点列，坐标与原轮廓一致
 */
export function reconstruct(coeffs, dc, n, samples = 512) {
  const use = coeffs.slice(0, n)
  const pts = []
  for (let t = 0; t < samples; t++) {
    let re = dc.re, im = dc.im
    for (let j = 0; j < use.length; j++) {
      const c = use[j]
      const ang = c.k * (2 * Math.PI * t) / samples
      re += c.re * Math.cos(ang) - c.im * Math.sin(ang)
      im += c.re * Math.sin(ang) + c.im * Math.cos(ang)
    }
    pts.push({ x: re, y: im })
  }
  return pts
}

/**
 * 误差：重建与原始轮廓的平均点到点距离 ÷ 轮廓平均半径，返回 0~1
 */
export function reconstructionError(original, coeffs, dc, n) {
  const N = original.length
  const use = coeffs.slice(0, n)
  // 平均半径作为尺度基准
  let cx = 0, cy = 0
  for (const p of original) { cx += p.x; cy += p.y }
  cx /= N; cy /= N
  let radius = 0
  for (const p of original) radius += Math.hypot(p.x - cx, p.y - cy)
  radius /= N || 1
  if (radius < 1e-9) return 0

  let sum = 0
  for (let t = 0; t < N; t++) {
    const phase = (2 * Math.PI * t) / N
    let re = dc.re, im = dc.im
    for (const c of use) {
      const ang = c.k * phase
      re += c.re * Math.cos(ang) - c.im * Math.sin(ang)
      im += c.re * Math.sin(ang) + c.im * Math.cos(ang)
    }
    sum += Math.hypot(re - original[t].x, im - original[t].y)
  }
  return sum / N / radius
}
