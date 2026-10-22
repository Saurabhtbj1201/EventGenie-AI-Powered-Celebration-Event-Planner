/**
 * EventGenie — Vercel Serverless Function (API Proxy)
 * Proxies requests to Google Gemini API.
 * The GEMINI_API_KEY is stored in Vercel environment variables — never exposed to the client.
 *
 * POST /api/generate
 * Body: { prompt: string, systemPrompt: string, format: 'text'|'json' }
 * Returns: { result: string }
 */

const GEMINI_MODEL   = 'gemini-2.0-flash';
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

export default async function handler(req, res) {
  // ── CORS Headers ────────────────────────────────────────────────────────────
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // ── Handle Preflight ────────────────────────────────────────────────────────
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // ── Method Guard ────────────────────────────────────────────────────────────
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use POST.' });
  }

  // ── API Key Guard ───────────────────────────────────────────────────────────
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('GEMINI_API_KEY environment variable is not set.');
    return res.status(500).json({ error: 'Server configuration error.' });
  }

  // ── Input Validation ────────────────────────────────────────────────────────
  const { prompt, systemPrompt, format } = req.body || {};

  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'Request body must include a "prompt" string.' });
  }
  if (prompt.length > 8000) {
    return res.status(400).json({ error: 'Prompt exceeds maximum allowed length.' });
  }

  // ── Build Gemini Request ─────────────────────────────────────────────────────
  const requestBody = {
    contents: [
      {
        role: 'user',
        parts: [{ text: prompt }]
      }
    ],
    generationConfig: {
      temperature:     0.7,
      maxOutputTokens: 2048,
      topP:            0.9
    }
  };

  // Add system instruction if provided
  if (systemPrompt && typeof systemPrompt === 'string') {
    requestBody.systemInstruction = {
      parts: [{ text: systemPrompt }]
    };
  }

  // Ask for JSON mime type if format === 'json'
  if (format === 'json') {
    requestBody.generationConfig.responseMimeType = 'application/json';
  }

  // ── Call Gemini ──────────────────────────────────────────────────────────────
  try {
    const geminiRes = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(requestBody)
    });

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error(`Gemini API error ${geminiRes.status}:`, errText);
      return res.status(502).json({
        error: `Upstream AI service error: ${geminiRes.status}`
      });
    }

    const data = await geminiRes.json();

    // Extract text from Gemini response
    const result = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (result === undefined || result === null) {
      console.error('Unexpected Gemini response shape:', JSON.stringify(data).slice(0, 500));
      return res.status(502).json({ error: 'Unexpected response from AI service.' });
    }

    return res.status(200).json({ result });

  } catch (err) {
    console.error('Error calling Gemini API:', err);
    return res.status(500).json({ error: 'Failed to connect to AI service.' });
  }
}
