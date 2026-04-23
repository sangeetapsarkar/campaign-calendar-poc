process.on("uncaughtException", (err) => {
  console.error(JSON.stringify({ level: "fatal", event: "uncaughtException", message: err.message, stack: err.stack }));
  process.exitCode = 1;
});

process.on("unhandledRejection", (err) => {
  console.error(JSON.stringify({ level: "fatal", event: "unhandledRejection", message: err?.message, stack: err?.stack }));
  process.exitCode = 1;
});

import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import crypto from "crypto";
import { GoogleGenAI } from "@google/genai";
import fs from "fs/promises";
import { optimizeCampaignDatesPrompt, generateHighImpactCampaignIdeasPrompt, summarizeNewsPrompt } from "./prompts.js";
import { TTLCache } from "./cache.js";
import { fetchWithTimeout, EXTERNAL_TIMEOUT_MS } from "./http.js";
import { logInfo, logError } from "./logger.js";
import { sessionMiddleware, updateSession } from "./sessionStore.js";
import { validatePlannerInput, validateIdeasOutput, buildExplainabilityTrace } from "./validation.js";
import Parser from "rss-parser";

const parser = new Parser();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, ".env") });

if (!process.env.GEMINI_API_KEY) {
  throw new Error("Missing GEMINI_API_KEY. Add it to the server .env before starting the API.");
}

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "2mb" }));
app.use(sessionMiddleware);

app.use((req, res, next) => {
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();
  req.requestId = requestId;
  res.setHeader("x-request-id", requestId);

  logInfo("request.start", {
    requestId,
    method: req.method,
    path: req.path,
    userId: req.userId,
  });

  res.on("finish", () => {
    logInfo("request.finish", {
      requestId,
      method: req.method,
      path: req.path,
      userId: req.userId,
      statusCode: res.statusCode,
      durationMs: Date.now() - startedAt,
    });
  });

  next();
});

function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

function safeJsonParse(text) {
  if (!text || typeof text !== "string") return null;

  try {
    return JSON.parse(text);
  } catch {
    const cleaned = text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "").trim();
    try {
      return JSON.parse(cleaned);
    } catch {
      return null;
    }
  }
}

function hashObject(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function extractHyperagentAnswer(payload) {
  if (!payload) return "No answer returned.";
  const candidates = [
    payload.answer,
    payload.content, 
    payload.text, 
    payload.reply,
    payload.response,
    payload.message,
    payload.output,
    payload.raw_output,
    payload.data?.answer,
    payload.data?.response,
    payload.data?.message,
    payload.data?.output,
    payload.result?.answer,
    payload.result?.response,
    payload.result?.message,
    payload.result?.output,
    payload.chat_response,
    payload.data?.chat_response,
    payload.result?.chat_response,
  ];

  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) return value;
  }

  if (payload.data && typeof payload.data === "object") return JSON.stringify(payload.data, null, 2);
  if (payload.result && typeof payload.result === "object") return JSON.stringify(payload.result, null, 2);
  return "No answer returned.";
}

const dataCache = new TTLCache(5 * 60 * 1000);
const eventCache = new TTLCache(5 * 60 * 1000);
const llmCache = new TTLCache(15 * 60 * 1000);
const newsCache = new TTLCache(30 * 60 * 1000);
const rssParser = new Parser();

async function loadCalendarData() {
  const cached = dataCache.get("calendar-data");
  if (cached) return cached;

  const [holidaysRaw, recurringRaw, campaignsRaw] = await Promise.all([
    fs.readFile(new URL("../data/holidays.json", import.meta.url), "utf-8"),
    fs.readFile(new URL("../data/recurring_events.json", import.meta.url), "utf-8"),
    fs.readFile(new URL("../data/campaigns.json", import.meta.url), "utf-8"),
  ]);

  const loaded = {
    holidays: JSON.parse(holidaysRaw),
    recurring_events: JSON.parse(recurringRaw),
    campaigns: JSON.parse(campaignsRaw),
  };

  return dataCache.set("calendar-data", loaded);
}

function normalizeOptimizerResponse(parsed, rawText, inputData) {
  const recommendations = Array.isArray(parsed?.recommendations) ? parsed.recommendations : [];
  return {
    recommendations: recommendations.map((recommendation) => ({
      ...recommendation,
      explainability: recommendation?.explainability || buildExplainabilityTrace(inputData, recommendation),
    })),
    raw_output: recommendations.length ? undefined : rawText || "",
  };
}

function normalizeCampaignIdeasResponse(parsed, inputData) {
  const validated = validateIdeasOutput(parsed, inputData?.month_context);
  return {
    campaignIdeas: validated.campaignIdeas,
    raw_output: validated.campaignIdeas.length ? undefined : parsed?.raw_output || "",
  };
}

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const HF_AUTH_URL = "https://agents.integ.hf.hyperface.co/api/v1/auth/jwt/login";
const HF_CHAT_START_URL = "https://agents.integ.hf.hyperface.co/api/v1/chat/start";
const HF_CHAT_URL = "https://agents.integ.hf.hyperface.co/api/v1/chat/chat";
const HF_AGENT_ID = process.env.HF_AGENT_ID || "agent_f96074572b";
const HF_USERNAME = process.env.HF_USERNAME;
const HF_PASSWORD = process.env.HF_PASSWORD;
const HF_TOKEN_TTL_MS = 50 * 60 * 1000;

async function getHFToken(req) {
  const now = Date.now();
  const session = req.session;

  if (session.hfAccessToken && now - session.hfTokenFetchedAt < HF_TOKEN_TTL_MS) {
    return session.hfAccessToken;
  }

  if (!HF_USERNAME || !HF_PASSWORD) {
    throw new Error("HF_USERNAME or HF_PASSWORD missing from .env");
  }

  const params = new URLSearchParams();
  params.append("username", HF_USERNAME);
  params.append("password", HF_PASSWORD);

  const response = await fetchWithTimeout(HF_AUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  const text = await response.text();
  const parsed = safeJsonParse(text) || { raw_output: text };

  if (!response.ok) {
    throw new Error(parsed?.detail || parsed?.message || text);
  }

  const token = parsed.access_token || parsed.token || parsed.jwt || parsed.data?.access_token || parsed.data?.access;
  if (!token) throw new Error("No token returned from Hyperagent");

  updateSession(req.userId, { hfAccessToken: token, hfTokenFetchedAt: now });
  return token;
}

app.get("/", (req, res) => {
  res.send("Backend is running");
});

app.get("/health", async (req, res) => {
  const checks = {
    ok: true,
    timeoutMs: EXTERNAL_TIMEOUT_MS,
    env: {
      GEMINI_API_KEY: !!process.env.GEMINI_API_KEY,
      HF_USERNAME: !!process.env.HF_USERNAME,
      HF_PASSWORD: !!process.env.HF_PASSWORD,
    },
    cache: {
      calendarDataWarm: !!dataCache.get("calendar-data"),
    },
    dataFiles: {},
  };

  const files = ["../data/holidays.json", "../data/recurring_events.json", "../data/campaigns.json"];
  for (const file of files) {
    try {
      await fs.access(new URL(file, import.meta.url));
      checks.dataFiles[file] = true;
    } catch {
      checks.dataFiles[file] = false;
      checks.ok = false;
    }
  }

  res.json(checks);
});

app.get("/api/calendar-data", async (req, res) => {
  try {
    const data = await loadCalendarData();
    res.json(data);
  } catch (error) {
    logError("calendar.load.failed", error, { requestId: req.requestId, userId: req.userId });
    res.status(500).json({ error: "Failed to load calendar data", details: error.message });
  }
});

app.get("/api/events", async (req, res) => {
  try {
    const date = req.query.date;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(String(date))) {
      return res.status(400).json({ error: "Provide a valid ISO date query param ?date=YYYY-MM-DD" });
    }

    const cacheKey = `events:${date}`;
    const cached = eventCache.get(cacheKey);
    if (cached) return res.json(cached);

    const data = await loadCalendarData();
    const isInRange = (event) => date >= event.start_date && date <= event.end_date;
    const payload = {
      date,
      holidays: data.holidays.filter(isInRange),
      recurring_events: data.recurring_events.filter(isInRange),
      campaigns: data.campaigns.filter(isInRange),
    };

    res.json(eventCache.set(cacheKey, payload));
  } catch (error) {
    logError("events.fetch.failed", error, { requestId: req.requestId, userId: req.userId });
    res.status(500).json({ error: "Failed to load events", details: error.message });
  }
});

app.get("/api/current-events", async (req, res) => {
  try {
    const cacheKey = "current-events:india:today";
    const cached = newsCache.get(cacheKey);
    if (cached) return res.json(cached);

    const feed = await rssParser.parseURL("https://www.thehindu.com/news/national/feeder/default.rss");
    const todayIso = new Date().toISOString().slice(0, 10);

    const articles = (feed.items || [])
      .filter((item) => {
        if (!item.pubDate) return false;
        const published = new Date(item.pubDate);
        return !Number.isNaN(published.getTime()) && published.toISOString().slice(0, 10) === todayIso;
      })
      .slice(0, 12)
      .map((item) => ({
        title: item.title || "",
        content: item.contentSnippet || item.content || "",
        link: item.link || ""
      }));

    if (!articles.length) {
      const emptyPayload = { events: [] };
      newsCache.set(cacheKey, emptyPayload);
      return res.json(emptyPayload);
    }

    const prompt = summarizeNewsPrompt(articles);
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: { responseMimeType: "application/json" }
    });

    const parsed = safeJsonParse(response.text || "") || {};
    const events = Array.isArray(parsed.events) ? parsed.events : [];

    const payload = {
      events: events.slice(0, 5).map((event) => ({
        title: event.title || "Untitled event",
        summary: event.summary || "",
        impact: event.impact || "",
        source: "The Hindu"
      }))
    };

    newsCache.set(cacheKey, payload);
    return res.json(payload);
  } catch (error) {
    logError("news.current-events.failed", error, { requestId: req.requestId, userId: req.userId });
    return res.status(500).json({ error: "Failed to fetch current events", details: error.message });
  }
});

async function generateWithModel({ cacheNamespace, inputData, promptBuilder, normalizer, model = "gemini-2.5-flash" }) {
  const prompt = promptBuilder(inputData);
  const cacheKey = `${cacheNamespace}:${hashObject({ model, inputData })}`;
  const cached = llmCache.get(cacheKey);
  if (cached) {
    return { ...cached, _cache: { hit: true, key: cacheKey } };
  }

  const inputTokens = estimateTokens(prompt);
  const startedAt = Date.now();
  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config: { responseMimeType: "application/json" },
  });

  const text = response.text || "";
  const parsed = safeJsonParse(text) || { raw_output: text };
  const normalized = normalizer(parsed, inputData);
  const outputTokens = estimateTokens(text);
  const payload = {
    ...normalized,
    _usage: {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      latencyMs: Date.now() - startedAt,
    },
    _cache: { hit: false, key: cacheKey },
  };

  llmCache.set(cacheKey, payload);
  return payload;
}

app.post("/api/optimize-campaign-dates", async (req, res) => {
  try {
    const inputData = Object.keys(req.body || {}).length > 0 ? validatePlannerInput(req.body) : validatePlannerInput(await loadCalendarData());
    const data = await generateWithModel({
      cacheNamespace: `optimizer:${req.userId}`,
      inputData,
      promptBuilder: optimizeCampaignDatesPrompt,
      normalizer: (parsed, sourceInput) => normalizeOptimizerResponse(parsed, parsed?.raw_output, sourceInput),
    });

    logInfo("llm.optimize.success", {
      requestId: req.requestId,
      userId: req.userId,
      usage: data._usage,
      cache: data._cache,
    });

    res.json(data);
  } catch (error) {
    logError("llm.optimize.failed", error, { requestId: req.requestId, userId: req.userId });
    res.status(error.statusCode || 500).json({ error: "Failed to optimize campaign dates", details: error.message });
  }
});

app.post("/api/generate-high-impact-campaign-ideas", async (req, res) => {
  try {
    const inputData = Object.keys(req.body || {}).length > 0 ? validatePlannerInput(req.body) : validatePlannerInput(await loadCalendarData());
    const data = await generateWithModel({
      cacheNamespace: `ideas:${req.userId}`,
      inputData,
      promptBuilder: generateHighImpactCampaignIdeasPrompt,
      normalizer: (parsed, sourceInput) => normalizeCampaignIdeasResponse(parsed, sourceInput),
    });

    logInfo("llm.ideas.success", {
      requestId: req.requestId,
      userId: req.userId,
      usage: data._usage,
      cache: data._cache,
      ideaCount: data.campaignIdeas?.length || 0,
    });

    res.json(data);
  } catch (error) {
    logError("llm.ideas.failed", error, { requestId: req.requestId, userId: req.userId });
    res.status(error.statusCode || 500).json({ error: "Failed to generate campaign ideas", details: error.message });
  }
});

app.post("/api/hf-chat/start", async (req, res) => {
  try {
    const token = await getHFToken(req);
    const response = await fetchWithTimeout(HF_CHAT_START_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        Referer: `https://agents.integ.hf.hyperface.co/agents/${HF_AGENT_ID}`,
        Origin: "https://agents.integ.hf.hyperface.co",
        "X-Tenant-Id": "t_global",
      },
      body: JSON.stringify({
        agent_id: HF_AGENT_ID,
        user_input: req.body.user_input || "Hello",
        data: req.body.data || {},
      }),
    });

    const text = await response.text();
    const parsed = safeJsonParse(text) || { raw_output: text };
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) {
      updateSession(req.userId, { hfSessionCookie: setCookie.split(";")[0] });
    }

    if (!response.ok) {
      return res.status(response.status).json({ error: "HF start failed", details: parsed });
    }

    const conversationId = parsed.conversation_id || parsed.conversationId || parsed.chat_id || parsed.chatId || parsed.data?.conversation_id || parsed.result?.conversation_id || null;
    updateSession(req.userId, { hfChatStarted: true, hfConversationId: conversationId });

    res.json({
      ...parsed,
      answer: extractHyperagentAnswer(parsed),
      conversation_id: conversationId,
    });
  } catch (error) {
    logError("hf.start.failed", error, { requestId: req.requestId, userId: req.userId });
    res.status(500).json({ error: "Failed to start chatbot", details: error.message });
  }
});

app.post("/api/hf-chat/chat", async (req, res) => {
  try {
    const token = await getHFToken(req);
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      Referer: `https://agents.integ.hf.hyperface.co/agents/${HF_AGENT_ID}`,
      Origin: "https://agents.integ.hf.hyperface.co",
      "X-Tenant-Id": "t_global",
    };

    if (req.session.hfSessionCookie) {
      headers.Cookie = req.session.hfSessionCookie;
    }

    const response = await fetchWithTimeout(HF_CHAT_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({
        user_input: req.body.user_input,
        conversation_id: req.body.conversation_id || req.session.hfConversationId,
      }),
    });

    const text = await response.text();
    const parsed = safeJsonParse(text) || { raw_output: text };
    if (!response.ok) {
      return res.status(response.status).json({ error: "HF chat failed", details: parsed });
    }

    const conversationId = req.body.conversation_id || parsed.conversation_id || parsed.conversationId || parsed.chat_id || parsed.chatId || parsed.data?.conversation_id || parsed.result?.conversation_id || null;
    updateSession(req.userId, { hfConversationId: conversationId });

    res.json({
      ...parsed,
      answer: extractHyperagentAnswer(parsed),
      conversation_id: conversationId,
    });
  } catch (error) {
    logError("hf.chat.failed", error, { requestId: req.requestId, userId: req.userId });
    res.status(500).json({ error: "Failed to continue chat", details: error.message });
  }
});

app.post("/api/cohort/count", async (req, res) => {
  const f = req.body;

  let query = `SELECT COUNT(*) as count FROM customers WHERE 1=1`;

  if (f.card_program && f.card_program !== "All") {
    query += ` AND card_program = '${f.card_program}'`;
  }

  if (f.gender && f.gender !== "All") {
    query += ` AND gender = '${f.gender}'`;
  }

  if (f.tier1 === "true") {
    query += ` AND tier1 = true`;
  }

  // handle ranges similarly...

  const result = await db.query(query);
  res.json({ count: result[0].count });
});

app.post("/api/cohort/download", async (req, res) => {
  const query = `SELECT * FROM customers WHERE ...`; // same filters

  const rows = await db.query(query);

  const csv = convertToCSV(rows); // simple helper

  res.setHeader("Content-Disposition", "attachment; filename=cohort.csv");
  res.send(csv);
});

const port = process.env.PORT || 3000;
logInfo("server.boot", {
  port,
  envLoaded: {
    GEMINI: !!process.env.GEMINI_API_KEY,
    HF_USER: !!process.env.HF_USERNAME,
    HF_PASS: !!process.env.HF_PASSWORD,
  },
});

app.listen(port, () => {
  logInfo("server.ready", { port });
});
