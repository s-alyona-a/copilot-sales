<script>
  import { createEventDispatcher, onMount } from 'svelte';
  import { getMeetingPlan } from '../lib/agentApi.js';

  export let meeting = null;
  export let cardData = null;

  const dispatch = createEventDispatcher();

  let meetingPlan = null;
  let planLoading = false;
  let planError = null;

  $: if (meeting && cardData && !meetingPlan && !planLoading) {
    generatePlan();
  }

  async function generatePlan() {
    planLoading = true;
    planError = null;
    try {
      const contact = meeting.contact || cardData?.crm?.contacts?.find(c => c.isLpr)?.name || '';
      const result = await getMeetingPlan(meeting.client, meeting.topic, contact, cardData);
      if (result.success && result.plan) {
        meetingPlan = result.plan;
        dispatch('planReady', { companyName: meeting.client, plan: meetingPlan });
      } else {
        throw new Error(result.error || 'Не удалось сгенерировать план');
      }
    } catch (err) {
      planError = err.message;
    } finally {
      planLoading = false;
    }
  }

  function handleStartMeeting() {
    dispatch('startMeeting', { meeting, plan: meetingPlan });
  }

  function handleBack() {
    dispatch('back');
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
</script>

{#if !meeting}
  <div class="prep-empty">
    <div class="empty-icon">📋</div>
    <p>Встреча не выбрана</p>
  </div>
{:else}
  <div class="prep-layout">
    <!-- Header -->
    <div class="prep-header">
      <div class="header-left">
        <button class="back-btn" on:click={handleBack} title="Назад к карточке">← Назад</button>
        <div class="avatar">{initials}</div>
        <div class="header-info">
          <div class="client-name">{meeting.client}</div>
          <div class="client-meta">{meeting.topic || 'Встреча'}{meeting.contact ? ` · ${meeting.contact}` : ''}</div>
        </div>
      </div>
      <div class="header-right">
        {#if meetingPlan}
          <button class="refresh-btn" on:click={generatePlan} disabled={planLoading}>
            🔄 Обновить план
          </button>
        {/if}
        <button class="start-btn" on:click={handleStartMeeting} disabled={!meetingPlan}>
          🎙️ Начать встречу
        </button>
      </div>
    </div>

    <!-- Content -->
    <div class="prep-body">
      {#if planLoading}
        <div class="loading-state">
          <div class="spinner"></div>
          <p>Готовим план встречи…</p>
          <div class="loading-steps">
            <div style="animation-delay:0s">📊 Анализ карточки клиента</div>
            <div style="animation-delay:0.3s">🎯 Формирование повестки</div>
            <div style="animation-delay:0.6s">💡 Подготовка аргументов и вопросов</div>
          </div>
        </div>

      {:else if planError}
        <div class="error-state">
          <div class="err-icon">⚠️</div>
          <p class="err-title">Ошибка при генерации плана</p>
          <p class="err-text">{planError}</p>
          <button class="retry-btn" on:click={generatePlan}>Повторить</button>
        </div>

      {:else if meetingPlan}
        <div class="plan-content">
          <!-- Goal -->
          <div class="plan-goal">
            <span class="goal-label">🎯 Цель встречи</span>
            <span class="goal-text">{meetingPlan.goal}</span>
          </div>

          <!-- Two-column layout -->
          <div class="plan-grid">
            <!-- Left column -->
            <div class="plan-col">
              <!-- Agenda -->
              {#if meetingPlan.agenda?.length}
                <section class="plan-section">
                  <h3>📅 Повестка</h3>
                  <div class="agenda-list">
                    {#each meetingPlan.agenda as item, i}
                      <div class="agenda-item">
                        <span class="agenda-num">{i + 1}</span>
                        <div class="agenda-body">
                          <div class="agenda-topic">
                            <span>{item.topic}</span>
                            <span class="agenda-time">{item.time}</span>
                          </div>
                          {#if item.notes}<div class="agenda-notes">{item.notes}</div>{/if}
                        </div>
                      </div>
                    {/each}
                  </div>
                </section>
              {/if}

              <!-- Key Questions -->
              {#if meetingPlan.keyQuestions?.length}
                <section class="plan-section">
                  <h3>❓ Ключевые вопросы</h3>
                  <ul class="plan-list questions">
                    {#each meetingPlan.keyQuestions as q}
                      <li>{q}</li>
                    {/each}
                  </ul>
                </section>
              {/if}
            </div>

            <!-- Right column -->
            <div class="plan-col">
              <!-- Talking Points -->
              {#if meetingPlan.talkingPoints?.length}
                <section class="plan-section">
                  <h3>💬 Аргументы</h3>
                  <ul class="plan-list">
                    {#each meetingPlan.talkingPoints as tp}
                      <li>{tp}</li>
                    {/each}
                  </ul>
                </section>
              {/if}

              <!-- Objections -->
              {#if meetingPlan.objections?.length}
                <section class="plan-section">
                  <h3>🛡️ Возражения и ответы</h3>
                  <div class="objections-list">
                    {#each meetingPlan.objections as obj}
                      <div class="objection-item">
                        <div class="obj-q">❓ {obj.objection}</div>
                        <div class="obj-a">💡 {obj.response}</div>
                      </div>
                    {/each}
                  </div>
                </section>
              {/if}

              <!-- Next Steps -->
              {#if meetingPlan.nextSteps?.length}
                <section class="plan-section">
                  <h3>➡️ Следующие шаги</h3>
                  <ul class="plan-list">
                    {#each meetingPlan.nextSteps as ns}
                      <li>{ns}</li>
                    {/each}
                  </ul>
                </section>
              {/if}
            </div>
          </div>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .prep-empty {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    height: 100%; gap: 8px; color: #4b5a7a;
  }
  .empty-icon { font-size: 36px; }

  .prep-layout {
    display: flex; flex-direction: column; height: 100%;
    background: #161b27; border: 1px solid #1e2535; border-radius: 16px; overflow: hidden;
  }

  .prep-header {
    display: flex; justify-content: space-between; align-items: center;
    padding: 16px 24px; border-bottom: 1px solid #1e2535; flex-shrink: 0; gap: 12px; flex-wrap: wrap;
  }
  .header-left { display: flex; align-items: center; gap: 12px; }
  .header-right { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }

  .back-btn {
    padding: 6px 12px; border-radius: 6px; border: 1px solid #252e42;
    background: #1e2535; color: #6b7db3; font-size: 12px; font-weight: 500; cursor: pointer; transition: all 0.15s;
  }
  .back-btn:hover { background: #252e42; color: #c8d0e7; }

  .avatar {
    width: 36px; height: 36px; border-radius: 10px;
    background: linear-gradient(135deg, #8b5cf6, #3b82f6);
    display: flex; align-items: center; justify-content: center;
    color: white; font-weight: 700; font-size: 13px; flex-shrink: 0;
  }
  .client-name { font-size: 15px; font-weight: 600; color: #e8eaed; }
  .client-meta { font-size: 12px; color: #4b5a7a; margin-top: 1px; }

  .refresh-btn {
    padding: 8px 14px; border-radius: 8px; border: 1px solid #252e42;
    background: #1e2535; color: #6b7db3; font-size: 12px; font-weight: 600; cursor: pointer; transition: all 0.15s;
  }
  .refresh-btn:hover:not(:disabled) { background: #252e42; color: #c8d0e7; }
  .refresh-btn:disabled { opacity: 0.5; cursor: not-allowed; }

  .start-btn {
    padding: 8px 20px; border-radius: 8px; border: none; font-size: 13px;
    font-weight: 600; cursor: pointer; background: linear-gradient(135deg, #10b981, #059669);
    color: white; transition: all 0.15s;
  }
  .start-btn:hover:not(:disabled) { opacity: 0.9; transform: translateY(-1px); }
  .start-btn:disabled { background: #1e2535; color: #4b5a7a; cursor: not-allowed; }

  .prep-body { flex: 1; overflow-y: auto; padding: 20px 24px; }

  /* Loading */
  .loading-state { display: flex; flex-direction: column; align-items: center; gap: 16px; padding: 64px 0; }
  .spinner {
    width: 32px; height: 32px; border-radius: 50%;
    border: 3px solid #1e2535; border-top-color: #3b82f6; animation: spin 0.9s linear infinite;
  }
  .loading-state p { font-size: 14px; color: #6b7db3; }
  .loading-steps { display: flex; flex-direction: column; gap: 6px; }
  .loading-steps div { font-size: 12px; color: #4b5a7a; animation: fadeIn 0.3s ease both; }

  /* Error */
  .error-state { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 64px 0; }
  .err-icon { font-size: 28px; }
  .err-title { font-size: 14px; font-weight: 600; color: #f87171; }
  .err-text { font-size: 12px; color: #4b5a7a; }
  .retry-btn {
    margin-top: 8px; padding: 8px 16px; border-radius: 8px; border: 1px solid #252e42;
    background: #1e2535; color: #c8d0e7; font-size: 13px; font-weight: 600; cursor: pointer;
  }

  /* Plan Content */
  .plan-content { display: flex; flex-direction: column; gap: 20px; }

  .plan-goal {
    display: flex; flex-direction: column; gap: 6px;
    padding: 16px 20px; background: rgba(59,130,246,0.08); border-radius: 12px; border-left: 4px solid #3b82f6;
  }
  .goal-label { font-size: 12px; font-weight: 700; color: #60a5fa; text-transform: uppercase; letter-spacing: 0.04em; }
  .goal-text { font-size: 16px; color: #e8eaed; line-height: 1.55; }

  .plan-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }

  .plan-col { display: flex; flex-direction: column; gap: 16px; }

  .plan-section {
    background: #1e2535; border-radius: 12px; padding: 16px 18px;
    display: flex; flex-direction: column; gap: 10px;
  }
  .plan-section h3 { font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: #6b7db3; margin: 0; }

  .plan-list { margin: 0; padding-left: 18px; font-size: 14px; color: #c8d0e7; display: flex; flex-direction: column; gap: 8px; line-height: 1.55; }
  .plan-list li::marker { color: #3b82f6; }
  .plan-list.questions li { color: #e8eaed; font-weight: 500; }

  .agenda-list { display: flex; flex-direction: column; gap: 6px; }
  .agenda-item { display: flex; gap: 10px; padding: 8px 10px; background: rgba(59,130,246,0.06); border-radius: 8px; }
  .agenda-num {
    width: 22px; height: 22px; border-radius: 50%; background: rgba(59,130,246,0.15);
    color: #60a5fa; font-size: 11px; font-weight: 700; display: flex; align-items: center; justify-content: center; flex-shrink: 0;
  }
  .agenda-body { flex: 1; }
  .agenda-topic { display: flex; justify-content: space-between; align-items: center; font-size: 14px; font-weight: 600; color: #e8eaed; }
  .agenda-time { font-size: 12px; font-weight: 500; color: #4b5a7a; flex-shrink: 0; }
  .agenda-notes { font-size: 13px; color: #6b7db3; margin-top: 3px; line-height: 1.5; }

  .objections-list { display: flex; flex-direction: column; gap: 8px; }
  .objection-item { padding: 10px 12px; background: rgba(245,158,11,0.06); border-radius: 8px; font-size: 14px; line-height: 1.5; }
  .obj-q { color: #f59e0b; font-weight: 600; margin-bottom: 4px; }
  .obj-a { color: #10b981; line-height: 1.5; }

  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes fadeIn { from { opacity: 0; transform: translateX(-10px); } to { opacity: 1; transform: translateX(0); } }

  @media (max-width: 900px) {
    .plan-grid { grid-template-columns: 1fr; }
  }
</style>
