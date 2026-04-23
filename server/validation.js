function isIsoDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function assert(condition, message) {
  if (!condition) {
    const error = new Error(message);
    error.statusCode = 400;
    throw error;
  }
}

function normalizeCalendarEvent(item, kind, index) {
  assert(item && typeof item === "object", `${kind}[${index}] must be an object`);
  const eventName = item.event_name || item.eventName;
  const startDate = item.start_date || item.startDate;
  const endDate = item.end_date || item.endDate;

  assert(typeof eventName === "string" && eventName.trim(), `${kind}[${index}] is missing event_name`);
  assert(isIsoDate(startDate), `${kind}[${index}] has invalid start_date`);
  assert(isIsoDate(endDate), `${kind}[${index}] has invalid end_date`);
  assert(startDate <= endDate, `${kind}[${index}] start_date cannot be after end_date`);

  return {
    event_name: eventName.trim(),
    start_date: startDate,
    end_date: endDate,
    card_program: item.card_program || item.cardProgram || null,
    benefit_type: item.benefit_type || item.benefitType || null,
  };
}

export function validatePlannerInput(payload) {
  const body = payload && typeof payload === "object" ? payload : {};
  const monthContext = body.month_context || {};

  if (monthContext.year !== undefined) {
    assert(Number.isInteger(monthContext.year), "month_context.year must be an integer");
  }

  if (monthContext.month !== undefined) {
    assert(Number.isInteger(monthContext.month) && monthContext.month >= 1 && monthContext.month <= 12, "month_context.month must be between 1 and 12");
  }

  const normalized = {
    objective: typeof body.objective === "string" ? body.objective : "",
    user_brief: typeof body.user_brief === "string" ? body.user_brief : "",
    selected_date: isIsoDate(body.selected_date) ? body.selected_date : null,
    month_context: {
      year: Number.isInteger(monthContext.year) ? monthContext.year : null,
      month: Number.isInteger(monthContext.month) ? monthContext.month : null,
    },
    holidays: Array.isArray(body.holidays) ? body.holidays.map((item, index) => normalizeCalendarEvent(item, "holidays", index)) : [],
    recurring_events: Array.isArray(body.recurring_events)
      ? body.recurring_events.map((item, index) => normalizeCalendarEvent(item, "recurring_events", index))
      : [],
    campaigns: Array.isArray(body.campaigns)
      ? body.campaigns.map((item, index) => normalizeCalendarEvent(item, "campaigns", index))
      : [],
  };

  return normalized;
}

export function dedupeCampaignIdeas(ideas) {
  const seen = new Set();
  const unique = [];

  for (const idea of ideas || []) {
    if (!idea || typeof idea !== "object") continue;
    const title = String(idea.title || "").trim().toLowerCase();
    const summary = String(idea.summary || idea.whyItWillWork || "").trim().toLowerCase();
    const fingerprint = `${title}::${summary}`;
    if (!title || seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    unique.push(idea);
  }

  return unique;
}

function ensureMonthMatches(value, monthContext) {
  if (!isIsoDate(value) || !monthContext?.year || !monthContext?.month) return false;
  const [year, month] = value.split("-").map(Number);
  return year === monthContext.year && month === monthContext.month;
}

export function validateIdeasOutput(parsed, monthContext) {
  const campaignIdeas = Array.isArray(parsed?.campaignIdeas) ? dedupeCampaignIdeas(parsed.campaignIdeas) : [];

  const filtered = campaignIdeas.filter((idea) => {
    const directStart = idea.start_date || idea.recommended_start_date || null;
    const directEnd = idea.end_date || idea.recommended_end_date || null;
    if (!isIsoDate(directStart) || !isIsoDate(directEnd)) return false;
    return ensureMonthMatches(directStart, monthContext) && ensureMonthMatches(directEnd, monthContext);
  });

  return {
    campaignIdeas: filtered,
    raw_output: parsed?.raw_output || "",
  };
}

export function buildExplainabilityTrace(inputData, recommendation) {
  const start = recommendation?.recommended_start_date || recommendation?.current_start_date || null;
  const end = recommendation?.recommended_end_date || recommendation?.current_end_date || null;
  const overlaps = (inputData?.campaigns || []).filter((campaign) => {
    if (!start || !end) return false;
    return !(campaign.end_date < start || campaign.start_date > end);
  });

  const nearEvents = [...(inputData?.holidays || []), ...(inputData?.recurring_events || [])].filter((event) => {
    if (!start || !end) return false;
    return !(event.end_date < start || event.start_date > end);
  });

  return {
    why_this_date: recommendation?.engagement_rationale || recommendation?.reason || "Chosen based on strongest event and spend timing signals.",
    conflicts_considered: overlaps.map((campaign) => campaign.event_name),
    strongest_signals: nearEvents.map((event) => event.event_name).slice(0, 5),
    compared_campaigns: overlaps.map((campaign) => ({
      event_name: campaign.event_name,
      start_date: campaign.start_date,
      end_date: campaign.end_date,
    })),
  };
}
