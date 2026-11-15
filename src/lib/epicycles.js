/**
 * 旋转圆环（Epicycles）可视化：
 * 每个傅里叶系数 c_k 是一个旋转向量——圆心在上一层向量末端，
 * 半径为 |c_k|，角速度正比于 k。最外层向量末端即重建曲线上的点。
 *
 * 渲染：透明覆盖层画在主画布上；rAF 驱动时间相位 t 递增，
 * 轨迹由 CanvasView 的重建曲线承担，这里只画圆环与连杆。
 */

/**
 * 计算时刻 t（0~1，对应一圈）的 epicycles 链
 * @returns {{x, y}[]} 每层向量的末端坐标（归一化前坐标），index 0 为 DC 中心
 */
export function epicycleChain(coeffs, dc, n, t) {
  const phase = 2 * Math.PI * t
  const chain = [{ x: dc.re, y: dc.im }]
  let re = dc.re
  let im = dc.im
  const use = coeffs.slice(0, n)
  for (const c of use) {
    const ang = c.k * phase
    re += c.re * Math.cos(ang) - c.im * Math.sin(ang)
    im += c.re * Math.sin(ang) + c.im * Math.cos(ang)
    chain.push({ x: re, y: im })
  }
  return chain
}
