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

  // --- Determine business type (safe default) ---
  let type = (businessType || "").toLowerCase().trim();
  if (type === "auto-detailing") type = "auto_detailing";
  if (type === "detail" || type === "detailing") type = "auto_detailing";

  if (!type) {
    const notesLower = (serviceNotes || "").toLowerCase();
    const solarHints = [
      "solar", "panel", "panels", "quote", "pricing", "bill", "savings",
      "financing", "install", "installation", "estimate", "kw", "utility", "roof"
    ];
    const looksSolar = solarHints.some((w) => notesLower.includes(w));
    type = looksSolar ? "solar" : "auto_detailing";
  }

  // --- Topic words (broad pools so it doesn’t force the same 3 words) ---
  const topic = {
    auto_detailing: {
      label: "auto detailing",
      tokens: [
        "interior", "seats", "carpets", "mats", "dashboard", "console", "windows",
        "exterior", "paint", "wheels", "tires", "finish", "shine",
        "clean", "detailed", "like new", "great job", "attention to detail"
      ],
      softAvoid: ["spotless", "fresh", "magic"], // not banned forever, just discouraged
    },
    solar: {
      label: "solar consultation",
      tokens: [
        "solar", "panels", "quote", "estimate", "pricing", "bill", "utility",
        "savings", "financing", "roof", "installation", "timeline", "options",
        "questions", "next steps", "process"
      ],
      softAvoid: ["walked me through", "made the whole process", "potential savings"],
    }
  };

  const cfg = topic[type] || topic.auto_detailing;
  const notes = String(serviceNotes || "").trim();

  // --- Hard punctuation rules you asked for ---
  // No semicolons, no colons, no dashes of any kind (hyphen/en/em)
  function hasForbiddenPunctuation(text) {
    return /[;:—–-]/.test(text || "");
  }

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
      t.startsWith(name + "'") ||
      t.startsWith(name + "’")
    );
  }

  function startsWithBoringStoryOpener(text) {
    const t = (text || "").trim().toLowerCase();
    if (!t) return false;
    const banned = [
      "after ", "after a ", "after an ", "after the ",
      "on my way", "when i", "when we",
      "last week", "yesterday", "this weekend"
    ];
    return banned.some((s) => t.startsWith(s));
  }

  function containsSoftAvoid(text) {
    const t = (text || "").toLowerCase();
    return (cfg.softAvoid || []).some((p) => t.includes(String(p).toLowerCase()));
  }

  // Keep it short + clean. Don’t over-restrict content.
  function isGood(text) {
    const raw = (text || "").trim();
    if (!raw) return false;

    const sentences = countSentences(raw);
    if (sentences < 1 || sentences > 2) return false;

    if (hasForbiddenPunctuation(raw)) return false;
    if (startsWithEmployeeName(raw)) return false;
    if (startsWithBoringStoryOpener(raw)) return false;

    // We *prefer* not to repeat the same “fresh/spotless/magic” stuff.
    // Not a hard fail every time, but we can treat it as a soft fail.
    if (containsSoftAvoid(raw)) return false;

    return true;
  }

  // --- Variation engine: “frames” + randomized focus tokens ---
  function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  // 75% 1 sentence, 25% 2 sentences
  const wantTwoSentences = Math.random() < 0.25;
  const sentenceTarget = wantTwoSentences ? 2 : 1;

  function buildPrompt() {
    const focusA = pick(cfg.tokens);
    const focusB = pick(cfg.tokens);

    // Different frames so structure doesn’t repeat
    const oneSentenceFrames = [
      `Write one sentence that starts with an observation, then mention "${employee}" naturally, and include one small ${cfg.label} detail.`,
      `Write one sentence that sounds like a real customer recommending someone, mention "${employee}", and include one ${cfg.label} keyword.`,
      `Write one sentence with a simple result first, then mention "${employee}" after a comma, and keep it casual.`,
      `Write one sentence that starts with a short compliment, then mention "${employee}" later in the sentence.`,
      `Write one sentence that starts with "Really happy with it" or "Super easy", then mention "${employee}" later.`
    ];

    const twoSentenceFrames = [
      `Write two short sentences. First sentence is a quick positive result. Second sentence mentions "${employee}" and includes one ${cfg.label} detail.`,
      `Write two short sentences. Mention "${employee}" in the second sentence, not the first.`,
      `Write two short sentences. First sentence is general. Second sentence includes a small ${cfg.label} detail and a recommendation.`,
      `Write two short sentences. Avoid sounding like a script. Keep it simple and believable.`
    ];

    const frame = sentenceTarget === 1 ? pick(oneSentenceFrames) : pick(twoSentenceFrames);

    return `
Write a short Google review draft.

Hard rules:
- ${sentenceTarget} sentence${sentenceTarget === 2 ? "s" : ""} only.
- Do NOT use semicolons.
- Do NOT use colons.
- Do NOT use dashes of any kind.
- Do NOT start the review with "${employee}".
- Do NOT start with a long story like "After a road trip" or "After hauling gear".

Context:
- Business type: ${cfg.label}
- Employee name: "${employee}"
- Do NOT mention the business name.

What to include:
- Mention "${employee}" once.
- Include one small relevant detail using words like: "${focusA}" or "${focusB}".
- Keep it natural, not salesy, not robotic.

Optional notes (use lightly if helpful, do not copy exactly):
${notes || "(none)"}

Important:
- Avoid repeating common phrases like "spotless", "fresh", or "worked his magic".
Return ONLY the review text.
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
          {
            role: "system",
            content:
              "You write short, human sounding Google reviews. Keep them varied, casual, and believable. No promotional tone. Follow punctuation rules exactly."
          },
          { role: "user", content: prompt }
        ],
        temperature: 1.15,
        max_tokens: 90
      })
    });

    const textBody = await resp.text();
    if (!resp.ok) throw new Error(textBody);

    const data = JSON.parse(textBody);
    return (data?.choices?.[0]?.message?.content || "").trim();
  }

  try {
    let review = "";

    // Retry for quality/variation. SoftAvoid makes it try different phrasing.
    for (let attempt = 0; attempt < 10; attempt++) {
      review = await generateOnce();
      if (isGood(review)) break;
    }

    // Fallbacks (must obey punctuation rules)
    if (!isGood(review)) {
      if (type === "solar") {
        review = sentenceTarget === 2
          ? `The solar info was easy to understand. ${employee} answered my questions and made the quote feel simple.`
          : `Super easy solar conversation, ${employee} answered my questions and made the quote feel simple.`;
      } else {
        review = sentenceTarget === 2
          ? `My car looks great after the detail. ${employee} did a solid job on the interior and finish.`
          : `My car looks great after the detail, ${employee} did a solid job on the interior and finish.`;
      }
    }

    return res.status(200).json({ review });
  } catch (e) {
    console.error(e);
    res.statusCode = 500;
    return res.json({ error: "AI generation failed" });
  }
};





