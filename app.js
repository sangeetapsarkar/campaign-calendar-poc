const API_BASE_URL = "http://localhost:3000";

let hfChatStarted = false;
let hfConversationId = null;

const state = {
  currentMonth: new Date(),
  selectedDate: new Date(),
  holidays: [],
  recurring: [],
  campaigns: [],
  visibleCounts: {
    holiday: 10,
    recurring: 10,
    campaign: 10
  },
  loadStep: {
    holiday: 5,
    recurring: 5,
    campaign: 10
  }
};

init();

async function init() {
  await loadData();

  renderCalendar(state.currentMonth);
  renderEvents(state.selectedDate);
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
  if (ideasBtn) ideasBtn.onclick = runCampaignIdeasAgent;

  await runCampaignIdeasAgent({ silentLoading: true });
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
    state.campaigns = await c.json();
  } catch (err) {
    console.error("JSON load failed, using fallback data", err);

    state.holidays = [
      { event_name: "Holi", start_date: "2026-03-18", end_date: "2026-03-18" },
      { event_name: "Shopping Festival", start_date: "2026-03-20", end_date: "2026-03-25" }
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
    benefitType: e.benefit_type || e.benefitType || "-"
  };
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

    const isToday = isSameDate(fullDate, today);
    const isSelected = isSameDate(fullDate, state.selectedDate);

    const el = document.createElement("button");
    el.type = "button";

    const classNames = [];
    if (isSelected || isToday) classNames.push("bg-blue-600");
    if (!isSelected && !isToday && hasAnyEvent) classNames.push("ring-1");

    el.className = classNames.join(" ");
    el.innerText = d;

    el.onclick = () => {
      state.selectedDate = fullDate;
      state.visibleCounts.holiday = 10;
      state.visibleCounts.recurring = 10;
      state.visibleCounts.campaign = 10;
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
    .filter((e) => isInRange(iso, e.start, e.end));

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
    return `<div class="text-sm text-gray-500 bg-gray-50 border border-dashed border-gray-200 rounded p-3">No events</div>`;
  }

  return events
    .map((e) => {
      let bgClass = "bg-gray-50";
      if (type === "holiday") bgClass = "bg-red-50";
      if (type === "recurring") bgClass = "bg-yellow-50";
      if (type === "campaign") bgClass = "bg-green-50";

      const campaignMeta =
        type === "campaign"
          ? `<div class="text-xs text-gray-500 mt-1">Card: ${escapeHtml(e.cardProgram)} | Benefit: ${escapeHtml(e.benefitType)}</div>`
          : "";

      return `
        <div class="p-3 rounded border border-gray-200 ${bgClass}">
          <div class="font-semibold">${escapeHtml(e.name)}</div>
          <div class="text-xs text-gray-600 mt-1">${escapeHtml(e.start)} → ${escapeHtml(e.end)}</div>
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
  }
}

async function runCampaignIdeasAgent(options = {}) {
  const { silentLoading = false } = options;
  const statusEl = document.getElementById("campaign-ideas-status");
  const resultEl = document.getElementById("campaign-ideas-result");

  if (!silentLoading) {
    if (statusEl) statusEl.innerText = "Generating campaign ideas...";
  } else {
    if (statusEl) statusEl.innerText = "Loading surfaced recommendations...";
  }

  try {
    const payload = buildCampaignIdeasPayload();

    const response = await fetch(`${API_BASE_URL}/api/generate-high-impact-campaign-ideas`, {
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
          <span class="bg-purple-100 text-purple-700 px-2 py-1 rounded">Total: ${usage?.totalTokens || 0}</span>
        </div>
      `;
    }

    renderCampaignIdeasResult(data);
  } catch (error) {
    console.error("Campaign ideas error:", error);

    if (statusEl) statusEl.innerText = "Failed to generate campaign ideas.";
    if (resultEl) {
      resultEl.innerHTML = `
        <div class="p-3 rounded-lg bg-red-50 text-red-700 text-sm">
          ${escapeHtml(error.message || "Campaign ideas request failed.")}
        </div>
      `;
    }
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

function extractChatAnswer(data) {
  if (!data) return "No answer returned.";

  const candidates = [
    data.answer,
    data.response,
    data.message,
    data.output,
    data.raw_output,
    data.data?.answer,
    data.data?.response,
    data.data?.message,
    data.result?.answer,
    data.result?.response,
    data.result?.message,
    data.chat_response,
    data.data?.chat_response,
    data.result?.chat_response
  ];

  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }

  if (typeof data === "object") {
    return JSON.stringify(data, null, 2);
  }

  return String(data);
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

  const ideas = Array.isArray(data?.campaignIdeas)
    ? data.campaignIdeas
    : [];

  if (!ideas.length) {
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
      <div class="text-sm text-gray-500">No campaign ideas returned.</div>
    `;
    return;
  }

  resultEl.innerHTML = ideas
    .map((item) => {
      const title = item.title || "Untitled idea";
      const summary =
        item.summary ||
        item.concept ||
        item.description ||
        item.whyItWillWork ||
        "";

      const targetSegment =
        item.targetSegment ||
        item.targetAudience ||
        item.audience ||
        "-";

      const suggestedTiming =
        item.suggestedTiming ||
        item.seasonalFit ||
        item.timing ||
        "-";

      return `
        <article class="idea-card">
          <h3>${escapeHtml(title)}</h3>
          <p>${escapeHtml(summary)}</p>

          <div class="idea-meta-grid">
            <div class="idea-meta">
              <span class="idea-meta-label">Segment</span>
              <span>${escapeHtml(targetSegment)}</span>
            </div>

            <div class="idea-meta">
              <span class="idea-meta-label">Timing</span>
              <span>${escapeHtml(suggestedTiming)}</span>
            </div>
          </div>
        </article>
      `;
    })
    .join("");
}

function changeMonth(offset) {
  state.currentMonth = new Date(
    state.currentMonth.getFullYear(),
    state.currentMonth.getMonth() + offset,
    1
  );
  renderCalendar(state.currentMonth);
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