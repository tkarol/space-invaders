# Deploying VELLOX (free, public, AI online)

The game is ready to deploy to **Vercel** for free. Vercel serves the static
game and runs the AI proxy in `/api` as serverless functions — so the AI call
happens **on Vercel's servers**, not the visitor's network (this also means it
works even if your office firewall blocks the AI provider).

Your API key goes in **Vercel's environment variables**, never in the repo.
(`ai-config.json` is git-ignored, so your local key is never pushed.)

---

## What you need
- A free **Vercel** account (sign up at https://vercel.com — you can use a GitHub login).
- Your AI key (the Gemini key you already have, or a Groq/OpenAI key).

---

## Option A — GitHub → Vercel (no local tooling; best for locked-down laptops)

1. **Put the code on your own GitHub** (the existing `origin` is someone else's repo):
   - Create a new empty repo at https://github.com/new (e.g. `vellox-game`).
   - In this folder:
     ```
     git add -A
     git commit -m "VELLOX cyber defense simulator"
     git remote add mine https://github.com/<your-username>/vellox-game.git
     git push -u mine main
     ```
     (Your key is NOT pushed — `ai-config.json` is git-ignored.)
2. In Vercel: **Add New… → Project → Import** your `vellox-game` repo.
3. Framework preset: **Other**. Leave build & output settings at their defaults
   (there's no build step — it's static files + functions).
4. Open **Settings → Environment Variables** and add:
   | Name | Value |
   |------|-------|
   | `AI_API_KEY` | your key |
   | `AI_PROVIDER` | `gemini` *(optional; default)* |
   | `AI_MODEL` | *(optional override)* |
   | `AI_BASE_URL` | *(only for Groq/OpenAI-compatible)* |
5. **Deploy**. You'll get a public URL like `https://vellox-game.vercel.app`.
6. If you added the env var *after* the first deploy, hit **Redeploy** so the
   functions pick it up. Open the URL → **AI: ONLINE**.

## Option B — Vercel CLI (from a machine that allows it)

```
npx vercel                       # log in via browser, follow prompts
npx vercel env add AI_API_KEY    # choose "Production", paste your key
npx vercel --prod                # deploy to the public URL
```

---

## Verify it's live
- Open the deployed URL. HUD should show **AI: ONLINE**.
- Play a bit — the VELLOX COMMAND messages should be dynamic (not the same
  scripted lines every game).
- If it shows ONLINE but responses look canned, the key/provider is off — check
  **Vercel → your project → Logs** for `[api/chat] error: ...`.

## Notes
- **Gemini free tier** has rate limits — plenty for a demo, but heavy traffic
  may occasionally fall back to the built-in scripted lines. That's graceful, not broken.
- **Rotate the key** if it was ever exposed; update it in Vercel env vars and redeploy.
- Running locally still works unchanged:
  - `npm run cloud` — live AI via `ai-config.json` (no install needed)
  - `npm run standalone` — no AI, scripted lines
  - `npm start` — local Foundry model (needs the optional SDK installed)
