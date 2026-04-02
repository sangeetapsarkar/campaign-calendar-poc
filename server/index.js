process.on("uncaughtException", (err) => {
  console.error("🔥 UNCAUGHT EXCEPTION:", err);
});

process.on("unhandledRejection", (err) => {
  console.error("🔥 UNHANDLED PROMISE:", err);
});

import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import { GoogleGenAI } from "@google/genai";
import fs from "fs/promises";
import fetch from "node-fetch";
import {
  optimizeCampaignDatesPrompt,
  generateHighImpactCampaignIdeasPrompt,
} from "./prompts.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// If your .env sits beside this file, keep this.
// If your .env later moves to project root, change this path accordingly.
dotenv.config({ path: path.join(__dirname, ".env") });

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

function safeJsonParse(text) {
  if (!text || typeof text !== "string") return null;

  try {
    return JSON.parse(text);
  } catch {
    // Try to recover JSON wrapped in markdown fences
    const cleaned = text
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    try {
      return JSON.parse(cleaned);
    } catch {
      return null;
    }
  }
}

function extractHyperagentAnswer(payload) {
  if (!payload) return "No answer returned.";

  const candidates = [
    payload.answer,
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
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }

  if (payload.data && typeof payload.data === "object") {
    return JSON.stringify(payload.data, null, 2);
  }

  if (payload.result && typeof payload.result === "object") {
    return JSON.stringify(payload.result, null, 2);
  }

  return "No answer returned.";
}

async function loadCalendarData() {
  const [holidaysRaw, recurringRaw, campaignsRaw] = await Promise.all([
    fs.readFile(new URL("../data/holidays.json", import.meta.url), "utf-8"),
    fs.readFile(new URL("../data/recurring_events.json", import.meta.url), "utf-8"),
    fs.readFile(new URL("../data/campaigns.json", import.meta.url), "utf-8"),
  ]);

  return {
    holidays: JSON.parse(holidaysRaw),
    recurring_events: JSON.parse(recurringRaw),
    campaigns: JSON.parse(campaignsRaw),
  };
}

function normalizeOptimizerResponse(parsed, rawText) {
  if (parsed && Array.isArray(parsed.recommendations)) {
    return parsed;
  }

  return {
    recommendations: [],
    raw_output: rawText || "",
  };
}

function normalizeCampaignIdeasResponse(parsed, rawText) {
  if (parsed && Array.isArray(parsed.campaignIdeas)) {
    return parsed;
  }

  return {
    campaignIdeas: [],
    raw_output: rawText || "",
  };
}

app.get("/", (req, res) => {
  res.send("Backend is running");
});

app.get("/health", async (req, res) => {
  const checks = {
    ok: true,
    env: {
      GEMINI_API_KEY: !!process.env.GEMINI_API_KEY,
      HF_USERNAME: !!process.env.HF_USERNAME,
      HF_PASSWORD: !!process.env.HF_PASSWORD,
    },
    dataFiles: {},
  };

  const files = [
    "../data/holidays.json",
    "../data/recurring_events.json",
    "../data/campaigns.json",
  ];

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

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

const HF_AUTH_URL = "https://agents.integ.hf.hyperface.co/api/v1/auth/jwt/login";
const HF_CHAT_START_URL = "https://agents.integ.hf.hyperface.co/api/v1/chat/start";
const HF_CHAT_URL = "https://agents.integ.hf.hyperface.co/api/v1/chat/chat";

const HF_AGENT_ID = "agent_f96074572b";

const HF_USERNAME = process.env.HF_USERNAME;
const HF_PASSWORD = process.env.HF_PASSWORD;

let hfAccessToken = null;
let hfTokenFetchedAt = 0;
let hfSessionCookie = null;
const HF_TOKEN_TTL_MS = 50 * 60 * 1000;

async function getHFToken() {
  const now = Date.now();

  if (hfAccessToken && now - hfTokenFetchedAt < HF_TOKEN_TTL_MS) {
    return hfAccessToken;
  }

  if (!HF_USERNAME || !HF_PASSWORD) {
    throw new Error("HF_USERNAME or HF_PASSWORD missing from .env");
  }

  const params = new URLSearchParams();
  params.append("username", HF_USERNAME);
  params.append("password", HF_PASSWORD);

  const response = await fetch(HF_AUTH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  const text = await response.text();
  const parsed = safeJsonParse(text) || { raw_output: text };

  if (!response.ok) {
    throw new Error(parsed?.detail || parsed?.message || text);
  }

  const token =
    parsed.access_token ||
    parsed.token ||
    parsed.jwt ||
    parsed.data?.access_token ||
    parsed.data?.access;

  if (!token) {
    throw new Error("No token returned from Hyperagent");
  }

  hfAccessToken = token;
  hfTokenFetchedAt = now;

  return token;
}

app.post("/api/optimize-campaign-dates", async (req, res) => {
  try {
    const inputData =
      Object.keys(req.body || {}).length > 0
        ? req.body
        : await loadCalendarData();

    const prompt = optimizeCampaignDatesPrompt(inputData);
    const inputTokens = estimateTokens(prompt);

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
      },
    });

    const text = response.text || "";
    const parsed = safeJsonParse(text);
    const normalized = normalizeOptimizerResponse(parsed, text);
    const outputTokens = estimateTokens(text);

    return res.json({
      ...normalized,
      _usage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
      },
    });
  } catch (error) {
    console.error("Optimize error:", error);
    return res.status(500).json({
      error: "Failed to optimize campaign dates",
      details: error.message,
    });
  }
});

app.post("/api/generate-high-impact-campaign-ideas", async (req, res) => {
  try {
    const inputData =
      Object.keys(req.body || {}).length > 0
        ? req.body
        : await loadCalendarData();

    const prompt = generateHighImpactCampaignIdeasPrompt(inputData);
    const inputTokens = estimateTokens(prompt);

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
      },
    });

    const text = response.text || "";
    const parsed = safeJsonParse(text);
    const normalized = normalizeCampaignIdeasResponse(parsed, text);
    const outputTokens = estimateTokens(text);

    return res.json({
      ...normalized,
      _usage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
      },
    });
  } catch (error) {
    console.error("Ideas error:", error);
    return res.status(500).json({
      error: "Failed to generate campaign ideas",
      details: error.message,
    });
  }
});

app.post("/api/hf-chat/start", async (req, res) => {
  try {
    const token = await getHFToken();

    const response = await fetch(HF_CHAT_START_URL, {
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
      hfSessionCookie = setCookie.split(";")[0];
    }

    if (!response.ok) {
      return res.status(response.status).json({
        error: "HF start failed",
        details: parsed,
      });
    }

    return res.json({
      ...parsed,
      answer: extractHyperagentAnswer(parsed),
      conversation_id:
        parsed.conversation_id ||
        parsed.conversationId ||
        parsed.chat_id ||
        parsed.chatId ||
        parsed.data?.conversation_id ||
        parsed.data?.conversationId ||
        parsed.result?.conversation_id ||
        parsed.result?.conversationId ||
        null,
    });
  } catch (error) {
    console.error("HF start error:", error);
    return res.status(500).json({
      error: "Failed to start chatbot",
      details: error.message,
    });
  }
});

app.post("/api/hf-chat/chat", async (req, res) => {
  try {
    const token = await getHFToken();

    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      Referer: `https://agents.integ.hf.hyperface.co/agents/${HF_AGENT_ID}`,
      Origin: "https://agents.integ.hf.hyperface.co",
      "X-Tenant-Id": "t_global",
    };

    if (hfSessionCookie) {
      headers.Cookie = hfSessionCookie;
    }

    const response = await fetch(HF_CHAT_URL, {
      method: "POST",
      headers,
      body: JSON.stringify({
        user_input: req.body.user_input,
        conversation_id: req.body.conversation_id,
      }),
    });

    const text = await response.text();
    const parsed = safeJsonParse(text) || { raw_output: text };

    if (!response.ok) {
      return res.status(response.status).json({
        error: "HF chat failed",
        details: parsed,
      });
    }

    return res.json({
      ...parsed,
      answer: extractHyperagentAnswer(parsed),
      conversation_id:
        req.body.conversation_id ||
        parsed.conversation_id ||
        parsed.conversationId ||
        parsed.chat_id ||
        parsed.chatId ||
        parsed.data?.conversation_id ||
        parsed.data?.conversationId ||
        parsed.result?.conversation_id ||
        parsed.result?.conversationId ||
        null,
    });
  } catch (error) {
    console.error("HF chat error:", error);
    return res.status(500).json({
      error: "Failed to continue chat",
      details: error.message,
    });
  }
});

const port = process.env.PORT || 3000;

console.log("PORT:", port);
console.log("ENV loaded:", {
  GEMINI: !!process.env.GEMINI_API_KEY,
  HF_USER: !!process.env.HF_USERNAME,
  HF_PASS: !!process.env.HF_PASSWORD,
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});