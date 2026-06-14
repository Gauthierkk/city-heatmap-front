import { cpSync, createReadStream, existsSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// The store GeoJSON lives in ./data (outside public/) so the sibling
// city-heatmap-data worker can own the whole directory. Vite doesn't serve it
// by default, so this plugin maps /data/* to ./data in dev and copies it into
// the build output — keeping every `data/...` URL (cities.ts, index.html)
// unchanged.
function serveData(): Plugin {
  const dataDir = fileURLToPath(new URL('./data', import.meta.url))
  let base = '/'
  return {
    name: 'serve-data',
    configResolved(config) {
      base = config.base
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url) return next()
        let url = req.url.split('?')[0]
        if (base !== '/' && url.startsWith(base)) url = '/' + url.slice(base.length)
        if (!url.startsWith('/data/')) return next()
        const file = fileURLToPath(new URL('.' + url.slice('/data'.length), new URL('./data/', import.meta.url)))
        if (!file.startsWith(dataDir) || !existsSync(file) || !statSync(file).isFile()) return next()
        res.setHeader('Content-Type', 'application/geo+json')
        createReadStream(file).pipe(res)
      })
    },
    closeBundle() {
      if (!existsSync(dataDir)) return
      cpSync(dataDir, fileURLToPath(new URL('./dist/data', import.meta.url)), { recursive: true })
    },
  }
}

export default defineConfig({
  // served from https://<user>.github.io/city-heatmap-front/
  base: '/city-heatmap-front/',
  plugins: [react(), serveData()],
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
