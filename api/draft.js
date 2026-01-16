export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { business, employee, extra } = req.body || {};
  if (!business || !employee) {
    return res.status(400).json({ error: "Missing business or employee" });
  }

  const apiKey = process.env.OPENAI_API_KEY_REAL;
  if (!apiKey) {
    return res.status(500).json({ error: "Missing OPENAI_API_KEY_REAL" });
  }

  try {
    const prompt = `Write a short, natural Google review for ${employee} at ${business}. 
Sound like a real customer. Casual, friendly, not promotional. ${extra || ""}`.trim();

    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "You write short, human-sounding Google reviews. No marketing language." },
          { role: "user", content: prompt }
        ],
        temperature: 0.9,
        max_tokens: 120
      })
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return res.status(resp.status).json({ error: errText });
    }

    const data = await resp.json();
    const text = data?.choices?.[0]?.message?.content?.trim();

    if (!text) return res.status(500).json({ error: "No text returned" });

    return res.status(200).json({ review: text });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "AI generation failed" });
  }
}


