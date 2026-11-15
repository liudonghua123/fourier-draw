# Fourier Draw

用截断复数傅里叶级数重建任意图片的主体轮廓 —— 实时调节谐波数 N，观察形状逐步收敛。

简体中文 · [English](./README.md)

> 纯前端实现，图片不会离开你的浏览器。

## 功能

- **拖拽上传** —— 点击或拖入任意图片，全部处理在本地完成
- **自动主体提取** —— Otsu 自适应阈值二值化（极性自动翻转兜底）→ 最大连通域（BFS）→ Moore 邻域轮廓追踪 → 弧长等距重采样（512 点）
- **复数傅里叶描述子** —— 轮廓点视为复数序列 z = x + iy，全量 DFT，按模 |c_k| 降序排列
- **实时 N 控制** —— 对数刻度滑杆（拖动 / 滚轮微调 / 双击重置），画布带描绘动画重画
- **误差指标** —— 重建曲线与原轮廓的平均点到点距离，按轮廓平均半径归一化，以百分比徽标展示
- **幅度谱** —— |c_k| 条形图，前 N 项高亮
- **预设对比墙** —— N ∈ {1, 2, 3, 5, 8, 15, 30, 64, 128, 256} 缩略图，点击同步主画布
- **动效设计** —— motion（Framer Motion 新版）入场动画、描绘进度动画、背景光斑漂移

## 原理

把采样后的轮廓视为复数序列 z_i = x_i + i·y_i，其离散傅里叶变换为

```
c_k = (1/N) Σ z_i · e^(-2πi·k·i/N)
```

只保留直流项 c_0 与 |c_k| 最大的前 n 个系数再做逆变换，即得到逼近原轮廓的闭合曲线：

- **圆**只需 1 项（误差 ≈ 0）
- **方形**需要很多项 —— 尖角处谐波衰减慢（吉布斯现象）

误差徽标显示 `mean ‖recon(t) − orig(t)‖ / 平均半径`，为尺度无关的百分比。

## 快速开始

```bash
npm install
npm run dev      # http://localhost:5180
npm run build    # 产物在 dist/
npm run preview  # 预览生产构建
```

## 公网访问（Cloudflare Tunnel）

```bash
# 快速隧道（临时 URL，无需账号）
cloudflared tunnel --url http://localhost:5180

# 命名隧道（固定域名，需要 Cloudflare 账号）
cloudflared tunnel create fourier-draw
cloudflared tunnel route dns fourier-draw draw.example.com
cloudflared tunnel run --url http://localhost:5180 fourier-draw
```

## 项目结构

```
src/
├── lib/
│   └── fourier.js          # 二值化、轮廓追踪、DFT、重建、误差
├── components/
│   ├── CanvasView.jsx      # 主画布（描绘动画）
│   ├── MultiView.jsx       # 预设 N 缩略图对比墙
│   └── Slider.jsx          # 对数刻度 N 滑杆
├── App.jsx                 # 布局、上传、状态
├── App.css                 # 样式（浅色主题、毛玻璃面板）
└── main.jsx
```

## 技术栈

Vite 8 · React 19 · motion · Canvas 2D

## 许可证

[MIT](./LICENSE)
