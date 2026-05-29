import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

import { loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const caldavUrl = env.VITE_CALDAV_URL || ''

  const proxy = {
    '/agent-api': {
      target: 'http://localhost:8900',
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/agent-api/, ''),
    },
    '/api': {
      target: 'http://localhost:7860',
      changeOrigin: true,
      secure: false,
      ws: true,
    },
    '/health': {
      target: 'http://localhost:7860',
      changeOrigin: true,
      secure: false,
    },
    '/v1': {
      target: 'http://localhost:7860',
      changeOrigin: true,
      secure: false,
    },
  }

  if (caldavUrl) {
    const parsed = new URL(caldavUrl)
    proxy['/caldav'] = {
      target: `${parsed.protocol}//${parsed.host}`,
      changeOrigin: true,
      secure: false,
      rewrite: () => parsed.pathname,
    }
  }

  return {
    plugins: [svelte()],
    server: { host: '127.0.0.1', proxy },
  }
})
