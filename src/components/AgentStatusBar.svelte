<script>
  import { onMount, onDestroy } from 'svelte'
  import { checkHealth } from '../lib/api.js'
  import { checkHealth as checkAgentHealth } from '../lib/agentApi.js'

  export let activeView
  export let activeMeeting

  // ---- Agent chips ----
  const agents = [
    { id: 'orchestrator', label: 'Orchestrator', status: 'active' },
    { id: 'prep',         label: 'Prep Agent',   status: 'active' },
    { id: 'live',         label: 'Live Advisor', status: 'standby' },
    { id: 'post',         label: 'Post-Meeting', status: 'standby' },
  ]

  $: agentStates = agents.map(a => {
    if (a.id === 'orchestrator') return { ...a, status: 'active' }
    if (a.id === 'prep')  return { ...a, status: activeView === 'today' ? 'active' : 'idle' }
    if (a.id === 'live')  return { ...a, status: activeView === 'live'  ? 'active' : 'standby' }
    if (a.id === 'post')  return { ...a, status: activeView === 'post'  ? 'active' : 'standby' }
    return a
  })

  const statusLabel = { active: 'активен', standby: 'ожидание', idle: 'простой' }
  const statusColor = { active: '#10b981', standby: '#f59e0b', idle: '#4b5a7a' }

  // ---- DialogScribe health ----
  let backendStatus = 'checking'
  let healthTimer

  async function pollHealth() {
    backendStatus = 'checking'
    const ok = await checkHealth()
    backendStatus = ok ? 'online' : 'offline'
  }

  // ---- Sales Agent health ----
  let agentStatus = 'checking'

  async function pollAgentHealth() {
    agentStatus = 'checking'
    const ok = await checkAgentHealth()
    agentStatus = ok ? 'online' : 'offline'
  }

  const backendColor = { checking: '#f59e0b', online: '#10b981', offline: '#ef4444' }
  const backendLabel = { checking: 'проверка…', online: 'онлайн', offline: 'недоступен' }

  // ---- Clock ----
  let now = new Date()
  let clockTimer

  onMount(() => {
    clockTimer  = setInterval(() => now = new Date(), 1000)
    pollHealth()
    pollAgentHealth()
    healthTimer = setInterval(() => { pollHealth(); pollAgentHealth() }, 30_000)
  })

  onDestroy(() => {
    clearInterval(clockTimer)
    clearInterval(healthTimer)
  })

  function fmt(d) {
    return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  }
</script>

<header class="status-bar">
  <div class="left">
    <span class="page-title">
      {#if activeView === 'today'}📅 Подготовка встреч
      {:else if activeView === 'prep'}📋 Подготовка к встрече
      {:else if activeView === 'live'}🎙️ В эфире — {activeMeeting?.client ?? '—'}
      {:else if activeView === 'post'}📊 Итоги встречи — {activeMeeting?.client ?? '—'}
      {/if}
    </span>
  </div>

  <div class="agents-row">
    {#each agentStates as agent}
      <div class="agent-chip" class:agent-active={agent.status === 'active'}>
        <span class="dot" style="background:{statusColor[agent.status]}"></span>
        <span class="agent-name">{agent.label}</span>
        <span class="agent-status" style="color:{statusColor[agent.status]}">{statusLabel[agent.status]}</span>
      </div>
    {/each}
  </div>

  <div class="right">
    <div
      class="backend-chip"
      class:backend-online={agentStatus === 'online'}
      class:backend-offline={agentStatus === 'offline'}
      title="Sales Agent API · http://localhost:8900"
      on:click={pollAgentHealth}
      role="button"
      tabindex="0"
      on:keydown={e => e.key === 'Enter' && pollAgentHealth()}
    >
      <span
        class="dot backend-dot"
        class:checking={agentStatus === 'checking'}
        style="background:{backendColor[agentStatus]}"
      ></span>
      <span class="backend-label">Sales Agent</span>
      <span class="backend-status" style="color:{backendColor[agentStatus]}">
        {backendLabel[agentStatus]}
      </span>
    </div>
    <div
      class="backend-chip"
      class:backend-online={backendStatus === 'online'}
      class:backend-offline={backendStatus === 'offline'}
      title="DialogScribe API · {import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'}"
      on:click={pollHealth}
      role="button"
      tabindex="0"
      on:keydown={e => e.key === 'Enter' && pollHealth()}
    >
      <span
        class="dot backend-dot"
        class:checking={backendStatus === 'checking'}
        style="background:{backendColor[backendStatus]}"
      ></span>
      <span class="backend-label">DialogScribe</span>
      <span class="backend-status" style="color:{backendColor[backendStatus]}">
        {backendLabel[backendStatus]}
      </span>
    </div>
    <span class="clock">{fmt(now)}</span>
  </div>
</header>

<style>
  .status-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 28px;
    height: 56px;
    border-bottom: 1px solid #1e2535;
    background: #161b27;
    flex-shrink: 0;
    gap: 16px;
  }

  .left {
    min-width: 220px;
  }

  .page-title {
    font-size: 14px;
    font-weight: 600;
    color: #c8d0e7;
    white-space: nowrap;
  }

  .agents-row {
    display: flex;
    gap: 8px;
    flex-wrap: nowrap;
  }

  .agent-chip {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 4px 10px;
    background: #1e2535;
    border: 1px solid #252e42;
    border-radius: 20px;
    font-size: 11px;
    transition: all 0.2s;
  }

  .agent-chip.agent-active {
    border-color: rgba(16, 185, 129, 0.4);
    background: rgba(16, 185, 129, 0.08);
  }

  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .agent-name {
    color: #8896b3;
    font-weight: 500;
  }

  .agent-status {
    font-weight: 600;
  }

  .right {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-shrink: 0;
  }

  .clock {
    font-size: 13px;
    font-weight: 500;
    color: #4b5a7a;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  /* DialogScribe health chip */
  .backend-chip {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 4px 10px;
    background: #1e2535;
    border: 1px solid #252e42;
    border-radius: 20px;
    font-size: 11px;
    cursor: pointer;
    transition: all 0.2s;
    user-select: none;
  }

  .backend-chip:hover {
    border-color: #3a4a6a;
  }

  .backend-chip.backend-online {
    border-color: rgba(16, 185, 129, 0.4);
    background: rgba(16, 185, 129, 0.07);
  }

  .backend-chip.backend-offline {
    border-color: rgba(239, 68, 68, 0.4);
    background: rgba(239, 68, 68, 0.07);
  }

  .backend-dot.checking {
    animation: pulse-dot 1s ease-in-out infinite;
  }

  @keyframes pulse-dot {
    0%, 100% { opacity: 1 }
    50%       { opacity: 0.3 }
  }

  .backend-label {
    color: #8896b3;
    font-weight: 500;
  }

  .backend-status {
    font-weight: 600;
  }
</style>
