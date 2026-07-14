/**
 * Vercel serverless function — VELLOX live AI proxy.
 * Mirrors server-cloud.js, but runs on Vercel's servers so the AI call is made
 * from the host (not the visitor's network). The API key comes from the
 * AI_API_KEY environment variable set in the Vercel dashboard — never committed.
 */

const DEFAULT_MODEL = { gemini: 'gemini-2.0-flash', openai: 'gpt-4o-mini' };

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }

    const apiKey = process.env.AI_API_KEY;
    if (!apiKey) {
        res.status(503).json({ error: 'AI not configured (set AI_API_KEY in Vercel env vars)' });
        return;
    }

    const provider = (process.env.AI_PROVIDER || 'gemini').toLowerCase();
    const model = process.env.AI_MODEL || DEFAULT_MODEL[provider] || DEFAULT_MODEL.gemini;

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
        const { systemPrompt, userPrompt, maxTokens = 100, temperature = 0.8 } = body;
        if (!systemPrompt || !userPrompt) {
            res.status(400).json({ error: 'Missing systemPrompt or userPrompt' });
            return;
        }

        let content = '';
        if (provider === 'gemini') {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
            const r = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    systemInstruction: { parts: [{ text: systemPrompt }] },
                    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
                    generationConfig: { temperature, maxOutputTokens: maxTokens }
                })
            });
            if (!r.ok) throw new Error(`Gemini HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
            const data = await r.json();
            content = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
        } else {
            const base = process.env.AI_BASE_URL || 'https://api.openai.com/v1';
            const r = await fetch(`${base}/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
                body: JSON.stringify({
                    model,
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: userPrompt }
                    ],
                    temperature,
                    max_tokens: maxTokens
                })
            });
            if (!r.ok) throw new Error(`LLM HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
            const data = await r.json();
            content = data.choices?.[0]?.message?.content?.trim() || '';
        }

        res.status(200).json({ content });
    } catch (err) {
        console.error('[api/chat] error:', err.message);
        res.status(500).json({ error: err.message });
    }
}
