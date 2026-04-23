const API_BASE_URL = "http://localhost:3000";

let hfChatStarted = false;
let hfConversationId = null;

let chatOverlayOpen = false;
let chatOverlayMinimized = false;

let currentEvents = [];
let currentEventIndex = 0;
let isCurrentEventsLoading = false;

let isCalendarLoading = false;

let isOptimizerRequestInFlight = false;
let isIdeasRequestInFlight = false;

const IDEA_HISTORY_KEY = "campaignIdeasHistory:v1";
const IDEA_WIDGET_LAYOUT_KEY = "campaignIdeasWidgetLayout:v1";
const CALENDAR_WIDGET_LAYOUT_KEY = "campaignCalendarWidgetLayout:v1";
const DASHBOARD_LAYOUT_KEY = "dashboardLayout:v1";

const state = {
  currentMonth: new Date(),
  selectedDate: new Date(),
  holidays: [],
  recurring: [],
  campaigns: [],
  visibleCounts: {
    holiday: 10,
    recurring: 10,
    campaign: 5
  },
  loadStep: {
    holiday: 5,
    recurring: 5,
    campaign: 5
  },
  widgetLayout: {
    calendarColumn: "left",
    calendarHidden: false
  },
  ideaWidget: {
    history: [],
    activeHistoryIndex: -1,
    currentIdeaIndex: 0,
    hidden: false,
    column: "center",
    loading: false
  },
  selectedCardProgram: "All",
  cardPrograms: ["All", "EazyDiner Cards", "Platinum Aura Edge", "Pinnacle"],
  cohort: {
    filters: {},
    count: 0
  }
};

init().catch(err => {
  console.error("INIT FAILED:", err);
});

async function init() {
  loadDashboardLayout();
  loadIdeaWidgetLayout();
  loadIdeaHistoryFromStorage();
  restoreCalendarWidgetLayout();

  await loadData();

  renderCalendar(state.currentMonth);
  renderEvents(state.selectedDate);
  setupChatUI();
  setupFloatingChatOverlay();
  setupCardProgramFilter();
  await loadCurrentEvents();
  setupOptimizerSuggestionChips();
  setupLoadMoreButtons();
  setupCalendarWidgetControls();
  setupGlobalDragAndDrop();
  applyIdeasWidgetLayout();
  applyCalendarWidgetLayout();
  renderHiddenWidgetsBar();

  const prevBtn = document.getElementById("prev-month-btn");
  const nextBtn = document.getElementById("next-month-btn");
  const optimizerBtn = document.getElementById("run-date-optimizer-btn");
  const ideasBtn = document.getElementById("run-campaign-ideas-btn");
  const todayBtn = document.getElementById("today-btn");
  const ideasPrevBtn = document.getElementById("campaign-ideas-prev-btn");
  const ideasNextBtn = document.getElementById("campaign-ideas-next-btn");
  const ideasUndoBtn = document.getElementById("campaign-ideas-undo-btn");
  const currentEventsPrevBtn = document.getElementById("current-events-prev-btn");
  const currentEventsNextBtn = document.getElementById("current-events-next-btn");
  const csvBtn = document.getElementById("download-campaign-csv-btn");
  const cohortBtn = document.getElementById("run-cohort-btn");
  const cohortDownloadBtn = document.getElementById("download-cohort-btn");
  const ideaChatBtn = document.getElementById("campaign-idea-chat-btn");

  const refreshEventsBtn = document.getElementById("run-current-events-btn");

  if (refreshEventsBtn) {
    refreshEventsBtn.onclick = loadCurrentEvents;
  }

  if (cohortBtn) cohortBtn.onclick = runCohortBuilder;
  if (cohortDownloadBtn) cohortDownloadBtn.onclick = downloadCohortCSV;

  if (csvBtn) csvBtn.onclick = downloadCampaignCSV;
   if (ideaChatBtn) {
       ideaChatBtn.onclick = () => {
         const inputEl = document.getElementById("campaign-idea-query-input");
         const question = inputEl?.value?.trim();
         if (!question) return;

         const activeSet = getActiveIdeaSet();
         const idea = activeSet?.ideas?.[state.ideaWidget.currentIdeaIndex];
         if (!idea) return;

         // 👉 Prefill cohort (SAFE)
         if (idea.cohort_filters) {
           const f = idea.cohort_filters;

           setInputValue("cohort-account-vintage", f.account_vintage);
           setInputValue("cohort-card-program", f.card_program);
           setInputValue("cohort-days-since-txn", f.days_since_last_txn);
           setInputValue("cohort-age", f.age);
           setInputValue("cohort-gender", f.gender);
           setInputValue("cohort-tier1", f.tier1_resident);
         }

         const cohortWidget = document.getElementById("cohort-widget");

         if (cohortWidget) {
           cohortWidget.scrollIntoView({ behavior: "smooth", block: "center" });

           // subtle highlight
           cohortWidget.classList.add("cohort-highlight");

           setTimeout(() => {
             cohortWidget.classList.remove("cohort-highlight");
           }, 1500);
         }

         // 👉 Open chat
         chatOverlayOpen = true;
         chatOverlayMinimized = false;
         syncChatOverlayState();

         const chatInput = document.getElementById("chatbot-input");
         if (chatInput) chatInput.focus();

         const contextPrompt = `
     You are refining this campaign idea:

     Title: ${idea.title}
     Summary: ${idea.summary}
     Target: ${idea.targetSegment}
     Timing: ${idea.suggestedTiming}

     User question:
     ${question}
         `.trim();

         if (chatInput) {
           chatInput.value = contextPrompt;
           runCalendarChatbot();
         }

         inputEl.value = "";
       };
     };
  if (prevBtn) prevBtn.onclick = () => changeMonth(-1);
  if (nextBtn) nextBtn.onclick = () => changeMonth(1);
  if (todayBtn) todayBtn.onclick = jumpToToday;
  if (optimizerBtn) optimizerBtn.onclick = runDateOptimizerAgent;
  if (ideasBtn) ideasBtn.onclick = () => runCampaignIdeasAgent({ forceRefresh: true });
  if (ideasPrevBtn) ideasPrevBtn.onclick = showPreviousIdea;
  if (ideasNextBtn) ideasNextBtn.onclick = showNextIdea;
  if (ideasUndoBtn) ideasUndoBtn.onclick = undoCampaignIdeas;
  if (currentEventsPrevBtn) currentEventsPrevBtn.onclick = showPreviousCurrentEvent;
  if (currentEventsNextBtn) currentEventsNextBtn.onclick = showNextCurrentEvent;

  const restored = restoreIdeasFromCacheForCurrentMonth();
  if (!restored) {
    await runCampaignIdeasAgent({ silentLoading: true });
  }
}

const filterEl = document.getElementById("card-program-filter");

if (filterEl) {
  filterEl.addEventListener("change", (e) => {
    state.selectedCardProgram = e.target.value;
  });
}

function saveDashboardLayout() {
  const layout = {};

  document.querySelectorAll(".dashboard-widget").forEach((widget) => {
    const column = widget.closest(".widget-dropzone");
    if (!column) return;

    layout[widget.dataset.widgetId] = column.dataset.columnId;
  });

  localStorage.setItem(DASHBOARD_LAYOUT_KEY, JSON.stringify(layout));
}

function loadDashboardLayout() {
  const raw = localStorage.getItem(DASHBOARD_LAYOUT_KEY);
  if (!raw) return;

  try {
    const layout = JSON.parse(raw);

    Object.entries(layout).forEach(([widgetId, columnId]) => {
      const widget = document.querySelector(`[data-widget-id="${widgetId}"]`);
      const column = document.querySelector(`[data-column-id="${columnId}"]`);

      if (widget && column) {
        column.appendChild(widget);
      }
    });
  } catch (e) {
    console.warn("Layout restore failed");
  }
}

function setupGlobalDragAndDrop() {
  const widgets = document.querySelectorAll(".dashboard-widget");
  const columns = document.querySelectorAll(".widget-dropzone");

  widgets.forEach((widget) => {
    widget.setAttribute("draggable", "true");

    widget.addEventListener("dragstart", (e) => {
      e.dataTransfer.effectAllowed = "move";
      widget.classList.add("widget-dragging");
    });

    widget.addEventListener("dragend", () => {
      widget.classList.remove("widget-dragging");

      columns.forEach((col) => {
        col.classList.remove("widget-dropzone-active");

        const indicator = col.querySelector(".widget-insert-indicator");
        if (indicator) indicator.remove();
      });
    });
  });

  columns.forEach((column) => {
    column.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      column.classList.add("widget-dropzone-active");

      const afterElement = getDragAfterElement(column, e.clientY);
      let indicator = column.querySelector(".widget-insert-indicator");
      if (!indicator) {
        indicator = document.createElement("div");
        indicator.className = "widget-insert-indicator";
      }
      if (afterElement) {
        column.insertBefore(indicator, afterElement);
      } else {
        column.appendChild(indicator);
      }
    });

    column.addEventListener("dragleave", (e) => {
      if (!column.contains(e.relatedTarget)) {
        column.classList.remove("widget-dropzone-active");
        const indicator = column.querySelector(".widget-insert-indicator");
        if (indicator) indicator.remove();
      }
    });

    column.addEventListener("drop", (e) => {
      e.preventDefault();

      const dragging = document.querySelector(".widget-dragging");
      const indicator = column.querySelector(".widget-insert-indicator");

      if (!dragging) return;

      if (indicator) {
        column.insertBefore(dragging, indicator);
        indicator.remove();
      } else {
        column.appendChild(dragging);
      }

      column.classList.remove("widget-dropzone-active");

      const widgetId = dragging.dataset.widgetId;

      if (widgetId === "campaign-ideas") {
        state.ideaWidget.column = column.dataset.columnId;
        saveIdeaWidgetLayout();
      }

      if (widgetId === "calendar-events") {
        state.widgetLayout.calendarColumn = column.dataset.columnId;
        saveCalendarWidgetLayout();
      }

      saveDashboardLayout();
    });
  });
}
  

function getDragAfterElement(container, y) {
  const draggableElements = [
    ...container.querySelectorAll(".dashboard-widget:not(.widget-dragging)")
  ];

  return draggableElements.reduce(
    (closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;

      if (offset < 0 && offset > closest.offset) {
        return { offset, element: child };
      } else {
        return closest;
      }
    },
    { offset: Number.NEGATIVE_INFINITY }
  ).element;
}

function setupChatUI() {
  const sendBtn = document.getElementById("chatbot-send-btn");
  const input = document.getElementById("chatbot-input");
  const newChatBtn = document.getElementById("chatbot-new-chat-btn");

  if (sendBtn) {
    sendBtn.onclick = runCalendarChatbot;
  }

  if (input) {
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        runCalendarChatbot();
      }
    });
  }

  if (newChatBtn) {
    newChatBtn.onclick = startNewChatSession;
  }
}

function setupFloatingChatOverlay() {
  const openBtn = document.getElementById("open-chat-btn");
  const overlay = document.getElementById("chat-overlay");
  const minimizeBtn = document.getElementById("chat-minimize-btn");
  const closeBtn = document.getElementById("chat-close-btn");

  if (openBtn) {
    openBtn.addEventListener("click", () => {
      chatOverlayOpen = true;
      chatOverlayMinimized = false;
      syncChatOverlayState();
    });
  }

  if (minimizeBtn) {
    minimizeBtn.addEventListener("click", () => {
      chatOverlayMinimized = true;
      syncChatOverlayState();
    });
  }

  if (closeBtn) {
    closeBtn.addEventListener("click", () => {
      chatOverlayOpen = false;
      chatOverlayMinimized = false;
      syncChatOverlayState();
    });
  }

  if (overlay) {
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) {
        chatOverlayOpen = false;
        chatOverlayMinimized = false;
        syncChatOverlayState();
      }
    });
  }

  syncChatOverlayState();
}

function syncChatOverlayState() {
  const openBtn = document.getElementById("open-chat-btn");
  if (openBtn) {
    openBtn.style.display = chatOverlayOpen ? "none" : "block";
  }
  const overlay = document.getElementById("chat-overlay");
  const panel = document.getElementById("chat-overlay-panel");
  const minimizedBar = document.getElementById("chat-overlay-minimized");

  if (!overlay || !panel || !minimizedBar) return;

  if (!chatOverlayOpen) {
    overlay.classList.add("hidden");
    panel.classList.add("hidden");
    minimizedBar.classList.add("hidden");
    return;
  }

  overlay.classList.remove("hidden");

  if (chatOverlayMinimized) {
    panel.classList.add("hidden");
    minimizedBar.classList.remove("hidden");
  } else {
    panel.classList.remove("hidden");
    minimizedBar.classList.add("hidden");
  }
}

async function loadCurrentEvents() {

  if (isCurrentEventsLoading) return;
  isCurrentEventsLoading = true;
  
  const container = document.getElementById("current-events-result");
  const position = document.getElementById("current-events-position");

  if (container) {
    container.innerHTML = `
      <article class="idea-card compact-idea-card skeleton-card">
        <div class="skeleton-line w-40"></div>
        <div class="skeleton-line w-full"></div>
        <div class="skeleton-line w-5/6"></div>
        <div class="idea-stack compact-idea-stack">
          <div class="skeleton-pill"></div>
          <div class="skeleton-pill"></div>
        </div>
      </article>
    `;
  }

  try {
    const response = await fetch(`${API_BASE_URL}/api/current-events`);
    const { ok, status, data, rawText } = await readJsonResponse(response);

    if (!ok) {
      throw new Error(data?.details || data?.error || rawText || `Request failed with status ${status}`);
    }

    currentEvents = Array.isArray(data?.events) ? data.events : [];
    currentEventIndex = 0;
    renderCurrentEventCard();
  } catch (error) {
    console.error("Current events error:", error);
    if (container) {
      container.innerHTML = `
        <div class="p-3 rounded-lg bg-red-50 text-red-700 text-sm">
          ${escapeHtml(error.message || "Failed to load current events.")}
        </div>
      `;
    }
    if (position) position.textContent = "0 / 0";
  }
  finally {
    isCurrentEventsLoading = false;
  }
}

function renderCurrentEventCard() {
  const container = document.getElementById("current-events-result");
  const position = document.getElementById("current-events-position");
  const prevBtn = document.getElementById("current-events-prev-btn");
  const nextBtn = document.getElementById("current-events-next-btn");

  if (!container || !position) return;

  if (!currentEvents.length) {
    container.innerHTML = `<div class="text-sm text-gray-500">No major India events found for today.</div>`;
    position.textContent = "0 / 0";
    if (prevBtn) prevBtn.disabled = true;
    if (nextBtn) nextBtn.disabled = true;
    return;
  }

  const item = currentEvents[currentEventIndex];

  container.innerHTML = `
    <article class="idea-card compact-idea-card">
      <div class="compact-idea-topline">
        <h3>${escapeHtml(item.title || "Untitled event")}</h3>
      </div>

      <p>${escapeHtml(item.summary || "-")}</p>

      <div class="idea-stack compact-idea-stack">
        <div class="compact-idea-text-row">
          <span class="idea-meta-label">Why it matters</span>
          <span>${escapeHtml(item.impact || "-")}</span>
        </div>
        <div class="compact-idea-text-row">
          <span class="idea-meta-label">Source</span>
          <span>${escapeHtml(item.source || "The Hindu")}</span>
        </div>
      </div>
    </article>
  `;

  position.textContent = `${currentEventIndex + 1} / ${currentEvents.length}`;

  if (prevBtn) prevBtn.disabled = currentEventIndex === 0;
  if (nextBtn) nextBtn.disabled = currentEventIndex === currentEvents.length - 1;
}

function showPreviousCurrentEvent() {
  if (currentEventIndex > 0) {
    currentEventIndex--;
    renderCurrentEventCard();
  }
}

function showNextCurrentEvent() {
  if (currentEventIndex < currentEvents.length - 1) {
    currentEventIndex++;
    renderCurrentEventCard();
  }
}

function setupOptimizerSuggestionChips() {
  const textarea = document.getElementById("optimize-campaign-input");
  const chips = document.querySelectorAll(".suggestion-chip");

  if (!textarea || !chips.length) return;

  chips.forEach((chip) => {
    chip.addEventListener("click", () => {
      const text = chip.textContent.trim();

      if (!textarea.value.trim()) {
        textarea.value = text;
      } else {
        textarea.value = `${textarea.value.trim()} ${text}`;
      }

      textarea.focus();
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    });
  });
}

function setupLoadMoreButtons() {
  const holidayBtn = document.getElementById("holiday-load-more-btn");
  const recurringBtn = document.getElementById("recurring-load-more-btn");
  const campaignBtn = document.getElementById("campaign-load-more-btn");

  if (holidayBtn) {
    holidayBtn.addEventListener("click", () => {
      state.visibleCounts.holiday += state.loadStep.holiday;
      renderEvents(state.selectedDate);
    });
  }

  if (recurringBtn) {
    recurringBtn.addEventListener("click", () => {
      state.visibleCounts.recurring += state.loadStep.recurring;
      renderEvents(state.selectedDate);
    });
  }

  if (campaignBtn) {
    campaignBtn.addEventListener("click", () => {
      state.visibleCounts.campaign += state.loadStep.campaign;
      renderEvents(state.selectedDate);
    });
  }
}

async function loadData() {
  try {
    const [h, r, c] = await Promise.all([
      fetch("./data/holidays.json"),
      fetch("./data/recurring_events.json"),
      fetch("./data/campaigns.json")
    ]);

    state.holidays = await h.json();
    state.recurring = await r.json();
    const campaignsRaw = await c.json();
    state.campaigns = campaignsRaw.sort((a, b) => {
      const aEnd = new Date(a.end_date || a.endDate);
      const bEnd = new Date(b.end_date || b.endDate);
      return aEnd - bEnd;
});
  } catch (err) {
    console.error("JSON load failed, using fallback data", err);

    state.holidays = [
      { event_name: "Holi", start_date: "2026-03-18", end_date: "2026-03-18", confidence: 95 },
      { event_name: "Shopping Festival", start_date: "2026-03-20", end_date: "2026-03-25", confidence: 60 }
    ];

    state.recurring = [
      { event_name: "Salary Credit Window", start_date: "2026-03-01", end_date: "2026-03-05" },
      { event_name: "Tax Payment Window", start_date: "2026-03-15", end_date: "2026-03-20" }
    ];

    state.campaigns = [
      {
        event_name: "Premium Cashback",
        start_date: "2026-03-10",
        end_date: "2026-03-22",
        card_program: "Signature",
        benefit_type: "Cashback"
      }
    ];
  }
}

function formatISO(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeEvent(e) {
  return {
    name: e.event_name || e.eventName || "Untitled Event",
    start: e.start_date || e.startDate,
    end: e.end_date || e.endDate,
    cardProgram: e.card_program || e.cardProgram || "-",
    benefitType: e.benefit_type || e.benefitType || "-",
    confidence: Number(e.confidence_score ?? e.confidence ?? e.score ?? 0) || 0
  };
}

function resetVisibleCounts() {
  state.visibleCounts.holiday = 10;
  state.visibleCounts.recurring = 10;
  state.visibleCounts.campaign = 5;
}

function getCurrentMonthKey() {
  return `${state.currentMonth.getFullYear()}-${String(state.currentMonth.getMonth() + 1).padStart(2, "0")}`;
}

function normalizeIdeaValue(value, fallback = "-") {
  const cleaned = String(value ?? "").trim();
  return cleaned || fallback;
}

function getIdeaFingerprint(item) {
  const parts = [
    normalizeIdeaValue(item.title, "").toLowerCase(),
    normalizeIdeaValue(item.targetSegment || item.targetAudience || item.audience, "").toLowerCase(),
    normalizeIdeaValue(item.suggestedTiming || item.timing || item.seasonalFit, "").toLowerCase(),
    normalizeIdeaValue(item.offerConstruct, "").toLowerCase(),
    normalizeIdeaValue(item.primaryMetric, "").toLowerCase()
  ];

  return parts.join("|");
}

function inferRecommendedBudget(item) {
  const segment = String(item.targetSegment || "").toLowerCase();
  if (segment.includes("premium") || segment.includes("affluent")) return "High budget; premium-funded pilot with merchant co-funding";
  if (segment.includes("mass") || segment.includes("salaried")) return "Medium budget; broad-base monthly allocation";
  return "Test budget; launch as a controlled monthly pilot";
}

function inferExpectedImpact(item) {
  const categories = Array.isArray(item.merchantCategories) ? item.merchantCategories.join(", ").toLowerCase() : "";
  if (categories.includes("travel") || categories.includes("electronics")) return "Likely to lift average ticket size and premium card spend";
  if (categories.includes("dining") || categories.includes("movies") || categories.includes("food")) return "Likely to increase transaction frequency over peak weekends";
  return "Likely to improve spend participation in the current month";
}

function inferPrimaryMetric(item) {
  const categories = Array.isArray(item.merchantCategories) ? item.merchantCategories.join(", ").toLowerCase() : "";
  if (categories.includes("travel") || categories.includes("electronics")) return "Average ticket size";
  return "Spend participation";
}

function inferOfferConstruct(item) {
  if (item.spendThreshold) return String(item.spendThreshold);
  return "Threshold-led cashback or accelerated rewards";
}

function inferRiskFlags(item) {
  const categories = Array.isArray(item.merchantCategories) ? item.merchantCategories.join(", ").toLowerCase() : "";
  if (categories.includes("travel")) return "Watch lead-time risk and overlap with travel-sale periods";
  return "Watch overlap with existing category campaigns and promo fatigue";
}

function enrichIdea(item, monthKey) {
  const merchantCategories = Array.isArray(item.merchantCategories)
    ? item.merchantCategories.filter(Boolean)
    : [];

  const enriched = {
    ...item,
    monthKey,
    title: normalizeIdeaValue(item.title, "Untitled idea"),
    summary: normalizeIdeaValue(item.summary || item.concept || item.description || item.whyItWillWork, "No summary available."),
    targetSegment: normalizeIdeaValue(item.targetSegment || item.targetAudience || item.audience),
    suggestedTiming: normalizeIdeaValue(item.suggestedTiming || item.seasonalFit || item.timing),
    recommendedBudget: normalizeIdeaValue(item.recommendedBudget || item.budgetRecommendation || inferRecommendedBudget(item)),
    expectedImpact: normalizeIdeaValue(item.expectedImpact || inferExpectedImpact(item)),
    primaryMetric: normalizeIdeaValue(item.primaryMetric || inferPrimaryMetric(item)),
    offerConstruct: normalizeIdeaValue(item.offerConstruct || item.spendThreshold || inferOfferConstruct(item)),
    implementationNotes: normalizeIdeaValue(item.implementationNotes || item.strategicRationale || item.whyItWillWork),
    riskFlags: normalizeIdeaValue(item.riskFlags || inferRiskFlags(item)),
    merchantCategories
  };

  enriched.fingerprint = getIdeaFingerprint(enriched);
  return enriched;
}

function setupCardProgramFilter() {
  const dropdown = document.getElementById("card-program-filter");
  if (!dropdown) return;

  dropdown.value = state.selectedCardProgram;

  dropdown.addEventListener("change", () => {
    state.selectedCardProgram = dropdown.value;

    // re-render everything dependent
    renderCalendar(state.currentMonth);
    renderEvents(state.selectedDate);
  });
}

function dedupeIdeas(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = item.fingerprint || getIdeaFingerprint(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getExcludedIdeaFingerprints() {
  return state.ideaWidget.history
    .flatMap((set) => set.ideas || [])
    .map((idea) => idea.fingerprint)
    .filter(Boolean);
}

function saveIdeaHistoryToStorage() {
  try {
    localStorage.setItem(
      IDEA_HISTORY_KEY,
      JSON.stringify({
        history: state.ideaWidget.history.slice(-3),
        activeHistoryIndex: Math.min(state.ideaWidget.activeHistoryIndex, state.ideaWidget.history.slice(-3).length - 1)
      })
    );
  } catch (error) {
    console.warn("Failed to persist idea history", error);
  }
}

function loadIdeaHistoryFromStorage() {
  try {
    const raw = localStorage.getItem(IDEA_HISTORY_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.history)) return;
    state.ideaWidget.history = parsed.history;
    state.ideaWidget.activeHistoryIndex = typeof parsed.activeHistoryIndex === "number"
      ? parsed.activeHistoryIndex
      : parsed.history.length - 1;
  } catch (error) {
    console.warn("Failed to restore idea history", error);
  }
}

function pushIdeaSet(ideas, usage = null) {
  const monthKey = getCurrentMonthKey();
  const nextSet = {
    monthKey,
    createdAt: Date.now(),
    ideas,
    usage
  };

  const history = state.ideaWidget.history.filter((entry) => entry.monthKey === monthKey).slice(-2);
  history.push(nextSet);
  state.ideaWidget.history = history;
  state.ideaWidget.activeHistoryIndex = history.length - 1;
  state.ideaWidget.currentIdeaIndex = 0;
  saveIdeaHistoryToStorage();
}

function getActiveIdeaSet() {
  if (state.ideaWidget.activeHistoryIndex < 0) return null;
  return state.ideaWidget.history[state.ideaWidget.activeHistoryIndex] || null;
}

function restoreIdeasFromCacheForCurrentMonth() {
  const monthKey = getCurrentMonthKey();
  const matching = state.ideaWidget.history.filter((entry) => entry.monthKey === monthKey);
  if (!matching.length) return false;
  state.ideaWidget.history = matching.slice(-3);
  state.ideaWidget.activeHistoryIndex = state.ideaWidget.history.length - 1;
  state.ideaWidget.currentIdeaIndex = 0;
  renderCampaignIdeasResult({ campaignIdeas: getActiveIdeaSet()?.ideas || [] });
  renderCampaignIdeasStatus(getActiveIdeaSet()?.usage || null);
  syncIdeaWidgetControls();
  return true;
}

function renderCampaignIdeasStatus(usage, loading = false) {
  const statusEl = document.getElementById("campaign-ideas-status");
  if (!statusEl) return;
  if (loading) {
    statusEl.innerText = "Generating campaign ideas...";
    return;
  }
  if (!usage) {
    statusEl.innerText = "";
    return;
  }
  statusEl.innerHTML = `
    <div class="flex gap-2 text-xs">
      <span class="bg-gray-100 px-2 py-1 rounded">In: ${usage?.inputTokens || 0}</span>
      <span class="bg-gray-100 px-2 py-1 rounded">Out: ${usage?.outputTokens || 0}</span>
      <span class="bg-purple-100 text-purple-700 px-2 py-1 rounded">Total: ${usage?.totalTokens || 0}</span>
    </div>
  `;
}

function setIdeasLoading(isLoading) {
  state.ideaWidget.loading = isLoading;
  const refreshBtn = document.getElementById("run-campaign-ideas-btn");
  const spinner = document.getElementById("campaign-ideas-refresh-spinner");
  const label = document.getElementById("campaign-ideas-refresh-label");
  if (refreshBtn) {
    refreshBtn.disabled = isLoading;
    refreshBtn.classList.toggle("button-loading", isLoading);
  }
  if (spinner) spinner.classList.toggle("hidden", !isLoading);
  if (label) label.textContent = isLoading ? "Refreshing" : "Refresh";
  syncIdeaWidgetControls();
}

function syncIdeaWidgetControls() {
  const activeSet = getActiveIdeaSet();
  const ideas = activeSet?.ideas || [];
  const prevBtn = document.getElementById("campaign-ideas-prev-btn");
  const nextBtn = document.getElementById("campaign-ideas-next-btn");
  const currentEventsPrevBtn = document.getElementById("current-events-prev-btn");
  const currentEventsNextBtn = document.getElementById("current-events-next-btn");
  const undoBtn = document.getElementById("campaign-ideas-undo-btn");
  const position = document.getElementById("campaign-ideas-position");

  if (prevBtn) prevBtn.disabled = state.ideaWidget.loading || ideas.length <= 1;
  if (nextBtn) nextBtn.disabled = state.ideaWidget.loading || ideas.length <= 1;
  if (undoBtn) undoBtn.disabled = state.ideaWidget.loading || state.ideaWidget.activeHistoryIndex <= 0;
  if (position) {
    position.textContent = ideas.length
      ? `${state.ideaWidget.currentIdeaIndex + 1} / ${ideas.length}`
      : "0 / 0";
  }
}

function showPreviousIdea() {
  const activeSet = getActiveIdeaSet();
  const ideas = activeSet?.ideas || [];
  if (ideas.length <= 1) return;
  state.ideaWidget.currentIdeaIndex = (state.ideaWidget.currentIdeaIndex - 1 + ideas.length) % ideas.length;
  renderCampaignIdeasResult({ campaignIdeas: ideas });
}

function showNextIdea() {
  const activeSet = getActiveIdeaSet();
  const ideas = activeSet?.ideas || [];
  if (ideas.length <= 1) return;
  state.ideaWidget.currentIdeaIndex = (state.ideaWidget.currentIdeaIndex + 1) % ideas.length;
  renderCampaignIdeasResult({ campaignIdeas: ideas });
}

function undoCampaignIdeas() {
  if (state.ideaWidget.activeHistoryIndex <= 0) return;
  state.ideaWidget.activeHistoryIndex -= 1;
  state.ideaWidget.currentIdeaIndex = 0;
  const activeSet = getActiveIdeaSet();
  renderCampaignIdeasResult({ campaignIdeas: activeSet?.ideas || [] });
  renderCampaignIdeasStatus(activeSet?.usage || null);
  saveIdeaHistoryToStorage();
}

function loadIdeaWidgetLayout() {
  try {
    const raw = localStorage.getItem(IDEA_WIDGET_LAYOUT_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    state.ideaWidget.hidden = !!parsed.hidden;
    state.ideaWidget.column = parsed.column || "center";
  } catch (error) {
    console.warn("Failed to restore ideas widget layout", error);
  }
}

function saveIdeaWidgetLayout() {
  try {
    localStorage.setItem(IDEA_WIDGET_LAYOUT_KEY, JSON.stringify({
      hidden: state.ideaWidget.hidden,
      column: state.ideaWidget.column
    }));
  } catch (error) {
    console.warn("Failed to persist ideas widget layout", error);
  }
}

function getIdeasWidget() {
  return document.getElementById("campaign-ideas-widget");
}

function applyIdeasWidgetLayout() {
  const widget = getIdeasWidget();
  if (!widget) return;
  const targetColumn = document.querySelector(`[data-column-id="${state.ideaWidget.column}"]`);
  if (targetColumn && widget.parentElement !== targetColumn) {
    targetColumn.prepend(widget);
  }
  widget.classList.toggle("hidden", state.ideaWidget.hidden);
}

function getCalendarWidget() {
  return document.getElementById("calendar-events-widget");
}

function saveCalendarWidgetLayout() {
  try {
    localStorage.setItem(CALENDAR_WIDGET_LAYOUT_KEY, JSON.stringify(state.widgetLayout));
  } catch (error) {
    console.warn("Failed to persist calendar widget layout", error);
  }
}

function restoreCalendarWidgetLayout() {
  try {
    const raw = localStorage.getItem(CALENDAR_WIDGET_LAYOUT_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    state.widgetLayout = {
      ...state.widgetLayout,
      ...parsed
    };
  } catch (error) {
    console.warn("Failed to restore calendar widget layout", error);
  }
}

function applyCalendarWidgetLayout() {
  const widget = getCalendarWidget();
  if (!widget) return;
  const targetColumn = document.getElementById(`${state.widgetLayout.calendarColumn}-column`);
  if (targetColumn && widget.parentElement !== targetColumn) {
    targetColumn.prepend(widget);
  }
  widget.classList.toggle("hidden", state.widgetLayout.calendarHidden);
}

function renderHiddenWidgetsBar() {
  const bar = document.getElementById("hidden-widgets-bar");
  const list = document.getElementById("hidden-widgets-list");
  if (!bar || !list) return;

  list.innerHTML = "";

  if (state.widgetLayout.calendarHidden) {
    const calendarButton = document.createElement("button");
    calendarButton.type = "button";
    calendarButton.className = "hidden-widget-chip";
    calendarButton.textContent = "Restore Campaign calendar";
    calendarButton.addEventListener("click", showCalendarWidget);
    list.appendChild(calendarButton);
  }

  if (state.ideaWidget.hidden) {
    const ideasButton = document.createElement("button");
    ideasButton.type = "button";
    ideasButton.className = "hidden-widget-chip";
    ideasButton.textContent = "Restore Suggested campaign ideas";
    ideasButton.addEventListener("click", showIdeasWidget);
    list.appendChild(ideasButton);
  }

  bar.classList.toggle("hidden", !list.children.length);
}

function hideCalendarWidget() {
  const widget = getCalendarWidget();
  if (!widget) return;
  widget.classList.add("hidden");
  state.widgetLayout.calendarHidden = true;
  saveCalendarWidgetLayout();
  renderHiddenWidgetsBar();
}

function showCalendarWidget() {
  const widget = getCalendarWidget();
  if (!widget) return;
  widget.classList.remove("hidden");
  state.widgetLayout.calendarHidden = false;
  saveCalendarWidgetLayout();
  renderHiddenWidgetsBar();
}

function hideIdeasWidget() {
  const widget = getIdeasWidget();
  if (!widget) return;
  widget.classList.add("hidden");
  state.ideaWidget.hidden = true;
  saveIdeaWidgetLayout();
  renderHiddenWidgetsBar();
}

function showIdeasWidget() {
  const widget = getIdeasWidget();
  if (!widget) return;
  widget.classList.remove("hidden");
  state.ideaWidget.hidden = false;
  saveIdeaWidgetLayout();
  renderHiddenWidgetsBar();
}

function setupCalendarWidgetControls() {
  const widget = getCalendarWidget();
  const hideBtn = document.getElementById("calendar-widget-hide-btn");
  if (hideBtn) {
    hideBtn.addEventListener("click", hideCalendarWidget);
  }

  if (widget) {
    widget.addEventListener("dragstart", (event) => {
      event.dataTransfer?.setData("text/widget-id", widget.dataset.widgetId || "calendar-events");
      event.dataTransfer.effectAllowed = "move";
      widget.classList.add("widget-dragging");
    });

    widget.addEventListener("dragend", () => {
      widget.classList.remove("widget-dragging");
      document.querySelectorAll(".widget-dropzone-active").forEach((column) => {
        column.classList.remove("widget-dropzone-active");
      });
    });
  }
}

function buildDateOptimizerPayload() {
  const optimizeInput = document.getElementById("optimize-campaign-input");
  const userBrief = optimizeInput?.value?.trim() || "";

  return {
    objective: "Optimize campaign dates for peak user engagement",
    user_brief: userBrief,
    selected_date: formatISO(state.selectedDate),
    month_context: {
      year: state.currentMonth.getFullYear(),
      month: state.currentMonth.getMonth() + 1
    },
    holidays: state.holidays.map(normalizeEvent).map((e) => ({
      event_name: e.name,
      start_date: e.start,
      end_date: e.end
    })),
    recurring_events: state.recurring.map(normalizeEvent).map((e) => ({
      event_name: e.name,
      start_date: e.start,
      end_date: e.end
    })),
    campaigns: state.campaigns.map(normalizeEvent).map((e) => ({
      event_name: e.name,
      start_date: e.start,
      end_date: e.end,
      card_program: e.cardProgram,
      benefit_type: e.benefitType
    }))
  };
}

function buildCampaignIdeasPayload() {
  return {
    objective: "Generate high impact campaign ideas",
    selected_date: formatISO(state.selectedDate),
    month_context: {
      year: state.currentMonth.getFullYear(),
      month: state.currentMonth.getMonth() + 1
    },
    holidays: state.holidays.map(normalizeEvent).map((e) => ({
      event_name: e.name,
      start_date: e.start,
      end_date: e.end
    })),
    recurring_events: state.recurring.map(normalizeEvent).map((e) => ({
      event_name: e.name,
      start_date: e.start,
      end_date: e.end
    })),
    campaigns: state.campaigns.map(normalizeEvent).map((e) => ({
      event_name: e.name,
      start_date: e.start,
      end_date: e.end,
      card_program: e.cardProgram,
      benefit_type: e.benefitType
    }))
  };
}

function buildHFChatStartPayload(userMessage) {
  return {
    user_input: userMessage,
    data: {
      campaign_objective: "calendar planning support",
      selected_date: formatISO(state.selectedDate),
      month_context: {
        year: state.currentMonth.getFullYear(),
        month: state.currentMonth.getMonth() + 1
      },
      holidays: state.holidays.map(normalizeEvent).map((e) => ({
        event_name: e.name,
        start_date: e.start,
        end_date: e.end
      })),
      recurring_events: state.recurring.map(normalizeEvent).map((e) => ({
        event_name: e.name,
        start_date: e.start,
        end_date: e.end
      })),
      campaigns: state.campaigns.map(normalizeEvent).map((e) => ({
        event_name: e.name,
        start_date: e.start,
        end_date: e.end,
        card_program: e.cardProgram,
        benefit_type: e.benefitType
      }))
    }
  };
}

function isInRange(dateISO, start, end) {
  return dateISO >= start && dateISO <= end;
}

function isSameDate(a, b) {
  return formatISO(a) === formatISO(b);
}

function renderCalendar(date) {
  const grid = document.getElementById("calendar-grid");
  const monthLabel = document.getElementById("calendar-month-label");

  if (!grid || !monthLabel) return;

  grid.innerHTML = "";

  const month = date.getMonth();
  const year = date.getFullYear();

  monthLabel.innerText = date.toLocaleString("default", {
    month: "long",
    year: "numeric"
  });

  const firstDay = new Date(year, month, 1).getDay();
  const lastDate = new Date(year, month + 1, 0).getDate();
  const today = new Date();

  for (let i = 0; i < firstDay; i++) {
    const spacer = document.createElement("div");
    spacer.className = "calendar-spacer";
    grid.appendChild(spacer);
  }

  for (let d = 1; d <= lastDate; d++) {
    const fullDate = new Date(year, month, d);
    const iso = formatISO(fullDate);

    const hasAnyEvent = [...state.holidays, ...state.recurring, ...state.campaigns]
      .map(normalizeEvent)
      .some((e) => isInRange(iso, e.start, e.end));

    const hasHighConfidenceHoliday = state.holidays
      .map(normalizeEvent)
      .some((e) => e.confidence >= 95 && isInRange(iso, e.start, e.end));

    const has2026EndingCampaign = state.campaigns
      .map(normalizeEvent)
      .some((e) => {
        const endYear = new Date(e.end).getFullYear();
        return endYear === 2026 && isInRange(iso, e.start, e.end);
      });

    const isToday = isSameDate(fullDate, today);
    const isSelected = isSameDate(fullDate, state.selectedDate);

    const el = document.createElement("button");
    el.type = "button";

    const classNames = ["calendar-day-button"];
    if (isSelected || isToday) classNames.push("bg-blue-600");
    if (!isSelected && !isToday && hasAnyEvent) classNames.push("ring-1");

    el.className = classNames.join(" ");
    el.innerHTML = `
      <span class="calendar-day-number">${d}</span>
      ${hasHighConfidenceHoliday ? '<span class="calendar-holiday-dot"></span>' : ""}
      ${has2026EndingCampaign ? '<span class="calendar-campaign-dot"></span>' : ""}
    `;

    el.onclick = () => {
      state.selectedDate = fullDate;
      resetVisibleCounts();
      renderCalendar(state.currentMonth);
      renderEvents(fullDate);
    };

    grid.appendChild(el);
  }
}

function renderEvents(date) {
  const iso = formatISO(date);

  const holidays = state.holidays
    .map(normalizeEvent)
    .filter((e) => isInRange(iso, e.start, e.end));

  const recurring = state.recurring
    .map(normalizeEvent)
    .filter((e) => isInRange(iso, e.start, e.end));

  const campaigns = state.campaigns
    .map(normalizeEvent)
    .filter((e) => {
      const matchesDate = isInRange(iso, e.start, e.end);

      const matchesProgram =
        state.selectedCardProgram === "All" ||
        e.cardProgram === state.selectedCardProgram;

      return matchesDate && matchesProgram;
    });

  const holidayVisible = holidays.slice(0, state.visibleCounts.holiday);
  const recurringVisible = recurring.slice(0, state.visibleCounts.recurring);
  const campaignVisible = campaigns.slice(0, state.visibleCounts.campaign);

  const selectedDateLabel = document.getElementById("selected-date-label");
  const holidayCount = document.getElementById("holiday-count");
  const recurringCount = document.getElementById("recurring-count");
  const campaignCount = document.getElementById("campaign-count");

  if (selectedDateLabel) {
    selectedDateLabel.innerText = date.toDateString();
  }

  if (holidayCount) {
    holidayCount.innerText = `${holidays.length} event${holidays.length === 1 ? "" : "s"}`;
  }

  if (recurringCount) {
    recurringCount.innerText = `${recurring.length} event${recurring.length === 1 ? "" : "s"}`;
  }

  if (campaignCount) {
    campaignCount.innerText = `${campaigns.length} event${campaigns.length === 1 ? "" : "s"}`;
  }

  const holidayList = document.getElementById("holiday-list");
  const recurringList = document.getElementById("recurring-list");
  const campaignList = document.getElementById("campaign-list");

  if (holidayList) holidayList.innerHTML = renderEventCards(holidayVisible, "holiday");
  if (recurringList) recurringList.innerHTML = renderEventCards(recurringVisible, "recurring");
  if (campaignList) campaignList.innerHTML = renderEventCards(campaignVisible, "campaign");

  updateLoadMoreButton("holiday", holidays.length, holidayVisible.length);
  updateLoadMoreButton("recurring", recurring.length, recurringVisible.length);
  updateLoadMoreButton("campaign", campaigns.length, campaignVisible.length);
}

function updateLoadMoreButton(type, totalCount, visibleCount) {
  const btn = document.getElementById(`${type}-load-more-btn`);
  if (!btn) return;

  if (visibleCount < totalCount) {
    btn.classList.remove("hidden");
    btn.textContent = `Load more (${totalCount - visibleCount} remaining)`;
  } else {
    btn.classList.add("hidden");
  }
}

function renderEventCards(events, type) {
  if (!events.length) {
    return `<div class="compact-empty-state">No events</div>`;
  }

  return events
    .map((e) => {
      let bgClass = "bg-gray-50";
      if (type === "holiday") bgClass = "bg-red-50";
      if (type === "recurring") bgClass = "bg-yellow-50";
      if (type === "campaign") bgClass = "bg-green-50";

      const campaignMeta =
        type === "campaign"
          ? `<div class="compact-event-meta">${escapeHtml(e.cardProgram)} · ${escapeHtml(e.benefitType)}</div>`
          : "";

      return `
        <div class="compact-event-card ${bgClass}">
          <div class="compact-event-main">
            <div class="compact-event-title">${escapeHtml(e.name)}</div>
            <div class="compact-event-dates">${escapeHtml(e.start)} → ${escapeHtml(e.end)}</div>
          </div>
          ${campaignMeta}
        </div>
      `;
    })
    .join("");
}

async function readJsonResponse(response) {
  const text = await response.text();

  try {
    return {
      ok: response.ok,
      status: response.status,
      data: JSON.parse(text),
      rawText: text
    };
  } catch {
    return {
      ok: response.ok,
      status: response.status,
      data: null,
      rawText: text
    };
  }
}

async function runDateOptimizerAgent() {
  // 🛑 Prevent multiple rapid API calls
  if (isOptimizerRequestInFlight) return;
  isOptimizerRequestInFlight = true;

  const statusEl = document.getElementById("date-optimizer-status");
  const resultEl = document.getElementById("date-optimizer-result");

  if (statusEl) statusEl.innerText = "Analyzing campaign timing...";
  if (resultEl) {
    resultEl.innerHTML = `
      <div class="text-sm text-gray-500">Reviewing timing signals and campaign context...</div>
    `;
  }

  try {
    const payload = buildDateOptimizerPayload();

    const response = await fetch(`${API_BASE_URL}/api/optimize-campaign-dates`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const { ok, status, data, rawText } = await readJsonResponse(response);

    if (!ok) {
      throw new Error(
        data?.details ||
          data?.error ||
          rawText ||
          `Request failed with status ${status}`
      );
    }

    if (statusEl) {
      const usage = data?._usage;
      statusEl.innerHTML = `
        <div class="flex gap-2 text-xs">
          <span class="bg-gray-100 px-2 py-1 rounded">In: ${usage?.inputTokens || 0}</span>
          <span class="bg-gray-100 px-2 py-1 rounded">Out: ${usage?.outputTokens || 0}</span>
          <span class="bg-blue-100 text-blue-700 px-2 py-1 rounded">Total: ${usage?.totalTokens || 0}</span>
        </div>
      `;
    }

    renderDateOptimizerResult(data);

  } catch (error) {
    console.error("Optimize dates error:", error);

    if (statusEl) statusEl.innerText = "Failed to generate recommendation.";
    if (resultEl) {
      resultEl.innerHTML = `
        <div class="p-3 rounded-lg bg-red-50 text-red-700 text-sm">
          ${escapeHtml(error.message || "Optimize dates request failed.")}
        </div>
      `;
    }

  } finally {
    isOptimizerRequestInFlight = false; // 🔓 ALWAYS release lock
  }
}

async function runCampaignIdeasAgent(options = {}) {
  // 🛑 Prevent multiple rapid API calls
  if (isIdeasRequestInFlight) return;
  isIdeasRequestInFlight = true;

  const { silentLoading = false, forceRefresh = false } = options;

  if (!forceRefresh && restoreIdeasFromCacheForCurrentMonth()) {
    isIdeasRequestInFlight = false; // release lock
    return;
  }

  if (!silentLoading) {
    renderCampaignIdeasStatus(null, true);
  } else {
    const statusEl = document.getElementById("campaign-ideas-status");
    if (statusEl) statusEl.innerText = "Loading cached recommendations...";
  }

  setIdeasLoading(true);

  try {
    let successData = null;
    const monthKey = getCurrentMonthKey();
    const excluded = new Set(getExcludedIdeaFingerprints());

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const payload = buildCampaignIdeasPayload();
      payload.excluded_ideas = Array.from(excluded);

      const response = await fetch(`${API_BASE_URL}/api/generate-high-impact-campaign-ideas`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      const { ok, status, data, rawText } = await readJsonResponse(response);
      if (!ok) {
        throw new Error(data?.details || data?.error || rawText || `Request failed with status ${status}`);
      }

      const rawIdeas = Array.isArray(data?.campaignIdeas) ? data.campaignIdeas : [];
      const enrichedIdeas = dedupeIdeas(rawIdeas.map((item) => enrichIdea(item, monthKey)));

      const filteredIdeas = forceRefresh
        ? enrichedIdeas.filter((idea) => !excluded.has(idea.fingerprint))
        : enrichedIdeas;

      if (filteredIdeas.length >= 5 || !forceRefresh) {
        successData = {
          ...data,
          campaignIdeas: filteredIdeas.slice(0, 5)
        };
        break;
      }

      filteredIdeas.forEach((idea) => excluded.add(idea.fingerprint));
    }

    if (!successData || !Array.isArray(successData.campaignIdeas) || !successData.campaignIdeas.length) {
      throw new Error("Could not generate a new non-overlapping set of campaign ideas.");
    }

    pushIdeaSet(successData.campaignIdeas, successData?._usage || null);
    renderCampaignIdeasStatus(successData?._usage || null);
    renderCampaignIdeasResult(successData);

  } catch (error) {
    console.error("Campaign ideas error:", error);

    const statusEl = document.getElementById("campaign-ideas-status");
    const resultEl = document.getElementById("campaign-ideas-result");

    if (statusEl) statusEl.innerText = "Failed to generate campaign ideas.";

    if (resultEl) {
      resultEl.innerHTML = `
        <div class="p-3 rounded-lg bg-red-50 text-red-700 text-sm">
          ${escapeHtml(error.message || "Campaign ideas request failed.")}
        </div>
      `;
    }

  } finally {
    setIdeasLoading(false);
    isIdeasRequestInFlight = false; // 🔓 ALWAYS release lock
  }
}

async function runCalendarChatbot() {
  const inputEl = document.getElementById("chatbot-input");
  const statusEl = document.getElementById("chatbot-status");
  const messagesEl = document.getElementById("chatbot-messages");

  const question = inputEl?.value?.trim();
  if (!question) return;

  appendChatMessage("user", question);
  inputEl.value = "";
  if (statusEl) statusEl.innerText = "AI is thinking...";

  try {
    let response;
    let parsed;

    if (!hfChatStarted) {
      const startPayload = buildHFChatStartPayload(question);

      response = await fetch(`${API_BASE_URL}/api/hf-chat/start`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(startPayload)
      });

      parsed = await readJsonResponse(response);

      if (!parsed.ok) {
        throw new Error(
          parsed.data?.details?.detail ||
            parsed.data?.details?.message ||
            parsed.data?.details ||
            parsed.data?.error ||
            parsed.rawText ||
            "Failed to start conversation"
        );
      }

      const data = parsed.data;
      hfChatStarted = true;
      hfConversationId =
        data?.conversation_id ||
        data?.conversationId ||
        data?.chat_id ||
        data?.chatId ||
        data?.data?.conversation_id ||
        data?.result?.conversation_id ||
        null;

      const answer = extractChatAnswer(data);
      if (statusEl) statusEl.innerText = "Ready";
      appendChatMessage("assistant", String(answer));
    } else {
      response = await fetch(`${API_BASE_URL}/api/hf-chat/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          user_input: question,
          conversation_id: hfConversationId
        })
      });

      parsed = await readJsonResponse(response);

      if (!parsed.ok) {
        throw new Error(
          parsed.data?.details?.detail ||
            parsed.data?.details?.message ||
            parsed.data?.details ||
            parsed.data?.error ||
            parsed.rawText ||
            "Failed to continue conversation"
        );
      }

      const data = parsed.data;
      const answer = extractChatAnswer(data);
      if (statusEl) statusEl.innerText = "Ready";
      appendChatMessage("assistant", String(answer));
    }
  } catch (error) {
    console.error("Chatbot error:", error);
    if (statusEl) statusEl.innerText = "Failed";
    appendChatMessage("assistant", `Error: ${error.message || "Chat request failed."}`);
  }

  if (messagesEl) {
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }
}

async function apiRequest(url, options = {}) {
  try {
    const response = await fetch(url, options);
    const { ok, status, data, rawText } = await readJsonResponse(response);

    if (!ok) {
      throw new Error(
        data?.details ||
        data?.error ||
        rawText ||
        `Request failed (${status})`
      );
    }

    return data;
  } catch (error) {
    console.error("API Error:", error);
    throw error;
  }
}

function extractChatAnswer(data) {
  if (!data) return "No answer returned.";

  // 🔥 handle nested first-response formats
  if (typeof data === "object") {
    if (data.data) return extractChatAnswer(data.data);
    if (data.result) return extractChatAnswer(data.result);
  }

  const candidates = [
    data.answer,
    data.response,
    data.message,
    data.output,
    data.raw_output,
    data.chat_response
  ];

  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }

  return "No answer returned.";
}

function renderDateOptimizerResult(data) {
  const resultEl = document.getElementById("date-optimizer-result");
  if (!resultEl) return;

  const recommendations = Array.isArray(data?.recommendations)
    ? data.recommendations
    : [];

  if (!recommendations.length) {
    if (data?.raw_output) {
      resultEl.innerHTML = `
        <div class="p-4 rounded-xl border border-yellow-200 bg-yellow-50">
          <div class="font-semibold text-yellow-800 mb-2">Model returned unexpected format</div>
          <pre class="text-xs text-gray-700 whitespace-pre-wrap">${escapeHtml(data.raw_output)}</pre>
        </div>
      `;
      return;
    }

    resultEl.innerHTML = `
      <div class="text-sm text-gray-500">No recommendations returned.</div>
    `;
    return;
  }

  resultEl.innerHTML = recommendations
    .map((item) => {
      const title =
        item.event_name ||
        item.title ||
        "Campaign timing recommendation";

      const currentRange =
        item.current_start_date || item.current_end_date
          ? `${escapeHtml(item.current_start_date || "-")} → ${escapeHtml(item.current_end_date || "-")}`
          : null;

      const recommendedRange =
        item.recommended_start_date || item.recommended_end_date
          ? `${escapeHtml(item.recommended_start_date || "-")} → ${escapeHtml(item.recommended_end_date || "-")}`
          : null;

      return `
        <div class="p-4 rounded-xl border border-gray-200 bg-blue-50">
          <div class="flex justify-between items-center mb-2">
            <h4 class="font-semibold">${escapeHtml(title)}</h4>
            <span class="text-xs bg-white px-2 py-1 rounded border">
              ${escapeHtml(item.confidence || "Medium")}
            </span>
          </div>

          ${
            currentRange
              ? `<div class="text-sm mb-1"><strong>Current:</strong> ${currentRange}</div>`
              : ""
          }

          ${
            recommendedRange
              ? `<div class="text-sm mb-2"><strong>Recommended:</strong> ${recommendedRange}</div>`
              : ""
          }

          <div class="text-sm text-gray-600 mb-2">
            ${escapeHtml(item.reason || item.summary || "")}
          </div>

          ${
            item.engagement_rationale
              ? `<div class="text-xs text-gray-500">${escapeHtml(item.engagement_rationale)}</div>`
              : ""
          }
        </div>
      `;
    })
    .join("");
}

function renderCampaignIdeasResult(data) {
  const resultEl = document.getElementById("campaign-ideas-result");
  if (!resultEl) return;

  // ✅ SAVE chat UI before wiping
  const chatBox = document.querySelector(".ideas-interactive-box");

  const ideas = Array.isArray(data?.campaignIdeas) ? data.campaignIdeas : [];

  if (!ideas.length) {
    if (data?.raw_output) {
      resultEl.innerHTML = `
        <div class="p-4 rounded-xl border border-yellow-200 bg-yellow-50">
          <div class="font-semibold text-yellow-800 mb-2">Model returned unexpected format</div>
          <pre class="text-xs text-gray-700 whitespace-pre-wrap">${escapeHtml(data.raw_output)}</pre>
        </div>
      `;
    } else {
      resultEl.innerHTML = `<div class="text-sm text-gray-500">No campaign ideas returned.</div>`;
    }

    syncIdeaWidgetControls();

    // ✅ ALWAYS restore chat UI
    if (chatBox) {
      resultEl.parentElement.appendChild(chatBox);
    }

    return;
  }

  const safeIndex = Math.min(state.ideaWidget.currentIdeaIndex, ideas.length - 1);
  state.ideaWidget.currentIdeaIndex = Math.max(0, safeIndex);
  const item = ideas[state.ideaWidget.currentIdeaIndex];

  const categories = Array.isArray(item.merchantCategories) && item.merchantCategories.length
    ? item.merchantCategories.map((value) => `<span class="idea-tag">${escapeHtml(value)}</span>`).join("")
    : `<span class="idea-tag">General spend</span>`;

  resultEl.innerHTML = `
    <article class="idea-card compact-idea-card">
      <div class="compact-idea-topline">
        <h3>${escapeHtml(item.title)}</h3>
      </div>

      <p>${escapeHtml(item.summary)}</p>

      <div class="idea-stack compact-idea-stack">
        <div class="compact-idea-text-row"><span class="idea-meta-label">Segment</span><span>${escapeHtml(item.targetSegment)}</span></div>
        <div class="compact-idea-text-row"><span class="idea-meta-label">Timing</span><span>${escapeHtml(item.suggestedTiming)}</span></div>
        <div class="compact-idea-text-row"><span class="idea-meta-label">Budget</span><span>${escapeHtml(item.recommendedBudget)}</span></div>
        <div class="compact-idea-text-row"><span class="idea-meta-label">Impact</span><span>${escapeHtml(item.expectedImpact)}</span></div>
        <div class="compact-idea-text-row"><span class="idea-meta-label">Metric</span><span>${escapeHtml(item.primaryMetric)}</span></div>
        <div class="compact-idea-text-row"><span class="idea-meta-label">Offer</span><span>${escapeHtml(item.offerConstruct)}</span></div>
        <div class="compact-idea-text-row"><span class="idea-meta-label">Implementation</span><span>${escapeHtml(item.implementationNotes)}</span></div>
        <div class="compact-idea-text-row"><span class="idea-meta-label">Risk</span><span>${escapeHtml(item.riskFlags)}</span></div>
      </div>

      <div class="idea-tags-row">${categories}</div>
    </article>
    <button 
      class="primary-action mt-3"
      onclick="handleCreateCohortClick()"
    >
      Create Target Cohort
    </button>
  `;

  syncIdeaWidgetControls();

  // ✅ ALWAYS restore chat UI (MOST IMPORTANT FIX)
  if (chatBox) {
    resultEl.parentElement.appendChild(chatBox);
  }

  document.querySelector(".create-cohort-btn")?.addEventListener("click", () => {
  const idea = getActiveIdeaSet()?.ideas?.[state.ideaWidget.currentIdeaIndex];
  if (!idea) return;

  // simple mapping
  document.getElementById("cohort-card-program").value = "All";

  if (idea.targetSegment?.toLowerCase().includes("premium")) {
    document.getElementById("cohort-age").value = "30-55";
  }

  if (idea.merchantCategories?.includes("travel")) {
    document.getElementById("cohort-days-since-txn").value = "0-30";
  }

  // scroll into view
  document.getElementById("cohort-widget")?.scrollIntoView({ behavior: "smooth" });
});
}

function downloadCampaignCSV() {
  const activeSet = getActiveIdeaSet();
  const idea = activeSet?.ideas?.[state.ideaWidget.currentIdeaIndex];

  if (!idea) return;

  const headers = [
    "Campaign Name",
    "Campaign Description",
    "User Segment",
    "Timing",
    "Budget",
    "Impact",
    "Metric",
    "Offer",
    "Implementation",
    "Risk",
    "Category Tags"
  ];

  const row = [
    idea.title,
    idea.summary,
    idea.targetSegment,
    idea.suggestedTiming,
    idea.recommendedBudget,
    idea.expectedImpact,
    idea.primaryMetric,
    idea.offerConstruct,
    idea.implementationNotes,
    idea.riskFlags,
    (idea.merchantCategories || []).join(", ")
  ];

  const csvContent =
    headers.join(",") + "\n" +
    row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = "campaign_idea.csv";
  link.click();
}

function changeMonth(offset) {
  const currentSelectedDay = state.selectedDate.getDate();
  const nextMonth = new Date(
    state.currentMonth.getFullYear(),
    state.currentMonth.getMonth() + offset,
    1
  );
  const maxDay = new Date(nextMonth.getFullYear(), nextMonth.getMonth() + 1, 0).getDate();
  const safeDay = Math.min(currentSelectedDay, maxDay);

  state.currentMonth = nextMonth;
  state.selectedDate = new Date(nextMonth.getFullYear(), nextMonth.getMonth(), safeDay);
  resetVisibleCounts();
  renderCalendar(state.currentMonth);
  renderEvents(state.selectedDate);

  const restored = restoreIdeasFromCacheForCurrentMonth();
  if (!restored) {
    runCampaignIdeasAgent({ silentLoading: true });
  }
}

function jumpToToday() {
  const today = new Date();
  state.currentMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  state.selectedDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  resetVisibleCounts();
  renderCalendar(state.currentMonth);
  renderEvents(state.selectedDate);

  const restored = restoreIdeasFromCacheForCurrentMonth();
  if (!restored) {
    runCampaignIdeasAgent({ silentLoading: true });
  }
}

function parseRange(value) {
  if (!value) return null;

  const parts = value.split("-");
  if (parts.length === 2) {
    return { min: Number(parts[0]), max: Number(parts[1]) };
  }

  return { min: Number(value), max: Number(value) };
}

function buildCohortPayload() {
  return {
    account_vintage: parseRange(document.getElementById("cohort-account-vintage")?.value),
    card_program: document.getElementById("cohort-card-program")?.value,
    days_since_txn: parseRange(document.getElementById("cohort-days-since-txn")?.value),
    age: parseRange(document.getElementById("cohort-age")?.value),
    gender: document.getElementById("cohort-gender")?.value,
    tier1: document.getElementById("cohort-tier1")?.value,
    location: Array.from(document.getElementById("cohort-location")?.selectedOptions || []).map(o => o.value)
  };
}

function setInputValue(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value || "";
}

function handleCreateCohortClick() {
  const activeSet = getActiveIdeaSet();
  const idea = activeSet?.ideas?.[state.ideaWidget.currentIdeaIndex];

  if (idea?.cohort_filters) {
    const f = idea.cohort_filters;

    document.getElementById("cohort-account-vintage").value = f.account_vintage || "";
    document.getElementById("cohort-card-program").value = f.card_program || "All";
    document.getElementById("cohort-days-since-txn").value = f.days_since_last_txn || "";
    document.getElementById("cohort-age").value = f.age || "";
    document.getElementById("cohort-gender").value = f.gender || "All";
    document.getElementById("cohort-tier1").value = f.tier1_resident || "All";
  }

  const widget = document.getElementById("cohort-widget");
  if (!widget) return;

  // 🔥 Smooth scroll
  widget.scrollIntoView({
    behavior: "smooth",
    block: "center"
  });

  // 🔥 Add highlight effect
  widget.classList.add("cohort-highlight");

  setTimeout(() => {
    widget.classList.remove("cohort-highlight");
  }, 1500);
}

async function runCohortBuilder() {
  const resultEl = document.getElementById("cohort-result");
  const btn = document.getElementById("run-cohort-btn");

  if (btn) btn.disabled = true;
  if (resultEl) resultEl.innerText = "Calculating...";

  try {
    const payload = buildCohortPayload();

    const response = await fetch(`${API_BASE_URL}/api/cohort/count`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const { ok, data } = await readJsonResponse(response);

    if (!ok) throw new Error("Failed");

    state.cohort.filters = payload;
    state.cohort.count = data.count;

    if (resultEl) {
      resultEl.innerText = `Total Users: ${data.count.toLocaleString()}`;
    }

  } catch (e) {
    if (resultEl) {
      resultEl.innerText = "Error calculating cohort";
    }
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function downloadCohortCSV() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/cohort/download`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(state.cohort.filters)
    });

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = "cohort.csv";
    link.click();

  } catch (e) {
    console.error(e);
  }
}

function appendChatMessage(role, text) {
  const messagesEl = document.getElementById("chatbot-messages");
  if (!messagesEl) return;

  const wrapper = document.createElement("div");
  wrapper.className =
    role === "user"
      ? "assistant-message assistant-message-user"
      : "assistant-message assistant-message-bot";

  const bubble = document.createElement("div");
  bubble.className = "assistant-bubble";
  bubble.textContent = text;

  wrapper.appendChild(bubble);
  messagesEl.appendChild(wrapper);
}

function startNewChatSession() {
  hfChatStarted = false;
  hfConversationId = null;

  const messagesEl = document.getElementById("chatbot-messages");
  const statusEl = document.getElementById("chatbot-status");

  if (messagesEl) {
    messagesEl.innerHTML = `
      <div class="assistant-message assistant-message-bot">
        <div class="assistant-bubble">
          Started a fresh chat. What would you like to know?
        </div>
      </div>
    `;
  }

  if (statusEl) {
    statusEl.innerText = "Ready";
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
