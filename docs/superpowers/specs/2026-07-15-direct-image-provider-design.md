# Direct Image Provider Design

## Goal

Make every image task call the provider image endpoint directly, matching the ArtForgeStudio adapter, without a preliminary `/v1/responses` planning request.

## Request Flow

- Build each image prompt locally from the user's content and selected style, layout, palette, preset, aspect ratio, resolution, sequence number, and watermark.
- For tasks without references, send one JSON `POST` per image to `/v1/images/generations`.
- For tasks with references, send one multipart `POST` per image to `/v1/images/edits`.
- Send `model`, `prompt`, `n`, `size`, and `quality`; retain the currently supported output controls.
- Send a stable `Idempotency-Key` composed from the task ID and image sequence number.
- Do not call `/v1/responses` or another text model as part of image generation.

## Error And Billing Behavior

- Preserve the 14-minute image-only HTTP timeout.
- Convert non-2xx provider responses and transport failures into the existing provider error shape.
- Do not automatically retry an image call, avoiding duplicate generation and duplicate provider charges.
- Settle points only for images that returned successfully, retaining the existing partial-success behavior.

## Scope

- Text generation remains unchanged.
- Membership pricing and point charging remain unchanged.
- The relay services and Nginx configuration remain unchanged.
- Reference-image requests continue to use `/v1/images/edits`, as in ArtForgeStudio.

## Verification

- A local delayed provider test must observe `/v1/images/generations`, the configured `size` and `quality`, and `Idempotency-Key`.
- The image worker source must contain no planner call or `/v1/responses` image-task endpoint.
- Backend lint, frontend build, and desktop startup must pass.
