# Rent Comp Analyzer

Pulls comparable rentals from RentCast for a property, lets you pick which comps count, estimates rent per unit and in total, and produces a shareable report with property details, property taxes and the 1% rule.

## How it fits together

- `index.html` — the whole app. Hosted on GitHub Pages. Contains no secrets.
- `supabase/functions/rentcast/index.ts` — Supabase Edge Function (project "Rental Analyzer") that holds the RentCast API key, caches responses for 30 days, saves assessments, and refuses any RentCast call past the 50 free monthly requests unless that call is confirmed in the app.

## Secrets (Supabase → Edge Functions → Secrets)

- `RENTCAST_API_KEY` — from the RentCast API dashboard
- `APP_PASSCODE` — the passcode the app asks for

## RentCast calls

- Rent estimate: 1 call per unit type (comps + RentCast's estimate)
- County records (taxes, year built, assessed value, last sale): 1 call
- Sold homes for after-repair value (recorded sales within a radius, time window and size range): 1 call
- Re-running the same inputs within 30 days uses the saved result and costs nothing
