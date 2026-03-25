# Web app (`apps/web`)

this is the React frontend for Syllentra.

## what this app includes

- login and role-aware routes
- dashboard/courses/modules/content screens
- review result and AI coaching/guidance screens
- admin user management and enrollment actions

## run from repo root (recommended)

use the root setup in `README.md`, then run:

```bash
npm run dev
```

the root dev script starts API first, then this web app.

## run web only

from repo root:

```bash
npm run dev --workspace web
```

or from this folder:

```bash
npm run dev
```

## scripts

- `npm run dev`: start Vite dev server
- `npm run build`: type-check and build
- `npm run preview`: preview production build
- `npm run test`: run Vitest tests

## env

this app currently uses:

- `VITE_APP_NAME=Syllentra`

if API is running locally, frontend expects it at `/api` via Vite proxy config.
