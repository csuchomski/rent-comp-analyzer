// Rental Analyzer backend: RentCast proxy with a hard stop at the free monthly limit,
// response caching, and saved assessments. Called only by the Rental Analyzer page.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const RENTCAST_BASE = "https://api.rentcast.io/v1";
const CACHE_DAYS = 30;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-app-passcode",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// Billing period runs from the reset day of one month to the reset day of the next (UTC).
export function currentPeriod(resetDay: number, now = new Date()) {
  const clamp = (y: number, m: number) =>
    Math.min(resetDay, new Date(Date.UTC(y, m + 1, 0)).getUTCDate());
  let y = now.getUTCFullYear(), m = now.getUTCMonth();
  let start = new Date(Date.UTC(y, m, clamp(y, m)));
  if (start > now) {
    m -= 1;
    if (m < 0) { m = 11; y -= 1; }
    start = new Date(Date.UTC(y, m, clamp(y, m)));
  }
  let ny = y, nm = m + 1;
  if (nm > 11) { nm = 0; ny += 1; }
  const end = new Date(Date.UTC(ny, nm, clamp(ny, nm)));
  return { start, end };
}

async function usage() {
  const { data: s, error: se } = await db.from("settings").select("*").eq("id", 1).single();
  if (se) throw se;
  const { start, end } = currentPeriod(s.billing_reset_day);
  const { data: rows, error } = await db
    .from("api_calls")
    .select("billable_count")
    .gte("called_at", start.toISOString())
    .lt("called_at", end.toISOString());
  if (error) throw error;
  const used = Math.max(0, rows.reduce((t, r) => t + r.billable_count, 0));
  return {
    used,
    limit: s.free_limit,
    remaining: Math.max(0, s.free_limit - used),
    overageCost: Number(s.overage_cost),
    resetDay: s.billing_reset_day,
    periodStart: start.toISOString(),
    periodEnd: end.toISOString(),
    apiKeySet: !!Deno.env.get("RENTCAST_API_KEY"),
  };
}

function cacheKey(p: Record<string, unknown>) {
  return JSON.stringify([
    String(p.address ?? "").trim().toLowerCase().replace(/\s+/g, " "),
    p.propertyType, p.bedrooms, p.bathrooms, p.squareFootage,
    p.compCount, p.maxRadius ?? null, p.daysOld ?? null, p.lookupSubjectAttributes ?? null,
  ]);
}

async function estimate(body: Record<string, unknown>) {
  const p = {
    address: String(body.address ?? "").trim(),
    propertyType: String(body.propertyType ?? ""),
    bedrooms: Number(body.bedrooms),
    bathrooms: Number(body.bathrooms),
    squareFootage: body.squareFootage ? Number(body.squareFootage) : undefined,
    compCount: Math.min(25, Math.max(5, Number(body.compCount ?? 15))),
    maxRadius: body.maxRadius ? Number(body.maxRadius) : undefined,
    daysOld: body.daysOld ? Number(body.daysOld) : undefined,
    lookupSubjectAttributes: body.lookupSubjectAttributes === false ? "false" : undefined,
  };
  if (!p.address) return json({ error: "Enter the full street address, city, state and ZIP." }, 400);
  return await guardedCall("avm/rent/long-term", p, cacheKey(p), body);
}

async function propertyRecord(body: Record<string, unknown>) {
  const p = { address: String(body.address ?? "").trim() };
  if (!p.address) return json({ error: "Enter the full street address, city, state and ZIP." }, 400);
  const key = "property:" + p.address.toLowerCase().replace(/\s+/g, " ");
  return await guardedCall("properties", p, key, body);
}

// Recorded sales near the subject, for after-repair value. Ranges use RentCast's "min:max" form.
async function soldNearby(body: Record<string, unknown>) {
  const address = String(body.address ?? "").trim();
  if (!address) return json({ error: "Enter the full street address, city, state and ZIP." }, 400);
  const radius = Math.min(10, Math.max(0.1, Number(body.radius) || 0.5));
  const days = Math.min(1095, Math.max(30, Math.round(Number(body.days) || 180)));
  // No type filter means "every property type" (used for multifamily, since county records often
  // label duplexes as single-family); allow the full 500 so a busy town still fits in one call.
  const p: Record<string, unknown> = {
    address, radius, saleDateRange: `1:${days}`,
    limit: body.propertyType ? 200 : 500,
    propertyType: body.propertyType ? String(body.propertyType) : undefined,
  };
  const minSf = Number(body.minSqft), maxSf = Number(body.maxSqft);
  if (minSf > 0 && maxSf > minSf) p.squareFootage = `${Math.round(minSf)}:${Math.round(maxSf)}`;
  const key = "sold:" + JSON.stringify([address.toLowerCase().replace(/\s+/g, " "), p.radius, p.saleDateRange, p.propertyType ?? null, p.squareFootage ?? null]);
  return await guardedCall("properties", p, key, body);
}

// Every RentCast request goes through here: cache first, then the free-limit guard, then the call.
async function guardedCall(endpoint: string, p: Record<string, unknown>, key: string, body: Record<string, unknown>) {
  if (!body.forceRefresh) {
    const { data: hit } = await db.from("rent_cache").select("*").eq("cache_key", key).maybeSingle();
    if (hit && Date.now() - new Date(hit.fetched_at).getTime() < CACHE_DAYS * 864e5) {
      return json({ fromCache: true, fetchedAt: hit.fetched_at, result: hit.response, usage: await usage() });
    }
  }

  const apiKey = Deno.env.get("RENTCAST_API_KEY");
  if (!apiKey) return json({ error: "The RentCast API key hasn't been added yet. Add RENTCAST_API_KEY in the Supabase project's Edge Function secrets." }, 503);

  // The guard: no call at or past the free limit unless the person confirmed this specific call.
  const u = await usage();
  if (u.used >= u.limit && body.confirmOverage !== true) {
    return json({
      overage: true,
      message: `You've used all ${u.limit} free RentCast calls this billing period. This call would cost $${u.overageCost.toFixed(2)}.`,
      usage: u,
    }, 402);
  }

  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) if (v !== undefined && v !== "" && !Number.isNaN(v)) qs.set(k, String(v));
  const res = await fetch(`${RENTCAST_BASE}/${endpoint}?${qs}`, { headers: { "X-Api-Key": apiKey, Accept: "application/json" } });
  const text = await res.text();
  let parsed: unknown = null;
  try { parsed = JSON.parse(text); } catch { /* non-JSON error */ }

  // RentCast bills only successful (200) responses.
  await db.from("api_calls").insert({
    endpoint,
    params: p,
    http_status: res.status,
    billable_count: res.ok ? 1 : 0,
    overage_confirmed: u.used >= u.limit,
  });

  if (!res.ok) {
    const msg = (parsed as { message?: string })?.message ?? text.slice(0, 300);
    return json({ error: `RentCast returned ${res.status}: ${msg}`, usage: await usage() }, 502);
  }
  await db.from("rent_cache").upsert({ cache_key: key, params: p, response: parsed, fetched_at: new Date().toISOString() });
  return json({ fromCache: false, fetchedAt: new Date().toISOString(), result: parsed, usage: await usage() });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  const passcode = Deno.env.get("APP_PASSCODE");
  if (!passcode) return json({ error: "The app passcode hasn't been set yet. Add APP_PASSCODE in the Supabase project's Edge Function secrets." }, 503);
  if (!safeEqual(req.headers.get("x-app-passcode") ?? "", passcode)) {
    return json({ error: "Wrong passcode." }, 401);
  }

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return json({ error: "Bad request body." }, 400); }

  try {
    switch (body.action) {
      case "status":
        return json({ usage: await usage() });

      case "estimate":
        return await estimate(body);

      case "property":
        return await propertyRecord(body);

      case "sold":
        return await soldNearby(body);

      case "sync_usage": {
        // Set this period's used count to match the RentCast dashboard.
        const target = Math.max(0, Math.floor(Number(body.used)));
        if (!Number.isFinite(target)) return json({ error: "Enter a whole number." }, 400);
        const u = await usage();
        const diff = target - u.used;
        if (diff !== 0) await db.from("api_calls").insert({ kind: "adjustment", billable_count: diff, endpoint: "manual sync" });
        return json({ usage: await usage() });
      }

      case "set_reset_day": {
        const day = Math.floor(Number(body.day));
        if (!(day >= 1 && day <= 31)) return json({ error: "Pick a day from 1 to 31." }, 400);
        await db.from("settings").update({ billing_reset_day: day, updated_at: new Date().toISOString() }).eq("id", 1);
        return json({ usage: await usage() });
      }

      case "calls": {
        const u = await usage();
        const { data, error } = await db.from("api_calls")
          .select("called_at, kind, endpoint, params, http_status, billable_count, overage_confirmed")
          .gte("called_at", u.periodStart).order("called_at", { ascending: false }).limit(200);
        if (error) throw error;
        return json({ calls: data, usage: u });
      }

      case "list_assessments": {
        const { data, error } = await db.from("assessments")
          .select("id, address, created_at, updated_at, data->summary").order("updated_at", { ascending: false }).limit(500);
        if (error) throw error;
        return json({ assessments: data });
      }

      case "get_assessment": {
        const { data, error } = await db.from("assessments").select("*").eq("id", String(body.id)).single();
        if (error) return json({ error: "That assessment wasn't found." }, 404);
        return json({ assessment: data });
      }

      case "save_assessment": {
        const row = { address: String(body.address ?? "").trim(), data: body.data ?? {}, updated_at: new Date().toISOString() };
        if (!row.address) return json({ error: "An assessment needs an address." }, 400);
        const q = body.id
          ? db.from("assessments").update(row).eq("id", String(body.id)).select("id").single()
          : db.from("assessments").insert(row).select("id").single();
        const { data, error } = await q;
        if (error) throw error;
        return json({ id: data.id });
      }

      case "delete_assessment": {
        const { error } = await db.from("assessments").delete().eq("id", String(body.id));
        if (error) throw error;
        return json({ ok: true });
      }

      default:
        return json({ error: "Unknown action." }, 400);
    }
  } catch (e) {
    return json({ error: `Server error: ${(e as Error).message ?? e}` }, 500);
  }
});
