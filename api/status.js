/** Vercel serverless function — init status for the VELLOX AI proxy. */
export default function handler(req, res) {
    const provider = (process.env.AI_PROVIDER || 'gemini').toLowerCase();
    const model = process.env.AI_MODEL || (provider === 'gemini' ? 'gemini-2.0-flash' : 'gpt-4o-mini');

    if (process.env.AI_API_KEY) {
        res.status(200).json({
            state: 'ready',
            progress: 100,
            message: `Cloud AI ready (${provider}/${model})`,
            modelAlias: model
        });
    } else {
        res.status(200).json({
            state: 'error',
            message: 'No API key configured (set AI_API_KEY in Vercel env vars)',
            modelAlias: model
        });
    }
}
