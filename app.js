const state = {
  currentMonth: new Date(),
  selectedDate: new Date(),
  holidays: [],
  recurring: [],
  campaigns: []
};

init();

async function init() {
  await loadData();

  renderCalendar(state.currentMonth);
  renderEvents(state.selectedDate);
  // renderInsights();

  document.getElementById("prev-month-btn").onclick = () => changeMonth(-1);
  document.getElementById("next-month-btn").onclick = () => changeMonth(1);
  const refreshBtn = document.getElementById("refresh-insights-btn");
if (refreshBtn) {
  refreshBtn.onclick = () => renderInsights();
}
  document.getElementById("run-date-optimizer-btn").onclick = runDateOptimizerAgent;
  document.getElementById("run-campaign-ideas-btn").onclick = runCampaignIdeasAgent;
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
  return {
    objective: "Optimize campaign dates for peak user engagement",
    selected_date: formatISO(state.selectedDate),

    month_context: {
      year: state.currentMonth.getFullYear(),
      month: state.currentMonth.getMonth() + 1
    },

    holidays: state.holidays.map(normalizeEvent).map(e => ({
      event_name: e.name,
      start_date: e.start,
      end_date: e.end
    })),

    recurring_events: state.recurring.map(normalizeEvent).map(e => ({
      event_name: e.name,
      start_date: e.start,
      end_date: e.end
    })),

    campaigns: state.campaigns.map(normalizeEvent).map(e => ({
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

    holidays: state.holidays.map(normalizeEvent).map(e => ({
      event_name: e.name,
      start_date: e.start,
      end_date: e.end
    })),

    recurring_events: state.recurring.map(normalizeEvent).map(e => ({
      event_name: e.name,
      start_date: e.start,
      end_date: e.end
    })),

    campaigns: state.campaigns.map(normalizeEvent).map(e => ({
      event_name: e.name,
      start_date: e.start,
      end_date: e.end,
      card_program: e.cardProgram,
      benefit_type: e.benefitType
    }))
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
  grid.innerHTML = "";

  const month = date.getMonth();
  const year = date.getFullYear();

  document.getElementById("calendar-month-label").innerText =
    date.toLocaleString("default", { month: "long", year: "numeric" });

  const firstDay = new Date(year, month, 1).getDay();
  const lastDate = new Date(year, month + 1, 0).getDate();
  const today = new Date();

  for (let i = 0; i < firstDay; i++) {
    const spacer = document.createElement("div");
    spacer.className = "h-12";
    grid.appendChild(spacer);
  }

  for (let d = 1; d <= lastDate; d++) {
    const fullDate = new Date(year, month, d);
    const iso = formatISO(fullDate);

    const hasAnyEvent =
      [...state.holidays, ...state.recurring, ...state.campaigns]
        .map(normalizeEvent)
        .some(e => isInRange(iso, e.start, e.end));

    const isToday = isSameDate(fullDate, today);

    const el = document.createElement("button");
    el.type = "button";
    el.className = [
      "h-12 rounded border text-sm transition",
      "hover:bg-gray-50",
      isToday ? "bg-blue-600 text-white border-blue-600 font-semibold" : "bg-white border-gray-200 text-gray-800",
      !isToday && hasAnyEvent ? "ring-1 ring-blue-200" : ""
    ].join(" ");

    el.innerText = d;

    el.onclick = () => {
      state.selectedDate = fullDate;
      renderEvents(fullDate);
    };

    grid.appendChild(el);
  }
}

function renderEvents(date) {
  const iso = formatISO(date);

  const holidays = state.holidays
    .map(normalizeEvent)
    .filter(e => isInRange(iso, e.start, e.end));

  const recurring = state.recurring
    .map(normalizeEvent)
    .filter(e => isInRange(iso, e.start, e.end));

  const campaigns = state.campaigns
    .map(normalizeEvent)
    .filter(e => isInRange(iso, e.start, e.end));

  document.getElementById("selected-date-label").innerText = date.toDateString();

  document.getElementById("holiday-count").innerText = `${holidays.length} event${holidays.length === 1 ? "" : "s"}`;
  document.getElementById("recurring-count").innerText = `${recurring.length} event${recurring.length === 1 ? "" : "s"}`;
  document.getElementById("campaign-count").innerText = `${campaigns.length} event${campaigns.length === 1 ? "" : "s"}`;

  document.getElementById("holiday-list").innerHTML = renderEventCards(holidays, "holiday");
  document.getElementById("recurring-list").innerHTML = renderEventCards(recurring, "recurring");
  document.getElementById("campaign-list").innerHTML = renderEventCards(campaigns, "campaign");
}

function renderEventCards(events, type) {
  if (!events.length) {
    return `<div class="text-sm text-gray-500 bg-gray-50 border border-dashed border-gray-200 rounded p-3">No events</div>`;
  }

  return events.map(e => {
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

function renderInsights() {
  const container = document.getElementById("insights-list");

  const allEvents = [
    ...state.holidays.map(normalizeEvent),
    ...state.recurring.map(normalizeEvent),
    ...state.campaigns.map(normalizeEvent)
  ];

  const currentMonthISO = `${state.currentMonth.getFullYear()}-${String(state.currentMonth.getMonth() + 1).padStart(2, "0")}`;
  const monthEvents = allEvents.filter(e => e.start?.startsWith(currentMonthISO) || e.end?.startsWith(currentMonthISO));

  const insights = [
    {
      title: "Monthly Event Coverage",
      text: `${monthEvents.length} scheduled items are loaded for this month across holidays, recurring events, and campaigns.`
    },
    {
      title: "Campaign Placeholder Ready",
      text: "Card Program and Benefit Type are available on campaign cards and can be used next for filtering and AI insight generation."
    },
    {
      title: "JSON Sources Connected",
      text: "The calendar now reads holidays.json, recurring_events.json, and campaigns.json independently."
    }
  ];

  container.innerHTML = insights.map(i => `
    <div class="p-4 border border-gray-200 rounded-lg">
      <h3 class="font-semibold">${escapeHtml(i.title)}</h3>
      <p class="text-sm text-gray-600 mt-1">${escapeHtml(i.text)}</p>
    </div>
  `).join("");
}

async function runDateOptimizerAgent() {
  console.log("Run Agent clicked");

  const statusEl = document.getElementById("date-optimizer-status");
  const resultEl = document.getElementById("date-optimizer-result");

  statusEl.innerText = "Analyzing campaign timing...";
  resultEl.innerHTML = `<div class="text-sm text-gray-500">Generating recommendation...</div>`;

  try {
    const payload = buildDateOptimizerPayload();

    const response = await fetch("http://localhost:3000/api/optimize-campaign-dates", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    console.log("Optimize dates response:", data);

    if (!response.ok) {
      throw new Error(data?.error || `Request failed with status ${response.status}`);
    }

    const usage = data._usage;
    statusEl.innerHTML = `
      <div class="flex gap-2 text-xs">
        <span class="bg-gray-100 px-2 py-1 rounded">In: ${usage?.inputTokens || 0}</span>
        <span class="bg-gray-100 px-2 py-1 rounded">Out: ${usage?.outputTokens || 0}</span>
        <span class="bg-blue-100 text-blue-700 px-2 py-1 rounded">Total: ${usage?.totalTokens || 0}</span>
      </div>
    `;

    renderDateOptimizerResult(data);

  } catch (error) {
    console.error("Optimize dates error:", error);

    statusEl.innerText = "Failed to generate recommendation.";
    resultEl.innerHTML = `
      <div class="p-3 rounded-lg bg-red-50 text-red-700 text-sm">
        ${error.message || "Optimize dates request failed."}
      </div>
    `;
  }
}

async function runCampaignIdeasAgent() {
  console.log("Run Campaign Ideas clicked");

  const statusEl = document.getElementById("campaign-ideas-status");
  const resultEl = document.getElementById("campaign-ideas-result");

  statusEl.innerText = "Generating campaign ideas...";
  resultEl.innerHTML = `<div class="text-sm text-gray-500">Thinking through ideas...</div>`;

  try {
    const payload = buildCampaignIdeasPayload();

    const response = await fetch("http://localhost:3000/api/generate-high-impact-campaign-ideas", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    console.log("Campaign ideas response:", data);

    if (!response.ok) {
      throw new Error(data?.error || `Request failed with status ${response.status}`);
    }

    const usage = data._usage;
    statusEl.innerHTML = `
      <div class="flex gap-2 text-xs">
        <span class="bg-gray-100 px-2 py-1 rounded">In: ${usage?.inputTokens || 0}</span>
        <span class="bg-gray-100 px-2 py-1 rounded">Out: ${usage?.outputTokens || 0}</span>
        <span class="bg-purple-100 text-purple-700 px-2 py-1 rounded">Total: ${usage?.totalTokens || 0}</span>
      </div>
    `;

    renderCampaignIdeasResult(data);

  } catch (error) {
    console.error("Campaign ideas error:", error);

    statusEl.innerText = "Failed to generate campaign ideas.";
    resultEl.innerHTML = `
      <div class="p-3 rounded-lg bg-red-50 text-red-700 text-sm">
        ${error.message || "Campaign ideas request failed."}
      </div>
    `;
  }
}

function renderDateOptimizerResult(data) {
  const resultEl = document.getElementById("date-optimizer-result");

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

  resultEl.innerHTML = recommendations.map(item => `
    <div class="p-4 rounded-xl border border-gray-200 bg-blue-50">
      <div class="flex justify-between items-center mb-2">
        <h4 class="font-semibold">${escapeHtml(item.event_name || "Campaign")}</h4>
        <span class="text-xs bg-white px-2 py-1 rounded border">
          ${escapeHtml(item.confidence || "Medium")}
        </span>
      </div>

      <div class="text-sm mb-1">
        <strong>Current:</strong> ${escapeHtml(item.current_start_date || "-")} → ${escapeHtml(item.current_end_date || "-")}
      </div>

      <div class="text-sm mb-2">
        <strong>Recommended:</strong> ${escapeHtml(item.recommended_start_date || "-")} → ${escapeHtml(item.recommended_end_date || "-")}
      </div>

      <div class="text-sm text-gray-600 mb-2">
        ${escapeHtml(item.reason || "")}
      </div>

      <div class="text-xs text-gray-500">
        ${escapeHtml(item.engagement_rationale || "")}
      </div>
    </div>
  `).join("");
}

function renderCampaignIdeasResult(data) {
  const resultEl = document.getElementById("campaign-ideas-result");

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

  resultEl.innerHTML = ideas.map(item => `
    <div class="p-4 rounded-xl border border-gray-200 bg-purple-50">
      <div class="mb-2">
        <h4 class="font-semibold text-gray-900">${escapeHtml(item.title || "Untitled Idea")}</h4>
      </div>

      <div class="text-sm text-gray-700 mb-2">
        ${escapeHtml(item.concept || "")}
      </div>

      <div class="text-sm text-gray-600 mb-2">
        <strong>Target audience:</strong> ${escapeHtml(item.targetAudience || "-")}
      </div>

      <div class="text-sm text-gray-600 mb-2">
        <strong>Merchant categories:</strong>
        ${Array.isArray(item.merchantCategories) ? item.merchantCategories.map(escapeHtml).join(", ") : "-"}
      </div>

      <div class="text-sm text-gray-600 mb-2">
        <strong>Spend threshold:</strong> ${escapeHtml(item.spendThreshold || "-")}
      </div>

      <div class="text-sm text-gray-600 mb-2">
        <strong>Why it will work:</strong> ${escapeHtml(item.whyItWillWork || "-")}
      </div>

      <div class="text-sm text-gray-600">
        <strong>Seasonal fit:</strong> ${escapeHtml(item.seasonalFit || "-")}
      </div>
    </div>
  `).join("");
}

function changeMonth(offset) {
  state.currentMonth = new Date(
    state.currentMonth.getFullYear(),
    state.currentMonth.getMonth() + offset,
    1
  );
  renderCalendar(state.currentMonth);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}