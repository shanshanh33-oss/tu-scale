# TU Scale analytics

This project uses Cloudflare Pages Functions plus KV to count privacy-friendly product events.

No image content, file names, email addresses, or user IDs are collected.

## Cloudflare setup

1. Open Cloudflare dashboard.
2. Go to `Storage & Databases` -> `KV`.
3. Create a namespace, for example `tuscale_analytics`.
4. Go to `Workers & Pages` -> `tu-scale` -> `Settings` -> `Bindings`.
5. Add a KV namespace binding:
   - Variable name: `TUSCALE_ANALYTICS`
   - KV namespace: the namespace created above
6. Redeploy the Pages project.

## Endpoints

- `POST /api/track`: used by the website to count events.
- `GET /api/stats`: renders the authenticated operations dashboard.
- `GET /api/stats-data`: returns one privacy-safe daily summary page. The current day is read live; missing historical summaries are finalized from raw event logs on first access.

## Counted events

- `page_view`
- `session_start`
- `image_uploaded`
- `ai_enabled`
- `crop_preset_selected`
- `process_start`
- `process_success`
- `process_error`
- `batch_start`
- `batch_item_success`
- `batch_item_error`
- `batch_normalize`
- `download`
- `download_zip`
- `download_success`
- `exported_image`
- `survey_submit`

Events are split into `upscale`, `converter`, `product_image`, `contact`, and compatible `unknown` historical data. Only fixed categorical analytics dimensions are stored; arbitrary paths, file names, image content, contact details, and raw user identities are not included in the dashboard response.
