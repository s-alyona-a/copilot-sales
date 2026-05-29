/**
 * DialogScribe API client
 */

/* global window */

/** @type {any} */
const _win = typeof window !== 'undefined' ? window : {}

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? ''
const API_KEY  = import.meta.env.VITE_API_KEY ?? ''
const DS_EMAIL = import.meta.env.VITE_DS_EMAIL ?? 'admin@local.dev'
const DS_PASS  = import.meta.env.VITE_DS_PASSWORD ?? 'admin123'

// ---------------------------------------------------------------------------
// Auth — auto-login with token cache + 401 retry
// ---------------------------------------------------------------------------

let _token = ''
let _loginPromise = null

async function ensureToken() {
  if (_token) return
  if (_loginPromise) { await _loginPromise; return }

  _loginPromise = (async () => {
    try {
      console.log('[Auth] Logging in with:', DS_EMAIL)
      const res = await fetch(`${BASE_URL}/api/auth/login`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body:    JSON.stringify({ login: DS_EMAIL, password: DS_PASS }),
      })
      if (res.ok) {
        const data = await res.json()
        _token = data.access_token
        console.log('[Auth] Login successful, token length:', _token?.length)
      } else {
        console.error('[Auth] Login failed:', res.status, res.statusText)
      }
    } catch (e) {
      console.error('[Auth] Login error:', e)
      // network error — leave _token empty, calls will fail with real error
    } finally {
      _loginPromise = null
    }
  })()

  return _loginPromise
}

function authHeader() {
  if (_token)   return { Authorization: `Bearer ${_token}` }
  if (API_KEY)  return { Authorization: `Bearer ${API_KEY}` }
  return {}
}

async function apiFetch(path, options = {}) {
  await ensureToken()

  const makeHeaders = () => ({
    Accept: 'application/json',
    ...authHeader(),
    ...options.headers,
  })

  const doFetch = (hdrs) =>
    fetch(`${BASE_URL}${path}`, { ...options, headers: hdrs })

  let res = await doFetch(makeHeaders())

  // Token expired — re-login and retry once
  if (res.status === 401) {
    _token = ''
    await ensureToken()
    res = await doFetch(makeHeaders())
  }

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`API ${path} → ${res.status}: ${text}`)
  }

  const ct = res.headers.get('content-type') ?? ''
  return ct.includes('application/json') ? res.json() : res.text()
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

export async function checkHealth() {
  try {
    const res = await fetch(`${BASE_URL}/health`)
    return res.ok
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

export async function getModels() {
  const data = await apiFetch('/api/models')
  if (Array.isArray(data))   return data
  if (data?.models)          return data.models.map(m => m.id ?? m)
  return []
}

// ---------------------------------------------------------------------------
// Transcription
// ---------------------------------------------------------------------------

/**
 * POST /api/transcribe
 * @param {File} file
 * @param {{ language?: string, diarize?: boolean }} opts
 */
export async function transcribeFile(file, opts = {}) {
  const fd = new FormData()
  fd.append('file', file)
  if (opts.language) fd.append('language', opts.language)
  // diarization_mode values: none | simple (hybrid) | advanced (pyannote)
  fd.append('diarization_mode', opts.diarize !== false ? 'simple' : 'none')

  // No Content-Type — browser sets multipart boundary automatically
  const data = await apiFetch('/api/transcribe', {
    method:  'POST',
    headers: { Accept: 'application/json', ...authHeader() },
    body:    fd,
  })
  return normaliseTranscript(data)
}

/**
 * POST /v1/audio/transcriptions  (OpenAI-compatible, no JWT required)
 */
export async function transcribeOpenAI(file, language = 'ru') {
  const fd = new FormData()
  fd.append('file', file)
  fd.append('model', 'voxtral')
  fd.append('language', language)

  return apiFetch('/v1/audio/transcriptions', { method: 'POST', body: fd })
}

function normaliseTranscript(raw) {
  return {
    text:     raw.text ?? raw.transcript ?? '',
    segments: raw.segments ?? [],
    speakers: raw.speakers ?? [],
    duration: raw.duration ?? null,
    language: raw.language ?? null,
  }
}

// ---------------------------------------------------------------------------
// Analysis
// ---------------------------------------------------------------------------

/**
 * POST /api/summary
 * Returns { summary, summary_markdown, summary_html }
 */
export async function getSummary(transcript, opts = {}) {
  const data = await apiFetch('/api/summary', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      text: transcript,
      ...(opts.model        ? { model:        opts.model        } : {}),
      ...(opts.template_key ? { template_key: opts.template_key } : {}),
    }),
  })
  // Backend returns { summary_markdown, summary_html } — normalise to { summary }
  return {
    ...data,
    summary: data?.summary_markdown ?? data?.summary ?? String(data),
  }
}

/**
 * POST /api/insights
 */
export async function getInsights(transcript, opts = {}) {
  return apiFetch('/api/insights', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      text: transcript,
      ...(opts.model ? { model: opts.model } : {}),
    }),
  })
}

/**
 * POST /api/mindmap
 */
export async function getMindmap(transcript) {
  return apiFetch('/api/mindmap', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ text: transcript }),
  })
}

// ---------------------------------------------------------------------------
// Meeting Prep
// ---------------------------------------------------------------------------

/**
 * POST /api/meeting-prep
 * @param {{ companyData: string, catalogData: string, model?: string }} params
 * @returns {Promise<{ id: string, markdown: string, model: string }>}
 */
export async function generateMeetingPrep({ companyData, catalogData, model }) {
  return apiFetch('/api/meeting-prep', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      company_data:  companyData,
      catalog_data:  catalogData,
      ...(model ? { model } : {}),
    }),
  })
}

// ---------------------------------------------------------------------------
// Chat (Live Advisor)
// ---------------------------------------------------------------------------

/**
 * POST /api/chat
 * DialogScribe expects: { text, messages: [{role, content}] }
 * Returns: { answer }
 *
 * @param {{ message: string, context?: string, system?: string, model?: string, history?: Array }} params
 * @returns {Promise<{ response: string }>}
 */
export async function chat(params) {
  const messages = []
  messages.push({ role: 'system', content: params.system ?? LIVE_ADVISOR_SYSTEM_PROMPT })
  if (params.history?.length) messages.push(...params.history)
  messages.push({ role: 'user', content: params.message })

  const data = await apiFetch('/api/chat', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      text:     params.context ?? '',
      messages,
      ...(params.model ? { model: params.model } : {}),
    }),
  })

  // Backend returns { answer } — normalise to { response }
  return {
    response: data?.answer ?? data?.response ?? data?.content ?? String(data),
  }
}

const LIVE_ADVISOR_SYSTEM_PROMPT = `Ты — ассистент менеджера B2B-продаж в реальном времени.
Твоя задача — давать краткие, конкретные советы на основе фрагментов диалога с клиентом.
Отвечай на русском. Максимум 3 предложения. Будь конкретен — ссылайся на слова клиента.
Если фрагмент нейтральный и не требует совета, ответь "—".`

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export async function exportTranscript(transcript, format = 'docx') {
  const res = await fetch(`${BASE_URL}/api/export`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...authHeader() },
    body:    JSON.stringify({ text: transcript, format }),
  })
  if (!res.ok) throw new Error(`Export failed: ${res.status}`)
  const blob = await res.blob()
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = `transcript.${format}`
  a.click()
  URL.revokeObjectURL(url)
}

// ---------------------------------------------------------------------------
// Live Advisor — WebSocket
// ---------------------------------------------------------------------------

/**
 * Connect to the DialogScribe Live Hints WebSocket.
 *
 * @param {{ onTranscript: (msg: object) => void, onHint: (msg: object) => void, onStatus: (msg: object) => void, onError: (msg: object) => void }} handlers
 * @returns {Promise<{ ws: WebSocket, sendAudio: (base64: string, source: string) => void, sendConfig: (templateKey: string, contextText?: string) => void, close: () => void }>}
 */
export async function connectLiveHints({ onTranscript, onHint, onStatus, onError }) {
  await ensureToken()

  const wsUrl = BASE_URL
    ? BASE_URL.replace(/^http/, 'ws') + '/api/live-hints/ws?token=' + encodeURIComponent(_token)
    : `ws://${location.host}/api/live-hints/ws?token=${encodeURIComponent(_token)}`

  console.log('[LiveHints] Connecting to:', wsUrl.replace(/token=[^&]+/, 'token=***'))

  const ws = new WebSocket(wsUrl)

  return new Promise((resolve, reject) => {
    ws.addEventListener('open', () => {
      console.log('[LiveHints] WebSocket opened')
      resolve({
        ws,
        sendConfig(templateKey, contextText = '') {
          const payload = {
            type: 'session_config',
            template_key: templateKey,
            context_text: contextText,
          }
          console.log('[LiveHints] Sending config:', payload)
          ws.send(JSON.stringify(payload))
        },
        sendAudio(base64, source = 'mic') {
          console.log('[LiveHints] Sending audio chunk:', source, 'size:', base64?.length)
          ws.send(JSON.stringify({
            type: 'audio_chunk',
            audio_b64: base64,
            source,
          }))
        },
        sendHintFeedback(hintId, rating) {
          ws.send(JSON.stringify({
            type: 'hint_feedback',
            hint_id: hintId,
            rating,
          }))
        },
        close() {
          if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
            ws.close()
          }
        },
      })
    })

    ws.addEventListener('message', (event) => {
      let msg
      try { msg = JSON.parse(event.data) } catch { return }
      console.log('[LiveHints] Message received:', msg)

      switch (msg.type) {
        case 'transcript':
          onTranscript?.(msg)
          break
        case 'hint':
          onHint?.(msg)
          break
        case 'status':
          onStatus?.(msg)
          break
        case 'error':
          onError?.(msg)
          break
      }
    })

    ws.addEventListener('error', (e) => {
      console.error('[LiveHints] WebSocket error:', e)
      onError?.({ code: 'ws_error', message: 'WebSocket connection error' })
      reject(e)
    })

    ws.addEventListener('close', () => {
      console.log('[LiveHints] WebSocket closed')
      onStatus?.({ status: 'disconnected' })
    })
  })
}

/**
 * Microphone recorder.
 *
 * In Electron: uses native WASAPI capture via IPC (bypasses Chromium USB audio bug).
 * In browser: uses getUserMedia with stop-start cycling.
 *
 * @param {{ onSegment: (base64: string) => void, segmentIntervalMs?: number }} opts
 * @returns {Promise<{ start: () => Promise<boolean>, stop: () => void }>}
 */
export function createMicRecorder({ onSegment }) {
  // Electron native WASAPI mic capture
  if (_win.electronAPI?.startMic) {
    let listening = false
    return {
      async start() {
        try {
          const ok = await _win.electronAPI.startMic()
          if (!ok) {
            console.warn('WASAPI mic capture failed to start, falling back')
            return false
          }
          listening = true
          _win.electronAPI.onMicAudioChunk((b64Wav) => {
            if (listening && b64Wav) {
              onSegment(b64Wav)
            }
          })
          return true
        } catch (e) {
          console.warn('Native mic capture failed:', e.message)
          return false
        }
      },
      stop() {
        listening = false
        if (_win.electronAPI?.stopMic) _win.electronAPI.stopMic()
        if (_win.electronAPI?.removeMicListener) _win.electronAPI.removeMicListener()
      },
    }
  }

  // Browser fallback: getUserMedia
  return createMicRecorderBrowser({ onSegment })
}

/**
 * Browser fallback for mic recorder using getUserMedia stop-start cycling.
 */
function createMicRecorderBrowser({ onSegment, segmentIntervalMs = 6000 }) {
  let inner = null
  return {
    async start() {
      inner = createStopStartRecorder({
        getStream: () => navigator.mediaDevices.getUserMedia({ audio: true }),
        onSegment,
        segmentIntervalMs,
      })
      await inner.start()
      return true
    },
    stop() {
      if (inner) inner.stop()
    },
  }
}

/**
 * System audio recorder — captures what the OTHER person says (VKS, browser tab, etc).
 *
 * In Electron: uses native WASAPI loopback capture via IPC (bypasses Chromium USB audio bug).
 * The main process spawns wasapi_loopback.exe which captures system audio natively.
 *
 * In browser: uses getDisplayMedia — user must share a screen/tab with audio.
 *
 * @param {{ onSegment: (base64: string) => void, segmentIntervalMs?: number }} opts
 * @returns {Promise<{ start: () => Promise<boolean>, stop: () => void }>}
 */
export function createSystemAudioRecorder({ onSegment }) {
  let listening = false

  return {
    async start() {
      // Electron native WASAPI loopback capture
      if (_win.electronAPI?.startSystemAudio) {
        try {
          const ok = await _win.electronAPI.startSystemAudio()
          if (!ok) {
            console.warn('WASAPI loopback capture failed to start')
            return false
          }

          // Listen for audio chunks from main process
          listening = true
          _win.electronAPI.onSystemAudioChunk((b64Wav) => {
            if (listening && b64Wav) {
              onSegment(b64Wav)
            }
          })
          return true
        } catch (e) {
          console.warn('Native system audio capture failed:', e.message)
          return false
        }
      }

      // Browser fallback: getDisplayMedia
      return createBrowserSystemAudioRecorder({ onSegment })
    },
    stop() {
      listening = false
      if (_win.electronAPI?.stopSystemAudio) {
        _win.electronAPI.stopSystemAudio()
      }
      if (_win.electronAPI?.removeSystemAudioListener) {
        _win.electronAPI.removeSystemAudioListener()
      }
    },
  }
}

/**
 * Browser fallback for system audio capture using getDisplayMedia.
 */
function createBrowserSystemAudioRecorder({ onSegment, segmentIntervalMs = 6000 }) {
  let inner = null

  const recorder = createStopStartRecorder({
    getStream: async () => {
      if (_win.electronAPI?.enableLoopbackAudio) {
        await _win.electronAPI.enableLoopbackAudio()
      }
      const ds = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
      ds.getVideoTracks().forEach(t => { t.stop(); ds.removeTrack(t) })
      const audioTracks = ds.getAudioTracks()
      if (audioTracks.length === 0) {
        ds.getTracks().forEach(t => t.stop())
        throw new Error('No system audio track captured.')
      }
      return ds
    },
    onSegment,
    segmentIntervalMs,
  })

  return {
    async start() {
      try {
        await inner.start()
        return true
      } catch (e) {
        console.warn('Browser system audio capture failed:', e.message)
        return false
      }
    },
    stop() {
      inner.stop()
    },
  }
}

/**
 * Shared stop-start recorder implementation.
 * Cycles: start MediaRecorder → wait N sec → stop → collect complete WebM → callback → restart.
 *
 * Uses setTimeout per-segment instead of setInterval to avoid race conditions
 * between the timer and the async onstop handler.
 */
function createStopStartRecorder({ getStream, onSegment, segmentIntervalMs = 6000 }) {
  let stream = null
  let recorder = null
  let stopTimer = null
  let stopped = false

  function startSegment() {
    if (stopped || !stream) return

    try {
      recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' })
    } catch (e) {
      console.error('[recorder] MediaRecorder creation failed:', e)
      if (!stopped) stopTimer = setTimeout(startSegment, 1000)
      return
    }
    const segChunks = []

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) segChunks.push(e.data)
    }

    recorder.onerror = (e) => {
      console.error('[recorder] MediaRecorder error:', e.error || e)
      if (!stopped) stopTimer = setTimeout(startSegment, 1500)
    }

    recorder.onstop = () => {
      // Clear the stop timer (it already fired, but just in case)
      if (stopTimer) { clearTimeout(stopTimer); stopTimer = null }

      if (segChunks.length > 0 && !stopped) {
        const blob = new Blob(segChunks, { type: 'audio/webm;codecs=opus' })
        const reader = new FileReader()
        reader.onloadend = () => {
          const b64 = reader.result.split(',')[1]
          if (b64 && !stopped) onSegment(b64)
        }
        reader.readAsDataURL(blob)
      }
      // Restart cycle — setTimeout starts fresh, no race with previous timer
      if (!stopped) startSegment()
    }

    try {
      recorder.start()
      // Schedule stop for this segment after the interval
      stopTimer = setTimeout(() => {
        stopTimer = null
        if (recorder && recorder.state === 'recording') {
          recorder.stop()
        }
      }, segmentIntervalMs)
    } catch (e) {
      console.error('[recorder] recorder.start() failed:', e)
      if (!stopped) stopTimer = setTimeout(startSegment, 1000)
    }
  }

  return {
    async start() {
      stopped = false
      stream = await getStream()
      startSegment()
    },

    stop() {
      stopped = true
      if (stopTimer) { clearTimeout(stopTimer); stopTimer = null }
      if (recorder && recorder.state === 'recording') {
        recorder.stop()
      }
      if (stream) {
        stream.getTracks().forEach(t => t.stop())
        stream = null
      }
    },
  }
}
