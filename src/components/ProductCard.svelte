<script>
  /** Продукт из каталога */
  export let product = {}
  /** Подходит ли продукт для отрасли клиента */
  export let isRecommended = false

  const categoryIcons = {
    'CRM-системы': '👥',
    'Бизнес-аналитика': '📊',
    'IoT и мониторинг': '📡',
    'Кибербезопасность': '🛡️',
    'Логистика и склад': '📦',
    'Управление проектами': '📋',
    'Телекоммуникации': '📞',
    'Маркетинг': '🎯',
    'Интеграция': '🔗',
    'Инфраструктура': '🖥️',
    'Документооборот': '📄',
  }
</script>

<div class="product-card" class:recommended={isRecommended}>
  <div class="product-header">
    <span class="product-icon">
      {categoryIcons[product.category] || '💼'}
    </span>
    <div class="product-title">
      <h4>{product.name}</h4>
      <span class="product-category">{product.category}</span>
    </div>
    {#if isRecommended}
      <span class="match-badge">✓ Подходит</span>
    {/if}
  </div>
  <p class="product-desc">{product.description}</p>
</div>

<style>
  .product-card {
    background: #1e2535;
    border: 1px solid #2a3348;
    border-radius: 8px;
    padding: 12px;
    transition: border-color 0.15s;
  }
  .product-card:hover {
    border-color: #3a4a68;
  }
  .product-card.recommended {
    border-color: #10b981;
    background: rgba(16, 185, 129, 0.05);
  }
  .product-card.recommended:hover {
    border-color: #34d399;
  }
  .product-header {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .product-icon {
    font-size: 1.4rem;
    flex-shrink: 0;
  }
  .product-title {
    flex: 1;
    min-width: 0;
  }
  .product-title h4 {
    margin: 0;
    font-size: 0.85rem;
    color: #e2e8f0;
    font-weight: 600;
  }
  .product-category {
    font-size: 0.7rem;
    color: #94a3b8;
  }
  .match-badge {
    font-size: 0.7rem;
    font-weight: 600;
    color: #10b981;
    background: rgba(16, 185, 129, 0.15);
    padding: 2px 8px;
    border-radius: 10px;
    flex-shrink: 0;
  }
  .product-desc {
    font-size: 0.75rem;
    color: #94a3b8;
    margin: 8px 0 0;
    line-height: 1.4;
  }
</style>