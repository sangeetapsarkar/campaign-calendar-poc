const API_BASE_URL = window.__API_BASE_URL__ || "http://localhost:3000";
const SESSION_KEY = "campaign-calendar-user-id";

function getOrCreateUserId() {
  const existing = localStorage.getItem(SESSION_KEY);
  if (existing) return existing;
  const created = `user-${crypto.randomUUID()}`;
  localStorage.setItem(SESSION_KEY, created);
  return created;
}

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "x-user-id": getOrCreateUserId(),
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!response.ok) {
    throw new Error(data?.details || data?.error || text || `Request failed with status ${response.status}`);
  }

  return data;
}

export const api = {
  getCalendarData() {
    return request("/api/calendar-data", { method: "GET" });
  },
  getEventsForDate(date) {
    return request(`/api/events?date=${encodeURIComponent(date)}`, { method: "GET" });
  },
  optimizeCampaignDates(payload) {
    return request("/api/optimize-campaign-dates", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  generateCampaignIdeas(payload) {
    return request("/api/generate-high-impact-campaign-ideas", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  startChat(payload) {
    return request("/api/hf-chat/start", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  continueChat(payload) {
    return request("/api/hf-chat/chat", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
};
