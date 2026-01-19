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

  // --- Determine business type (safe for Will + fixes Swave if businessType isn't sent) ---
  let type = (businessType || "").toLowerCase().trim();

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
      avoidStarts: ["just had", "just got", "i just"]
    },
    solar: {
      label: "a solar sales consultation",
      mustIncludeAny: [
        "solar", "panels", "panel", "quote", "pricing", "bill", "savings",
        "financing", "estimate", "install", "installation", "process"
      ],
      mustMentionAny: [],
      avoidStarts: ["just had", "just got", "i just"]
    }
  };

  const cfg = rules[type] || rules.auto_detailing;

  function countSentences(text) {
    // Count sentences by punctuation end marks
    const parts = (text || "").trim().split(/[.!?]+/).filter(Boolean);
    return parts.length;
  }

  function startsWithEmployeeName(text) {
    const t = (text || "").trim().toLowerCase();
    const name = String(employee || "").trim().toLowerCase();
    if (!t || !name) return false;

    // Check first "word" chunk (handle "Will," "Will -" "Will’s")
    return (
      t.startsWith(name + " ") ||
      t.startsWith(name + ",") ||
      t.startsWith(name + "-") ||
      t.startsWith(name + "—") ||
      t.startsWith(name + "'") ||
      t.startsWith(name + "’")
    );
  }

  function isGood(text) {
    const t = (text || "").toLowerCase().trim();
    if (!t) return false;

    // Hard cap: 2 sentences max
    if (countSentences(t) > 2) return false;

    // Don’t always start with employee name
    if (startsWithEmployeeName(t)) return false;

    // avoid certain openings (generic)
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

    return true;
  }

  function buildPrompt() {
    const notes = (serviceNotes || "").trim();

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

Style rules:
- Keep it short and natural (no long paragraphs).
- Do NOT start with "Just had", "Just got", or "I just".
- Sound like a real customer (casual, believable).
- Avoid marketing language and overly excited claims.
- Use different wording and structure each time.
- Avoid starting with the employee’s name.

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
        max_tokens: 90
      })
    });

    const textBody = await resp.text();

    if (!resp.ok) {
      throw new Error(textBody);
    }

    const data = JSON.parse(textBody);
    const text = data?.choices?.[0]?.message?.content?.trim() || "";
    return text;
  }

  try {
    let review = "";

    for (let attempt = 0; attempt < 4; attempt++) {
      review = await generateOnce();
      if (isGood(review)) break;
    }

    // Fallbacks (rare)
    if (!isGood(review)) {
      if (type === "solar") {
        // 2 sentences max, no starting with employee name, include solar keywords
        review = `Really appreciated how clear everything was. ${employee} explained solar pricing and savings in a way that made sense.`;
      } else {
        // 2 sentences max, no starting with employee name, include detailing keywords + car
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
