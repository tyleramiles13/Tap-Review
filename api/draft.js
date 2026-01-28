module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.statusCode = 405;
    return res.json({ error: "Method not allowed" });
  }

  const apiKey = process.env.OPENAI_API_KEY_REAL;
  if (!apiKey) {
    res.statusCode = 500;
    return res.json({ error: "Missing OPENAI_API_KEY_REAL" });
  }

  const { business, employee, detail } = req.body || {};

  if (!business || !employee) {
    res.statusCode = 400;
    return res.json({ error: "Missing business or employee" });
  }

  // This is the key “stays legit” requirement:
  // force at least one real customer-provided detail.
  const userDetail = String(detail || "").trim();
  if (userDetail.length < 6) {
    res.statusCode = 400;
    return res.json({
      error:
        "Add one quick detail first (example: 'interior looks spotless' or 'explained pricing clearly').",
    });
  }

  // Basic helper to keep output short and consistent
  function clampToTwoSentences(text) {
    const t = String(text || "").trim();
    if (!t) return t;

    const parts = t.split(/(?<=[.!?])\s+/).filter(Boolean);
    return parts.slice(0, 2).join(" ").trim();
  }

  async function generate() {
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
              "Help a real customer write an honest Google review based only on the details they provide. Keep it natural and not promotional.",
          },
          {
            role: "user",
            content: `
Write a short Google review (1–2 sentences) for a real customer.

Business: ${business}
Employee: ${employee}

Customer’s real detail (must be reflected):
"${userDetail}"

Rules:
- Mention the employee name naturally.
- Keep it casual and believable.
- Do not exaggerate.
- Do not include hashtags.
Return only the review text.
            `.trim(),
          },
        ],
        temperature: 0.9,
        max_tokens: 90,
      }),
    });

    const bodyText = await resp.text();
    if (!resp.ok) throw new Error(bodyText);

    const data = JSON.parse(bodyText);
    const text = (data?.choices?.[0]?.message?.content || "").trim();
    return clampToTwoSentences(text);
  }

  try {
    // Generate with a couple tries for quality/variation
    let review = "";
    for (let i = 0; i < 3; i++) {
      review = await generate();
      if (review) break;
    }

    if (!review) {
      res.statusCode = 500;
      return res.json({ error: "AI generation failed" });
    }

    return res.status(200).json({ review });
  } catch (e) {
    console.error("Draft API error:", e);
    res.statusCode = 500;
    return res.json({ error: "AI generation failed" });
  }
};




