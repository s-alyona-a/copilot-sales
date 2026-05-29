<script>
  export let activeView
  export let isRecording = false

  const userName = import.meta.env.VITE_USER_NAME ?? 'Алексей Козлов'
  const userRole = import.meta.env.VITE_USER_ROLE ?? 'Менеджер продаж'

  const initials = userName.split(' ').map(w => w[0]).join('').substring(0, 2)

  const navItems = [
    { id: 'today', icon: '📅', label: 'Сегодня' },
    { id: 'prep',  icon: '📋', label: 'Подготовка' },
    { id: 'live',  icon: '🎙️', label: 'В эфире' },
    { id: 'post',  icon: '📊', label: 'Итоги' },
  ]
</script>

<aside class="sidebar">
  <div class="logo">
    <div class="logo-icon">CP</div>
    <span class="logo-text">CoPilot<br/><em>Sales</em></span>
  </div>

  <nav class="nav">
    {#each navItems as item}
      <button
        class="nav-item"
        class:active={activeView === item.id}
        on:click={() => activeView = item.id}
      >
        <span class="nav-icon">{item.icon}</span>
        <span class="nav-label">{item.label}</span>
        {#if item.id === 'live' && isRecording}
          <span class="live-pulse"></span>
        {:else if item.id === 'live'}
          <span class="live-badge">LIVE</span>
        {/if}
      </button>
    {/each}
  </nav>

  <div class="sidebar-footer">
    <div class="user-card">
      <div class="avatar">{initials}</div>
      <div class="user-info">
        <div class="user-name">{userName}</div>
        <div class="user-role">{userRole}</div>
      </div>
    </div>
  </div>
</aside>

<style>
  .sidebar {
    width: 220px;
    flex-shrink: 0;
    background: #161b27;
    border-right: 1px solid #1e2535;
    display: flex;
    flex-direction: column;
    padding: 20px 0;
  }

  .logo {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 20px 24px;
    border-bottom: 1px solid #1e2535;
    margin-bottom: 16px;
  }

  .logo-icon {
    width: 36px;
    height: 36px;
    border-radius: 10px;
    background: linear-gradient(135deg, #3b82f6, #8b5cf6);
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 700;
    font-size: 13px;
    color: #fff;
    flex-shrink: 0;
  }

  .logo-text {
    font-size: 13px;
    font-weight: 600;
    line-height: 1.3;
    color: #c8d0e7;
  }

  .logo-text em {
    font-style: normal;
    color: #6b7db3;
    font-weight: 400;
  }

  .nav {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 0 10px;
  }

  .nav-item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 10px 12px;
    border-radius: 8px;
    border: none;
    background: transparent;
    color: #6b7db3;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
    text-align: left;
    position: relative;
  }

  .nav-item:hover {
    background: #1e2535;
    color: #c8d0e7;
  }

  .nav-item.active {
    background: rgba(59, 130, 246, 0.15);
    color: #60a5fa;
  }

  .nav-icon {
    font-size: 16px;
    width: 20px;
    text-align: center;
  }

  .nav-label {
    flex: 1;
  }

  .live-badge {
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.5px;
    background: #ef4444;
    color: #fff;
    padding: 2px 5px;
    border-radius: 4px;
  }

  .live-pulse {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #ef4444;
    animation: livePulse 1.2s ease-in-out infinite;
    flex-shrink: 0;
  }

  @keyframes livePulse {
    0%, 100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.5) }
    50%       { box-shadow: 0 0 0 8px rgba(239, 68, 68, 0) }
  }

  .sidebar-footer {
    padding: 16px 10px 0;
    border-top: 1px solid #1e2535;
    margin-top: auto;
  }

  .user-card {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    border-radius: 8px;
  }

  .avatar {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: linear-gradient(135deg, #10b981, #3b82f6);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    font-weight: 700;
    color: #fff;
    flex-shrink: 0;
  }

  .user-name {
    font-size: 13px;
    font-weight: 500;
    color: #c8d0e7;
  }

  .user-role {
    font-size: 11px;
    color: #4b5a7a;
    margin-top: 1px;
  }
</style>
