# Argile Map - Claude Information

Interactive 3D viewer for French buildings reconstructed from LIDAR + BD TOPO.
Vite + React 19 + MapLibre GL + deck.gl + TanStack DB. See `README.md` for the
data-flow overview.

## Working Documents

All documents produced during research, planning, or specification work
(plans, specs, explorations, design docs) must be placed in the
`.claude-work/` directory at the project root.

## Build & Test Commands

- **Lint**: `npm run lint` (biome check)
- **Format**: `npm run format` (biome format --write)
- **Test**: `npm run test` (vitest run)
- **Dev server**: `npm run dev`
- **Build**: DO NOT TEST FOR BUILD UNLESS ASKED

## Codebase Structure

Flat `src/` layout — no feature folders. Notable areas:

- `src/App.tsx`, `src/main.tsx`: app entry
- `src/api.ts`, `src/argile-api/`: Argile API client
- `src/collections.ts`: TanStack DB per-tile collections
- `src/BuildingLayer.ts`, `src/DetectionLayer.ts`, `src/TreeLayer.ts`: deck.gl layers
- `src/useViewport*.ts`: viewport-driven data hooks
- `src/workers/`: web workers
- `perf/`: performance probes

## Code Preferences

### TypeScript & React
- TypeScript for type safety; no `any` type
- Functional React components and hooks (no class components)
- Use `type` instead of `interface`
- Use `Readonly` for typing props
- Do not annotate JSX return type (no `: JSX.Element`)
- Do not `import React from 'react'`; import types directly (e.g. `MouseEvent` not `React.MouseEvent`)
- Place types in a separate `types.ts` file; keep only Zod schemas in `schemas.ts`
- Use `zod` for schema validation
- Use enums
- Export default React components and helper functions

### Style
- Prefer `??` over `||` (nullish coalescing). **Always** use `??`
- Use `const` only — no `let`. Prefer functional ops (`map`, `filter`, `reduce`)
- No `for (const ... of ...)` loops — use array methods instead
- Early return in functions
- Use defined functions instead of arrow functions (top-level)
- Use `useCallback` with arrow functions for handlers in components
- Use `useMemo` for computed constants in components
- Do not declare async callbacks (use `.then()` or `onSuccess` from mutations instead)
- Do not use try/catch in callbacks
- Small functions, small files

### Files & Organization
- 1 `.tsx` file = 1 component — never define multiple components in the same file
- Default: 1 helper function = 1 file with `export default`
- Move utility/helper functions to a `helpers/` directory when reusable
- Move constants to `constants.ts`
- Do not use barrel files
- Do not use multi-level relative imports (max 2 levels)
- Do not export if not necessary (knip detects unused exports)
- Do not add JSX section comments like `{/* Section Name */}`

### Data
- Prefer `useQuery` / `useMutation` from `@tanstack/react-query`
- Use `useMutation` for async side effects (API calls, downloads)
- React Query caches data — do not hand-optimize fetching; call the hooks again rather than prop-drilling
- Avoid prop drilling — components get data directly from hooks

### Language
- UI texts are in French; comments and variables are in English

## SUPER CRITICAL

You are NOT allowed to use `useEffect`. If you have no other option, you MUST ask for approval.
