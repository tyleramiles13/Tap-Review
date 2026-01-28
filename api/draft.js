module.exports = async function handler(req, res) {
  // --- Only allow POST ---
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

  // --- Determine business type (safe defaults) ---
  let type = (businessType || "").toLowerCase().trim();

  // Normalize common variants
  if (type === "auto-detailing") type = "auto_detailing";
  if (type === "detail" || type === "detailing") type = "auto_detailing";

  if (!type) {
    const notesLower = (serviceNotes || "").toLowerCase();
    const solarHints = [
      "solar",
      "panel",
      "panels",
      "quote",
      "pricing",
      "bill",
      "savings",
      "financing",
      "install",
      "installation",
      "estimate",
      "kw",
      "utility",
      "roof",
      "monthly",
    ];
    const looksSolar = solarHints.some((w) => notesLower.includes(w));
    type = looksSolar ? "solar" : "auto_detailing";
  }

  // --- Rules by business type ---
  const rules = {
    auto_detailing: {
      label: "an auto detailing service",
      mustIncludeAny: [
        "clean",
        "spotless",
        "interior",
        "exterior",
        "shiny",
        "fresh",
        "vacuum",
        "vacuumed",
        "wax",
        "polish",
      ],
      mustMentionAny: ["car", "vehicle"],
      avoidStarts: [
        // old repetitive openers
        "just had",
        "just got",
        "i just",
        "had a great",
        "had a good",
        "great experience",
        "great consultation",

        // story-style openers you DON'T want
        "after ",
        "after a ",
        "after an ",
        "after the ",
        "following ",
        "after my ",
        "after our ",
        "after hauling",
        "after a long",
        "after driving",
        "after a road",
      ],
      avoidPhrases: [
        // optional: you can add more later if you see repeats
        "made the whole process",
        "took the time to explain",
        "walked me through",
      ],
    },

    solar: {
      label: "a solar conversation / consultation",
      mustIncludeAny: [
        "solar",
        "panels",
        "panel",
        "quote",
        "pricing",
        "bill",
        "savings",
        "financing",
        "estimate",
        "utility",
        "roof",
        "install",
      ],
      mustMentionAny: [],
      avoidStarts: [
        "just had",
        "just got",
        "i just",
        "had a great",
        "had a good",
        "great experience",
        "great consultation",
        "had a great conversation",
        "had a great meeting",

        // story-style openers you DON'T want
        "after ",
        "after a ",
        "after an ",
        "after the ",
        "following ",
        "after my ",
        "after our ",
        "after hauling",
        "after a long",
        "after driving",
        "after a road",
      ],
      avoidPhrases: [
        // common robot phrases
        "walked me through",
        "made the whole process",
        "helped me understand my potential savings",
        "really appreciated",
        "took the time to explain",
      ],
    },
  };

  const cfg = rules[type] || rules.auto_detailing;

  // Safety: ensure arrays always exist
  const mustIncludeAny = Array.isArray(cfg.mustIncludeAny) ? cfg.mustIncludeAny : [];
  const mustMentionAny = Array.isArray(cfg.mustMentionAny) ? cfg.mustMentionAny : [];
  const avoidStarts = Array.isArray(cfg.avoidStarts) ? cfg.avoidStarts : [];
  const avoidPhrases = Array.isArray(cfg.avoidPhrases) ? cfg.avoidPhrases : [];

  // --- Helpers ---
  function countSentences(text) {
    const parts = (text || "")
      .trim()
      .split(/[.!?]+/)
      .filter(Boolean);
    return parts.length;
  }

  function startsWithEmployeeName(text) {
    const t = (text || "").trim().toLowerCase();
    const name = String(employee || "").trim().toLowerCase();
    if (!t || !name) return false;

    return (
      t.startsWith(name + " ") ||
      t.startsWith(name + ",") ||
      t.startsWith(name + "'") ||
      t.startsWith(name + "’")
    );
  }

  function startsWithBannedOpener(text) {
    const t = (text || "").trim().toLowerCase();
    if (!t) return false;
    return avoidStarts.some((s) => t.startsWith(s));
  }

  function containsAvoidPhrases(text) {
    if (!avoidPhrases.length) return false;
    const t = (text || "").toLowerCase();
    return avoidPhrases.some((p) => t.includes(String(p).toLowerCase()));
  }

  // NEW: ban semicolons and any dashes (hyphen, en dash, em dash)
  function containsBannedPunctuation(text) {
    if (!text) return false;
    return /[;—–-]/.test(text);
  }

  // Optional: avoid weird punctuation beyond what you want
  function containsOddPunctuation(text) {
    if (!text) return false;
    // Blocks: colon, parentheses, brackets, quotes, emojis (basic), etc.
    // Keeps: letters, numbers, spaces, commas, periods, exclamation
    return /[:()\[\]{}"“”'’@#%^*_+=<>\\/|~`]/.test(text);
  }

  function isGood(text) {
    const raw = (text || "").trim();
    const t = raw.toLowerCase();

    if (!raw) return false;

    // 2 sentences max
    if (countSentences(raw) > 2) return false;

    // Don’t start with employee name
    if (startsWithEmployeeName(raw)) return false;

    // Don’t start with story openers / repetitive openers
    if (startsWithBannedOpener(raw)) return false;

    // No semicolons or dashes
    if (containsBannedPunctuation(raw)) return false;

    // Keep punctuation simple (optional extra strictness)
    if (containsOddPunctuation(raw)) return false;

    // Avoid repeated robotic phrases
    if (containsAvoidPhrases(raw)) return false;

    // Must include a relevant keyword so it stays on-topic
    if (mustIncludeAny.length > 0) {
      const hasKeyword = mustIncludeAny.some((k) => t.includes(String(k).toLowerCase()));
      if (!hasKeyword) return false;
    }

    // Optionally require mention words (like car/vehicle for detailing)
    if (mustMentionAny.length > 0) {
      const mentions = mustMentionAny.some((w) => t.includes(String(w).toLowerCase()));
      if (!mentions) return false;
    }

    return true;
  }

  // --- Prompt: generic templates with variation (NOT story-based) ---
  function buildPrompt() {
    const notes = (serviceNotes || "").trim();

    // Generic “template angles” (not storytelling)
    const solarAngles = [
      "keep it generic and low pressure, mention solar and one practical word like quote or pricing",
      "keep it short and simple, mention solar and panels without extra details",
      "keep it neutral and believable, mention solar and estimate with no story",
      "keep it basic, mention solar and utility bill, do not add a scenario",
      "keep it generic, mention financing or pricing, do not describe a personal situation",
    ];

    const detailingAngles = [
      "keep it generic, mention car and interior being clean or fresh",
      "keep it generic, mention car and exterior looking shiny or clean",
      "keep it basic, mention car looking clean and ready to go, no extra details",
      "keep it neutral, mention vehicle and spotless or clean, do not add a scenario",
      "keep it simple, mention car and vacuumed or fresh, no story",
    ];

    const anglePool = type === "solar" ? solarAngles : detailingAngles;
    const angle = anglePool[Math.floor(Math.random() * anglePool.length)];

    // Different sentence patterns to reduce repetition
    const patterns = [
      `Pattern 1: Start with a result. Mention "${employee}" in the second half of sentence 1.`,
      `Pattern 2: Start with a simple opinion. Mention "${employee}" in sentence 2.`,
      `Pattern 3: Start with a quick recommendation. Mention "${employee}" after the first clause.`,
      `Pattern 4: Start with "Really happy with the" and then mention "${employee}" later, but do not start with the name.`,
      `Pattern 5: Start with "Super easy" or "Quick and simple" then mention "${employee}" later.`,
    ];
    const pattern = patterns[Math.floor(Math.random() * patterns.length)];

    return `
Write a very short Google review that feels like a generic starter draft the customer can edit later.
Max 2 sentences.

Punctuation rules are strict:
Do not use semicolons.
Do not use dashes of any kind.
Only use periods, commas, and at most one exclamation point.

Context:
This is for ${cfg.label}.
Employee name is "${employee}".
Do not mention the business name.

Hard requirements:
Mention "${employee}" somewhere but do not start the review with "${employee}".
Include at least one of these words: ${mustIncludeAny.join(", ")}.
${mustMentionAny.length ? `Also include: ${mustMentionAny.join(" or ")}.` : ""}

Banned openings:
Do not start with After.
Do not start with Just had, Just got, I just.
Do not start with Had a great, Great experience, Had a great consultation.
Do not start with a long personal scenario.

Style:
Keep it generic, vague, and believable.
Avoid overly specific situations like road trips, sports gear, snacks, hauling, kids, pets, weather.
Avoid sounding like marketing.

Variation:
Use a different wording and structure each time.

Angle:
${angle}

Structure:
${pattern}

Optional notes you may lightly reflect, but keep it vague:
${notes || "(none)"}

Write only the review text.
`.trim();
  }

  async function generateOnce() {
    const prompt = buildPrompt();

    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "Write short, human sounding Google review starter drafts. Keep them generic and editable. No business name. No stories. No semicolons or dashes. Do not start with After. Vary structure each time.",
          },
          { role: "user", content: prompt },
        ],
        temperature: 1.05,
        max_tokens: 85,
      }),
    });

    const textBody = await resp.text();
    if (!resp.ok) throw new Error(textBody);

    const data = JSON.parse(textBody);
    return (data?.choices?.[0]?.message?.content || "").trim();
  }

  try {
    let review = "";

    // More retries because rules are strict
    for (let attempt = 0; attempt < 8; attempt++) {
      review = await generateOnce();
      if (isGood(review)) break;
    }

    // Fallbacks (generic + editable, still on-type)
    if (!isGood(review)) {
      if (type === "solar") {
        review = `Super easy to get a solar quote and talk through pricing. ${employee} was helpful and made the next steps clear.`;
      } else {
        review = `My car looks clean and fresh after the detail. ${employee} did a great job and I would recommend him.`;
      }
    }

    return res.status(200).json({ review });
  } catch (e) {
    console.error("Draft API error:", e);
    res.statusCode = 500;
    return res.json({ error: "AI generation failed" });
  }
};


