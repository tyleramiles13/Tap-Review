module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.statusCode = 405;
    return res.json({ error: "Method not allowed" });
  }

  const { business, employee, extra } = req.body || {};
  if (!business || !employee) {
    res.statusCode = 400;
    return res.json({ error: "Missing business or employee" });
  }

  const apiKey = process.env.OPENAI_API_KEY_REAL;
  if (!apiKey) {
    res.statusCode = 500;
    return res.json({ error: "Missing OPENAI_API_KEY_REAL" });
  }

  try {
    const prompt = `
Write a very short Google review (1–2 sentences max).

Rules:
- Mention the employee name "${employee}"
- Do NOT mention the business name
- Do NOT start with "Just had", "Just got", or "I just"
- Use a different opening each time
- Sound natural, casual, and human
- Avoid salesy or promotional language

Vary the angle:
Sometimes focus on results, sometimes friendliness, sometimes how easy it was.

Write only the review text.
`.trim();

    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "You write short, human-sounding Google reviews. No marketing language." },
          { role: "user", content: prompt }
        ],
        temperature: 0.9,
        max_tokens: 120,
      }),
    });

    const textBody = await resp.text();
    if (!resp.ok) {
      res.statusCode = resp.status;
      return res.json({ error: textBody });
    }

    const data = JSON.parse(textBody);
    const text = data?.choices?.[0]?.message?.content?.trim();
    if (!text) {
      res.statusCode = 500;
      return res.json({ error: "No text returned" });
    }

    return res.status(200).json({ review: text });
  } catch (e) {
    console.error(e);
    res.statusCode = 500;
    return res.json({ error: "AI generation failed" });
  }
};



