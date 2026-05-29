<script>
  import { createEventDispatcher } from 'svelte';
  import { collectCard, collectCardDirect, collectCardStream } from '../lib/agentApi.js';
  import ProductCard from './ProductCard.svelte';

  export let meeting = null;
  /** Карточка из cardsMap (передаётся от App.svelte) */
  export let existingCard = null;
  /** LLM-анализ из cardsMap */
  export let existingAnalysis = '';
  /** Есть ли LLM-анализ */
  export let existingHasLLM = false;

  const dispatch = createEventDispatcher();

  let _apiLoading = false;       // внутренний: идёт ли API-запрос (любой компании)
  let error = null;
  let useAgent = true;

  // Шаги сбора карточки (SSE прогресс)
  const STEPS = [
    { id: 'crm',        icon: '🏢', label: 'CRM' },
    { id: 'opensearch', icon: '🔍', label: 'OpenSearch' },
    { id: 'web',        icon: '🌐', label: 'Веб-поиск' },
    { id: 'news',       icon: '📰', label: 'Новости' },
    { id: 'vacancies',  icon: '💼', label: 'Вакансии' },
    { id: 'sbar',       icon: '📊', label: 'СБАР' },
  ];
  let stepStates = {};

  // Локальное отображение — синхронизируется с existingCard
  let displayCard = null;
  let displayAnalysis = '';
  let displayHasLLM = false;

  // ID встречи, для которой сейчас идёт сбор (для защиты от race condition)
  let collectingMeetingId = null;


  // ⚡ Ключевой фикс: loading=true ТОЛЬКО для той встречи, которую сейчас собирают.
  // Если пользователь переключился на другую вкладку — loading=false,
  // и отображается карточка (или пустое состояние) этой компании.
  $: isLoading = _apiLoading && collectingMeetingId === meeting?.id;


  // Когда меняется meeting ИЛИ existingCard — обновляем отображение
  $: {
    // Если мы НЕ в процессе сбора — синхронизируем с existingCard
    // (при сборе displayCard управляется handleCollect)
    if (collectingMeetingId !== meeting?.id) {
      if (existingCard) {
        displayCard = existingCard;
        displayAnalysis = existingAnalysis || '';
        displayHasLLM = existingHasLLM || false;
      } else {
        displayCard = null;
        displayAnalysis = '';
        displayHasLLM = false;
      }
      error = null;
    }
  }

  $: initials = getInitials(meeting?.client || '');

  function getInitials(name) {
    if (!name) return '?';
    const skip = /^(ООО|АО|ПАО|ГУП|ЗАО|ОАО|ИП|НКО|ФГУП|МУП)$/i;
    const words = name.replace(/[«»""()]/g, '').split(/\s+/).filter(w => w && !skip.test(w));
    if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return name[0]?.toUpperCase() || '?';
  }

  function formatMoney(n) { return n.toLocaleString('ru-RU') + ' ₽'; }
  function formatRevenue(n) {
    if (n >= 1e9) return `${(n / 1e9).toFixed(1).replace('.0', '')} млрд ₽`;
    if (n >= 1e6) return `${(n / 1e6).toFixed(0)} млн ₽`;
    return formatMoney(n);
  }
  function dealLabel(s) {
    return { won: 'Закрыта', lost: 'Проиграна', in_progress: 'В работе', negotiation: 'Переговоры' }[s] || s;
  }
  function dealColor(s) {
    return { won: '#10b981', lost: '#ef4444', in_progress: '#60a5fa', negotiation: '#f59e0b' }[s] || '#4b5a7a';
  }
  function dealBg(s) {
    return { won: 'rgba(16,185,129,0.15)', lost: 'rgba(239,68,68,0.15)', in_progress: 'rgba(59,130,246,0.15)', negotiation: 'rgba(245,158,11,0.15)' }[s] || 'rgba(75,90,122,0.15)';
  }
  function interIcon(t) { return { meeting: '🤝', call: '📞', email: '✉️', task: '✅' }[t] || '📝'; }
  // ISO-дату из ddgs.news (2024-01-15T10:30:00+00:00) → «15 янв 2024»
  function formatNewsDate(d) {
    if (!d) return '';
    const dt = new Date(d);
    if (isNaN(dt.getTime())) return d;
    return dt.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function mdToHtml(md) {
    if (!md) return '';
    return md
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/^### (.+)$/gm, '<h4>$1</h4>')
      .replace(/^## (.+)$/gm, '<h3>$1</h3>')
      .replace(/^# (.+)$/gm, '<h2>$1</h2>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/^- (.+)$/gm, '<li>$1</li>')
      .replace(/\n{2,}/g, '<br/><br/>').replace(/\n/g, '<br/>');
  }

  async function handleCollect() {
    if (!meeting || _apiLoading) return;

    const currentMeeting = meeting;
    const currentMeetingId = meeting.id;
    collectingMeetingId = currentMeetingId;
    _apiLoading = true; error = null;
    stepStates = {};

    try {
      // Всегда используем streaming для визуализации шагов сбора
      const result = await collectCardStream(
        currentMeeting.client, currentMeeting.topic, currentMeeting.inn,
        (step, status, detail) => { stepStates = { ...stepStates, [step]: { status, detail } }; }
      );

      let llmAnalysis = '';
      if (useAgent && result.success && result.data) {
        stepStates = { ...stepStates, llm: { status: 'running', detail: 'Анализ данных…' } };
        try {
          const agentResult = await collectCard(currentMeeting.client, currentMeeting.topic, currentMeeting.inn);
          llmAnalysis = agentResult.agentAnalysis || '';
          stepStates = { ...stepStates, llm: { status: 'done', detail: 'Готово' } };
        } catch {
          stepStates = { ...stepStates, llm: { status: 'done', detail: 'Пропущен' } };
        }
      }

      if (result.success && result.data) {
        const newCard = result.data;
        const newAnalysis = llmAnalysis;
        const newHasLLM = useAgent && !!newAnalysis;

        if (meeting?.id === currentMeetingId) {
          displayCard = newCard;
          displayAnalysis = newAnalysis;
          displayHasLLM = newHasLLM;
        }

        dispatch('cardCollected', {
          companyName: currentMeeting.client,
          card: newCard,
          analysis: newAnalysis,
          hasLLM: newHasLLM,
        });

        dispatch('toast', {
          type: 'success',
          message: existingCard ? `Карточка ${currentMeeting.client} обновлена` : `Карточка ${currentMeeting.client} собрана`,
        });
      } else {
        throw new Error(result.error || 'Некорректный ответ');
      }
    } catch (err) {
      if (meeting?.id === currentMeetingId) {
        error = err.message;
        dispatch('toast', { type: 'error', message: error });
      }
    } finally {
      _apiLoading = false;
      if (collectingMeetingId === currentMeetingId) {
        collectingMeetingId = null;
      }
    }
  }
</script>

{#if !meeting}
  <div class="dossier-empty">
    <div class="empty-icon">📋</div>
    <p class="empty-title">Выберите встречу</p>
    <p class="empty-sub">Для просмотра досье клиента</p>
  </div>
{:else}
  <div class="dossier">
    <!-- Header -->
    <div class="header">
      <div class="header-left">
        <div class="avatar">{initials}</div>
        <div class="header-info">
          <div class="client-name">
            {meeting.client}
            {#if displayCard}
              <span class="ready-badge">✓ Карточка готова</span>
            {/if}
          </div>
          <div class="client-meta">{meeting.inn ? `ИНН ${meeting.inn} · ` : ''}{meeting.contact || meeting.topic}</div>
        </div>
      </div>
      <div class="header-right">
        <label class="mode-toggle" title={useAgent ? 'LLM-агент с анализом (медленно)' : 'Прямой сбор без LLM (быстро)'}>
          <input type="checkbox" bind:checked={useAgent} />
          <span>{useAgent ? '🤖 Агент' : '⚡ Прямой'}</span>
        </label>
        <button
          class="collect-btn"
          on:click={handleCollect}
          disabled={_apiLoading}
          class:collect-update={displayCard}
        >
          {#if isLoading}
            Собираем…
          {:else if displayCard}
            🔄 Обновить
          {:else}
            🚀 Собрать карточку
          {/if}
        </button>
        {#if meeting.status === 'done'}
          <button class="btn-secondary" on:click={() => dispatch('postMeeting', meeting)}>
            📊 Итоги встречи
          </button>
        {:else if displayCard}
          <button class="btn-primary" on:click={() => dispatch('prepMeeting', meeting)}>
            📋 Подготовка к встрече
          </button>
        {/if}
      </div>
    </div>

    <!-- Body -->
    <div class="body">
      {#if isLoading}
        <div class="loading-state">
          <div class="spinner"></div>
          <p>Prep Agent собирает карточку…</p>
          <div class="step-grid">
            {#each STEPS as s}
              {@const st = stepStates[s.id]}
              <div class="step-chip" class:step-running={st?.status === 'running'} class:step-done={st?.status === 'done'}>
                <span class="step-icon">{st?.status === 'done' ? '✅' : st?.status === 'running' ? '⏳' : s.icon}</span>
                <div class="step-info">
                  <span class="step-label">{s.label}</span>
                  {#if st?.detail}<span class="step-detail">{st.detail}</span>{/if}
                </div>
              </div>
            {/each}
            {#if useAgent}
              {@const llmSt = stepStates['llm']}
              <div class="step-chip" class:step-running={llmSt?.status === 'running'} class:step-done={llmSt?.status === 'done'}>
                <span class="step-icon">{llmSt?.status === 'done' ? '✅' : llmSt?.status === 'running' ? '⏳' : '🤖'}</span>
                <div class="step-info">
                  <span class="step-label">LLM-анализ</span>
                  {#if llmSt?.detail}<span class="step-detail">{llmSt.detail}</span>{/if}
                </div>
              </div>
            {/if}
          </div>
        </div>

      {:else if error}
        <div class="error-state">
          <div class="err-icon">⚠️</div>
          <p class="err-title">Ошибка при сборе карточки</p>
          <p class="err-text">{error}</p>
          <button class="retry-btn" on:click={handleCollect}>Повторить</button>
        </div>

      {:else if !displayCard}
        <div class="empty-state">
          <div class="empty-icon">📋</div>
          <p class="empty-title">Досье не заполнено</p>
          <p class="empty-sub">Нажмите «Собрать карточку»<br/>Prep Agent соберёт данные из CRM, OpenSearch и интернета</p>
        </div>

      {:else}
        {@const os = displayCard.opensearch?.[0]}
        {@const ci = displayCard.crm?.clientInfo}
        {@const openDeals = (displayCard.crm?.deals || []).filter(d => d.status === 'in_progress' || d.status === 'negotiation').length}

        <div class="card-content">
          <!-- Stats -->
          <div class="stats-row">
            <div class="stat"><div class="stat-label">Выручка</div><div class="stat-val">{os?.revenue ? formatRevenue(os.revenue) : '—'}</div></div>
            <div class="stat"><div class="stat-label">Сотрудники</div><div class="stat-val">{os?.employeeCount ? os.employeeCount.toLocaleString('ru-RU') : '—'}</div></div>
            <div class="stat"><div class="stat-label">Регион</div><div class="stat-val sm">{os?.region || '—'}</div></div>
            <div class="stat"><div class="stat-label">Открытых сделок</div><div class="stat-val">{openDeals}</div></div>
          </div>

          <!-- Company Info -->
          {#if ci}
            <section class="sec">
              <h3>🏢 Информация о компании</h3>
              <div class="info-grid">
                {#if ci.industry}<div class="info-r"><span class="lbl">Отрасль</span><span class="val">{ci.industry}</span></div>{/if}
                {#if ci.okved}<div class="info-r"><span class="lbl">ОКВЭД</span><span class="val">{ci.okved}</span></div>{/if}
                {#if ci.website}<div class="info-r"><span class="lbl">Сайт</span><a class="link" href={ci.website} target="_blank" rel="noopener">{ci.website.replace(/^https?:\/\//, '')}</a></div>{/if}
                {#if ci.status}<div class="info-r"><span class="lbl">Статус</span><span class="badge" class:ok={ci.status === 'active'}>{ci.status === 'active' ? 'Активный' : ci.status === 'prospect' ? 'Потенциальный' : ci.status}</span></div>{/if}
                {#if ci.description}<div class="info-r full"><span class="lbl">Описание</span><span class="val">{ci.description}</span></div>{/if}
              </div>
            </section>
          {/if}

          <!-- Deals -->
          {#if displayCard.crm?.deals?.length > 0}
            <section class="sec">
              <h3>💼 Сделки из CRM</h3>
              <div class="table-wrap">
                <table>
                  <thead><tr><th>Статус</th><th>Сделка</th><th>Сумма</th><th>Продукты</th><th>Дата</th></tr></thead>
                  <tbody>
                    {#each displayCard.crm.deals as d}
                      <tr>
                        <td><span class="deal-st" style="background:{dealBg(d.status)};color:{dealColor(d.status)}">{dealLabel(d.status)}</span></td>
                        <td>{d.title}</td>
                        <td class="bold">{d.amount ? formatMoney(d.amount) : '—'}</td>
                        <td class="muted">{Array.isArray(d.products) ? d.products.join(', ') : d.products || '—'}</td>
                        <td class="muted">{d.closedAt || d.createdAt}</td>
                      </tr>
                    {/each}
                  </tbody>
                </table>
              </div>
            </section>
          {/if}

          <!-- Contacts -->
          {#if displayCard.crm?.contacts?.length > 0}
            <section class="sec">
              <h3>👤 Контакты и ЛПР</h3>
              <div class="contacts">
                {#each displayCard.crm.contacts as c}
                  <div class="contact">
                    <div class="c-avatar">{c.name.split(' ').map(w => w[0]).join('').substring(0, 2)}</div>
                    <div class="c-info">
                      <div class="c-name">{c.name} {#if c.isLpr}<span class="lpr">ЛПР</span>{/if}</div>
                      <div class="c-pos">{c.position}</div>
                      {#if c.notes}<div class="c-notes">{c.notes}</div>{/if}
                    </div>
                    <div class="c-contacts">
                      {#if c.email}<span class="c-email">{c.email}</span>{/if}
                      {#if c.phone}<span class="c-phone">{c.phone}</span>{/if}
                    </div>
                  </div>
                {/each}
              </div>
            </section>
          {/if}

          <!-- Interactions -->
          {#if displayCard.crm?.interactions?.length > 0}
            <section class="sec">
              <h3>📝 История взаимодействий</h3>
              <div class="interactions">
                {#each displayCard.crm.interactions as inter}
                  <div class="inter">
                    <div class="inter-left"><span class="inter-icon">{interIcon(inter.type)}</span><span class="inter-date">{inter.date}</span></div>
                    <div class="inter-body">
                      <div>{inter.description}</div>
                      {#if inter.outcome}<div class="inter-out">→ {inter.outcome}</div>{/if}
                      {#if inter.manager}<div class="inter-mgr">Менеджер: {inter.manager}</div>{/if}
                    </div>
                  </div>
                {/each}
              </div>
            </section>
          {/if}

          <!-- News -->
          {#if displayCard.webNews?.length > 0}
            <section class="sec">
              <h3>📰 Новости</h3>
              <div class="news-list">
                {#each displayCard.webNews as n}
                  <div class="news-item">
                    <span class="news-src">{n.source || 'Web'}</span>
                    <span class="news-text">{n.title}{n.body ? ` — ${n.body.slice(0, 100)}…` : ''}</span>
                    <span class="news-date">{formatNewsDate(n.date)}</span>
                    {#if n.href}<a class="news-link" href={n.href} target="_blank" rel="noopener">↗</a>{/if}
                  </div>
                {/each}
              </div>
            </section>
          {/if}

          <!-- Vacancies -->
          {#if displayCard.vacancies?.length > 0}
            <section class="sec">
              <h3>💼 Открытые вакансии</h3>
              <div class="vac-list">
                {#each displayCard.vacancies.slice(0, 5) as v}
                  <div class="vac-item">
                    <span>{v.title}</span>
                    {#if v.href}<a class="vac-link" href={v.href} target="_blank" rel="noopener">↗</a>{/if}
                  </div>
                {/each}
              </div>
            </section>
          {/if}

          <!-- Products -->
          {#if displayCard.products?.length > 0}
            {@const industry = ci?.industry}
            {@const rec = industry ? displayCard.products.filter(p => p.targetIndustries?.some(i => i === industry)) : []}
            {@const other = displayCard.products.filter(p => !rec.includes(p))}
            <section class="sec">
              <h3>🎯 Рекомендуемые продукты</h3>
              {#if rec.length > 0}
                <div class="prod-label ok">✅ Подходят для «{industry}»</div>
                {#each rec as p}<ProductCard product={p} isRecommended={true} />{/each}
              {/if}
              {#if other.length > 0 && rec.length > 0}<div class="prod-label muted">Другие продукты</div>{/if}
              {#each other.slice(0, 4) as p}<ProductCard product={p} />{/each}
            </section>
          {/if}

          <!-- Agent Analysis -->
          {#if displayHasLLM && displayAnalysis}
            <section class="sec">
              <h3>🤖 Анализ ИИ-агента</h3>
              <div class="analysis">{@html mdToHtml(displayAnalysis)}</div>
            </section>
          {/if}

        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  /* Layout */
  .dossier-empty, .empty-state {
    display: flex; flex-direction: column; align-items: center;
    justify-content: center; height: 100%; gap: 8px;
    background: #161b27; border: 1px solid #1e2535; border-radius: 16px; padding: 32px;
  }
  .dossier {
    display: flex; flex-direction: column; height: 100%;
    background: #161b27; border: 1px solid #1e2535; border-radius: 16px; overflow: hidden;
  }
  .header {
    display: flex; justify-content: space-between; align-items: center;
    padding: 20px 24px; border-bottom: 1px solid #1e2535; gap: 12px; flex-shrink: 0;
    flex-wrap: wrap;
  }
  .header-left { display: flex; align-items: center; gap: 12px; }
  .avatar {
    width: 40px; height: 40px; border-radius: 10px;
    background: linear-gradient(135deg, #8b5cf6, #3b82f6);
    display: flex; align-items: center; justify-content: center;
    color: white; font-weight: 700; font-size: 14px; flex-shrink: 0;
  }
  .client-name {
    font-size: 15px; font-weight: 600; color: #e8eaed;
    display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  }
  .ready-badge {
    font-size: 10px; font-weight: 600; padding: 2px 8px; border-radius: 4px;
    background: rgba(16,185,129,0.15); color: #10b981; border: 1px solid rgba(16,185,129,0.3);
  }
  .client-meta { font-size: 12px; color: #4b5a7a; margin-top: 2px; }
  .header-right { display: flex; align-items: center; gap: 10px; flex-shrink: 0; flex-wrap: wrap; }
  .mode-toggle {
    display: flex; align-items: center; gap: 6px; cursor: pointer; font-size: 11px; color: #6b7db3;
  }
  .mode-toggle input { accent-color: #3b82f6; }
  .collect-btn {
    padding: 8px 16px; border-radius: 8px; border: none; font-size: 13px;
    font-weight: 600; cursor: pointer; background: linear-gradient(135deg, #3b82f6, #6366f1);
    color: white; transition: all 0.15s;
  }
  .collect-btn:hover:not(:disabled) { opacity: 0.9; transform: translateY(-1px); }
  .collect-btn:disabled { background: #1e2535; color: #4b5a7a; cursor: not-allowed; }
  .collect-btn.collect-update {
    background: #1e2535; color: #10b981; border: 1px solid rgba(16,185,129,0.3);
  }
  .collect-btn.collect-update:hover:not(:disabled) { background: #252e42; }
  .btn-primary {
    padding: 8px 16px; border-radius: 8px; border: none; font-size: 13px;
    font-weight: 600; cursor: pointer; background: linear-gradient(135deg, #3b82f6, #6366f1);
    color: white; transition: all 0.15s;
  }
  .btn-primary:hover { opacity: 0.9; }
  .btn-secondary {
    padding: 8px 16px; border-radius: 8px; font-size: 13px;
    font-weight: 600; cursor: pointer; background: #1e2535; color: #c8d0e7;
    border: 1px solid #252e42; transition: all 0.15s;
  }
  .btn-secondary:hover { background: #252e42; }

  .body { flex: 1; overflow-y: auto; padding: 20px 24px; }

  /* Loading */
  .loading-state { display: flex; flex-direction: column; align-items: center; gap: 16px; padding: 64px 0; }
  .spinner {
    width: 32px; height: 32px; border-radius: 50%;
    border: 3px solid #1e2535; border-top-color: #3b82f6;
    animation: spin 0.9s linear infinite;
  }
  .loading-state p { font-size: 14px; color: #6b7db3; }
  .step-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; width: 100%; max-width: 420px; }
  .step-chip {
    display: flex; align-items: center; gap: 8px; padding: 8px 12px;
    background: #1e2535; border: 1px solid #252e42; border-radius: 10px;
    transition: all 0.3s; animation: fadeIn 0.3s ease both;
  }
  .step-chip.step-running { border-color: rgba(59,130,246,0.4); background: rgba(59,130,246,0.08); }
  .step-chip.step-done { border-color: rgba(16,185,129,0.3); background: rgba(16,185,129,0.06); }
  .step-icon { font-size: 16px; flex-shrink: 0; }
  .step-info { display: flex; flex-direction: column; min-width: 0; }
  .step-label { font-size: 11px; font-weight: 600; color: #8896b3; }
  .step-chip.step-running .step-label { color: #60a5fa; }
  .step-chip.step-done .step-label { color: #10b981; }
  .step-detail { font-size: 10px; color: #4b5a7a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  /* Error */
  .error-state { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 64px 0; }
  .err-icon { font-size: 28px; }
  .err-title { font-size: 14px; font-weight: 600; color: #f87171; }
  .err-text { font-size: 12px; color: #4b5a7a; }
  .retry-btn {
    margin-top: 8px; padding: 8px 16px; border-radius: 8px; border: 1px solid #252e42;
    background: #1e2535; color: #c8d0e7; font-size: 13px; font-weight: 600; cursor: pointer;
  }

  /* Empty */
  .empty-icon { font-size: 36px; }
  .empty-title { font-size: 14px; font-weight: 600; color: #6b7db3; }
  .empty-sub { font-size: 12px; color: #4b5a7a; text-align: center; line-height: 1.6; }

  /* Card Content */
  .card-content { display: flex; flex-direction: column; gap: 20px; }
  .stats-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
  .stat { background: #1e2535; border-radius: 10px; padding: 12px 14px; }
  .stat-label { font-size: 11px; color: #4b5a7a; margin-bottom: 4px; }
  .stat-val { font-size: 16px; font-weight: 700; color: #e8eaed; }
  .stat-val.sm { font-size: 13px; }

  /* Sections */
  .sec { display: flex; flex-direction: column; gap: 10px; }
  .sec h3 { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: #6b7db3; margin: 0; }

  /* Info Grid */
  .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 24px; background: #1e2535; border-radius: 8px; padding: 16px; }
  .info-r { display: flex; align-items: baseline; gap: 8px; font-size: 12px; }
  .info-r.full { grid-column: span 2; }
  .lbl { color: #4b5a7a; min-width: 70px; }
  .val { color: #c8d0e7; }
  .link { color: #60a5fa; text-decoration: none; }
  .link:hover { text-decoration: underline; }
  .badge { font-size: 10px; font-weight: 600; padding: 2px 6px; border-radius: 4px; background: rgba(245,158,11,0.15); color: #f59e0b; }
  .badge.ok { background: rgba(16,185,129,0.15); color: #10b981; }

  /* Table */
  .table-wrap { border-radius: 8px; overflow: hidden; border: 1px solid #1e2535; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { text-align: left; padding: 8px 12px; background: #1e2535; color: #4b5a7a; font-weight: 600; }
  td { padding: 8px 12px; border-top: 1px solid #1e2535; color: #c8d0e7; }
  .bold { font-weight: 600; color: #e8eaed; }
  .muted { color: #8896b3; }
  .deal-st { font-size: 10px; font-weight: 600; padding: 2px 6px; border-radius: 4px; }

  /* Contacts */
  .contacts { display: flex; flex-direction: column; gap: 8px; }
  .contact { display: flex; align-items: center; gap: 12px; padding: 10px 12px; background: #1e2535; border-radius: 8px; }
  .c-avatar {
    width: 28px; height: 28px; border-radius: 50%;
    background: linear-gradient(135deg, #10b981, #3b82f6);
    display: flex; align-items: center; justify-content: center;
    color: white; font-size: 11px; font-weight: 700; flex-shrink: 0;
  }
  .c-info { flex: 1; }
  .c-name { font-size: 12px; font-weight: 600; color: #e8eaed; display: flex; align-items: center; gap: 6px; }
  .lpr { font-size: 9px; font-weight: 700; padding: 1px 4px; border-radius: 3px; background: rgba(245,158,11,0.15); color: #f59e0b; }
  .c-pos { font-size: 11px; color: #6b7db3; }
  .c-notes { font-size: 11px; color: #4b5a7a; margin-top: 2px; }
  .c-contacts { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; font-size: 11px; }
  .c-email { color: #60a5fa; }
  .c-phone { color: #4b5a7a; }

  /* Interactions */
  .interactions { display: flex; flex-direction: column; gap: 8px; }
  .inter { display: flex; align-items: flex-start; gap: 12px; padding: 10px 12px; background: #1e2535; border-radius: 8px; }
  .inter-left { display: flex; flex-direction: column; align-items: center; gap: 4px; flex-shrink: 0; }
  .inter-icon { font-size: 16px; }
  .inter-date { font-size: 11px; font-weight: 600; color: #c8d0e7; }
  .inter-body { flex: 1; font-size: 12px; color: #8896b3; }
  .inter-out { font-size: 11px; color: #6b7db3; margin-top: 4px; }
  .inter-mgr { font-size: 10px; color: #4b5a7a; margin-top: 2px; }

  /* News */
  .news-list { display: flex; flex-direction: column; gap: 8px; }
  .news-item { display: flex; align-items: baseline; gap: 8px; padding: 8px 12px; background: #1e2535; border-radius: 8px; font-size: 12px; }
  .news-src { font-weight: 600; color: #3b82f6; flex-shrink: 0; }
  .news-text { flex: 1; color: #8896b3; }
  .news-date { color: #4b5a7a; flex-shrink: 0; }
  .news-link { color: #60a5fa; text-decoration: none; }
  .news-link:hover { text-decoration: underline; }

  /* Vacancies */
  .vac-list { display: flex; flex-direction: column; gap: 8px; }
  .vac-item { display: flex; align-items: baseline; gap: 8px; padding: 8px 12px; background: #1e2535; border-radius: 8px; font-size: 12px; color: #8896b3; }
  .vac-item span { flex: 1; }
  .vac-link { padding: 2px 8px; border-radius: 4px; background: #252e42; color: #60a5fa; font-size: 11px; text-decoration: none; }
  .vac-link:hover { opacity: 0.8; }

  /* Products */
  .prod-label { font-size: 11px; font-weight: 600; }
  .prod-label.ok { color: #10b981; }
  .prod-label.muted { color: #4b5a7a; margin-top: 8px; }

  /* Agent Analysis */
  .analysis { background: #1e2535; border-radius: 8px; padding: 16px; font-size: 13px; line-height: 1.6; color: #c8d0e7; border-left: 3px solid #10b981; }
  .analysis :global(h2) { font-size: 16px; color: #e8eaed; margin: 12px 0 8px; }
  .analysis :global(h3) { font-size: 14px; color: #e8eaed; margin: 10px 0 6px; }
  .analysis :global(h4) { font-size: 13px; color: #c8d0e7; margin: 8px 0 4px; }
  .analysis :global(strong) { color: #e8eaed; }
  .analysis :global(ul) { padding-left: 20px; }
  .analysis :global(li) { margin: 2px 0; }

  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes fadeIn { from { opacity: 0; transform: translateX(-10px); } to { opacity: 1; transform: translateX(0); } }
</style>