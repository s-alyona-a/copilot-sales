<script>
  import { createEventDispatcher, onMount } from 'svelte'
  import ClientDossier from './ClientDossier.svelte'
  import { fetchTodayMeetings, isCalDavConfigured } from '../lib/caldav.js'
  import { getMeetingsToday, checkHealth } from '../lib/agentApi.js'

  const dispatch = createEventDispatcher()
  export let activeMeeting
  export let savedCompanies = new Set()
  export let cardsMap = {}

  const MOCK_MEETINGS = [
    {
      id: 1,
      time: '09:30',
      duration: '60 мин',
      client: 'ООО «РусТехСнаб»',
      contact: 'Дмитрий Орлов, Директор по закупкам',
      inn: '5261103923',
      topic: 'Презентация нового логистического модуля',
      status: 'done',
      prepStatus: 'ready',
      tags: ['госзакупки', 'логистика'],
    },
    {
      id: 2,
      time: '11:00',
      duration: '45 мин',
      client: 'АО «СибирьЭнерго»',
      contact: 'Марина Белова, CFO',
      inn: '4223117100',
      topic: 'Пересмотр условий контракта Q3',
      status: 'upcoming',
      prepStatus: 'ready',
      tags: ['энергетика', 'контракт'],
    },
    {
      id: 3,
      time: '13:30',
      duration: '30 мин',
      client: 'ГУП «МосТрансАвто»',
      contact: 'Игорь Петров, Зам. директора',
      inn: '7700001122',
      topic: 'Первичная квалификация, демо продукта',
      status: 'upcoming',
      prepStatus: 'loading',
      tags: ['госсектор', 'демо'],
    },
    {
      id: 4,
      time: '15:00',
      duration: '60 мин',
      client: 'ООО «АгроИнвест»',
      contact: 'Светлана Кузьмина, ИТ-директор',
      inn: '6729047729',
      topic: 'Техническое согласование интеграции ERP',
      status: 'upcoming',
      prepStatus: 'pending',
      tags: ['агро', 'ERP', 'интеграция'],
    },
  ]

  // ---- Data source toggle ----
  let dataSource = 'mock'  // 'mock' | 'api' | 'caldav'
  let meetings = MOCK_MEETINGS
  let sourceLoading = false
  let sourceError = ''
  let caldavConfigured = isCalDavConfigured()
  let apiAvailable = false

  onMount(async () => {
    apiAvailable = await checkHealth()
    if (apiAvailable) {
      switchSource('api')
    }
  })

  async function loadApiMeetings() {
    sourceLoading = true
    sourceError = ''
    try {
      meetings = await getMeetingsToday()
      if (meetings.length === 0) {
        sourceError = 'Нет встреч на сегодня'
      }
      selectedMeeting = meetings[0] || null
    } catch (e) {
      sourceError = e.message || 'Ошибка API'
      meetings = MOCK_MEETINGS
      selectedMeeting = meetings[0] || null
    } finally {
      sourceLoading = false
    }
  }

  async function loadCalDavMeetings() {
    sourceLoading = true
    sourceError = ''
    try {
      meetings = await fetchTodayMeetings()
      if (meetings.length === 0) {
        sourceError = 'Нет событий на сегодня'
      }
      selectedMeeting = meetings[0] || null
    } catch (e) {
      sourceError = e.message || 'Ошибка CalDAV'
      meetings = []
      selectedMeeting = null
    } finally {
      sourceLoading = false
    }
  }

  function switchSource(source) {
    dataSource = source
    sourceError = ''
    if (source === 'mock') {
      meetings = MOCK_MEETINGS
      selectedMeeting = activeMeeting ?? meetings[0]
    } else if (source === 'api') {
      loadApiMeetings()
    } else {
      loadCalDavMeetings()
    }
  }

  let selectedMeeting = activeMeeting ?? meetings[0]
  $: dispatch('select', selectedMeeting)

  // Получить карточку текущего клиента из cardsMap
  $: currentCardData = selectedMeeting ? cardsMap[selectedMeeting.client] : undefined

  const statusLabels = { done: 'Завершена', upcoming: 'Предстоит', live: 'В эфире' }
  const prepLabels   = { ready: 'Готово', loading: 'Загружается…', pending: 'Ожидает' }
  const prepColors   = { ready: '#10b981', loading: '#f59e0b', pending: '#4b5a7a' }
</script>

<div class="layout">
  <!-- Left: meeting list -->
  <div class="meeting-panel">
    <div class="panel-header">
      <div class="header-top">
        <h2>Встречи на сегодня</h2>
        <div class="source-toggle">
          <button
            class="toggle-btn"
            class:active={dataSource === 'mock'}
            on:click={() => switchSource('mock')}
          >Mock</button>
          <button
            class="toggle-btn"
            class:active={dataSource === 'api'}
            disabled={!apiAvailable}
            title={apiAvailable ? 'Sales Agent API' : 'Sales Agent API недоступен'}
            on:click={() => switchSource('api')}
          >API</button>
          <button
            class="toggle-btn"
            class:active={dataSource === 'caldav'}
            disabled={!caldavConfigured}
            title={caldavConfigured ? 'CalDAV' : 'Заполните VITE_CALDAV_* в .env'}
            on:click={() => switchSource('caldav')}
          >CalDAV</button>
        </div>
      </div>
      <span class="date">{new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
    </div>

    {#if sourceLoading}
      <div class="source-status loading">
        <span class="spinner"></span> Загрузка {dataSource === 'api' ? 'из API' : 'CalDAV'}...
      </div>
    {/if}
    {#if sourceError}
      <div class="source-status error">
        {sourceError}
        <button class="retry-link" on:click={() => switchSource(dataSource)}>Повторить</button>
      </div>
    {/if}

    <div class="meeting-list">
      {#if meetings.length === 0 && !sourceLoading}
        <div class="empty-state">
          {#if dataSource === 'caldav'}
            Нет событий в календаре на сегодня
          {:else}
            Нет встреч
          {/if}
        </div>
      {/if}
      {#each meetings as m}
        {@const hasCard = savedCompanies.has(m.client)}
        <button
          class="meeting-card"
          class:selected={selectedMeeting?.id === m.id}
          class:done={m.status === 'done'}
          on:click={() => selectedMeeting = m}
        >
          <div class="meeting-time-col">
            <div class="time">{m.time}</div>
            <div class="duration">{m.duration}</div>
          </div>

          <div class="meeting-info">
            <div class="client-name">{m.client}</div>
            <div class="contact">{m.contact}</div>
            <div class="topic">{m.topic}</div>
            <div class="meeting-meta">
              <span class="status-badge" class:done={m.status === 'done'}>
                {statusLabels[m.status]}
              </span>
              {#if hasCard}
                <span class="card-badge ready">✓ Карточка</span>
              {:else}
                <span class="card-badge pending">Ожидание</span>
              {/if}
              {#each m.tags as tag}
                <span class="tag">{tag}</span>
              {/each}
            </div>
          </div>

          <div class="prep-col">
            <div class="prep-label">Prep Agent</div>
            <div class="prep-status" style="color:{hasCard ? '#10b981' : prepColors[m.prepStatus]}">
              {#if hasCard}
                Готово
              {:else if m.prepStatus === 'loading'}
                <span class="spinner"></span>
                {prepLabels[m.prepStatus]}
              {:else}
                {prepLabels[m.prepStatus] || prepLabels.pending}
              {/if}
            </div>
          </div>
        </button>
      {/each}
    </div>
  </div>

  <!-- Right: client dossier for selected meeting -->
  <div class="dossier-panel">
    {#if selectedMeeting}
      <ClientDossier
        meeting={selectedMeeting}
        existingCard={currentCardData?.card}
        existingAnalysis={currentCardData?.analysis}
        existingHasLLM={currentCardData?.hasLLM}
        on:prepMeeting={(e) => dispatch('prepMeeting', e.detail)}
        on:startMeeting={(e) => dispatch('startMeeting', e.detail)}
        on:postMeeting={(e) => dispatch('postMeeting', e.detail)}
        on:cardCollected={(e) => dispatch('cardCollected', e.detail)}
        on:toast={(e) => dispatch('toast', e.detail)}
      />
    {/if}
  </div>
</div>

<style>
  .layout {
    display: grid;
    grid-template-columns: 420px 1fr;
    gap: 24px;
    height: 100%;
  }

  .meeting-panel {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .panel-header {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .header-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .panel-header h2 {
    font-size: 18px;
    font-weight: 600;
    color: #e8eaed;
  }

  .source-toggle {
    display: flex;
    background: #1e2535;
    border-radius: 8px;
    border: 1px solid #252e42;
    overflow: hidden;
    flex-shrink: 0;
  }

  .toggle-btn {
    padding: 4px 12px;
    font-size: 11px;
    font-weight: 600;
    background: transparent;
    border: none;
    color: #4b5a7a;
    cursor: pointer;
    transition: all 0.15s;
  }
  .toggle-btn:hover:not(:disabled) { color: #8896b3 }
  .toggle-btn.active {
    background: rgba(59, 130, 246, 0.15);
    color: #60a5fa;
  }
  .toggle-btn:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  .source-status {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-radius: 8px;
    font-size: 12px;
  }
  .source-status.loading {
    background: rgba(245, 158, 11, 0.08);
    color: #f59e0b;
  }
  .source-status.error {
    background: rgba(239, 68, 68, 0.08);
    color: #f87171;
  }
  .retry-link {
    background: none;
    border: none;
    color: #60a5fa;
    cursor: pointer;
    font-size: 12px;
    text-decoration: underline;
    margin-left: auto;
  }

  .empty-state {
    padding: 32px 16px;
    text-align: center;
    color: #4b5a7a;
    font-size: 13px;
  }

  .date {
    font-size: 13px;
    color: #4b5a7a;
    text-transform: capitalize;
  }

  .meeting-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .meeting-card {
    display: flex;
    gap: 14px;
    align-items: flex-start;
    padding: 14px 16px;
    background: #161b27;
    border: 1px solid #1e2535;
    border-radius: 12px;
    cursor: pointer;
    text-align: left;
    width: 100%;
    transition: all 0.15s;
    color: inherit;
  }

  .meeting-card:hover {
    border-color: #2d3a56;
    background: #1a2030;
  }

  .meeting-card.selected {
    border-color: #3b82f6;
    background: rgba(59, 130, 246, 0.07);
  }

  .meeting-card.done {
    opacity: 0.55;
  }

  .meeting-time-col {
    flex-shrink: 0;
    text-align: center;
    min-width: 48px;
  }

  .time {
    font-size: 16px;
    font-weight: 700;
    color: #c8d0e7;
    font-variant-numeric: tabular-nums;
  }

  .duration {
    font-size: 11px;
    color: #4b5a7a;
    margin-top: 2px;
  }

  .meeting-info {
    flex: 1;
    min-width: 0;
  }

  .client-name {
    font-size: 14px;
    font-weight: 600;
    color: #e8eaed;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .contact {
    font-size: 12px;
    color: #6b7db3;
    margin-top: 2px;
  }

  .topic {
    font-size: 12px;
    color: #8896b3;
    margin-top: 4px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .meeting-meta {
    display: flex;
    gap: 6px;
    margin-top: 8px;
    flex-wrap: wrap;
  }

  .status-badge {
    font-size: 10px;
    font-weight: 600;
    padding: 2px 7px;
    border-radius: 4px;
    background: rgba(59, 130, 246, 0.15);
    color: #60a5fa;
    border: 1px solid rgba(59, 130, 246, 0.3);
  }

  .status-badge.done {
    background: rgba(75, 90, 122, 0.15);
    color: #4b5a7a;
    border-color: #252e42;
  }

  .card-badge {
    font-size: 10px;
    font-weight: 600;
    padding: 2px 7px;
    border-radius: 4px;
  }
  .card-badge.ready {
    background: rgba(16, 185, 129, 0.15);
    color: #10b981;
    border: 1px solid rgba(16, 185, 129, 0.3);
  }
  .card-badge.pending {
    background: rgba(245, 158, 11, 0.1);
    color: #f59e0b;
    border: 1px solid rgba(245, 158, 11, 0.25);
  }

  .tag {
    font-size: 10px;
    padding: 2px 7px;
    border-radius: 4px;
    background: #1e2535;
    color: #6b7db3;
    border: 1px solid #252e42;
  }

  .prep-col {
    flex-shrink: 0;
    text-align: right;
  }

  .prep-label {
    font-size: 10px;
    color: #4b5a7a;
    margin-bottom: 3px;
  }

  .prep-status {
    font-size: 11px;
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 4px;
    justify-content: flex-end;
  }

  .spinner {
    display: inline-block;
    width: 8px;
    height: 8px;
    border: 1.5px solid #f59e0b;
    border-top-color: transparent;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin { to { transform: rotate(360deg) } }

  .dossier-panel {
    min-width: 0;
  }
</style>

