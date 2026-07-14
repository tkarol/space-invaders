/** Vercel serverless function — health check for the VELLOX AI proxy. */
export default function handler(req, res) {
    res.status(200).json({ status: 'ok', initialized: Boolean(process.env.AI_API_KEY) });
}
