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

  // --- Determine business type (safe for Will + works even if businessType isn’t sent) ---
  let type = (businessType || "").toLowerCase().trim();

  // Normalize common variants
  if (type === "auto-detailing") type = "auto_detailing";
  if (type === "detail" || type === "detailing") type = "auto_detailing";

  if (!type) {
    const notesLower = (serviceNotes || "").toLowerCase();
    const solarHints = [
      "solar", "panel", "panels", "quote", "pricing", "bill", "savings",
      "financing", "install", "installation", "estimate", "kw", "utility"
    ];
    const looksSolar = solarHints.some((w) => notesLower.includes(w));
    type = looksSolar ? "solar" : "auto_detailing";
  }

  // --- Rules by business type ---
  const rules = {
    auto_detailing: {
      label: "an auto detailing service",
      mustIncludeAny: [
        "interior", "exterior", "vacuum", "vacuumed", "spotless", "shiny",
        "clean", "fresh", "smelled", "wax", "polish"
      ],
      mustMentionAny: ["car", "vehicle"],
      avoidStarts: [
        "just had", "just got", "i just",
        "had a great", "had a good", "had a great experience", "had a great consultation",
        "great experience", "great consultation"
      ]
    },
    solar: {
      label: "a solar conversation / consultation (often door-to-door)",
      // Make sure the review actually sounds like solar (not generic service talk)
      mustIncludeAny: [
        "solar", "panel", "panels", "quote", "pricing", "bill", "savings",
        "financing", "estimate", "install", "installation", "process", "utility", "roof"
      ],
      mustMentionAny: [],
      // Ban the repetitive openers you’re seeing
      avoidStarts: [
        "just had", "just got", "i just",
        "had a great", "had a good", "had a great experience", "had a great consultation",
        "great experience", "great consultation",
        "had a great conversation", "had a great meeting",
        "had a great", "had a good"
      ],
      // Common robot phrases to avoid repeating over and over
      avoidPhrases: [
        "walked me through",
        "made the whole process",
        "helped me understand my potential savings",
        "really appreciated",
        "took the time to explain"
      ]
    }
  };

  const cfg = rules[type] || rules.auto_detailing;

  // --- Helpers ---
  function countSentences(text) {
    const parts = (text || "").trim().split(/[.!?]+/).filter(Boolean);
    return parts.length;
  }

  function startsWithEmployeeName(text) {
    const t = (text || "").trim().toLowerCase();
    const name = String(employee || "").trim().toLowerCase();
    if (!t || !name) return false;

    return (
      t.startsWith(name + " ") ||
      t.startsWith(name + ",") ||
      t.startsWith(name + "-") ||
      t.startsWith(name + "—") ||
      t.startsWith(name + "'") ||
      t.startsWith(name + "’")
    );
  }

  function startsWithBannedOpener(text) {
    const t = (text || "").trim().toLowerCase();
    if (!t) return false;
    return cfg.avoidStarts.some((s) => t.startsWith(s));
  }

  function containsAvoidPhrases(text) {
    if (!cfg.avoidPhrases || cfg.avoidPhrases.length === 0) return false;
    const t = (text || "").toLowerCase();
    return cfg.avoidPhrases.some((p) => t.includes(p.toLowerCase()));
  }

  function isGood(text) {
    const t = (text || "").toLowerCase().trim();
    if (!t) return false;

    // Hard cap: 2 sentences max (your request)
    if (countSentences(t) > 2) return false;

    // Don’t always start with employee name
    if (startsWithEmployeeName(t)) return false;

    // Ban repetitive openers
    if (startsWithBannedOpener(t)) return false;

    // Avoid repeated robot phrases
    if (containsAvoidPhrases(t)) return false;

    // Must include a relevant keyword for that business type
    const hasKeyword = cfg.mustIncludeAny.some((k) => t.includes(k));
    if (!hasKeyword) return false;

    // Optionally require certain mention words
    if (cfg.mustMentionAny.length > 0) {
      const mentions = cfg.mustMentionAny.some((w) => t.includes(w));
      if (!mentions) return false;
    }

    return true;
  }

  // --- Prompt styles (biggest improvement for “not the same every time”) ---
  function buildPrompt() {
    const notes = (serviceNotes || "").trim();

    // Different “angles” so it doesn’t repeat pricing/consultation every time
    const solarAngles = [
      "focus on being low-pressure and respectful (door-to-door context is okay but keep it subtle)",
      "focus on clarity: the explanation finally made sense",
      "focus on the customer feeling informed (not sold)",
      "focus on options: comparing choices or next steps",
      "focus on practical details: estimate/roof/utility bill/install timeline",
      "focus on the rep being normal and easy to talk to (but still include a solar keyword)"
    ];

    const detailingAngles = [
      "focus on how clean the interior felt",
      "focus on the exterior shine / spotless finish",
      "focus on a before/after difference",
      "focus on small details being taken care of"
    ];

    const anglePool = type === "solar" ? solarAngles : detailingAngles;
    const angle = anglePool[Math.floor(Math.random() * anglePool.length)];

    const styleA = `Style A (short + direct): 1 sentence if possible, 2 max. Start with an observation (NOT the employee name).`;
    const styleB = `Style B (mini story): Start with a quick real-life moment. Mention "${employee}" after the first phrase.`;
    const styleC = `Style C (result-first): Start with the most specific outcome, then mention "${employee}".`;
    const styles = [styleA, styleB, styleC];
    const chosenStyle = styles[Math.floor(Math.random() * styles.length)];

    return `
Write a Google review that is MAX 2 sentences.

Context:
- This is for ${cfg.label}.
- The employee’s name is "${employee}".
- Do NOT mention the business name.

Hard requirements:
- Mention "${employee}" somewhere in the review, but DO NOT start the review with "${employee}".
- The review MUST include at least one of these words: ${cfg.mustIncludeAny.join(", ")}.
${cfg.mustMentionAny.length ? `- Also mention: ${cfg.mustMentionAny.join(" or ")}.` : ""}

Banned openings:
- Do NOT start with "Had a great", "Had a great experience", "Had a great consultation", "Great experience", or similar.
- Do NOT start with "Just had", "Just got", or "I just".
- Do NOT start with the employee’s name.

Avoid sounding robotic:
- Avoid phrases like: ${cfg.avoidPhrases ? cfg.avoidPhrases.join("; ") : "none"}.

Angle for this review:
- ${angle}

Extra context (use if helpful, do not copy verbatim):
${notes || "(none)"}

Write ONLY the review text.
`.trim();
  }

  async function generateOnce() {
    const prompt = buildPrompt();

    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "You write short, human-sounding Google reviews. No promotional tone." },
          { role: "user", content: prompt }
        ],
        temperature: 1.0,
        max_tokens: 85
      })
    });

    const textBody = await resp.text();
    if (!resp.ok) throw new Error(textBody);

    const data = JSON.parse(textBody);
    return (data?.choices?.[0]?.message?.content || "").trim();
  }

  try {
    let review = "";

    // More retries since we’re enforcing more rules (still fast)
    for (let attempt = 0; attempt < 6; attempt++) {
      review = await generateOnce();
      if (isGood(review)) break;
    }

    // Fallbacks (rare)
    if (!isGood(review)) {
      if (type === "solar") {
        review = `It was nice getting clear answers without any pressure. ${employee} explained solar pricing and the estimate process in a way that actually made sense.`;
      } else {
        review = `My car looked spotless when it was done. ${employee} got the interior clean and feeling fresh.`;
      }
    }

    return res.status(200).json({ review });
  } catch (e) {
    console.error(e);
    res.statusCode = 500;
    return res.json({ error: "AI generation failed" });
  }
};
