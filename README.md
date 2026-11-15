# Fourier Draw

Reconstruct any image's subject contour with a truncated complex Fourier series — tune the number of harmonics *N* in real time and watch the shape converge.

[简体中文](./README.zh-CN.md) · English

> Pure frontend. Images never leave your browser.

## Features

- **Drag & drop upload** — click or drop any image; all processing is local
- **Automatic subject extraction** — Otsu adaptive thresholding (auto polarity flip) → largest connected component (BFS) → Moore-neighbor contour tracing → arc-length resampling (512 points)
- **Complex Fourier descriptors** — contour points treated as complex sequence z = x + iy, full DFT, coefficients ranked by magnitude |c_k|
- **Real-time N control** — logarithmic slider (drag / mouse-wheel / double-click to reset), canvas redraws with a tracing animation
- **Error metric** — mean point-to-point distance between reconstruction and original contour, normalized by mean contour radius, shown as a percentage badge
- **Magnitude spectrum** — |c_k| bar chart with the first N terms highlighted
- **Preset gallery** — thumbnails at N ∈ {1, 2, 3, 5, 8, 15, 30, 64, 128, 256}; click to sync the main canvas
- **Motion design** — Framer Motion (motion) entrance animations, tracing progress animation, drifting gradient orbs background

## How it works

Treat the sampled contour as a complex sequence z_i = x_i + i·y_i. Its DFT is

```
c_k = (1/N) Σ z_i · e^(-2πi·k·i/N)
```

Keeping only the DC term c_0 plus the n largest-|c_k| coefficients and inverting gives a closed curve that approximates the contour:

- A **circle** needs just 1 term (error ≈ 0)
- A **square** needs many terms — sharp corners decay slowly (Gibbs phenomenon)

The error badge reports `mean ‖recon(t) − orig(t)‖ / mean radius`, a scale-invariant percentage.

## Getting started

```bash
npm install
npm run dev      # http://localhost:5180
npm run build    # production bundle in dist/
npm run preview  # preview the production build
```

## Expose to the internet (Cloudflare Tunnel)

```bash
# Quick tunnel (temporary URL, no account needed)
cloudflared tunnel --url http://localhost:5180

# Named tunnel (stable hostname, requires a Cloudflare account)
cloudflared tunnel create fourier-draw
cloudflared tunnel route dns fourier-draw draw.example.com
cloudflared tunnel run --url http://localhost:5180 fourier-draw
```

## Project structure

```
src/
├── lib/
│   └── fourier.js          # Thresholding, tracing, DFT, reconstruction, error
├── components/
│   ├── CanvasView.jsx      # Main canvas with tracing animation
│   ├── MultiView.jsx       # Preset-N thumbnail gallery
│   └── Slider.jsx          # Logarithmic N slider
├── App.jsx                 # Layout, upload, state
├── App.css                 # Styles (light theme, glass panels)
└── main.jsx
```

## Tech stack

Vite 8 · React 19 · motion · Canvas 2D

## License

[MIT](./LICENSE)
