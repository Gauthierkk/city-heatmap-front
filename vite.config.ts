import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // served from https://<user>.github.io/city-heatmap-front/
  base: '/city-heatmap-front/',
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          maplibre: ['maplibre-gl'],
          react: ['react', 'react-dom'],
        },
      },
    },
  },
})
