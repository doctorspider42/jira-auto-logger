import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

// Builds the existing renderer for the Tauri trial. The root is `src` so the
// page can reach both the renderer and the Tauri bridge in `src/tauri-web`.
export default defineConfig({
  root: resolve(__dirname, 'src'),
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@': resolve(__dirname, 'src/renderer/src')
    }
  },
  server: { port: 5174, strictPort: true },
  build: {
    outDir: resolve(__dirname, 'out/tauri'),
    emptyOutDir: true,
    rollupOptions: { input: resolve(__dirname, 'src/renderer/index.tauri.html') }
  }
})
