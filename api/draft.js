module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.statusCode = 405;
    return res.json({ error: "Method not allowed" });
  }

  const { employee, businessType, serviceNotes } = req.body || {};

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
  if (!type) type = "auto_detailing"; // keep Will safe by defaulting to detailing

  const notes = String(serviceNotes || "").trim();

  function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  // Solar: ALWAYS 1 sentence template
  // Detailing: mostly 1, sometimes 2 (like your current behavior)
  const sentenceTarget =
    type === "solar" ? 1 : (Math.random() < 0.25 ? 2 : 1);

  // Remove forbidden punctuation
  function sanitize(text) {
    return String(text || "").replace(/[;:—–-]/g, "").trim();
  }

  function trimToSentences(text, max) {
    const raw = String(text || "").trim();
    if (!raw) return raw;

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

    return (
      t.startsWith(name + " ") ||
      t.startsWith(name + ",") ||
      t.startsWith(name + "'") ||
      t.startsWith(name + "’")
    );
  }

  function startsWithStory(text) {
    const t = String(text || "").trim().toLowerCase();
    const banned = [
      "after ", "after a ", "after an ", "after the ",
      "last week", "yesterday", "this weekend",
      "when i", "when we", "on my way"
    ];
    return banned.some((s) => t.startsWith(s));
  }

  // --- SOLAR: template rules + phrase bans ---
  const solarBannedPhrases = [
    "easy to understand",
    "made it easy to understand",
    "made it easy",
    "made everything easy",
    "super easy",
    "very easy",
    "straightforward",
    "simple and easy",
    "smooth",
    "the process",
    "process",
    "walked me through",
    "broke it down",
    "answered all my questions",
    "solar conversation",
    "conversation",
    "consultation"
  ];

  function containsBannedPhrase(text, bannedList) {
    const low = String(text || "").toLowerCase();
    return bannedList.some((p) => low.includes(p));
  }

  function solarIsAcceptable(text) {
    const t = String(text || "").trim();
    if (!t) return false;

    if (startsWithName(t)) return false;
    if (startsWithStory(t)) return false;

    const low = t.toLowerCase();

    // Must feel solar-ish but not salesy
    if (!low.includes("solar")) return false;

    // Must mention employee once somewhere
    if (!low.includes(String(employee).toLowerCase())) return false;

    // Ban repetitive / robotic phrases
    if (containsBannedPhrase(t, solarBannedPhrases)) return false;

    // Must be 1 sentence only
    const sentenceCount = t.split(/[.!?]+/).filter(Boolean).length;
    if (sentenceCount > 1) return false;

    // Not too short
    const wc = t.split(/\s+/).filter(Boolean).length;
    if (wc < 8) return false;

    return true;
  }

  // Detailing: keep checks light so Will doesn’t suddenly fall back
  function detailingIsAcceptable(text) {
    const t = String(text || "").trim();
    if (!t) return false;
    if (startsWithName(t)) return false;
    if (startsWithStory(t)) return false;
    return true;
  }

  function buildPromptSolar() {
    // “Template” starters that do NOT rely on "easy to understand"
    // Also they intentionally leave room for the customer to add specifics
    const patterns = [
      `Write ONE short sentence that sounds like a real Google review starter and is easy for a customer to edit. Mention "${employee}" once, not at the start, and include the word "solar" once.`,
      `Write ONE sentence that feels like a genuine review but stays general. Mention "${employee}" once (not first) and include "solar" once.`,
      `Write ONE sentence that is positive and vague so the customer can personalize it. Mention "${employee}" once (not first) and include "solar" once.`,
      `Write ONE sentence that sounds normal and not robotic. Mention "${employee}" once, not at the start, and include "solar" once.`
    ];

    return `
Write a Google review draft.

Hard rules:
- Exactly ONE sentence.
- Do NOT start with "${employee}".
- Do NOT start with a story opener (After, Last week, Yesterday, etc.).
- Do NOT mention the business name.
- Include the word "solar" exactly once.
- Mention "${employee}" exactly once.
- Keep it general like a template so the customer can edit.
- Do NOT use any of these phrases: ${solarBannedPhrases.join(", ")}.
- Do NOT use semicolons, colons, or any dashes.

Optional notes (do NOT add details, just tone):
${notes || "(none)"}

Instruction:
${pick(patterns)}

Return ONLY the review text.
    `.trim();
  }

  function buildPromptDetailing() {
    // leave detailing simple / stable
    return `
Write a short Google review draft.

Rules:
- ${sentenceTarget} sentence${sentenceTarget === 2 ? "s" : ""} only.
- Do NOT start with "${employee}".
- Do NOT start with a story opener (After, Last week, Yesterday, etc.).
- Do NOT mention the business name.
- Do NOT use semicolons, colons, or any dashes.

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
                "Write short, human sounding Google reviews. Keep them casual and believable. Avoid repeating the same phrasing."
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

    for (let attempt = 0; attempt < 4; attempt++) {
      const prompt = isSolar ? buildPromptSolar() : buildPromptDetailing();
      review = await generate(prompt, isSolar ? 1.25 : 1.05, isSolar ? 80 : 95);

      review = sanitize(review);
      review = trimToSentences(review, sentenceTarget);

      if (isSolar) {
        if (solarIsAcceptable(review)) break;
      } else {
        if (detailingIsAcceptable(review)) break;
      }
    }

    review = sanitize(review);
    review = trimToSentences(review, sentenceTarget);

    // Solar fallback: MANY variants, none use "easy to understand"
    if (isSolar && !solarIsAcceptable(review)) {
      const solarFallback = [
        `Really appreciate ${employee} being respectful and professional about solar.`,
        `Solid experience overall and ${employee} was great to work with on solar.`,
        `Glad I talked with ${employee} and got pointed in the right direction on solar.`,
        `It was a good experience and ${employee} was helpful with solar.`,
        `Thanks to ${employee} for being professional and helpful with solar.`,
        `I had a positive experience and ${employee} was great during the solar visit.`,
        `Everything felt professional and ${employee} did a great job with solar.`,
        `Happy with the experience and ${employee} was friendly and helpful about solar.`
      ];
      review = sanitize(pick(solarFallback));
      review = trimToSentences(review, 1);
    }

    // Detailing fallback (rare)
    if (!isSolar && !detailingIsAcceptable(review)) {
      review =
        sentenceTarget === 2
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

