# API contract

`openapi.json` is generated from the Zod schemas in `packages/shared/src/index.ts`
(the single source of truth) via the route definitions in `apps/api`:

```bash
npm run contract:export
```

Regenerate and commit it whenever a schema or route changes, so contract changes
show up in code review. The running API also serves it at `/api/openapi.json`.
