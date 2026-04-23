const defaultVisibleCounts = () => ({ holiday: 10, recurring: 10, campaign: 10 });

export const state = {
  currentMonth: new Date(),
  selectedDate: new Date(),
  entities: {
    holidays: [],
    recurring: [],
    campaigns: [],
  },
  ui: {
    visibleCounts: defaultVisibleCounts(),
    loadStep: { holiday: 5, recurring: 5, campaign: 10 },
    ideasStatus: "Ready",
    optimizerStatus: "Ready",
    chatStatus: "Ready",
  },
  cache: {
    calendarData: null,
    eventsByDate: new Map(),
    llmByKey: new Map(),
  },
  chat: {
    started: false,
    conversationId: null,
  },
  ideaChatHistory: {},
  workspace: {
    widgets: [
      { id: "calendar-widget", type: "calendar", title: "Campaign calendar" },
      { id: "strategy-widget", type: "strategy", title: "Strategy workspace" },
      { id: "assistant-widget", type: "assistant", title: "Campaign assistant" },
    ],
  },
};

export function resetVisibleCounts() {
  state.ui.visibleCounts = defaultVisibleCounts();
}

export function setCalendarData(data) {
  state.entities.holidays = data?.holidays || [];
  state.entities.recurring = data?.recurring_events || [];
  state.entities.campaigns = data?.campaigns || [];
  state.cache.calendarData = data;
}

export function cacheEvents(date, payload) {
  state.cache.eventsByDate.set(date, payload);
}

export function getCachedEvents(date) {
  return state.cache.eventsByDate.get(date) || null;
}

export function cacheLlm(key, payload) {
  state.cache.llmByKey.set(key, payload);
}

export function getCachedLlm(key) {
  return state.cache.llmByKey.get(key) || null;
}
