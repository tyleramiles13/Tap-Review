import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY_REAL,
});

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { business, employee } = req.body || {};

  if (!business || !employee) {
    return res.status(400).json({ error: "Missing business or employee" });
  }

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You write short, natural Google reviews that sound like real customers. Never promotional.",
        },
        {
          role: "user",
          content: `Write a short, casual Google review for ${employee} at ${business}.`,
        },
      ],
      temperature: 0.9,
      max_tokens: 120,
    });

    res.status(200).json({
      review: completion.choices[0].message.content.trim(),
    });
  } catch (err) {
    console.error("AI ERROR:", err);
    res.status(500).json({ error: "AI generation failed" });
  }
}


