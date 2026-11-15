import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
    // 允许通过 Cloudflare Tunnel 域名访问
    allowedHosts: ['fourier.iman.qzz.io'],
  },
})
