interface ClientCategory {
  id: string;
  name: string;
}

interface ClientTool {
  id: string;
  index: number;
  name: string;
  url: string;
  description: string;
  category: string;
  tags: string[];
  keywords: string[];
  hostname: string;
}

interface ClientPayload {
  categories: ClientCategory[];
  tools: ClientTool[];
  tags: string[];
}

type SortMode = 'freq' | 'default';

const THEME_STORAGE_KEY = 'bingwu_theme';
const CLICKS_STORAGE_KEY = 'bingwu_tools_clicks_v1';

function initApp() {
  const dataEl = document.getElementById('tools-data');
  if (!dataEl?.textContent) return;

  const payload: ClientPayload = JSON.parse(dataEl.textContent);
  const validCategoryIds = new Set(payload.categories.map((c) => c.id));
  const validTags = new Set(payload.tags);
  const categoryNameMap = new Map(payload.categories.map((c) => [c.id, c.name]));

  // Precompute lowercase searchable text for fast matching
  const searchIndex = new Map<string, string>();
  for (const tool of payload.tools) {
    const haystack = [
      tool.name,
      tool.description,
      tool.hostname,
      tool.category,
      categoryNameMap.get(tool.category) ?? '',
      ...tool.tags,
      ...tool.keywords,
    ]
      .join(' ')
      .toLowerCase();
    searchIndex.set(tool.id, haystack);
  }

  // DOM References
  const grid = document.getElementById('tools-grid') as HTMLElement | null;
  const emptyState = document.getElementById('empty-state') as HTMLElement | null;
  const searchInput = document.getElementById('search-input') as HTMLInputElement | null;
  const searchClearBtn = document.getElementById('search-clear-btn') as HTMLButtonElement | null;
  const searchKbdHint = document.getElementById('search-kbd-hint') as HTMLElement | null;
  const brandResetBtn = document.getElementById('brand-reset-btn') as HTMLButtonElement | null;
  const themeToggleBtn = document.getElementById('theme-toggle-btn') as HTMLButtonElement | null;
  const resultCountEl = document.getElementById('result-count') as HTMLElement | null;
  const activeFiltersEl = document.getElementById('active-filters') as HTMLElement | null;
  const sidebarClearBtn = document.getElementById('sidebar-clear-btn') as HTMLButtonElement | null;
  const emptyClearBtn = document.getElementById('empty-clear-btn') as HTMLButtonElement | null;
  const resetClicksBtn = document.getElementById('reset-clicks-btn') as HTMLButtonElement | null;

  // Mobile drawer DOM
  const mobileDrawer = document.getElementById('mobile-drawer') as HTMLElement | null;
  const mobileDrawerOpen = document.getElementById('mobile-drawer-open') as HTMLButtonElement | null;
  const mobileDrawerClose = document.getElementById('mobile-drawer-close') as HTMLButtonElement | null;
  const mobileDrawerDone = document.getElementById('mobile-drawer-done') as HTMLButtonElement | null;
  const mobileDrawerClear = document.getElementById('mobile-drawer-clear') as HTMLButtonElement | null;
  const mobileDrawerBackdrop = document.getElementById('mobile-drawer-backdrop') as HTMLElement | null;
  const mobileTagBadge = document.getElementById('mobile-tag-badge') as HTMLElement | null;

  if (!grid) return;

  // Map tool id -> DOM card element
  const cardMap = new Map<string, HTMLElement>();
  grid.querySelectorAll<HTMLElement>('[data-tool-card]').forEach((el) => {
    const id = el.dataset.toolCard;
    if (id) cardMap.set(id, el);
  });

  // State
  let selectedCategory = 'all';
  const selectedTags = new Set<string>();
  let searchQuery = '';
  let sortMode: SortMode = 'freq';
  let clicks: Record<string, number> = loadClicks();
  let needsResort = false;
  let visibleIds: string[] = [];
  let activeCardIndex = -1;
  let resetConfirmTimer: number | null = null;
  let awaitingResetConfirm = false;

  // --- Storage Helpers ---
  function loadClicks(): Record<string, number> {
    try {
      const raw = localStorage.getItem(CLICKS_STORAGE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const clean: Record<string, number> = {};
        for (const [key, val] of Object.entries(parsed)) {
          if (typeof val === 'number' && Number.isFinite(val) && val > 0) {
            clean[key] = Math.floor(val);
          }
        }
        return clean;
      }
    } catch {
      // Ignore storage errors
    }
    return {};
  }

  function saveClicks() {
    try {
      localStorage.setItem(CLICKS_STORAGE_KEY, JSON.stringify(clicks));
    } catch {
      // Ignore storage errors
    }
  }

  function hasAnyClicks(): boolean {
    return Object.keys(clicks).length > 0;
  }

  function recordClick(toolId: string) {
    clicks[toolId] = (clicks[toolId] ?? 0) + 1;
    saveClicks();
    needsResort = true;
    updateResetClicksButton();
  }

  // --- Theme Handling ---
  function initTheme() {
    themeToggleBtn?.addEventListener('click', () => {
      const isDark = document.documentElement.classList.toggle('dark');
      try {
        localStorage.setItem(THEME_STORAGE_KEY, isDark ? 'dark' : 'light');
      } catch {
        // Ignore
      }
    });

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    mediaQuery.addEventListener('change', (e) => {
      try {
        if (!localStorage.getItem(THEME_STORAGE_KEY)) {
          document.documentElement.classList.toggle('dark', e.matches);
        }
      } catch {
        document.documentElement.classList.toggle('dark', e.matches);
      }
    });
  }

  // --- Favicon Fallback Handling ---
  function initIconFallbacks() {
    const showFallback = (img: HTMLImageElement) => {
      img.classList.add('hidden');
      const box = img.closest('[data-tool-icon-box]');
      const fallback = box?.querySelector<HTMLElement>('[data-tool-fallback]');
      fallback?.classList.remove('hidden');
    };

    document.querySelectorAll<HTMLImageElement>('[data-tool-icon]').forEach((img) => {
      img.addEventListener('error', () => showFallback(img));
      if (img.complete && img.naturalWidth === 0) {
        showFallback(img);
      }
    });
  }

  // --- URL Query Sync ---
  function readStateFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const cat = params.get('cat');
    selectedCategory = cat && validCategoryIds.has(cat) ? cat : 'all';

    selectedTags.clear();
    const rawTags = params.get('tags');
    if (rawTags) {
      rawTags
        .split(',')
        .map((t) => t.trim())
        .filter((t) => validTags.has(t))
        .forEach((t) => selectedTags.add(t));
    }

    searchQuery = params.get('q') ?? '';
    if (searchInput) searchInput.value = searchQuery;

    const sort = params.get('sort');
    sortMode = sort === 'default' ? 'default' : 'freq';
  }

  function syncUrl() {
    const params = new URLSearchParams();
    if (selectedCategory !== 'all') params.set('cat', selectedCategory);
    if (selectedTags.size > 0) params.set('tags', Array.from(selectedTags).join(','));
    if (searchQuery.trim()) params.set('q', searchQuery.trim());
    if (sortMode === 'default') params.set('sort', 'default');

    const query = params.toString();
    const nextUrl = query ? `${window.location.pathname}?${query}` : window.location.pathname;
    if (nextUrl !== `${window.location.pathname}${window.location.search}`) {
      window.history.replaceState(null, '', nextUrl);
    }
  }

  // --- Filtering & Sorting ---
  function matchesSearch(tool: ClientTool, tokens: string[]): boolean {
    if (tokens.length === 0) return true;
    const text = searchIndex.get(tool.id) ?? '';
    return tokens.every((token) => text.includes(token));
  }

  function matchesTags(tool: ClientTool, requiredTags: Set<string>): boolean {
    if (requiredTags.size === 0) return true;
    for (const tag of requiredTags) {
      if (!tool.tags.includes(tag)) return false;
    }
    return true;
  }

  function sortTools(list: ClientTool[]): ClientTool[] {
    if (sortMode === 'default') {
      return [...list].sort((a, b) => a.index - b.index);
    }
    return [...list].sort((a, b) => {
      const diff = (clicks[b.id] ?? 0) - (clicks[a.id] ?? 0);
      if (diff !== 0) return diff;
      return a.index - b.index;
    });
  }

  // --- Render ---
  function render(options: { syncUrl?: boolean; resetActiveCard?: boolean } = {}) {
    const shouldSyncUrl = options.syncUrl ?? true;
    const resetActive = options.resetActiveCard ?? true;

    needsResort = false;
    if (shouldSyncUrl) syncUrl();

    const tokens = searchQuery
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);

    // 1. Filter visible tools
    const matched = payload.tools.filter((tool) => {
      if (selectedCategory !== 'all' && tool.category !== selectedCategory) return false;
      if (!matchesTags(tool, selectedTags)) return false;
      if (!matchesSearch(tool, tokens)) return false;
      return true;
    });

    const sorted = sortTools(matched);
    visibleIds = sorted.map((t) => t.id);

    // 2. Reorder & toggle visibility in DOM
    const visibleSet = new Set(visibleIds);
    const fragment = document.createDocumentFragment();
    for (const tool of sorted) {
      const card = cardMap.get(tool.id);
      if (card) {
        card.classList.remove('hidden');
        fragment.appendChild(card);
      }
    }
    for (const tool of payload.tools) {
      if (!visibleSet.has(tool.id)) {
        const card = cardMap.get(tool.id);
        if (card) {
          card.classList.add('hidden');
          fragment.appendChild(card);
        }
      }
    }
    grid?.appendChild(fragment);

    // 3. Empty state & count
    if (resultCountEl) resultCountEl.textContent = String(sorted.length);
    if (sorted.length === 0) {
      grid?.classList.add('hidden');
      emptyState?.classList.remove('hidden');
      emptyState?.classList.add('flex');
    } else {
      grid?.classList.remove('hidden');
      emptyState?.classList.add('hidden');
      emptyState?.classList.remove('flex');
    }

    // 4. Update dynamic category counts (respecting current search + tags)
    const toolsMatchingSearchAndTags = payload.tools.filter(
      (tool) => matchesTags(tool, selectedTags) && matchesSearch(tool, tokens)
    );
    const catCountMap = new Map<string, number>();
    for (const tool of toolsMatchingSearchAndTags) {
      catCountMap.set(tool.category, (catCountMap.get(tool.category) ?? 0) + 1);
    }

    const allCountEl = document.querySelector<HTMLElement>('[data-category-count="all"]');
    if (allCountEl) allCountEl.textContent = String(toolsMatchingSearchAndTags.length);

    for (const cat of payload.categories) {
      const el = document.querySelector<HTMLElement>(`[data-category-count="${cat.id}"]`);
      if (el) el.textContent = String(catCountMap.get(cat.id) ?? 0);
    }

    // 5. Update dynamic tag counts (respecting current category + search + currently selected tags)
    const baseForTags = payload.tools.filter((tool) => {
      if (selectedCategory !== 'all' && tool.category !== selectedCategory) return false;
      if (!matchesSearch(tool, tokens)) return false;
      return true;
    });

    for (const tag of payload.tags) {
      let count = 0;
      for (const tool of baseForTags) {
        if (!tool.tags.includes(tag)) continue;
        // Check AND compatibility with all other selected tags
        let ok = true;
        for (const req of selectedTags) {
          if (req !== tag && !tool.tags.includes(req)) {
            ok = false;
            break;
          }
        }
        if (ok) count++;
      }

      document.querySelectorAll<HTMLElement>(`[data-tag-count="${CSS.escape(tag)}"]`).forEach((el) => {
        el.textContent = String(count);
      });
      document
        .querySelectorAll<HTMLElement>(`[data-mobile-tag-count="${CSS.escape(tag)}"]`)
        .forEach((el) => {
          el.textContent = String(count);
        });
    }

    // 6. Sync sidebar / mobile / toolbar active styles
    updateFilterUI();
    updateResetClicksButton();

    if (resetActive) {
      setActiveCard(-1);
    } else if (activeCardIndex >= visibleIds.length) {
      setActiveCard(visibleIds.length - 1);
    }
  }

  function updateFilterUI() {
    // Desktop category buttons
    document.querySelectorAll<HTMLButtonElement>('[data-category-btn]').forEach((btn) => {
      const isSelected = btn.dataset.categoryBtn === selectedCategory;
      btn.setAttribute('aria-pressed', String(isSelected));
      btn.classList.toggle('bg-[var(--bg-subtle)]', isSelected);
      btn.classList.toggle('font-medium', isSelected);
      btn.classList.toggle('text-[var(--text-primary)]', isSelected);
      btn.classList.toggle('text-[var(--text-secondary)]', !isSelected);
    });

    // Mobile category pills
    document.querySelectorAll<HTMLButtonElement>('[data-mobile-cat]').forEach((btn) => {
      const isSelected = btn.dataset.mobileCat === selectedCategory;
      btn.classList.toggle('border-[var(--accent-bg)]', isSelected);
      btn.classList.toggle('bg-[var(--accent-bg)]', isSelected);
      btn.classList.toggle('text-[var(--accent-fg)]', isSelected);
      btn.classList.toggle('border-[var(--border)]', !isSelected);
      btn.classList.toggle('bg-[var(--bg-surface)]', !isSelected);
      btn.classList.toggle('text-[var(--text-secondary)]', !isSelected);
    });

    // Desktop tag checkboxes
    document.querySelectorAll<HTMLInputElement>('[data-tag-checkbox]').forEach((cb) => {
      const tag = cb.dataset.tagCheckbox ?? '';
      cb.checked = selectedTags.has(tag);
    });

    // Mobile tag buttons
    document.querySelectorAll<HTMLButtonElement>('[data-mobile-tag]').forEach((btn) => {
      const tag = btn.dataset.mobileTag ?? '';
      const active = selectedTags.has(tag);
      btn.setAttribute('aria-pressed', String(active));
      btn.classList.toggle('border-[var(--accent-bg)]', active);
      btn.classList.toggle('bg-[var(--accent-bg)]', active);
      btn.classList.toggle('text-[var(--accent-fg)]', active);
      btn.classList.toggle('border-[var(--border)]', !active);
      btn.classList.toggle('bg-[var(--bg-page)]', !active);
      btn.classList.toggle('text-[var(--text-secondary)]', !active);
    });

    // Mobile badge
    if (mobileTagBadge) {
      if (selectedTags.size > 0) {
        mobileTagBadge.textContent = String(selectedTags.size);
        mobileTagBadge.classList.remove('hidden');
        mobileTagBadge.classList.add('inline-flex');
      } else {
        mobileTagBadge.classList.add('hidden');
        mobileTagBadge.classList.remove('inline-flex');
      }
    }

    // Sort toggle buttons
    document.querySelectorAll<HTMLButtonElement>('[data-sort-btn]').forEach((btn) => {
      const active = btn.dataset.sortBtn === sortMode;
      btn.setAttribute('aria-pressed', String(active));
      btn.classList.toggle('bg-[var(--bg-subtle)]', active);
      btn.classList.toggle('font-medium', active);
      btn.classList.toggle('text-[var(--text-primary)]', active);
      btn.classList.toggle('text-[var(--text-secondary)]', !active);
    });

    // Search clear button & kbd hint
    const hasSearch = searchQuery.length > 0;
    searchClearBtn?.classList.toggle('hidden', !hasSearch);
    searchClearBtn?.classList.toggle('inline-flex', hasSearch);
    if (searchKbdHint) {
      searchKbdHint.classList.toggle('sm:inline-flex', !hasSearch);
      searchKbdHint.classList.toggle('hidden', true);
      if (!hasSearch) searchKbdHint.classList.add('sm:inline-flex');
    }

    // Sidebar clear button
    const hasAnyFilter =
      selectedCategory !== 'all' || selectedTags.size > 0 || searchQuery.trim().length > 0;
    sidebarClearBtn?.classList.toggle('hidden', !hasAnyFilter);

    // Active filter chips in toolbar
    if (activeFiltersEl) {
      activeFiltersEl.innerHTML = '';

      if (selectedCategory !== 'all') {
        activeFiltersEl.appendChild(
          createFilterChip(categoryNameMap.get(selectedCategory) ?? selectedCategory, () => {
            selectedCategory = 'all';
            render();
          })
        );
      }

      for (const tag of selectedTags) {
        activeFiltersEl.appendChild(
          createFilterChip(`#${tag}`, () => {
            selectedTags.delete(tag);
            render();
          })
        );
      }

      if (searchQuery.trim()) {
        activeFiltersEl.appendChild(
          createFilterChip(`“${searchQuery.trim()}”`, () => {
            searchQuery = '';
            if (searchInput) searchInput.value = '';
            render();
          })
        );
      }
    }
  }

  function createFilterChip(label: string, onRemove: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className =
      'inline-flex cursor-pointer items-center gap-1 rounded border border-[var(--border)] bg-[var(--bg-surface)] px-2 py-0.5 text-[11px] text-[var(--text-secondary)] transition-colors hover:border-[var(--border-hover)] hover:text-[var(--text-primary)]';
    btn.innerHTML = `<span></span><svg class="h-2.5 w-2.5 opacity-70" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 3l6 6M9 3l-6 6" stroke-linecap="round"/></svg>`;
    const textSpan = btn.querySelector('span');
    if (textSpan) textSpan.textContent = label;
    btn.addEventListener('click', onRemove);
    return btn;
  }

  function updateResetClicksButton() {
    if (!resetClicksBtn) return;
    const visible = hasAnyClicks();
    resetClicksBtn.classList.toggle('hidden', !visible);
    resetClicksBtn.classList.toggle('inline-flex', visible);
    if (!visible) {
      clearResetConfirm();
    }
  }

  function clearResetConfirm() {
    awaitingResetConfirm = false;
    if (resetConfirmTimer !== null) {
      window.clearTimeout(resetConfirmTimer);
      resetConfirmTimer = null;
    }
    if (resetClicksBtn) {
      resetClicksBtn.textContent = '重置记录';
      resetClicksBtn.classList.remove(
        'border-[var(--accent-bg)]',
        'bg-[var(--accent-bg)]',
        'text-[var(--accent-fg)]'
      );
      resetClicksBtn.classList.add(
        'border-[var(--border)]',
        'bg-[var(--bg-surface)]',
        'text-[var(--text-secondary)]'
      );
    }
  }

  function clearAllFilters() {
    selectedCategory = 'all';
    selectedTags.clear();
    searchQuery = '';
    if (searchInput) searchInput.value = '';
    render();
  }

  // --- Keyboard Selection ---
  function setActiveCard(nextIndex: number) {
    if (activeCardIndex >= 0 && activeCardIndex < visibleIds.length) {
      const prevEl = cardMap.get(visibleIds[activeCardIndex]);
      if (prevEl) prevEl.dataset.active = 'false';
    }

    if (nextIndex < 0 || visibleIds.length === 0) {
      activeCardIndex = -1;
      return;
    }

    const clamped = Math.max(0, Math.min(nextIndex, visibleIds.length - 1));
    activeCardIndex = clamped;
    const nextEl = cardMap.get(visibleIds[activeCardIndex]);
    if (nextEl) {
      nextEl.dataset.active = 'true';
      nextEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  function getGridColumnCount(): number {
    if (!grid) return 1;
    const style = window.getComputedStyle(grid);
    const cols = style.gridTemplateColumns.split(' ').filter(Boolean).length;
    return Math.max(1, cols);
  }

  // --- Mobile Drawer ---
  function setDrawerOpen(open: boolean) {
    if (!mobileDrawer) return;
    mobileDrawer.classList.toggle('hidden', !open);
    mobileDrawer.setAttribute('aria-hidden', String(!open));
    document.body.style.overflow = open ? 'hidden' : '';
  }

  // --- Event Listeners ---
  function bindEvents() {
    // Category clicks (desktop + mobile)
    document.querySelectorAll<HTMLButtonElement>('[data-category-btn]').forEach((btn) => {
      btn.addEventListener('click', () => {
        selectedCategory = btn.dataset.categoryBtn ?? 'all';
        render();
      });
    });

    document.querySelectorAll<HTMLButtonElement>('[data-mobile-cat]').forEach((btn) => {
      btn.addEventListener('click', () => {
        selectedCategory = btn.dataset.mobileCat ?? 'all';
        render();
      });
    });

    // Tag toggles (desktop checkboxes)
    document.querySelectorAll<HTMLInputElement>('[data-tag-checkbox]').forEach((cb) => {
      cb.addEventListener('change', () => {
        const tag = cb.dataset.tagCheckbox;
        if (!tag) return;
        if (cb.checked) selectedTags.add(tag);
        else selectedTags.delete(tag);
        render();
      });
    });

    // Tag toggles (mobile drawer)
    document.querySelectorAll<HTMLButtonElement>('[data-mobile-tag]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tag = btn.dataset.mobileTag;
        if (!tag) return;
        if (selectedTags.has(tag)) selectedTags.delete(tag);
        else selectedTags.add(tag);
        render();
      });
    });

    // Search
    searchInput?.addEventListener('input', () => {
      searchQuery = searchInput.value;
      render();
    });

    searchClearBtn?.addEventListener('click', () => {
      searchQuery = '';
      if (searchInput) {
        searchInput.value = '';
        searchInput.focus();
      }
      render();
    });

    // Clear / Reset buttons
    brandResetBtn?.addEventListener('click', clearAllFilters);
    sidebarClearBtn?.addEventListener('click', clearAllFilters);
    emptyClearBtn?.addEventListener('click', clearAllFilters);

    // Sort buttons
    document.querySelectorAll<HTMLButtonElement>('[data-sort-btn]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.sortBtn;
        if (mode === 'freq' || mode === 'default') {
          sortMode = mode;
          render();
        }
      });
    });

    // Two-step inline reset click records
    resetClicksBtn?.addEventListener('click', () => {
      if (!awaitingResetConfirm) {
        awaitingResetConfirm = true;
        resetClicksBtn.textContent = '确认重置?';
        resetClicksBtn.classList.remove(
          'border-[var(--border)]',
          'bg-[var(--bg-surface)]',
          'text-[var(--text-secondary)]'
        );
        resetClicksBtn.classList.add(
          'border-[var(--accent-bg)]',
          'bg-[var(--accent-bg)]',
          'text-[var(--accent-fg)]'
        );
        resetConfirmTimer = window.setTimeout(() => {
          clearResetConfirm();
        }, 3000);
        return;
      }

      clicks = {};
      try {
        localStorage.removeItem(CLICKS_STORAGE_KEY);
      } catch {
        // Ignore
      }
      clearResetConfirm();
      render();
    });

    // Main card clicks (left click + middle click) — record without immediate layout jump
    grid.addEventListener('click', (e) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('[data-tool-secondary-link]')) return;
      const mainLink = target?.closest<HTMLAnchorElement>('[data-tool-main-link]');
      const toolId = mainLink?.dataset.toolMainLink;
      if (toolId) {
        recordClick(toolId);
      }
    });

    grid.addEventListener('auxclick', (e) => {
      if (e.button !== 1) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest('[data-tool-secondary-link]')) return;
      const mainLink = target?.closest<HTMLAnchorElement>('[data-tool-main-link]');
      const toolId = mainLink?.dataset.toolMainLink;
      if (toolId) {
        recordClick(toolId);
      }
    });

    // Deferred re-sort when returning to tab
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && needsResort && sortMode === 'freq') {
        render({ syncUrl: false, resetActiveCard: true });
      }
    });

    window.addEventListener('focus', () => {
      if (needsResort && sortMode === 'freq') {
        render({ syncUrl: false, resetActiveCard: true });
      }
    });

    // Mobile drawer events
    mobileDrawerOpen?.addEventListener('click', () => setDrawerOpen(true));
    mobileDrawerClose?.addEventListener('click', () => setDrawerOpen(false));
    mobileDrawerDone?.addEventListener('click', () => setDrawerOpen(false));
    mobileDrawerBackdrop?.addEventListener('click', () => setDrawerOpen(false));
    mobileDrawerClear?.addEventListener('click', () => {
      selectedTags.clear();
      render();
    });

    // Global Keyboard Shortcuts
    document.addEventListener('keydown', (e) => {
      const isDrawerOpen = mobileDrawer && !mobileDrawer.classList.contains('hidden');
      const activeTag = document.activeElement?.tagName;
      const isTyping = activeTag === 'INPUT' || activeTag === 'TEXTAREA';

      // Cmd/Ctrl + K focuses search
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (isDrawerOpen) setDrawerOpen(false);
        searchInput?.focus();
        searchInput?.select();
        return;
      }

      // '/' focuses search when not already typing
      if (e.key === '/' && !isTyping && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        searchInput?.focus();
        searchInput?.select();
        return;
      }

      // Escape closes drawer, clears search, or clears active card
      if (e.key === 'Escape') {
        if (isDrawerOpen) {
          setDrawerOpen(false);
          return;
        }
        if (document.activeElement === searchInput) {
          if (searchQuery) {
            searchQuery = '';
            if (searchInput) searchInput.value = '';
            render();
          } else {
            searchInput?.blur();
          }
          return;
        }
        if (activeCardIndex >= 0) {
          setActiveCard(-1);
        }
        return;
      }

      if (isDrawerOpen) return;

      // Arrow keys navigate visible cards
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        if (visibleIds.length === 0) return;

        // When typing in search, allow Left/Right cursor editing; ArrowDown jumps into card grid
        if (document.activeElement === searchInput) {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            searchInput?.blur();
            setActiveCard(0);
          }
          return;
        }

        if (isTyping) return;

        e.preventDefault();
        const cols = getGridColumnCount();

        if (activeCardIndex === -1) {
          setActiveCard(0);
          return;
        }

        if (e.key === 'ArrowRight') setActiveCard(activeCardIndex + 1);
        else if (e.key === 'ArrowLeft') setActiveCard(activeCardIndex - 1);
        else if (e.key === 'ArrowDown') setActiveCard(activeCardIndex + cols);
        else if (e.key === 'ArrowUp') {
          if (activeCardIndex - cols < 0) {
            setActiveCard(-1);
            searchInput?.focus();
          } else {
            setActiveCard(activeCardIndex - cols);
          }
        }
        return;
      }

      // Enter opens active card (or first match when pressing Enter directly in search box)
      if (e.key === 'Enter') {
        let targetId: string | undefined;
        if (activeCardIndex >= 0 && activeCardIndex < visibleIds.length) {
          targetId = visibleIds[activeCardIndex];
        } else if (document.activeElement === searchInput && visibleIds.length > 0) {
          targetId = visibleIds[0];
        }

        if (targetId) {
          const tool = payload.tools.find((t) => t.id === targetId);
          if (tool) {
            e.preventDefault();
            recordClick(tool.id);
            window.open(tool.url, '_blank', 'noopener,noreferrer');
          }
        }
      }
    });

    // Browser back/forward sync
    window.addEventListener('popstate', () => {
      readStateFromUrl();
      render({ syncUrl: false });
    });
  }

  initTheme();
  initIconFallbacks();
  readStateFromUrl();
  bindEvents();
  render({ syncUrl: false });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
