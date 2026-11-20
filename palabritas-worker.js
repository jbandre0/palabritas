// ═══════════════════════════════════════════════════════════
// Palabritas — Cloudflare Worker
// ═══════════════════════════════════════════════════════════
//
// Handles 4 things:
//   1. X-Action: kv-get    — read a single KV key
//   2. X-Action: kv-set    — write a single KV key
//   3. X-Action: kv-getall — fetch all keys for a PIN prefix
//   4. (no action)         — Anthropic API proxy (forwards X-Api-Key)
//
// DEPLOY STEPS:
//   1. Log in to dash.cloudflare.com → Workers & Pages → Create Worker
//   2. Name it: palabritas-worker
//   3. Paste this file, click Deploy
//   4. Go to Settings → Variables & Secrets → KV Namespace Bindings
//   5. Add binding: Variable name = KV, Namespace = palabritas-kv
//      (Create the "palabritas-kv" namespace first under Workers → KV)
//   6. Your worker URL will be:
//      https://palabritas-worker.<your-subdomain>.workers.dev
//   7. Update WORKER_URL in palabritas.html to match
// ═══════════════════════════════════════════════════════════

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

export default {
  async fetch(request, env) {

    // ── CORS preflight ──────────────────────────────────────
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "POST only" }), {
        status: 405, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const action = request.headers.get("X-Action");

    // ── KV: read single key ─────────────────────────────────
    if (action === "kv-get") {
      try {
        const { key } = await request.json();
        if (!key) return err(400, "missing key");
        const val = await env.KV.get(key);
        return json(val !== null ? val : "null");
      } catch (e) {
        return err(500, e.message);
      }
    }

    // ── KV: write single key ────────────────────────────────
    if (action === "kv-set") {
      try {
        const { key, value } = await request.json();
        if (!key) return err(400, "missing key");
        await env.KV.put(key, value);
        return json(JSON.stringify({ ok: true }));
      } catch (e) {
        return err(500, e.message);
      }
    }

    // ── KV: fetch all keys for a PIN prefix ─────────────────
    if (action === "kv-getall") {
      try {
        const pin = request.headers.get("X-Pin");
        if (!pin) return err(400, "missing X-Pin header");
        const prefix = pin + "-pal-";
        const list = await env.KV.list({ prefix });
        const result = {};
        for (const { name } of list.keys) {
          const val = await env.KV.get(name);
          if (val !== null) {
            try { result[name] = JSON.parse(val); } catch { result[name] = val; }
          }
        }
        return json(JSON.stringify(result));
      } catch (e) {
        return err(500, e.message);
      }
    }

    // ── Anthropic API proxy ─────────────────────────────────
    const apiKey = request.headers.get("X-Api-Key");
    if (!apiKey) {
      return err(401, "Missing X-Api-Key header. Add your Anthropic key in Palabritas settings.");
    }

    try {
      const body = await request.text();
      const upstream = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type":      "application/json",
          "x-api-key":         apiKey,
          "anthropic-version": "2023-06-01",
        },
        body,
      });
      const data = await upstream.text();
      return new Response(data, {
        status: upstream.status,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    } catch (e) {
      return err(502, "Upstream error: " + e.message);
    }
  },
};

// ── helpers ─────────────────────────────────────────────────
function json(text) {
  return new Response(text, {
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}
function err(status, message) {
  return new Response(
    JSON.stringify({ error: { type: "worker_error", message } }),
    { status, headers: { ...CORS, "Content-Type": "application/json" } }
  );
}
