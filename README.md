# Solar Production Estimator

Vue 3 + Node/Express app that estimates hourly, monthly and annual PV production for any location. It runs its own physical model on typical-meteorological-year (TMY) weather data, then cross-checks the result against **NREL PVWatts v8** and **EU JRC PVGIS 5.3**.

## Quick start

```bash
npm install
cp .env.example .env      # add a free NREL key (see below)
npm run dev               # API on :3080, Vite UI on http://localhost:5173
```

Production: `npm run build && npm start`, then open http://localhost:3080. Express serves `client/dist`.

| Script | Purpose |
| --- | --- |
| `npm run dev` | API (watch mode) and Vite dev server |
| `npm run build` | Build the Vue client |
| `npm start` | Serve API and built client |
| `npm test` | Engine unit tests (`node:test`) |
| `npm run validate [roof\|1-axis]` | Compare the engine with PVWatts and PVGIS for six climates |

### NREL API key

PVWatts and NSRDB weather come from `developer.nlr.gov` (NREL's API moved there from `developer.nrel.gov`). Without a key the app uses `DEMO_KEY`, which allows about 30 requests per hour and 50 per day per IP. Get a free key at https://developer.nlr.gov/signup/ and set `NREL_API_KEY` in `.env`. If NREL is unavailable, the app falls back to PVGIS weather and shows a warning.

### Reading power bills (optional)

The **Size from your power bill** section can read an uploaded bill (PDF or photo) with Claude. It pulls out the kWh, charges and 12-month usage history. Set `ANTHROPIC_API_KEY` in `.env` to turn this on. Without it, type the monthly kWh, an average month or a monthly bill amount instead. Sizing does not use Claude.

## How the estimate is made

For each of the 8,760 hours:

| Step | Model | Notes |
| --- | --- | --- |
| Weather | **NSRDB PSM v3 TMY** (4 km satellite, Americas), via the PVWatts hourly output; otherwise **PVGIS TMY** (SARAH3 / ERA5, global) | `auto` prefers NSRDB. |
| Long-term correction | PVGIS TMY irradiance scaled month by month to the PVGIS 2005–2023 mean GHI (MRcalc) | TMY years can sit several percent off the mean (Berlin: +6.4%). This gives a true P50. |
| Sun position | NOAA / Meeus algorithm, with refraction | Checked against the NREL SPA reference case to within 0.05°. For sunrise and sunset hours, the sun is placed at the midpoint of the sunlit part of the hour (as SAM does). |
| Transposition | **Perez 1990** (all-sites composite coefficients) | Ground reflection uses the user's albedo. |
| Terrain | PVGIS DEM horizon profile | Blocks beam and circumsolar light when the sun is below the skyline. |
| Reflection | Fresnel + glass absorption IAM (De Soto 2006) | n = 1.526 for plain glass, 1.3 for AR-coated. Diffuse light uses Brandemuehl–Beckman effective angles. |
| Cell temperature | SAPM open rack (King 2004) for open racks and trackers; PVsyst Uc = 20 W/m²K for roof mounts | The roof value reproduces PVWatts' installed NOCT of about 49 °C. |
| DC | PVWatts linear model, γ = −0.37 / −0.35 / −0.32 %/°C | Includes a low-irradiance efficiency loss (−2.4% at 200 W/m² for standard modules). |
| Tracking | Horizontal N–S single axis, optional backtracking (GCR) | Lorenzo 2011 / pvlib method. |
| Losses | PVWatts loss breakdown (14.08% default), combined multiplicatively | Editable in the UI. |
| Inverter | PVWatts part-load efficiency curve, clipping at AC rating (set by DC/AC ratio) | |

The API also returns a loss waterfall, the average daily profile by month, tilt and azimuth sweeps with optima, 25-year economics (degradation, escalation, NPV, LCOE, payback, CO₂) and the full hourly series, which the UI offers as a CSV download.

## Site, shadows & sunlight

The results page includes an interactive satellite map (Esri World Imagery) of the site.

- **Buildings and trees** come from OpenStreetMap via the Overpass API. Missing heights are estimated from `building:levels` or the building type and shown with dashed outlines. Every height is editable. Trees can be added by clicking, since OSM rarely maps them.
- **Your roof** is picked automatically: the building under the site marker. You can also select another building or draw an outline on the imagery.
- **Live shadows** follow date and time sliders, with a play button that animates the day. Ground shadows are drawn as one union and cut out of rooftops. Your roof shows shadows measured at panel height. The sun path shows the selected day and both solstices.
- **Sunlight strength** comes from the typical-weather year for the selected hour: plane-of-array, GHI and DNI irradiance, AC output, and the percentage of the roof in shadow at that moment.
- **Annual shading analysis** (`POST /api/shading`) samples up to 500 points on the roof. It tests beam blocking against each obstacle's prism for every month × hour bin, weighted by the site's own beam irradiance on the panel plane, and adds sky-view (diffuse) loss. Trees are treated as 75% opaque. The analysis returns:
  - solar access per point, drawn as the roof heatmap;
  - the annual shading loss, which can be applied as the near-shading loss with one click;
  - a month × hour matrix showing when the roof is shaded.

Esri World Imagery may be used free of charge for development and non-commercial use with attribution. A commercial deployment needs an ArcGIS account or another imagery provider.

## Validation

`npm run validate` results, 5 kWp systems:

| Site | Engine vs PVWatts v8 (same NSRDB weather) | Engine vs PVGIS 5.3 |
| --- | --- | --- |
| Los Angeles, 1-axis backtracking | +0.6% | (PVGIS has no backtracking) |
| Phoenix, 1-axis backtracking | +0.7% | |
| Seattle, 1-axis backtracking | +3.6% | |
| Boston, 1-axis backtracking | +3.4% | |
| Berlin / Madrid / LA / Seattle / Sydney / Nairobi, roof 30° | | −0.7% to +2.1% |
| Same six sites, open rack 30° | | +1.7% to +4.9% |

Published comparisons of PV models typically differ from one another by 3–8% for the same site. Year-to-year weather variation is about ±5%. Use the mean of the models in the cross-check panel as a planning figure.

## API

`POST /api/estimate`

```json
{
  "lat": 34.05, "lon": -118.25,
  "weatherSource": "auto | nsrdb | pvgis",
  "useHorizon": true, "longTermCorrection": true, "compare": true,
  "system": {
    "capacityKw": 6, "arrayType": "fixed-roof | fixed-open | 1-axis | 1-axis-backtrack",
    "moduleType": "standard | premium | thinfilm",
    "tilt": 20, "azimuth": 180, "dcAcRatio": 1.2, "inverterEfficiency": 96,
    "albedo": 0.2, "gcr": 0.4, "maxAngle": 60, "lowLight": true,
    "losses": { "soiling": 2, "shading": 3, "...": "..." },
    "panel": {
      "name": "TOPCon 440 W", "count": 14, "powerW": 440,
      "lengthMm": 1722, "widthMm": 1134, "gammaPct": -0.30
    }
  },
  "financial": { "systemCost": 16500, "incentivePct": 30, "electricityRate": 0.17, "...": "..." }
}
```

When `system.panel` includes both a `count` and a `powerW`, it sets the DC rating (`count × powerW`) and replaces `capacityKw`. It also supplies:

- the temperature coefficient;
- the module efficiency (rated power ÷ module area), which feeds the roof-mount thermal model;
- `annual.kwhPerPanel` and `annual.kwhPerM2` in the response.

`sunHours` (optional, 0.5–12) overrides the site's peak sun hours: its average daily horizontal irradiation in kWh/m²/day. All hourly irradiance is scaled by `sunHours / site value`. This keeps the daily and seasonal shape, and temperature and clipping effects are still simulated. The response's `sunHours` object reports the site value, the value used and the equivalent on the panel plane.

Other endpoints:

- `GET /api/sun-hours?lat=..&lon=..&weatherSource=auto&longTermCorrection=true`: the site's peak sun hours (annual and monthly). The UI uses it as the default.

- `POST /api/size`: recommends a system size from electricity use. The body takes the same location, weather and `system` fields as `/api/estimate`, plus:
  - `monthlyKwh`: 12 values, January first; `null` marks an unknown month;
  - `offsetPct`: the share of annual use to cover (default 100).

  The server simulates 1 kWp with the given orientation, panel and losses, then works out `kWp = annual use × offset ÷ specific yield`. It rounds up to whole panels of `system.panel.powerW` and returns the panel count, kWp, and monthly usage against production. Unknown months take the mean of the known ones.

- `POST /api/bill/read` with `{ "mediaType": "application/pdf" | "image/jpeg" | ..., "data": "<base64>" }`: reads an electricity bill with Claude. It returns the billing period, kWh, amount, effective rate and `monthlyKwh` from the bill's usage history. It needs `ANTHROPIC_API_KEY` in `.env` and returns 503 without it. Files are limited to 10 MB.

- `GET /api/geocode?q=...` (OpenStreetMap Nominatim)
- `GET /api/defaults`
- `GET /api/health`

## Layout

```
index.js                 Express entry (API + static client)
server/engine/           solarPosition, irradiance (Perez/IAM/horizon), pvModels, simulate, financial
server/services/         pvgis, pvwatts, geocode, estimate (orchestration), cache, http
client/src/              Vue app (App.vue + components/, Chart.js, Leaflet)
scripts/validate.js      cross-model validation
test/engine.test.js      unit tests
```
