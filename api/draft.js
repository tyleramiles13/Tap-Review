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

Context:
- This is for an AUTO DETAILING service.
- The employee's name is "${employee}".
- Do NOT mention the business name.

Required content:
- Mention "${employee}" naturally.
- Include at least ONE specific auto-detailing result, such as:
  • how clean the car looked
  • how fresh the interior felt
  • attention to small details
  • shine, spotless finish, or before/after difference

Rules:
- Avoid generic-only praise like only saying "friendly" or "easy".
- Sound like a real customer, casual and believable.
- Do NOT sound promotional or scripted.

Variation:
- Use different wording and sentence structure each time.
- Keep it short and human.

Write ONLY the review text.
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



