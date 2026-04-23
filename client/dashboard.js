import { api } from "./api.js";
import { state, setCalendarData, cacheEvents, getCachedEvents, cacheLlm, getCachedLlm, resetVisibleCounts } from "./state.js";

function formatISO(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeEvent(e) {
  return {
    name: e.event_name || e.eventName || "Untitled Event",
    start: e.start_date || e.startDate,
    end: e.end_date || e.endDate,
    cardProgram: e.card_program || e.cardProgram || "-",
    benefitType: e.benefit_type || e.benefitType || "-",
  };
}

function isInRange(dateISO, start, end) {
  return dateISO >= start && dateISO <= end;
}

function isSameDate(a, b) {
  return formatISO(a) === formatISO(b);
}

function sameMonth(dateA, dateB) {
  return dateA.getFullYear() === dateB.getFullYear() && dateA.getMonth() === dateB.getMonth();
}

function buildBasePayload() {
  return {
    selected_date: formatISO(state.selectedDate),
    month_context: {
      year: state.currentMonth.getFullYear(),
      month: state.currentMonth.getMonth() + 1,
    },
    holidays: state.entities.holidays.map(normalizeEvent).map((e) => ({ event_name: e.name, start_date: e.start, end_date: e.end })),
    recurring_events: state.entities.recurring.map(normalizeEvent).map((e) => ({ event_name: e.name, start_date: e.start, end_date: e.end })),
    campaigns: state.entities.campaigns.map(normalizeEvent).map((e) => ({
      event_name: e.name,
      start_date: e.start,
      end_date: e.end,
      card_program: e.cardProgram,
      benefit_type: e.benefitType,
    })),
  };
}

function buildDateOptimizerPayload() {
  const optimizeInput = document.getElementById("optimize-campaign-input");
  return {
    objective: "Optimize campaign dates for peak user engagement",
    user_brief: optimizeInput?.value?.trim() || "",
    ...buildBasePayload(),
  };
}

function buildCampaignIdeasPayload() {
  return {
    objective: "Generate high impact campaign ideas",
    ...buildBasePayload(),
  };
}

function buildHFChatStartPayload(userMessage) {
  return {
    user_input: userMessage,
    data: {
      campaign_objective: "calendar planning support",
      ...buildBasePayload(),
    },
  };
}

function renderEventCards(events, type) {
  if (!events.length) {
    return `<div class="text-sm text-gray-500 bg-gray-50 border border-dashed border-gray-200 rounded p-3">No events</div>`;
  }

  return events.map((e) => {
    let bgClass = "bg-gray-50";
    if (type === "holiday") bgClass = "bg-red-50";
    if (type === "recurring") bgClass = "bg-yellow-50";
    if (type === "campaign") bgClass = "bg-green-50";

    const campaignMeta = type === "campaign"
      ? `<div class="text-xs text-gray-500 mt-1">Card: ${escapeHtml(e.cardProgram)} | Benefit: ${escapeHtml(e.benefitType)}</div>`
      : "";

    return `
      <div class="p-3 rounded border border-gray-200 ${bgClass}">
        <div class="font-semibold">${escapeHtml(e.name)}</div>
        <div class="text-xs text-gray-600 mt-1">${escapeHtml(e.start)} → ${escapeHtml(e.end)}</div>
        ${campaignMeta}
      </div>
    `;
  }).join("");
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

export function renderCalendar(date) {
  const grid = document.getElementById("calendar-grid");
  const monthLabel = document.getElementById("calendar-month-label");
  if (!grid || !monthLabel) return;

  grid.innerHTML = "";
  const month = date.getMonth();
  const year = date.getFullYear();

  monthLabel.innerText = date.toLocaleString("default", { month: "long", year: "numeric" });

  const firstDay = new Date(year, month, 1).getDay();
  const lastDate = new Date(year, month + 1, 0).getDate();
  const today = new Date();

  for (let i = 0; i < firstDay; i += 1) {
    const spacer = document.createElement("div");
    spacer.className = "calendar-spacer";
    grid.appendChild(spacer);
  }

  for (let d = 1; d <= lastDate; d += 1) {
    const fullDate = new Date(year, month, d);
    const iso = formatISO(fullDate);
    const hasAnyEvent = [...state.entities.holidays, ...state.entities.recurring, ...state.entities.campaigns]
      .map(normalizeEvent)
      .some((e) => isInRange(iso, e.start, e.end));

    const isToday = isSameDate(fullDate, today);
    const isSelected = isSameDate(fullDate, state.selectedDate);

    const el = document.createElement("button");
    el.type = "button";
    const classNames = [];
    if (isSelected || isToday) classNames.push("bg-blue-600");
    if (!isSelected && !isToday && hasAnyEvent) classNames.push("ring-1");
    el.className = classNames.join(" ");
    el.innerText = d;
    el.onclick = async () => {
      state.selectedDate = fullDate;
      resetVisibleCounts();
      renderCalendar(state.currentMonth);
      await renderEvents(fullDate);
    };
    grid.appendChild(el);
  }
}

export async function renderEvents(date) {
  const iso = formatISO(date);
  const cached = getCachedEvents(iso);
  const payload = cached || await api.getEventsForDate(iso);
  if (!cached) cacheEvents(iso, payload);

  const holidays = (payload.holidays || []).map(normalizeEvent);
  const recurring = (payload.recurring_events || []).map(normalizeEvent);
  const campaigns = (payload.campaigns || []).map(normalizeEvent);

  const holidayVisible = holidays.slice(0, state.ui.visibleCounts.holiday);
  const recurringVisible = recurring.slice(0, state.ui.visibleCounts.recurring);
  const campaignVisible = campaigns.slice(0, state.ui.visibleCounts.campaign);

  const selectedDateLabel = document.getElementById("selected-date-label");
  const holidayCount = document.getElementById("holiday-count");
  const recurringCount = document.getElementById("recurring-count");
  const campaignCount = document.getElementById("campaign-count");
  const holidayList = document.getElementById("holiday-list");
  const recurringList = document.getElementById("recurring-list");
  const campaignList = document.getElementById("campaign-list");

  if (selectedDateLabel) selectedDateLabel.innerText = date.toDateString();
  if (holidayCount) holidayCount.innerText = `${holidays.length} event${holidays.length === 1 ? "" : "s"}`;
  if (recurringCount) recurringCount.innerText = `${recurring.length} event${recurring.length === 1 ? "" : "s"}`;
  if (campaignCount) campaignCount.innerText = `${campaigns.length} event${campaigns.length === 1 ? "" : "s"}`;
  if (holidayList) holidayList.innerHTML = renderEventCards(holidayVisible, "holiday");
  if (recurringList) recurringList.innerHTML = renderEventCards(recurringVisible, "recurring");
  if (campaignList) campaignList.innerHTML = renderEventCards(campaignVisible, "campaign");

  updateLoadMoreButton("holiday", holidays.length, holidayVisible.length);
  updateLoadMoreButton("recurring", recurring.length, recurringVisible.length);
  updateLoadMoreButton("campaign", campaigns.length, campaignVisible.length);
}

function renderExplainability(explainability) {
  if (!explainability) return "";

  const conflicts = (explainability.conflicts_considered || []).map((item) => `<li>${escapeHtml(typeof item === "string" ? item : item.event_name || JSON.stringify(item))}</li>`).join("");
  const signals = (explainability.strongest_signals || []).map((item) => `<li>${escapeHtml(typeof item === "string" ? item : item.event_name || JSON.stringify(item))}</li>`).join("");
  const compared = (explainability.compared_campaigns || []).map((item) => `<li>${escapeHtml(item.event_name || item)}</li>`).join("");

  return `
    <div class="explainability-card">
      <div class="explainability-title">Explainability trace</div>
      <div class="text-xs text-gray-600 mb-2"><strong>Why this date?</strong> ${escapeHtml(explainability.why_this_date || "Not available")}</div>
      <div class="text-xs text-gray-600 mb-2"><strong>Conflicts considered:</strong><ul>${conflicts || "<li>None surfaced</li>"}</ul></div>
      <div class="text-xs text-gray-600 mb-2"><strong>Strongest signals:</strong><ul>${signals || "<li>Not available</li>"}</ul></div>
      <div class="text-xs text-gray-600"><strong>Compared campaigns:</strong><ul>${compared || "<li>None surfaced</li>"}</ul></div>
    </div>
  `;
}

function renderDateOptimizerResult(data) {
  const resultEl = document.getElementById("date-optimizer-result");
  if (!resultEl) return;

  const recommendations = Array.isArray(data?.recommendations) ? data.recommendations : [];
  if (!recommendations.length) {
    if (data?.raw_output) {
      resultEl.innerHTML = `<div class="p-4 rounded-xl border border-yellow-200 bg-yellow-50"><div class="font-semibold text-yellow-800 mb-2">Model returned unexpected format</div><pre class="text-xs text-gray-700 whitespace-pre-wrap">${escapeHtml(data.raw_output)}</pre></div>`;
      return;
    }
    resultEl.innerHTML = `<div class="text-sm text-gray-500">No recommendations returned.</div>`;
    return;
  }

  resultEl.innerHTML = recommendations.map((item) => {
    const title = item.event_name || item.title || "Campaign timing recommendation";
    const currentRange = item.current_start_date || item.current_end_date ? `${escapeHtml(item.current_start_date || "-")} → ${escapeHtml(item.current_end_date || "-")}` : null;
    const recommendedRange = item.recommended_start_date || item.recommended_end_date ? `${escapeHtml(item.recommended_start_date || "-")} → ${escapeHtml(item.recommended_end_date || "-")}` : null;

    return `
      <div class="p-4 rounded-xl border border-gray-200 bg-blue-50">
        <div class="flex justify-between items-center mb-2">
          <h4 class="font-semibold">${escapeHtml(title)}</h4>
          <span class="text-xs bg-white px-2 py-1 rounded border">${escapeHtml(item.confidence || "Medium")}</span>
        </div>
        ${currentRange ? `<div class="text-sm mb-1"><strong>Current:</strong> ${currentRange}</div>` : ""}
        ${recommendedRange ? `<div class="text-sm mb-2"><strong>Recommended:</strong> ${recommendedRange}</div>` : ""}
        <div class="text-sm text-gray-600 mb-2">${escapeHtml(item.reason || item.summary || "")}</div>
        ${item.engagement_rationale ? `<div class="text-xs text-gray-500 mb-2">${escapeHtml(item.engagement_rationale)}</div>` : ""}
        ${renderExplainability(item.explainability)}
      </div>
    `;
  }).join("");
}

function renderCampaignIdeasResult(data) {
  const resultEl = document.getElementById("campaign-ideas-result");
  if (!resultEl) return;
  const ideas = Array.isArray(data?.campaignIdeas) ? data.campaignIdeas : [];

  if (!ideas.length) {
    if (data?.raw_output) {
      resultEl.innerHTML = `<div class="p-4 rounded-xl border border-yellow-200 bg-yellow-50"><div class="font-semibold text-yellow-800 mb-2">Model returned unexpected format</div><pre class="text-xs text-gray-700 whitespace-pre-wrap">${escapeHtml(data.raw_output)}</pre></div>`;
      return;
    }
    resultEl.innerHTML = `<div class="text-sm text-gray-500">No campaign ideas returned.</div>`;
    return;
  }

  resultEl.innerHTML = ideas.map((item) => {
    const title = item.title || "Untitled idea";
    const summary = item.summary || item.concept || item.description || item.whyItWillWork || "";
    const targetSegment = item.targetSegment || item.targetAudience || item.audience || "-";
    const suggestedTiming = item.suggestedTiming || item.seasonalFit || item.timing || "-";

    return `
      <article class="idea-card">
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(summary)}</p>
        <div class="idea-meta-grid">
          <div class="idea-meta"><span class="idea-meta-label">Segment</span><span>${escapeHtml(targetSegment)}</span></div>
          <div class="idea-meta"><span class="idea-meta-label">Timing</span><span>${escapeHtml(suggestedTiming)}</span></div>
        </div>
      </article>
    `;
  }).join("");
}

function appendChatMessage(role, text) {
  const messagesEl = document.getElementById("chatbot-messages");
  if (!messagesEl) return;
  const wrapper = document.createElement("div");
  wrapper.className = role === "user" ? "assistant-message assistant-message-user" : "assistant-message assistant-message-bot";
  const bubble = document.createElement("div");
  bubble.className = "assistant-bubble";
  bubble.textContent = text;
  wrapper.appendChild(bubble);
  messagesEl.appendChild(wrapper);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function extractChatAnswer(data) {
  if (!data) return "No answer returned.";
  const candidates = [data.answer, data.response, data.message, data.output, data.raw_output, data.data?.answer, data.data?.response, data.data?.message, data.result?.answer, data.result?.response, data.result?.message, data.chat_response, data.data?.chat_response, data.result?.chat_response];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) return value;
  }
  return typeof data === "object" ? JSON.stringify(data, null, 2) : String(data);
}

async function runDateOptimizerAgent() {
  const statusEl = document.getElementById("date-optimizer-status");
  const resultEl = document.getElementById("date-optimizer-result");
  const payload = buildDateOptimizerPayload();
  const cacheKey = `optimizer:${JSON.stringify(payload)}`;

  if (statusEl) statusEl.innerText = "Analyzing campaign timing...";
  if (resultEl) resultEl.innerHTML = `<div class="text-sm text-gray-500">Reviewing timing signals and campaign context...</div>`;

  try {
    const cached = getCachedLlm(cacheKey);
    const data = cached || await api.optimizeCampaignDates(payload);
    if (!cached) cacheLlm(cacheKey, data);

    if (statusEl) {
      const usage = data?._usage;
      statusEl.innerHTML = `<div class="flex gap-2 text-xs"><span class="bg-gray-100 px-2 py-1 rounded">In: ${usage?.inputTokens || 0}</span><span class="bg-gray-100 px-2 py-1 rounded">Out: ${usage?.outputTokens || 0}</span><span class="bg-blue-100 text-blue-700 px-2 py-1 rounded">Total: ${usage?.totalTokens || 0}</span><span class="bg-green-100 text-green-700 px-2 py-1 rounded">${data?._cache?.hit ? "Cache" : "Fresh"}</span></div>`;
    }

    renderDateOptimizerResult(data);
  } catch (error) {
    if (statusEl) statusEl.innerText = "Failed to generate recommendation.";
    if (resultEl) resultEl.innerHTML = `<div class="p-3 rounded-lg bg-red-50 text-red-700 text-sm">${escapeHtml(error.message || "Optimize dates request failed.")}</div>`;
  }
}

async function runCampaignIdeasAgent(options = {}) {
  const { silentLoading = false } = options;
  const statusEl = document.getElementById("campaign-ideas-status");
  const resultEl = document.getElementById("campaign-ideas-result");
  const payload = buildCampaignIdeasPayload();
  const cacheKey = `ideas:${JSON.stringify(payload)}`;

  if (statusEl) statusEl.innerText = silentLoading ? "Loading surfaced recommendations..." : "Generating campaign ideas...";

  try {
    const cached = getCachedLlm(cacheKey);
    const data = cached || await api.generateCampaignIdeas(payload);
    if (!cached) cacheLlm(cacheKey, data);

    if (statusEl) {
      const usage = data?._usage;
      statusEl.innerHTML = `<div class="flex gap-2 text-xs"><span class="bg-gray-100 px-2 py-1 rounded">In: ${usage?.inputTokens || 0}</span><span class="bg-gray-100 px-2 py-1 rounded">Out: ${usage?.outputTokens || 0}</span><span class="bg-purple-100 text-purple-700 px-2 py-1 rounded">Total: ${usage?.totalTokens || 0}</span><span class="bg-green-100 text-green-700 px-2 py-1 rounded">${data?._cache?.hit ? "Cache" : "Fresh"}</span></div>`;
    }

    renderCampaignIdeasResult(data);
  } catch (error) {
    if (statusEl) statusEl.innerText = "Failed to generate campaign ideas.";
    if (resultEl) resultEl.innerHTML = `<div class="p-3 rounded-lg bg-red-50 text-red-700 text-sm">${escapeHtml(error.message || "Campaign ideas request failed.")}</div>`;
  }
}

async function runCalendarChatbot() {
  const inputEl = document.getElementById("chatbot-input");
  const statusEl = document.getElementById("chatbot-status");
  const question = inputEl?.value?.trim();
  if (!question) return;

  appendChatMessage("user", question);
  inputEl.value = "";
  if (statusEl) statusEl.innerText = "AI is thinking...";

  try {
    let data;
    if (!state.chat.started) {
      data = await api.startChat(buildHFChatStartPayload(question));
      state.chat.started = true;
      state.chat.conversationId = data?.conversation_id || null;
    } else {
      data = await api.continueChat({ user_input: question, conversation_id: state.chat.conversationId });
    }

    appendChatMessage("assistant", extractChatAnswer(data));
    if (statusEl) statusEl.innerText = "Ready";
  } catch (error) {
    appendChatMessage("assistant", `Error: ${error.message || "Chat request failed."}`);
    if (statusEl) statusEl.innerText = "Failed";
  }
}

function startNewChatSession() {
  state.chat.started = false;
  state.chat.conversationId = null;
  const messagesEl = document.getElementById("chatbot-messages");
  const statusEl = document.getElementById("chatbot-status");
  if (messagesEl) {
    messagesEl.innerHTML = `<div class="assistant-message assistant-message-bot"><div class="assistant-bubble">Started a fresh chat. What would you like to know?</div></div>`;
  }
  if (statusEl) statusEl.innerText = "Ready";
}

function setupChatUI() {
  const sendBtn = document.getElementById("chatbot-send-btn");
  const input = document.getElementById("chatbot-input");
  const newChatBtn = document.getElementById("chatbot-new-chat-btn");
  if (sendBtn) sendBtn.onclick = runCalendarChatbot;
  if (input) {
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        runCalendarChatbot();
      }
    });
  }
  if (newChatBtn) newChatBtn.onclick = startNewChatSession;
}

function setupOptimizerSuggestionChips() {
  const textarea = document.getElementById("optimize-campaign-input");
  const chips = document.querySelectorAll(".suggestion-chip");
  if (!textarea || !chips.length) return;
  chips.forEach((chip) => {
    chip.addEventListener("click", () => {
      const text = chip.textContent.trim();
      textarea.value = textarea.value.trim() ? `${textarea.value.trim()} ${text}` : text;
      textarea.focus();
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    });
  });
}

function setupLoadMoreButtons() {
  const bindings = ["holiday", "recurring", "campaign"];
  for (const type of bindings) {
    const btn = document.getElementById(`${type}-load-more-btn`);
    if (!btn) continue;
    btn.addEventListener("click", async () => {
      state.ui.visibleCounts[type] += state.ui.loadStep[type];
      await renderEvents(state.selectedDate);
    });
  }
}

export async function changeMonth(offset) {
  state.currentMonth = new Date(state.currentMonth.getFullYear(), state.currentMonth.getMonth() + offset, 1);
  if (!sameMonth(state.selectedDate, state.currentMonth)) {
    state.selectedDate = new Date(state.currentMonth.getFullYear(), state.currentMonth.getMonth(), 1);
  }
  resetVisibleCounts();
  renderCalendar(state.currentMonth);
  await renderEvents(state.selectedDate);
}

export async function initializeDashboard() {
  const data = state.cache.calendarData || await api.getCalendarData();
  if (!state.cache.calendarData) setCalendarData(data);

  renderCalendar(state.currentMonth);
  await renderEvents(state.selectedDate);
  setupChatUI();
  setupOptimizerSuggestionChips();
  setupLoadMoreButtons();

  const prevBtn = document.getElementById("prev-month-btn");
  const nextBtn = document.getElementById("next-month-btn");
  const optimizerBtn = document.getElementById("run-date-optimizer-btn");
  const ideasBtn = document.getElementById("run-campaign-ideas-btn");
  if (prevBtn) prevBtn.onclick = () => changeMonth(-1);
  if (nextBtn) nextBtn.onclick = () => changeMonth(1);
  if (optimizerBtn) optimizerBtn.onclick = runDateOptimizerAgent;
  if (ideasBtn) ideasBtn.onclick = () => runCampaignIdeasAgent();

  await runCampaignIdeasAgent({ silentLoading: true });
}
