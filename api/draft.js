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

  // Default to detailing so Will’s existing page still behaves correctly
  const type = (businessType || "auto_detailing").toLowerCase();

  // Keyword + validation rules by business type
  const rules = {
    auto_detailing: {
      label: "an auto detailing service",
      mustIncludeAny: ["interior", "exterior", "vacuum", "vacuumed", "spotless", "shiny", "clean", "fresh", "smelled", "wax", "polish"],
      mustMentionAny: ["car", "vehicle"],
      avoidStarts: ["just had", "just got", "i just"]
    },
    solar: {
      label: "a solar sales consultation",
      mustIncludeAny: ["solar", "panels", "panel", "quote", "pricing", "bill", "savings", "financing", "estimate", "install", "installation", "process"],
      // for solar, we don’t require “car/vehicle”
      mustMentionAny: [],
      avoidStarts: ["just had", "just got", "i just"]
    }
  };

  const cfg = rules[type] || rules.auto_detailing;

  function isGood(text) {
    const t = (text || "").toLowerCase().trim();
    if (!t) return false;

    // avoid certain openings
    for (const s of cfg.avoidStarts) {
      if (t.startsWith(s)) return false;
    }

    // must include a relevant keyword
    const hasKeyword = cfg.mustIncludeAny.some((k) => t.includes(k));
    if (!hasKeyword) return false;

    // optionally must mention certain words
    if (cfg.mustMentionAny.length > 0) {
      const mentions = cfg.mustMentionAny.some((w) => t.includes(w));
      if (!mentions) return false;
    }

    // keep it short-ish: 1–2 sentences. (Soft check)
    const sentenceCount = t.split(/[.!?]+/).filter(Boolean).length;
    if (sentenceCount > 2) return false;

    return true;
  }

  // Prompt builder
  function buildPrompt() {
    const notes = (serviceNotes || "").trim();

    return `
Write a very short Google review (1–2 sentences max).

Context:
- This is for ${cfg.label}.
- The employee’s name is "${employee}".
- Do NOT mention the business name.

Hard requirements:
- Mention "${employee}" naturally.
- Include at least ONE specific, relevant detail for this type of business.
- The review MUST include at least one of these words: ${cfg.mustIncludeAny.join(", ")}.
${cfg.mustMentionAny.length ? `- Also mention: ${cfg.mustMentionAny.join(" or ")}.` : ""}

Style rules:
- Do NOT start with "Just had", "Just got", or "I just".
- Sound like a real customer (casual, believable).
- Avoid marketing language and overly excited claims.
- Use different wording and structure each time.

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
        temperature: 0.95,
        max_tokens: 120
      })
    });

    const textBody = await resp.text();

    if (!resp.ok) {
      // Return OpenAI error body so it’s easy to debug
      throw new Error(textBody);
    }

    const data = JSON.parse(textBody);
    const text = data?.choices?.[0]?.message?.content?.trim() || "";
    return text;
  }

  try {
    let review = "";

    for (let attempt = 0; attempt < 3; attempt++) {
      review = await generateOnce();
      if (isGood(review)) break;
    }

    // Fallbacks (rare)
    if (!isGood(review)) {
      if (type === "solar") {
        review = `${employee} was helpful and made the solar process easy to understand — the pricing and next steps were clear.`;
      } else {
        review = `${employee} did a great job — my car was clean, fresh, and the interior looked spotless.`;
      }
    }

    return res.status(200).json({ review });
  } catch (e) {
    console.error(e);
    res.statusCode = 500;
    return res.json({ error: "AI generation failed" });
  }
};
