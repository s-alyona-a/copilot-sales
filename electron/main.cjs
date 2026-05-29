const { app, BrowserWindow, ipcMain } = require('electron')
const http = require('http')
const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')

// ═══ Sales Agent API — автозапуск Python ═══
const SALES_AGENT_PORT = 8900;
const SALES_AGENT_DIR = path.join(__dirname, '..', '..', 'sales-agent');
const PYTHON_CMD = path.join(SALES_AGENT_DIR, 'venv', 'Scripts', 'python.exe');
let salesAgentProcess = null;

function checkSalesAgentHealth() {
  return new Promise((resolve) => {
    const req = http.get(
      `http://localhost:${SALES_AGENT_PORT}/health`,
      { timeout: 3000 },
      (res) => { resolve(res.statusCode === 200); }
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

async function waitForSalesAgent(maxRetries = 20, interval = 1000) {
  for (let i = 0; i < maxRetries; i++) {
    if (await checkSalesAgentHealth()) return true;
    await new Promise(r => setTimeout(r, interval));
  }
  return false;
}

function startSalesAgent() {
  return new Promise(async (resolve) => {
    // Если API уже запущен — ничего не делаем
    if (await checkSalesAgentHealth()) {
      console.log('[SalesAgent] ✅ API уже запущен');
      resolve(true);
      return;
    }
    const scriptPath = path.join(SALES_AGENT_DIR, 'api_server.py');
    if (!fs.existsSync(scriptPath)) {
      console.warn('[SalesAgent] ⚠️ Не найден', scriptPath);
      resolve(false);
      return;
    }
    console.log('[SalesAgent] 🚀 Запуск Python API...');
    salesAgentProcess = spawn(PYTHON_CMD, [scriptPath, '--no-reload'], {
      cwd: SALES_AGENT_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, SALES_AGENT_PORT: String(SALES_AGENT_PORT),
      PYTHONIOENCODING: 'utf-8',
      PYTHONUTF8: '1',},

    });
    salesAgentProcess.stdout.on('data', (d) => console.log('[SalesAgent]', d.toString().trim()));
    salesAgentProcess.stderr.on('data', (d) => console.error('[SalesAgent]', d.toString().trim()));
    salesAgentProcess.on('close', (code) => { console.log(`[SalesAgent] Завершён (${code})`); salesAgentProcess = null; });
    salesAgentProcess.on('error', (err) => { console.error('[SalesAgent] ❌', err.message); resolve(false); });
    await new Promise(r => setTimeout(r, 2000));
    resolve(salesAgentProcess && !salesAgentProcess.killed);
  });
}

function stopSalesAgent() {
  if (!salesAgentProcess) return;
  console.log('[SalesAgent] 🛑 Остановка...');
  if (process.platform === 'win32') {
    spawn('taskkill', ['/PID', String(salesAgentProcess.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    salesAgentProcess.kill('SIGTERM');
    setTimeout(() => { if (salesAgentProcess) salesAgentProcess.kill('SIGKILL'); }, 3000);
  }
  salesAgentProcess = null;
}

// Initialize loopback audio (legacy, kept as fallback)
try {
  const { initMain } = require('electron-audio-loopback/dist/main')
  initMain()
} catch { /* ignore if not available */ }

let mainWindow = null
let server = null

const DIST_DIR = path.join(__dirname, '..', 'dist')
const MIME = {
  '.html': 'text/html',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.json': 'application/json',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
}

function proxyToSalesAgent(req, res) {
  const target = `http://localhost:${SALES_AGENT_PORT}${req.url.replace(/^\/agent-api/, '')}`
  const parsed = new URL(target)
  const proxyReq = http.request({
    hostname: parsed.hostname,
    port: parsed.port,
    path: parsed.pathname + parsed.search,
    method: req.method,
    headers: { ...req.headers, host: `localhost:${SALES_AGENT_PORT}` },
  }, (proxyRes) => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers)
    proxyRes.pipe(res)
  })
  proxyReq.on('error', () => {
    res.writeHead(502, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Sales agent unavailable' }))
  })
  req.pipe(proxyReq)
}

function startServer() {
  return new Promise((resolve, reject) => {
    server = http.createServer((req, res) => {
      if (req.url.startsWith('/agent-api')) {
        return proxyToSalesAgent(req, res)
      }
      const urlPath = req.url.split('?')[0]
      let filePath = path.join(DIST_DIR, urlPath === '/' ? 'index.html' : urlPath)
      if (!filePath.startsWith(DIST_DIR)) { res.writeHead(403); return res.end() }
      fs.readFile(filePath, (err, data) => {
        if (err) {
          if (err.code === 'ENOENT' && !path.extname(filePath)) {
            filePath = path.join(DIST_DIR, 'index.html')
            return fs.readFile(filePath, (e2, d2) => {
              if (e2) { res.writeHead(404); return res.end('Not found') }
              res.writeHead(200, { 'Content-Type': 'text/html' })
              res.end(d2)
            })
          }
          res.writeHead(404); return res.end('Not found')
        }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' })
        res.end(data)
      })
    })
    server.listen(0, '127.0.0.1', () => resolve(server.address().port))
    server.on('error', reject)
  })
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    title: 'CoPilot Sales',
    icon: path.join(__dirname, '..', 'public', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
    },
  })

  mainWindow.webContents.session.setPermissionRequestHandler(
    (_wc, permission, callback) => {
      if (permission === 'media') callback(true)
      else callback(false)
    }
  )
}

// ---------------------------------------------------------------------------
// WASAPI Loopback System Audio Capture
// ---------------------------------------------------------------------------
let loopbackProc = null
let loopbackChunkBuf = []
let loopbackChunkSize = 0

// ---------------------------------------------------------------------------
// WASAPI Microphone Capture
// ---------------------------------------------------------------------------
let micProc = null
let micChunkBuf = []
let micChunkSize = 0
const LOOPBACK_CHUNK_DURATION_MS = 6000  // 6 seconds per chunk
const LOOPBACK_SAMPLE_RATE = 48000
const LOOPBACK_CHANNELS = 2
const LOOPBACK_BYTES_PER_SAMPLE = 2  // s16le
const LOOPBACK_BYTES_PER_SEC = LOOPBACK_SAMPLE_RATE * LOOPBACK_CHANNELS * LOOPBACK_BYTES_PER_SAMPLE
const LOOPBACK_CHUNK_BYTES = LOOPBACK_BYTES_PER_SEC * (LOOPBACK_CHUNK_DURATION_MS / 1000)
const WAV_HEADER_SIZE = 44

function makeWavHeader(dataLen, sampleRate, channels, bitsPerSample) {
  const buf = Buffer.alloc(44)
  const byteRate = sampleRate * channels * (bitsPerSample / 8)
  const blockAlign = channels * (bitsPerSample / 8)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + dataLen, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)  // PCM fmt chunk size
  buf.writeUInt16LE(1, 20)   // PCM format
  buf.writeUInt16LE(channels, 22)
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(byteRate, 28)
  buf.writeUInt16LE(blockAlign, 32)
  buf.writeUInt16LE(bitsPerSample, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(dataLen, 40)
  return buf
}

function flushLoopbackChunk() {
  if (loopbackChunkBuf.length === 0) return
  const pcmData = Buffer.concat(loopbackChunkBuf)
  loopbackChunkBuf = []
  loopbackChunkSize = 0

  // Wrap in WAV container
  const wavHeader = makeWavHeader(pcmData.length, LOOPBACK_SAMPLE_RATE, LOOPBACK_CHANNELS, 16)
  const wavBuf = Buffer.concat([wavHeader, pcmData])

  // Base64 encode and send to renderer
  const b64 = wavBuf.toString('base64')
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('system-audio-chunk', b64)
  }
}

ipcMain.handle('start-system-audio', async () => {
  if (loopbackProc) {
    try { loopbackProc.kill() } catch { /* ignore */ }
    loopbackProc = null
    loopbackChunkBuf = []
    loopbackChunkSize = 0
  }

  const exePath = path.join(__dirname, 'wasapi_loopback.exe')
  if (!fs.existsSync(exePath)) {
    console.error('wasapi_loopback.exe not found at', exePath)
    return false
  }

  try {
    loopbackProc = spawn(exePath, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })

    loopbackChunkBuf = []
    loopbackChunkSize = 0

    // Read PCM data from stdout
    loopbackProc.stdout.on('data', (chunk) => {
      loopbackChunkBuf.push(chunk)
      loopbackChunkSize += chunk.length

      // When we have enough for a 6-second segment, flush it
      if (loopbackChunkSize >= LOOPBACK_CHUNK_BYTES) {
        flushLoopbackChunk()
      }
    })

    loopbackProc.stderr.on('data', (data) => {
      const msg = data.toString().trim()
      console.log('[wasapi_loopback]', msg)
    })

    loopbackProc.on('close', (code) => {
      console.log('[wasapi_loopback] exited with code', code)
      // Flush remaining data
      flushLoopbackChunk()
      loopbackProc = null
    })

    loopbackProc.on('error', (err) => {
      console.error('[wasapi_loopback] error:', err.message)
      loopbackProc = null
    })

    // Wait a moment to see if it starts successfully
    await new Promise(resolve => setTimeout(resolve, 500))
    return loopbackProc !== null
  } catch (e) {
    console.error('Failed to start wasapi_loopback:', e.message)
    loopbackProc = null
    return false
  }
})

ipcMain.handle('stop-system-audio', async () => {
  if (!loopbackProc) return

  // Send STOP command via stdin
  try {
    loopbackProc.stdin.write('STOP\n')
    loopbackProc.stdin.end()
  } catch { /* ignore */ }

  // Give it a moment to exit gracefully
  await new Promise(resolve => setTimeout(resolve, 300))

  if (loopbackProc) {
    try { loopbackProc.kill() } catch { /* ignore */ }
    loopbackProc = null
  }

  // Flush any remaining audio
  flushLoopbackChunk()
})

// ---------------------------------------------------------------------------
// WASAPI Microphone Capture IPC
// ---------------------------------------------------------------------------
const MIC_SAMPLE_RATE = 48000
const MIC_CHANNELS = 1
const MIC_BYTES_PER_SAMPLE = 2
const MIC_BYTES_PER_SEC = MIC_SAMPLE_RATE * MIC_CHANNELS * MIC_BYTES_PER_SAMPLE
const MIC_CHUNK_BYTES = MIC_BYTES_PER_SEC * (LOOPBACK_CHUNK_DURATION_MS / 1000)

function flushMicChunk() {
  if (micChunkBuf.length === 0) return
  const pcmData = Buffer.concat(micChunkBuf)
  micChunkBuf = []
  micChunkSize = 0

  const wavHeader = makeWavHeader(pcmData.length, MIC_SAMPLE_RATE, MIC_CHANNELS, 16)
  const wavBuf = Buffer.concat([wavHeader, pcmData])
  const b64 = wavBuf.toString('base64')
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('mic-audio-chunk', b64)
  }
}

ipcMain.handle('start-mic', async () => {
  if (micProc) {
    try { micProc.kill() } catch { /* ignore */ }
    micProc = null
    micChunkBuf = []
    micChunkSize = 0
  }

  const exePath = path.join(__dirname, 'wasapi_mic.exe')
  if (!fs.existsSync(exePath)) {
    console.error('wasapi_mic.exe not found at', exePath)
    return false
  }

  try {
    micProc = spawn(exePath, ['NVIDIA Broadcast'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })

    micChunkBuf = []
    micChunkSize = 0

    micProc.stdout.on('data', (chunk) => {
      micChunkBuf.push(chunk)
      micChunkSize += chunk.length

      if (micChunkSize >= MIC_CHUNK_BYTES) {
        flushMicChunk()
      }
    })

    micProc.stderr.on('data', (data) => {
      const msg = data.toString().trim()
      console.log('[wasapi_mic]', msg)
    })

    micProc.on('close', (code) => {
      console.log('[wasapi_mic] exited with code', code)
      flushMicChunk()
      micProc = null
    })

    micProc.on('error', (err) => {
      console.error('[wasapi_mic] error:', err.message)
      micProc = null
    })

    await new Promise(resolve => setTimeout(resolve, 500))
    return micProc !== null
  } catch (e) {
    console.error('Failed to start wasapi_mic:', e.message)
    micProc = null
    return false
  }
})

ipcMain.handle('stop-mic', async () => {
  if (!micProc) return
  try {
    micProc.stdin.write('STOP\n')
    micProc.stdin.end()
  } catch { /* ignore */ }
  await new Promise(resolve => setTimeout(resolve, 300))
  if (micProc) {
    try { micProc.kill() } catch { /* ignore */ }
    micProc = null
  }
  flushMicChunk()
})

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

app.whenReady().then(async () => {
  // 🚀 Автозапуск Python API
  const started = await startSalesAgent();
  if (started) {
    const ready = await waitForSalesAgent(20, 1000);
    console.log(ready ? '[SalesAgent] ✅ API готов' : '[SalesAgent] ⚠️ API не отвечает');
  }
  createWindow()
  const viteDevUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173'
  if (process.argv.includes('--vite') || process.env.ELECTRON_DEV === '1') {
    mainWindow.loadURL(viteDevUrl)
  } else {
    const port = await startServer()
    mainWindow.loadURL(`http://127.0.0.1:${port}`)
  }
})

app.on('window-all-closed', () => {
  // Stop system audio capture
  if (loopbackProc) {
    try { loopbackProc.kill() } catch { /* ignore */ }
    loopbackProc = null
  }
  if (server) server.close()
  app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
