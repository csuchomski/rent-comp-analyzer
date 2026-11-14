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
- Sold homes for after-repair value (recorded sales within a radius, time window, size range, and optional lot size and year built): 1 call

## Reports

Pick the report type next to Print / Download:
- Purchase: property details, comparable sales with an estimated value, and financing / monthly cost
- Buy & hold rental: property details, rental comps and suggested rent, 1% rule, financing and cash flow
- Flip: property details, purchase price, rehab, ARV from sold comps, spread and the 70% rule

## Year built

Optional in both searches. Sold-home searches send the range to RentCast. Rent comps are filtered in the app
(RentCast's rent search has no year filter); rental listings with no year on record stay in and are marked.
- Re-running the same inputs within 30 days uses the saved result and costs nothing
