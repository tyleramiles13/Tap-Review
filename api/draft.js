module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.statusCode = 405;
    return res.json({ error: "Method not allowed" });
  }

  const { employee, business, businessType, serviceNotes } = req.body || {};

  if (!employee) {
    res.statusCode = 400;
    return res.json({ error: "Missing employee" });
  }

  const apiKey = process.env.OPENAI_API_KEY_REAL;
  if (!apiKey) {
    res.statusCode = 500;
    return res.json({ error: "Missing OPENAI_API_KEY_REAL" });
  }

  // --- Determine business type ---
  let type = (businessType || "").toLowerCase().trim();
  if (type === "auto-detailing") type = "auto_detailing";
  if (type === "detail" || type === "detailing") type = "auto_detailing";

  if (!type) {
    // Default to detailing if nothing is sent (keeps Will behaving normally)
    type = "auto_detailing";
  }

  const notes = String(serviceNotes || "").trim();
  const biz = String(business || "").trim();

  function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  // Mostly 1 sentence, sometimes 2
  const wantTwo = Math.random() < 0.25;
  const sentenceTarget = wantTwo ? 2 : 1;

  // Remove forbidden punctuation instead of rejecting (fast)
  function sanitize(text) {
    return String(text || "").replace(/[;:—–-]/g, "").trim();
  }

  function trimToSentences(text, max) {
    const raw = String(text || "").trim();
    if (!raw) return raw;

    // Split while keeping punctuation
    const parts = raw.split(/([.!?])/).filter(Boolean);
    let out = "";
    let count = 0;

    for (let i = 0; i < parts.length; i += 2) {
      const chunk = (parts[i] || "").trim();
      const punct = (parts[i + 1] || "").trim();
      if (!chunk) continue;

      out += (out ? " " : "") + chunk + (punct || ".");
      count += 1;
      if (count >= max) break;
    }

    return out.trim();
  }

  function startsWithName(text) {
    const t = String(text || "").trim().toLowerCase();
    const name = String(employee || "").trim().toLowerCase();
    if (!t || !name) return false;
    return t.startsWith(name + " ") || t.startsWith(name + ",") || t.startsWith(name + "'") || t.startsWith(name + "’");
  }

  function startsWithStory(text) {
    const t = String(text || "").trim().toLowerCase();
    const banned = ["after ", "after a ", "after an ", "after the ", "last week", "yesterday", "this weekend", "when i", "when we", "on my way"];
    return banned.some((s) => t.startsWith(s));
  }

  // ---- SOLAR quality checks (ONLY for solar) ----
  function solarIsAcceptable(text) {
    const t = String(text || "").trim();
    if (!t) return false;
    if (startsWithName(t)) return false;
    if (startsWithStory(t)) return false;

    const low = t.toLowerCase();
    if (low.includes("solar conversation")) return false;
    if (low.includes("solar info")) return false;

    // Must contain a real solar detail word so it doesn’t go vague
    const must = ["quote", "estimate", "pricing", "bill", "utility", "panels", "panel", "roof", "financing", "installation", "timeline", "options"];
    const hasDetail = must.some((w) => low.includes(w));
    if (!hasDetail) return false;

    // Avoid tiny, empty lines
    const wc = t.split(/\s+/).filter(Boolean).length;
    if (wc < 10) return false;

    return true;
  }

  // ---- DETAILING checks (light touch so Will doesn’t fall back) ----
  function detailingIsAcceptable(text) {
    const t = String(text || "").trim();
    if (!t) return false;
    if (startsWithName(t)) return false;
    if (startsWithStory(t)) return false;
    return true;
  }

  function buildPromptSolar() {
    const detailWords = [
      "quote", "estimate", "pricing", "utility bill", "roof", "panels",
      "financing", "timeline", "options", "installation"
    ];

    const frames1 = [
      `Write one sentence. Start with a simple positive result. Mention "${employee}" later, not at the start. Include one specific solar detail like ${pick(detailWords)}.`,
      `Write one sentence that sounds casual and real. Mention "${employee}" once, not at the start. Include one solar detail like ${pick(detailWords)}.`,
      `Write one sentence that flows naturally. Mention "${employee}" once. Include a solar detail like ${pick(detailWords)}.`
    ];

    const frames2 = [
      `Write two short sentences. First sentence is positive. Second sentence mentions "${employee}" and includes one solar detail like ${pick(detailWords)}.`,
      `Write two short sentences that feel normal and not scripted. Mention "${employee}" once, not at the start. Include one solar detail like ${pick(detailWords)}.`
    ];

    const frame = sentenceTarget === 1 ? pick(frames1) : pick(frames2);

    return `
Write a short Google review draft.

Hard rules:
- ${sentenceTarget} sentence${sentenceTarget === 2 ? "s" : ""} only.
- Do NOT start with "${employee}".
- Do NOT start with "After..." or a story opener.
- Do NOT use semicolons, colons, or any dashes.
- Do NOT use the phrases "solar conversation" or "solar info".
- Do NOT mention the business name.

Context:
- Employee name: "${employee}"
- This is solar related.

Optional notes (use lightly):
${notes || "(none)"}

Instruction:
${frame}

Return ONLY the review text.
    `.trim();
  }

  function buildPromptDetailing() {
    // Keep detailing prompt very light so it behaves like your “working” Will setup
    return `
Write a short Google review draft.

Rules:
- ${sentenceTarget} sentence${sentenceTarget === 2 ? "s" : ""} only.
- Do NOT start with "${employee}".
- Do NOT start with "After..." or a story opener.
- Do NOT use semicolons, colons, or any dashes.
- Do NOT mention the business name.

Context:
- Employee name: "${employee}"
- This is an auto detailing service.

Optional notes (use lightly):
${notes || "(none)"}

Return ONLY the review text.
    `.trim();
  }

  async function generate(prompt, temp, maxTokens) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    try {
      const resp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content:
                "Write short, human sounding Google reviews. Vary structure. No promotional tone."
            },
            { role: "user", content: prompt }
          ],
          temperature: temp,
          max_tokens: maxTokens
        })
      });

      const textBody = await resp.text();
      if (!resp.ok) throw new Error(textBody);

      const data = JSON.parse(textBody);
      return (data?.choices?.[0]?.message?.content || "").trim();
    } finally {
      clearTimeout(timeout);
    }
  }

  try {
    let review = "";
    const isSolar = type === "solar";

    // Only 3 tries (fast)
    for (let attempt = 0; attempt < 3; attempt++) {
      const prompt = isSolar ? buildPromptSolar() : buildPromptDetailing();
      review = await generate(prompt, isSolar ? 1.2 : 1.05, isSolar ? 120 : 95);

      review = sanitize(review);
      review = trimToSentences(review, sentenceTarget);

      if (isSolar) {
        if (solarIsAcceptable(review)) break;
      } else {
        if (detailingIsAcceptable(review)) break;
      }
    }

    // Final cleanup
    review = sanitize(review);
    review = trimToSentences(review, sentenceTarget);

    // Fallbacks (solar now GOOD + varied)
    if (type === "solar" && !solarIsAcceptable(review)) {
      const solarFallback1 = [
        `Really glad I got a clear solar estimate. ${employee} explained the pricing in a way that made sense.`,
        `The solar quote felt straightforward. ${employee} answered my questions and explained the options clearly.`,
        `I understood the utility bill side a lot better after this. ${employee} made the estimate easy to follow.`,
        `Getting a solar quote was simpler than I expected. ${employee} explained pricing and next steps clearly.`,
        `The solar options finally made sense. ${employee} explained the estimate and timeline in plain language.`
      ];

      const solarFallback2 = [
        `The solar estimate made sense and felt straightforward, ${employee} explained it clearly.`,
        `I felt a lot more clear on pricing and options after talking with ${employee}.`,
        `The quote and options were easy to understand, ${employee} explained it well.`
      ];

      review = sentenceTarget === 2 ? pick(solarFallback1) : pick(solarFallback2);
      review = sanitize(review);
      review = trimToSentences(review, sentenceTarget);
    }

    // Detailing fallback (rare, minimal so it doesn’t change Will’s style)
    if (type !== "solar" && !detailingIsAcceptable(review)) {
      review = sentenceTarget === 2
        ? `My car looks great after the detail. ${employee} did a solid job and it came out really clean.`
        : `My car looks great after the detail, ${employee} did a solid job and it came out really clean.`;
      review = sanitize(review);
      review = trimToSentences(review, sentenceTarget);
    }

    return res.status(200).json({ review });
  } catch (e) {
    console.error(e);
    res.statusCode = 500;
    return res.json({ error: "AI generation failed" });
  }
};
