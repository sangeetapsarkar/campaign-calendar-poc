import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import fs from "fs/promises";
import {
  optimizeCampaignDatesPrompt,
  generateHighImpactCampaignIdeasPrompt,
} from "./prompts.js";

function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});


// =========================
// OPTIMIZE CAMPAIGN DATES
// =========================
app.post("/api/optimize-campaign-dates", async (req, res) => {
  try {
    const bodyData = req.body ?? {};

    const inputData =
      Object.keys(bodyData).length > 0
        ? bodyData
        : {
            holidays: JSON.parse(
              await fs.readFile(new URL("../data/holidays.json", import.meta.url), "utf-8")
            ),
            recurring_events: JSON.parse(
              await fs.readFile(new URL("../data/recurring_events.json", import.meta.url), "utf-8")
            ),
            campaigns: JSON.parse(
              await fs.readFile(new URL("../data/campaigns.json", import.meta.url), "utf-8")
            ),
          };

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
    const outputTokens = estimateTokens(text);

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      return res.status(200).json({
        recommendations: [],
        raw_output: text,
        _usage: {
          inputTokens,
          outputTokens,
          totalTokens: inputTokens + outputTokens,
        },
      });
    }

    // ✅ Ensure recommendations always exists (important fix)
if (!Array.isArray(parsed.recommendations)) {
  parsed = {
    recommendations: [],
    raw_output: text
  };
}

return res.json({
  ...parsed,
  _usage: {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
  },
});

  } catch (error) {
    console.error("Gemini API error:", error);

    return res.status(500).json({
      error: "Failed to optimize campaign dates",
      details: error.message,
    });
  }
});


// =========================
// GENERATE CAMPAIGN IDEAS
// =========================
app.post("/api/generate-high-impact-campaign-ideas", async (req, res) => {
  try {
    const bodyData = req.body ?? {};

    const inputData =
      Object.keys(bodyData).length > 0
        ? bodyData
        : {
            holidays: JSON.parse(
              await fs.readFile(new URL("../data/holidays.json", import.meta.url), "utf-8")
            ),
            recurring_events: JSON.parse(
              await fs.readFile(new URL("../data/recurring_events.json", import.meta.url), "utf-8")
            ),
            campaigns: JSON.parse(
              await fs.readFile(new URL("../data/campaigns.json", import.meta.url), "utf-8")
            ),
          };

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
    const outputTokens = estimateTokens(text);

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      return res.status(200).json({
        campaignIdeas: [],
        raw_output: text,
        _usage: {
          inputTokens,
          outputTokens,
          totalTokens: inputTokens + outputTokens,
        },
      });
    }

    if (!Array.isArray(parsed.campaignIdeas)) {
  parsed = {
    campaignIdeas: [],
    raw_output: text
  };
}

return res.json({
  ...parsed,
  _usage: {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens
  }
});

  } catch (error) {
    console.error("Gemini API error:", error);

    return res.status(500).json({
      error: "Failed to generate high impact campaign ideas",
      details: error.message,
    });
  }
});


// =========================
// START SERVER
// =========================
const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});