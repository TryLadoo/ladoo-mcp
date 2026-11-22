# Contributing

Bug reports and pull requests are welcome. For anything larger than a fix, open an issue first so we can agree on the shape.

## Setup

```sh
npm install
npm test            # offline, against a mocked API
npm run lint        # Biome
npm run typecheck
```

Run the server from source with `LADOO_API_KEY=lsk_... npm run dev`, or point a client at `node dist/index.js` after `npm run build`.

`test/live.test.ts` runs read-only calls against the real API when `LADOO_API_KEY` is set. CI never sets it.

## Updating the API

The client is typed from the OpenAPI snapshot in `openapi/`. When the API changes, replace the snapshot with the current `https://api.tryladoo.com/openapi.json`, then run `npm run generate`. CI fails if `src/generated` doesn't match the snapshot.

## Adding a tool

Tools are for a model, not a programmer. Before adding one:

- Prefer extending an existing tool over adding another. Each tool costs context in every conversation.
- Return short rows with ids from lists, and full detail only from `get_*` tools. Drop fields a model won't use.
- Write the description for someone who has never seen the API: what it returns and when to use it.
- Tools that change data go behind `allowWrites` with accurate `destructiveHint` and `idempotentHint` annotations.
- Add a test in `test/server.test.ts` with fixtures typed against the OpenAPI schemas in `test/fixtures.ts`.

Use demo data in tests and docs: 555 phone numbers and `example.com` addresses.
