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
- Comparable sales (recorded sales near the property): 1 call. Each search criterion can be turned on or off: distance, sale date, size, property type, bedrooms, bathrooms, year built and lot size. Distance, sale date, size and type are on by default.

## Estimated value

Sales comparison approach, the way an appraiser's grid works. Each ticked sale is adjusted toward the subject for market change since it sold, living area (at a marginal $/sq ft measured from the sales in the search, not the full price per sq ft), bedrooms, bathrooms, age and lot size. The adjusted prices are weighted toward the closest sales needing the smallest gross adjustment; a sale whose adjusted price is far from the rest is flagged and counts less. Every rate can be changed under Adjustment rates. Market trend starts at 0: enter your local trend.

## Reports

Pick the report type next to Print / Download:
- Purchase: property details, comparable sales with an estimated value, and financing / monthly cost
- Buy & hold rental: property details, rental comps and suggested rent, 1% rule, financing and cash flow
- Flip: property details, a flip analysis (after-repair value from comparable sales, rehab, selling and holding costs, net profit and return) and the 70% rule

## Year built

Optional in both searches. Sold-home searches send the range to RentCast. Rent comps are filtered in the app
(RentCast's rent search has no year filter); rental listings with no year on record stay in and are marked.
- Re-running the same inputs within 30 days uses the saved result and costs nothing
