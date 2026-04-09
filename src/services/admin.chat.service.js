const fs = require("fs/promises");
const path = require("path");

const CONFIG_PATH = path.join(__dirname, "..", "data", "chatbot.intents.json");
const CONFIG_DIR = path.dirname(CONFIG_PATH);

const normalizeText = (value = "") =>
  String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const tokenize = (value = "") =>
  normalizeText(value)
    .split(" ")
    .filter(Boolean);

const uniq = (arr = []) => [...new Set(arr.filter(Boolean))];

const isObject = (value) => value && typeof value === "object" && !Array.isArray(value);

const deepMerge = (target, source) => {
  if (Array.isArray(target) && Array.isArray(source)) {
    return source;
  }

  if (isObject(target) && isObject(source)) {
    const result = { ...target };

    Object.keys(source).forEach((key) => {
      if (key in target) {
        result[key] = deepMerge(target[key], source[key]);
      } else {
        result[key] = source[key];
      }
    });

    return result;
  }

  return source;
};

const readConfig = async () => {
  const raw = await fs.readFile(CONFIG_PATH, "utf8");
  return JSON.parse(raw);
};

const writeConfig = async (config) => {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return config;
};

const buildTokenSet = (text) => new Set(tokenize(text));

const keywordOverlapScore = (messageTokens, example) => {
  const exampleTokens = tokenize(example);

  if (exampleTokens.length === 0) {
    return 0;
  }

  let hits = 0;
  exampleTokens.forEach((token) => {
    if (messageTokens.has(token)) {
      hits += 1;
    }
  });

  return hits / exampleTokens.length;
};

const sentenceSimilarity = (message, example) => {
  const normalizedMessage = normalizeText(message);
  const normalizedExample = normalizeText(example);

  if (!normalizedMessage || !normalizedExample) {
    return 0;
  }

  if (normalizedMessage === normalizedExample) {
    return 1;
  }

  if (normalizedMessage.includes(normalizedExample) || normalizedExample.includes(normalizedMessage)) {
    return 0.95;
  }

  const messageTokens = buildTokenSet(normalizedMessage);
  const overlap = keywordOverlapScore(messageTokens, normalizedExample);

  const longest = Math.max(normalizedMessage.length, normalizedExample.length, 1);
  let samePrefix = 0;
  const shortest = Math.min(normalizedMessage.length, normalizedExample.length);

  while (samePrefix < shortest && normalizedMessage[samePrefix] === normalizedExample[samePrefix]) {
    samePrefix += 1;
  }

  const prefixScore = samePrefix / longest;
  return Math.max(overlap, prefixScore * 0.7);
};

const matchFaqIntent = (message, intents = []) => {
  let bestMatch = null;

  intents.forEach((intent) => {
    const bestExampleScore = Math.max(
      0,
      ...(intent.examples || []).map((example) => sentenceSimilarity(message, example)),
    );

    if (!bestMatch || bestExampleScore > bestMatch.confidence) {
      bestMatch = {
        intent: intent.intent,
        response: intent.response,
        confidence: Number(bestExampleScore.toFixed(4)),
      };
    }
  });

  return bestMatch;
};

const hasBookingCode = (message, regexPattern) => {
  if (!regexPattern) {
    return false;
  }

  try {
    const regex = new RegExp(regexPattern, "i");
    const matches = String(message).match(regex);

    if (!matches || matches.length === 0) {
      return false;
    }

    return matches.some((candidate) => {
      const value = String(candidate).trim();
      const hasLetter = /[A-Za-z]/.test(value);
      const hasDigit = /\d/.test(value);

      // Reject plain words like "coupon" that accidentally match a loose regex.
      return hasLetter && hasDigit;
    });
  } catch (_error) {
    return false;
  }
};

const shouldRouteToAdmin = (message, config) => {
  const normalized = normalizeText(message);
  const routing = config.routing || {};
  const adminKeywords = routing.admin_keywords || [];

  if (hasBookingCode(message, routing.booking_code_regex)) {
    return { matched: true, reason: "booking_code" };
  }

  const matchedKeyword = adminKeywords.find((keyword) => normalized.includes(normalizeText(keyword)));

  if (matchedKeyword) {
    return { matched: true, reason: matchedKeyword };
  }

  return { matched: false, reason: null };
};

const pickFallback = (config, bucket = "generic") => {
  const items = config?.fallbacks?.[bucket] || config?.fallbacks?.generic || ["Mình chưa có câu trả lời phù hợp lúc này."];
  return items[0];
};

const trimHistory = (history = [], maxHistory = 8) => {
  if (!Array.isArray(history)) {
    return [];
  }

  return history
    .filter((item) => item && typeof item.content === "string")
    .slice(-maxHistory)
    .map((item) => ({
      role: item.role === "assistant" ? "assistant" : "user",
      content: item.content.trim(),
    }))
    .filter((item) => item.content);
};

const callGemini = async (config, message, history) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY chưa được cấu hình");
  }

  const payload = {
    contents: [
      ...history.map((item) => ({
        role: item.role === "assistant" ? "model" : "user",
        parts: [{ text: item.content }],
      })),
      { role: "user", parts: [{ text: message }] },
    ],
    systemInstruction: {
      role: "system",
      parts: [{ text: config.ai_flow?.system_prompt || "Bạn là trợ lý CSKH." }],
    },
    generationConfig: {
      temperature: config.ai_flow?.temperature ?? 0.4,
    },
  };

  const response = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(payload),
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gemini lỗi ${response.status}: ${text}`);
  }

  const data = await response.json();
  return (
    data?.candidates?.[0]?.content?.parts
      ?.map((part) => part.text || "")
      .join("")
      .trim() || null
  );
};

const callGroq = async (config, message, history) => {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("GROQ_API_KEY chưa được cấu hình");
  }

  const payload = {
    model: "llama-3.3-70b-versatile",
    temperature: config.ai_flow?.temperature ?? 0.4,
    messages: [
      { role: "system", content: config.ai_flow?.system_prompt || "Bạn là trợ lý CSKH." },
      ...history,
      { role: "user", content: message },
    ],
  };

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Groq lỗi ${response.status}: ${text}`);
  }

  const data = await response.json();
  return data?.choices?.[0]?.message?.content?.trim() || null;
};

const callOpenRouter = async (config, message, history) => {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY chưa được cấu hình");
  }

  const payload = {
    model: "openrouter/free",
    temperature: config.ai_flow?.temperature ?? 0.4,
    messages: [
      { role: "system", content: config.ai_flow?.system_prompt || "Bạn là trợ lý CSKH." },
      ...history,
      { role: "user", content: message },
    ],
  };

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": process.env.OPENROUTER_SITE_URL || "https://vivudee.vercel.app",
      "X-Title": process.env.OPENROUTER_SITE_NAME || "Vivudee Admin Chat",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenRouter lỗi ${response.status}: ${text}`);
  }

  const data = await response.json();
  return data?.choices?.[0]?.message?.content?.trim() || null;
};

const callProvider = async (provider, config, message, history) => {
  if (provider === "gemini") {
    return callGemini(config, message, history);
  }

  if (provider === "groq") {
    return callGroq(config, message, history);
  }

  if (provider === "openrouter") {
    return callOpenRouter(config, message, history);
  }

  throw new Error(`Provider không hỗ trợ: ${provider}`);
};

const askAi = async (config, message, history = []) => {
  const providerOrder = uniq([
    config?.ai_flow?.provider,
    ...(config?.routing?.provider_order || []),
  ]);

  const failures = [];

  for (const provider of providerOrder) {
    if (!provider) {
      continue;
    }

    try {
      const reply = await callProvider(provider, config, message, history);
      if (reply) {
        return {
          success: true,
          provider,
          reply,
          failures,
        };
      }

      failures.push({ provider, error: "empty_response" });
    } catch (error) {
      failures.push({ provider, error: error.message });
    }
  }

  return {
    success: false,
    provider: null,
    reply: null,
    failures,
  };
};

const buildAdminReply = (config, message) => {
  const normalized = normalizeText(message);
  const responses = config.admin_handoff?.responses || {};

  if (normalized.includes("trừ tiền") || normalized.includes("chuyển khoản") || normalized.includes("thanh toán")) {
    return responses.payment_issue || responses.need_booking_info || responses.generic;
  }

  if (normalized.includes("khiếu nại") || normalized.includes("tức") || normalized.includes("bực") || normalized.includes("gấp")) {
    return responses.angry_customer || responses.generic;
  }

  return responses.need_booking_info || responses.generic || "Mình sẽ chuyển hỗ trợ thủ công cho bạn nhé.";
};

const getConfig = async () => {
  const config = await readConfig();
  return config;
};

const replaceConfig = async (payload) => {
  if (!payload || typeof payload !== "object") {
    throw new Error("Payload config không hợp lệ");
  }

  await writeConfig(payload);
  return payload;
};

const patchConfig = async (payload) => {
  if (!payload || typeof payload !== "object") {
    throw new Error("Payload config không hợp lệ");
  }

  const current = await readConfig();
  const merged = deepMerge(current, payload);
  await writeConfig(merged);
  return merged;
};

const chat = async ({ message, history = [] }) => {
  if (!message || !String(message).trim()) {
    throw new Error("message là bắt buộc");
  }

  const config = await readConfig();
  const trimmedMessage = String(message).trim();
  const cleanedHistory = trimHistory(history, config.ai_flow?.max_history || 8);

  const adminCheck = shouldRouteToAdmin(trimmedMessage, config);
  if (adminCheck.matched) {
    return {
      success: true,
      route: "admin",
      reason: adminCheck.reason,
      reply: buildAdminReply(config, trimmedMessage),
      quick_replies: config.quick_replies?.booking || [],
    };
  }

  const bestMatch = matchFaqIntent(trimmedMessage, config.faq_intents || []);
  if (bestMatch && bestMatch.confidence >= (config.routing?.faq_confidence_threshold ?? 0.82)) {
    return {
      success: true,
      route: "faq",
      intent: bestMatch.intent,
      confidence: bestMatch.confidence,
      reply: bestMatch.response,
      quick_replies: config.quick_replies?.home || [],
    };
  }

  if (config.ai_flow?.enabled) {
    const aiResult = await askAi(config, trimmedMessage, cleanedHistory);

    if (aiResult.success) {
      return {
        success: true,
        route: "ai",
        intent: bestMatch?.intent || null,
        confidence: bestMatch?.confidence || null,
        provider: aiResult.provider,
        reply: aiResult.reply,
        quick_replies: config.quick_replies?.home || [],
        provider_failures: aiResult.failures,
      };
    }

    return {
      success: true,
      route: "fallback",
      reply: pickFallback(config, "ai_unavailable"),
      provider: null,
      provider_failures: aiResult.failures,
      quick_replies: config.quick_replies?.home || [],
    };
  }

  return {
    success: true,
    route: "fallback",
    intent: bestMatch?.intent || null,
    confidence: bestMatch?.confidence || null,
    reply: pickFallback(config, "generic"),
    quick_replies: config.quick_replies?.home || [],
  };
};

module.exports = {
  getConfig,
  replaceConfig,
  patchConfig,
  chat,
};
