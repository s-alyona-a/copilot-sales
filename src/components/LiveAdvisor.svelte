<script>
  import { createEventDispatcher, onMount, onDestroy, tick } from 'svelte'
  import { connectLiveHints, createMicRecorder, createSystemAudioRecorder } from '../lib/api.js'

  const dispatch = createEventDispatcher()
  export let meeting
  export let meetingPlan = null

  // ---- Transcript state ----
  let displayedLines = []
  let transcriptText = ''   // plain text accumulation for context
  let elapsed = 0

  // ---- Advisor state ----
  let advisorCards = []
  let wsConnected = false
  let wsConnecting = false
  let wsError = ''
  let isRecording = false
  let isPaused = false
  let mic
  let systemAudio
  let hasSystemAudio = false

  // ---- Live connection ----
  let liveConnection = null
  let stopped = false

  // ---- Confirmation modal ----
  let showEndConfirm = false

  // ---- Helper: start mic recording (called when server is ready) ----
  async function startMicRecording() {
    if (mic || isRecording) return  // Already started

    mic = createMicRecorder({
      onSegment(base64Audio) {
        if (liveConnection && !stopped && !isPaused) {
          liveConnection.sendAudio(base64Audio, 'mic')
        }
      },
    })
    const micOk = await mic.start()
    if (!micOk) {
      toast('Не удалось запустить микрофон', 'error')
      return
    }
    isRecording = true
    dispatch('recordingChange', { isRecording: true })
    toast('Запись начата', 'success')
  }

  // ---- Auto-scroll ----
  let transcriptScrollEl

  // ---- Timers ----
  let elapsedTimer

  // ---- Trigger keywords for local fast layer ----
  function detectTrigger(text) {
    const lower = text.toLowerCase()
    if (/цен[аеуы]|стоимость|бюджет|дорого|дешев|скидк|тариф|оплат|рассрочк/.test(lower)) return 'warning'
    if (/подумаем|не подход|не готов|не уверен|сомнев|слишком|не устраив|отлож|позже/.test(lower)) return 'warning'
    if (/конкурент|sap|1с|альтернатив|другой поставщик|другое предложение/.test(lower)) return 'warning'
    if (/демо|внедрен|пилот|договор|контракт|давайте попробу|когда можем начать/.test(lower)) return 'tactical'
    if (/интеграц|апи|api|как работает|можно ли|поддержив/.test(lower)) return 'analytical'
    return null
  }

  const typeColors = { tactical: '#10b981', strategic: '#6366f1', warning: '#ef4444', analytical: '#f59e0b' }
  const typeLabels = { tactical: 'Действие', strategic: 'Стратегия', warning: 'Внимание', analytical: 'Инсайт' }
  const typeIcons = { tactical: '⚡', strategic: '🧭', warning: '⚠️', analytical: '💡' }

  // ---- Auto-scroll logic (newest on top) ----
  async function scrollToTop() {
    if (userScrolledDown || !transcriptScrollEl) return
    await tick()
    transcriptScrollEl.scrollTop = 0
  }

  let userScrolledDown = false

  function handleScroll() {
    if (!transcriptScrollEl) return
    userScrolledDown = transcriptScrollEl.scrollTop > 60
  }

  function scrollToLatest() {
    userScrolledDown = false
    scrollToTop()
  }

  // ---- Toast helper ----
  function toast(message, type = 'info') {
    dispatch('toast', { message, type })
  }

  async function startLiveSession() {
    wsConnecting = true
    wsError = ''
    stopped = false
    isPaused = false

    try {
      liveConnection = await connectLiveHints({
        onTranscript(msg) {
          console.log('[LiveHints] Transcript:', msg)
          const speaker = msg.speaker === 'user' ? 'Менеджер' : 'Клиент'
          const prefix = msg.speaker === 'user' ? '[Вы]:' : '[Оппонент]:'
          const text = msg.text?.trim()
          if (!text) return

          displayedLines = [{ speaker, text, ts: Date.now() }, ...displayedLines]
          transcriptText += `${prefix} ${text}\n`
          scrollToTop()

          // Local fast layer trigger detection
          const trigger = detectTrigger(text)
          if (trigger) {
            const loadingId = `loading-${Date.now()}`
            const shortText = text.length > 60 ? text.slice(0, 60) + '…' : text
            advisorCards = [{
              id: loadingId,
              type: trigger,
              title: typeLabels[trigger],
              advice: `${typeIcons[trigger]} «${shortText}» — генерирую совет…`,
              source: 'Быстрый слой · Локально',
              fresh: true,
              loading: true,
              ts: Date.now(),
            }, ...advisorCards].slice(0, 10)

            // Auto-remove stale loading card after 10s
            setTimeout(() => {
              advisorCards = advisorCards.filter(c => c.id !== loadingId)
            }, 10000)
          }
        },
        onHint(msg) {
          const legacyMap = { argumentative: 'tactical', navigational: 'strategic' }
          const hintType = legacyMap[msg.hint_type] || msg.hint_type || 'tactical'
          const priorityLabels = { critical: 'Критично', high: 'Важно', medium: 'Совет', low: 'Инфо' }
          const prioLabel = priorityLabels[msg.priority] || msg.priority || 'Совет'

          advisorCards = [{
            type: hintType,
            title: typeLabels[hintType] || hintType,
            advice: msg.text,
            source: `${prioLabel} · Live Advisor`,
            rationale: msg.rationale || '',
            fresh: true,
            hintId: msg.hint_id,
            ts: Date.now(),
          }, ...advisorCards.filter(c => !c.loading)].slice(0, 10)
        },
        onStatus(msg) {
          console.log('[LiveHints] Status:', msg.status, msg)
          if (msg.status === 'ready') {
            wsConnected = true
            wsConnecting = false
            toast('WebSocket подключен', 'success')
            // Start mic recording now that server is ready
            startMicRecording()
          } else if (msg.status === 'processing') {
            // Server is busy processing previous chunk
          } else if (msg.status === 'silent_chunk') {
            // No speech detected in chunk
          } else if (msg.status === 'disconnected') {
            wsConnected = false
            if (!stopped) {
              toast('Соединение потеряно', 'error')
            }
          }
        },
        onError(msg) {
          console.error('[LiveHints] Error:', msg)
          wsError = msg.message || 'WebSocket error'
          wsConnecting = false
          toast(wsError, 'error')
        },
      })

      // Send session config — mic will start when server sends 'ready' status
      const clientCtx = meeting
        ? `Клиент: ${meeting.client}. Контакт: ${meeting.contact}. Тема: ${meeting.topic}.`
        : ''
      liveConnection.sendConfig('sales', clientCtx)

      // Note: DO NOT set wsConnected here! Wait for 'ready' from server (see onStatus)
      // Mic recording will start in onStatus when ready is received

      // Timeout: if server doesn't send 'ready' within 10 seconds, show error
      setTimeout(() => {
        if (!wsConnected && wsConnecting) {
          wsConnecting = false
          wsError = 'Сервер не подтвердил готовность (timeout)'
          toast(wsError, 'error')
        }
      }, 10000)

    } catch (e) {
      wsError = e.message || 'Connection failed'
      wsConnecting = false
      wsConnected = false
      toast(wsError, 'error')
    }
  }

  async function enableSystemAudio() {
    if (systemAudio || !liveConnection) return
    systemAudio = createSystemAudioRecorder({
      onSegment(base64Audio) {
        if (liveConnection && !stopped && !isPaused) {
          liveConnection.sendAudio(base64Audio, 'tab')
        }
      },
      segmentIntervalMs: 6000,
    })
    hasSystemAudio = await systemAudio.start()
    if (hasSystemAudio) {
      toast('Захват системного звука включён', 'success')
    } else {
      toast('Не удалось захватить системный звук', 'warning')
    }
  }

  function togglePause() {
    isPaused = !isPaused
    if (isPaused) {
      toast('Запись на паузе', 'warning')
    } else {
      toast('Запись продолжена', 'success')
    }
  }

  function requestEndMeeting() {
    showEndConfirm = true
  }

  function cancelEndMeeting() {
    showEndConfirm = false
  }

  function confirmEndMeeting() {
    showEndConfirm = false
    stopLiveSession()
  }

  function stopLiveSession() {
    isRecording = false
    isPaused = false
    stopped = true
    hasSystemAudio = false
    if (liveConnection) { liveConnection.close(); liveConnection = null }
    if (mic) { mic.stop(); mic = null }
    if (systemAudio) { systemAudio.stop(); systemAudio = null }
    wsConnected = false
    dispatch('recordingChange', { isRecording: false })
    dispatch('endMeeting', { transcript: transcriptText, displayedLines, elapsed })
  }

  onMount(() => {
    elapsedTimer = setInterval(() => {
      if (!isPaused && isRecording) elapsed++
    }, 1000)
    freshnessTicker = setInterval(() => { now = Date.now() }, 5000)
    if (meeting) {
      startLiveSession()
    }
  })

  onDestroy(() => {
    clearInterval(elapsedTimer)
    clearInterval(freshnessTicker)
    stopped = true
    if (liveConnection) liveConnection.close()
    if (mic) mic.stop()
    if (systemAudio) systemAudio.stop()
  })

  function sendFeedback(card, direction) {
    if (!liveConnection || !card.hintId) return
    const rating = direction === 'up' ? 1 : -1
    liveConnection.sendHintFeedback(card.hintId, rating)
    card.feedback = direction
    advisorCards = advisorCards
  }

  // ---- Freshness ticker for hint cards ----
  let now = Date.now()
  let freshnessTicker

  function fmtAgo(ts) {
    if (!ts) return ''
    const sec = Math.floor((now - ts) / 1000)
    if (sec < 10) return 'сейчас'
    if (sec < 60) return `${sec}с назад`
    const min = Math.floor(sec / 60)
    return `${min}м назад`
  }

  function fmtElapsed(s) {
    const m   = Math.floor(s / 60).toString().padStart(2, '0')
    const sec = (s % 60).toString().padStart(2, '0')
    return `${m}:${sec}`
  }
</script>

<div class="live-layout">
  <!-- Left: transcript -->
  <div class="transcript-panel">
    <div class="panel-head">
      <div class="live-indicator">
        {#if wsConnected && !isPaused}
          <span class="live-dot"></span> В ЭФИРЕ
        {:else if isPaused}
          <span class="live-dot paused"></span> ПАУЗА
        {:else if wsConnecting}
          <span class="live-dot connecting"></span> ПОДКЛЮЧЕНИЕ...
        {:else}
          <span class="live-dot offline"></span> ОФЛАЙН
        {/if}
      </div>

      <!-- Large timer -->
      <div class="elapsed-timer" class:paused={isPaused}>{fmtElapsed(elapsed)}</div>

      <div class="head-actions">
        {#if wsConnected || isRecording}
          <button class="pause-btn" on:click={togglePause} disabled={!isRecording}>
            {isPaused ? '▶ Продолжить' : '⏸ Пауза'}
          </button>
          <button class="end-btn" on:click={requestEndMeeting}>
            ⏹ Завершить
          </button>
        {:else}
          <button class="start-btn" on:click={startLiveSession} disabled={wsConnecting || !meeting}>
            {wsConnecting ? 'Подключение...' : '▶ Начать'}
          </button>
        {/if}
      </div>
    </div>

    <div class="meeting-meta-bar">
      <strong>{meeting?.client ?? '—'}</strong>
      <span>·</span>
      <span>{meeting?.contact ?? ''}</span>
    </div>

    <!-- WS disconnect banner -->
    {#if wsError}
      <div class="ws-error-banner">
        <span>⚠️ {wsError}</span>
        <button class="retry-btn" on:click={startLiveSession}>Переподключить</button>
      </div>
    {/if}

    <!-- System audio enable (prominent) -->
    {#if isRecording && !hasSystemAudio && !isPaused}
      <button class="sys-audio-prominent" on:click={enableSystemAudio}>
        🔊 Включить звук собеседника (WASAPI)
      </button>
    {/if}

    <div class="transcript-scroll" bind:this={transcriptScrollEl} on:scroll={handleScroll}>
      {#if displayedLines.length === 0}
        <div class="waiting">
          {#if !meeting}
            <span class="listening-label">Выберите встречу на экране «Подготовка», затем нажмите «Начать»</span>
          {:else if wsConnecting}
            <span class="wave"></span><span class="wave"></span><span class="wave"></span>
            <span class="listening-label">Подключение к DialogScribe...</span>
          {:else if wsConnected}
            <span class="wave"></span><span class="wave"></span><span class="wave"></span>
            <span class="listening-label">Слушаю микрофон...</span>
          {:else}
            <span class="listening-label">Нажмите «Начать» для подключения</span>
          {/if}
        </div>
      {:else}
        {#if wsConnected && !isPaused}
          <div class="listening">
            <span class="wave"></span><span class="wave"></span><span class="wave"></span>
            <span class="listening-label">Слушаю…</span>
          </div>
        {/if}
        {#each displayedLines as line}
          <div class="line" class:manager={line.speaker === 'Менеджер'}>
            <span class="speaker">{line.speaker}</span>
            <span class="text">{line.text}</span>
          </div>
        {/each}
      {/if}
    </div>

    <!-- Scroll to latest button -->
    {#if userScrolledDown && displayedLines.length > 0}
      <button class="scroll-top-btn" on:click={scrollToLatest}>
        ↑ К последним репликам
      </button>
    {/if}

    <div class="audio-bar">
      <div class="audio-label">
        {#if isRecording}
          🎤 Микрофон{#if hasSystemAudio} + 🔊 Звук системы{/if}
        {:else}
          🎤 Микрофон
        {/if}
      </div>
      {#if isRecording}
        <div class="audio-vis" class:vis-paused={isPaused}>
          {#each Array(18) as _, i}
            <div class="bar" style="animation-delay:{i * 0.07}s"></div>
          {/each}
        </div>
      {/if}
      <div class="audio-label">
        {#if hasSystemAudio}
          🎤 [Вы] · 🔊 [Клиент]
        {:else}
          🎤 [Вы] · нажмите кнопку для [Клиент]
        {/if}
      </div>
    </div>
  </div>

  <!-- Right: Live Advisor tips -->
  <div class="advisor-panel">
    <div class="advisor-header">
      <div class="advisor-title">⚡ Live Advisor Agent</div>
      <div class="advisor-sub">
        {#if wsConnecting}
          <span class="fetching">⟳ Подключение к WebSocket...</span>
        {:else if wsConnected}
          Советы через DialogScribe Live Hints
        {:else}
          Не подключено
        {/if}
      </div>
    </div>

    <!-- Honest Shared Memory chip -->
    <div class="memory-chip">
      <span>🧠 Shared Memory:</span>
      {#if meeting}
        <span class="memory-val loaded">Профиль «{meeting.client}» загружен</span>
      {:else}
        <span class="memory-empty">Не загружен — выберите встречу</span>
      {/if}
    </div>

    {#if advisorCards.length === 0}
      <div class="waiting-tips">
        <div class="waiting-icon">👂</div>
        <p>Анализирую диалог…</p>
        <p class="hint">Триггеры: цена · возражение · конкурент · покупательский сигнал · потребность<br/>Layer 0 → regex, Layer 1 → LLM-классификатор, Layer 2 → LLM-советник</p>
      </div>
    {:else}
      <div class="tips-list">
        {#each advisorCards as card}
          <div
            class="tip-card"
            class:tip-loading={card.loading}
            class:tip-stale={card.ts && (now - card.ts) > 90000}
            style="border-color:{typeColors[card.type] || '#3b82f6'}33; background:{typeColors[card.type] || '#3b82f6'}0a"
          >
            <div class="tip-header">
              <span class="tip-badge" style="background:{typeColors[card.type] || '#3b82f6'}22; color:{typeColors[card.type] || '#3b82f6'}">
                {typeIcons[card.type] || ''} {typeLabels[card.type] || card.type}
              </span>
              {#if card.ts}
                <span class="tip-ago" class:tip-ago-fresh={card.ts && (now - card.ts) < 15000}>
                  {fmtAgo(card.ts)}
                </span>
              {/if}
            </div>
            <p class="tip-advice">{card.advice}</p>
            {#if card.rationale}
              <p class="tip-rationale">{card.rationale}</p>
            {/if}
            <div class="tip-footer">
              <span class="tip-source">{card.source}</span>
              {#if card.hintId && liveConnection}
                <div class="tip-feedback">
                  <button class="fb-btn fb-up" class:fb-selected={card.feedback === 'up'}
                    on:click={() => sendFeedback(card, 'up')}>👍</button>
                  <button class="fb-btn fb-down" class:fb-selected={card.feedback === 'down'}
                    on:click={() => sendFeedback(card, 'down')}>👎</button>
                </div>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    {/if}

    <div class="cascade-info">
      <div class="cascade-row">
        <span class="cascade-label">Layer 0 · Фронт</span>
        <span class="cascade-status" class:active={wsConnected}>
          Триггеры (regex) · {wsConnected ? 'активен' : 'ожидает'}
        </span>
      </div>
      <div class="cascade-row">
        <span class="cascade-label">Layer 1 · Классификатор</span>
        <span class="cascade-status" class:active={advisorCards.some(c => !c.loading)}>
          LLM fast · {advisorCards.some(c => !c.loading) ? 'активен' : 'ожидает'}
        </span>
      </div>
      <div class="cascade-row">
        <span class="cascade-label">Layer 2 · Советник</span>
        <span class="cascade-status" class:active={advisorCards.some(c => !c.loading && c.rationale)}>
          LLM strong · {advisorCards.some(c => !c.loading && c.rationale) ? 'активен' : 'ожидает'}
        </span>
      </div>
      <div class="cascade-row">
        <span class="cascade-label">DialogScribe</span>
        <span class="cascade-status" class:active={wsConnected}>
          {wsConnected ? '🟢 Подключен' : wsConnecting ? '🟡 Подключение' : '🔴 Офлайн'}
        </span>
      </div>
    </div>
  </div>
</div>

<!-- End meeting confirmation modal -->
<!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
{#if showEndConfirm}
  <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
  <div class="modal-overlay" on:click={cancelEndMeeting}>
    <!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
    <div class="modal" on:click|stopPropagation>
      <div class="modal-icon">⏹</div>
      <h3 class="modal-title">Завершить звонок?</h3>
      <p class="modal-text">
        {#if displayedLines.length > 0}
          Транскрипт ({displayedLines.length} реплик, {fmtElapsed(elapsed)}) будет сохранён для анализа.
        {:else}
          Транскрипт пуст — данных для анализа не будет.
        {/if}
      </p>
      <div class="modal-actions">
        <button class="btn btn-secondary" on:click={cancelEndMeeting}>Отмена</button>
        <button class="btn btn-danger" on:click={confirmEndMeeting}>Завершить</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .live-layout {
    display: grid;
    grid-template-columns: 1fr 380px;
    gap: 24px;
    height: 100%;
  }

  /* Transcript */
  .transcript-panel {
    background: #161b27;
    border: 1px solid #1e2535;
    border-radius: 16px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .panel-head {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 14px 20px;
    border-bottom: 1px solid #1e2535;
    flex-shrink: 0;
  }

  .live-indicator {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    font-weight: 700;
    color: #ef4444;
    letter-spacing: 0.5px;
    flex-shrink: 0;
  }

  .live-dot {
    width: 8px; height: 8px;
    border-radius: 50%;
    background: #ef4444;
    animation: pulse 1.2s ease-in-out infinite;
  }
  .live-dot.connecting { background: #f59e0b }
  .live-dot.offline { background: #4b5a7a; animation: none }
  .live-dot.paused { background: #f59e0b; animation: none }

  @keyframes pulse {
    0%, 100% { opacity: 1; transform: scale(1) }
    50%       { opacity: 0.5; transform: scale(0.8) }
  }

  .elapsed-timer {
    font-size: 28px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: #e8eaed;
    flex: 1;
    text-align: center;
    letter-spacing: 2px;
    line-height: 1;
  }
  .elapsed-timer.paused { color: #f59e0b }

  .head-actions {
    display: flex;
    gap: 6px;
    flex-shrink: 0;
  }

  .pause-btn {
    padding: 6px 12px;
    background: rgba(245, 158, 11, 0.15);
    border: 1px solid rgba(245, 158, 11, 0.3);
    color: #fbbf24;
    border-radius: 8px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
  }
  .pause-btn:hover { background: rgba(245, 158, 11, 0.25) }
  .pause-btn:disabled { opacity: 0.4; cursor: not-allowed }

  .end-btn {
    padding: 6px 14px;
    background: rgba(239,68,68,0.15);
    border: 1px solid rgba(239,68,68,0.3);
    color: #f87171;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
  }
  .end-btn:hover { background: rgba(239,68,68,0.25) }

  .start-btn {
    padding: 6px 14px;
    background: rgba(16,185,129,0.15);
    border: 1px solid rgba(16,185,129,0.3);
    color: #34d399;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
  }
  .start-btn:hover { background: rgba(16,185,129,0.25) }
  .start-btn:disabled { opacity: 0.5; cursor: not-allowed }

  .meeting-meta-bar {
    padding: 8px 20px;
    font-size: 12px;
    color: #4b5a7a;
    border-bottom: 1px solid #1e2535;
    display: flex;
    gap: 6px;
    flex-shrink: 0;
  }
  .meeting-meta-bar strong { color: #6b7db3 }

  .ws-error-banner {
    padding: 10px 20px;
    background: rgba(239,68,68,0.08);
    border-bottom: 1px solid rgba(239,68,68,0.2);
    font-size: 12px;
    color: #f87171;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    flex-shrink: 0;
  }
  .retry-btn {
    padding: 3px 10px;
    background: rgba(239,68,68,0.15);
    border: 1px solid rgba(239,68,68,0.3);
    color: #f87171;
    border-radius: 4px;
    font-size: 11px;
    cursor: pointer;
  }

  .sys-audio-prominent {
    padding: 10px 20px;
    background: rgba(59,130,246,0.08);
    border: none;
    border-bottom: 1px solid rgba(59,130,246,0.2);
    color: #60a5fa;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    text-align: center;
    transition: all 0.15s;
    flex-shrink: 0;
  }
  .sys-audio-prominent:hover { background: rgba(59,130,246,0.15) }

  .transcript-scroll {
    flex: 1;
    overflow-y: auto;
    padding: 16px 20px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .line {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 10px 14px;
    background: #1e2535;
    border-radius: 10px;
    border-left: 3px solid #2d3a56;
    animation: fadeUp 0.3s ease;
  }
  .line.manager {
    border-left-color: #3b82f6;
    background: rgba(59,130,246,0.07);
  }

  @keyframes fadeUp {
    from { opacity: 0; transform: translateY(6px) }
    to   { opacity: 1; transform: translateY(0) }
  }

  .speaker {
    font-size: 11px;
    font-weight: 600;
    color: #4b5a7a;
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }
  .line.manager .speaker { color: #3b82f6 }
  .text { font-size: 14px; color: #c8d0e7; line-height: 1.5 }

  .listening {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 8px 14px;
    color: #4b5a7a;
    font-size: 13px;
  }
  .listening-label { margin-left: 4px }

  .waiting {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    padding: 20px 14px;
    color: #4b5a7a;
    font-size: 13px;
  }

  .wave {
    display: inline-block;
    width: 4px; height: 4px;
    background: #4b5a7a;
    border-radius: 50%;
    animation: bounce 1.2s ease-in-out infinite;
  }
  .wave:nth-child(2) { animation-delay: 0.2s }
  .wave:nth-child(3) { animation-delay: 0.4s }

  @keyframes bounce {
    0%, 80%, 100% { transform: scale(0) }
    40%           { transform: scale(1) }
  }

  .scroll-top-btn {
    position: absolute;
    top: 160px;
    left: 50%;
    transform: translateX(-50%);
    padding: 6px 14px;
    background: rgba(59,130,246,0.2);
    border: 1px solid rgba(59,130,246,0.3);
    color: #60a5fa;
    border-radius: 20px;
    font-size: 12px;
    cursor: pointer;
    z-index: 10;
    transition: all 0.15s;
  }
  .scroll-top-btn:hover { background: rgba(59,130,246,0.3) }

  .audio-bar {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 20px;
    border-top: 1px solid #1e2535;
    flex-shrink: 0;
  }
  .audio-label { font-size: 11px; color: #4b5a7a; white-space: nowrap }
  .audio-vis { display: flex; align-items: center; gap: 2px; flex: 1 }
  .audio-vis.vis-paused .bar { animation-play-state: paused; opacity: 0.3 }
  .bar {
    width: 3px;
    background: #3b82f6;
    border-radius: 2px;
    opacity: 0.6;
    height: 12px;
    animation: audioBar 0.8s ease-in-out infinite alternate;
  }
  @keyframes audioBar {
    from { transform: scaleY(0.3) }
    to   { transform: scaleY(1) }
  }

  /* Advisor panel */
  .advisor-panel {
    background: #161b27;
    border: 1px solid #1e2535;
    border-radius: 16px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .advisor-header {
    padding: 16px 20px;
    border-bottom: 1px solid #1e2535;
    flex-shrink: 0;
  }
  .advisor-title { font-size: 15px; font-weight: 600; color: #e8eaed }
  .advisor-sub { font-size: 12px; color: #4b5a7a; margin-top: 2px }
  .fetching { color: #f59e0b; animation: blink 1s ease-in-out infinite }
  @keyframes blink { 0%, 100% { opacity: 1 } 50% { opacity: 0.4 } }

  .memory-chip {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 20px;
    border-bottom: 1px solid #1e2535;
    font-size: 12px;
    color: #4b5a7a;
    flex-shrink: 0;
  }
  .memory-val { color: #10b981; font-weight: 500 }
  .memory-empty { color: #4b5a7a; font-style: italic }

  .waiting-tips {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 24px;
    color: #4b5a7a;
    font-size: 14px;
    text-align: center;
  }
  .waiting-icon { font-size: 32px; margin-bottom: 8px }
  .hint { font-size: 12px; color: #2d3a56; line-height: 1.6 }

  .tips-list {
    flex: 1;
    overflow-y: auto;
    padding: 12px 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .tip-card {
    padding: 12px 14px;
    border-radius: 10px;
    border: 1px solid;
    animation: slideIn 0.35s ease;
  }
  .tip-card.tip-loading { opacity: 0.6 }
  .tip-card.tip-stale { opacity: 0.4 }

  @keyframes slideIn {
    from { opacity: 0; transform: translateX(10px) }
    to   { opacity: 1; transform: translateX(0) }
  }

  .tip-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }
  .tip-badge {
    font-size: 10px;
    font-weight: 700;
    padding: 2px 7px;
    border-radius: 4px;
    text-transform: uppercase;
    letter-spacing: 0.4px;
  }
  .tip-ago {
    font-size: 10px;
    color: #4b5a7a;
    margin-left: auto;
    flex-shrink: 0;
  }
  .tip-ago-fresh { color: #10b981 }
  .tip-advice { font-size: 13px; color: #c8d0e7; line-height: 1.5; margin-bottom: 6px }
  .tip-rationale { font-size: 11px; color: #4b5a7a; line-height: 1.4; margin-bottom: 8px; font-style: italic }
  .tip-footer { display: flex; align-items: center; justify-content: space-between }
  .tip-source { font-size: 11px; color: #2d3a56 }
  .tip-feedback { display: flex; gap: 4px }
  .fb-btn {
    padding: 2px 6px;
    background: transparent;
    border: 1px solid #1e2535;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
    opacity: 0.5;
    transition: all 0.15s;
  }
  .fb-btn:hover { opacity: 1; background: #1e2535 }
  .fb-btn.fb-selected { opacity: 1; border-color: #3b82f6 }

  .cascade-info {
    padding: 12px 16px;
    border-top: 1px solid #1e2535;
    display: flex;
    flex-direction: column;
    gap: 6px;
    flex-shrink: 0;
  }
  .cascade-row { display: flex; align-items: center; justify-content: space-between; font-size: 11px }
  .cascade-label { color: #4b5a7a }
  .cascade-status { color: #2d3a56; font-weight: 500; transition: color 0.3s }
  .cascade-status.active { color: #10b981 }

  /* Confirmation modal */
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    z-index: 9999;
    display: flex;
    align-items: center;
    justify-content: center;
    animation: fadeIn 0.15s ease;
  }
  @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }

  .modal {
    background: #161b27;
    border: 1px solid #252e42;
    border-radius: 16px;
    padding: 28px 32px;
    max-width: 380px;
    text-align: center;
    animation: modalIn 0.2s ease;
  }
  @keyframes modalIn { from { transform: scale(0.95); opacity: 0 } to { transform: scale(1); opacity: 1 } }

  .modal-icon { font-size: 36px; margin-bottom: 12px }
  .modal-title { font-size: 18px; font-weight: 600; color: #e8eaed; margin-bottom: 8px }
  .modal-text { font-size: 13px; color: #8896b3; line-height: 1.5; margin-bottom: 20px }

  .modal-actions { display: flex; gap: 10px; justify-content: center }

  .btn {
    padding: 8px 20px;
    border-radius: 8px;
    border: none;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
  }
  .btn-secondary {
    background: #1e2535;
    color: #c8d0e7;
    border: 1px solid #252e42;
  }
  .btn-secondary:hover { background: #252e42 }
  .btn-danger {
    background: rgba(239,68,68,0.2);
    color: #f87171;
    border: 1px solid rgba(239,68,68,0.3);
  }
  .btn-danger:hover { background: rgba(239,68,68,0.3) }
</style>
