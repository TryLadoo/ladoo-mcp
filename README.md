<p>
  <a href="https://tryladoo.com">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset=".github/assets/ladoo-wordmark-on-dark.svg">
      <img src=".github/assets/ladoo-wordmark.svg" alt="Ladoo" height="40">
    </picture>
  </a>
</p>

# ladoo-mcp

[![CI](https://github.com/TryLadoo/ladoo-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/TryLadoo/ladoo-mcp/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

The official [Model Context Protocol](https://modelcontextprotocol.io) server for [Ladoo](https://tryladoo.com), the AI receptionist that answers your business's phone and website chat.

Connect it to Claude, Cursor, VS Code or any MCP client and ask about your workspace in plain words: which calls need a callback, what got booked this week, which agent answers your main number, what your knowledge base says about pricing.

It is read-only unless you turn on write tools.

## Install

Requires Node.js 22 or later. Your MCP client runs the server with:

```sh
npx -y github:TryLadoo/ladoo-mcp
```

Not on npm yet. Registry releases are on the [roadmap](ROADMAP.md). The first run takes a few seconds while npm builds it.

### Get an API key

In Ladoo, go to **Settings → Developers**, click **Create key** and pick the **Read only** preset. That covers every default tool. Owners and admins can create keys.

A key belongs to one workspace. Agencies make one key per client workspace and add the server once per client.

### Claude Code

```sh
claude mcp add ladoo -e LADOO_API_KEY=lsk_your_key -- npx -y github:TryLadoo/ladoo-mcp
```

### Claude Desktop

Open **Settings → Developer → Edit Config** and add:

```json
{
  "mcpServers": {
    "ladoo": {
      "command": "npx",
      "args": ["-y", "github:TryLadoo/ladoo-mcp"],
      "env": { "LADOO_API_KEY": "lsk_your_key" }
    }
  }
}
```

Restart Claude Desktop.

### Cursor

[Add to Cursor](cursor://anysphere.cursor-deeplink/mcp/install?name=ladoo&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsImdpdGh1YjpUcnlMYWRvby9sYWRvby1tY3AiXSwiZW52Ijp7IkxBRE9PX0FQSV9LRVkiOiJsc2tfeW91cl9rZXkifX0=), then replace `lsk_your_key` with your key. Or put the Claude Desktop snippet above in `~/.cursor/mcp.json`.

### VS Code

```sh
code --add-mcp '{"name":"ladoo","command":"npx","args":["-y","github:TryLadoo/ladoo-mcp"],"env":{"LADOO_API_KEY":"lsk_your_key"}}'
```

To be asked for the key instead of storing it, add this to `.vscode/mcp.json`:

```json
{
  "inputs": [{ "type": "promptString", "id": "ladoo-key", "description": "Ladoo API key", "password": true }],
  "servers": {
    "ladoo": {
      "command": "npx",
      "args": ["-y", "github:TryLadoo/ladoo-mcp"],
      "env": { "LADOO_API_KEY": "${input:ladoo-key}" }
    }
  }
}
```

### ChatGPT and other remote clients

Clients that only connect to a URL need the server hosted over HTTP. See [Hosting over HTTP](#hosting-over-http).

## Examples

> **You:** What calls came in today that need a callback?
>
> **Claude** calls `list_calls` with `from: 2026-11-20`, `urgent: true`, then `outcome: message_taken` and `needs_callback: true`:
>
> Three people are waiting. Jordan Rivera (+1 555-555-0100) has a leaking water heater and was marked urgent at 9:00. A caller from +1 555-555-0142 hung up while picking a drain cleaning time. ...

> **You:** Summarize this week's missed bookings.
>
> **Claude** runs the `missed_bookings_review` prompt: `list_calls` with `unfinished: booking` and `calendar_error: true`, `get_call_analytics`, then `get_call` on a few transcripts.

> **You:** Which agent answers my main number, and what changed in its last version?
>
> **Claude** calls `list_phone_numbers`, then `compare_agent_versions`: "Front desk" answers +1 555-555-0001. Version 3 changed the greeting step's opening hours from 8am to 7am.

> **You:** Add this to the knowledge base: we don't service tankless water heaters older than 2010.
>
> **Claude** checks with `search_knowledge_base`, asks you to confirm, then calls `add_knowledge_answer`. This needs [write tools](#write-tools).

## Tools

| Tool                      | What it does                                                                                        |
| ------------------------- | --------------------------------------------------------------------------------------------------- |
| `get_workspace`           | The workspace, the key's scopes, and the current time                                               |
| `list_calls`              | List and filter calls and chats: date range, outcome, agent, urgent, needs callback, caller, reason |
| `get_call`                | One call with its summary, review, follow-up owner and timestamped transcript                       |
| `get_call_analytics`      | Totals for a date range, with the period before for comparison                                      |
| `search_people`           | Find callers by name, phone or email                                                                |
| `get_person`              | A person's details, notes, recent conversations and likely duplicates                               |
| `list_agents`             | Agents with their greeting and languages                                                            |
| `get_agent`               | An agent's numbers, live version, booking setup, tools and success criteria                         |
| `list_agent_versions`     | Published versions with changelogs                                                                  |
| `compare_agent_versions`  | What changed between two versions, the live one and its predecessor by default                      |
| `list_knowledge_bases`    | Knowledge bases and the agents that use them                                                        |
| `get_knowledge_base`      | A knowledge base's sources and their status                                                         |
| `search_knowledge_base`   | The passages an agent would answer from                                                             |
| `list_bookings`           | Appointments agents booked, the next 7 days by default                                              |
| `list_phone_numbers`      | Numbers and the agent that answers each                                                             |
| `get_attention_items`     | What's broken right now, such as a disconnected calendar                                            |
| `list_webhook_endpoints`  | Webhook endpoints and whether they're failing                                                       |
| `list_webhook_deliveries` | Recent deliveries to an endpoint, with response codes                                               |

Lists return short rows with ids, and `get_*` tools return one item in full. Paginated lists return `next_cursor`, which the model passes back as `cursor`.

Dates can be bare (`2026-11-20`, read as midnight in `LADOO_TIME_ZONE`) or ISO 8601 with an offset.

### Write tools

Write tools are registered only when you start the server with `--allow-writes` or `LADOO_ALLOW_WRITES=1`, and are annotated so clients can ask before running them.

| Tool                   | What it does                                              | Scope             | Annotation     |
| ---------------------- | --------------------------------------------------------- | ----------------- | -------------- |
| `update_person`        | Edit a name, phone, email or notes, or append a note      | `people:write`    | destructive    |
| `add_knowledge_source` | Add text, Q&A pairs, a web page or a website              | `knowledge:write` | not idempotent |
| `add_knowledge_answer` | Add or replace one question and answer                    | `knowledge:write` | idempotent     |
| `cancel_booking`       | Cancel an appointment in every calendar Ladoo wrote it to | `bookings:write`  | destructive    |
| `redeliver_webhook`    | Send a webhook delivery again                             | `webhooks:write`  | not idempotent |

The key needs these scopes too. Give it only the ones you want the model to have.

### Resources and prompts

- `ladoo://calls/{id}` is a call as Markdown, transcript included. Clients that support resources list the 20 most recent calls.
- `daily_call_digest`: one day's calls, bookings and callbacks.
- `find_callbacks`: everyone waiting to hear back, most urgent first.
- `missed_bookings_review`: calls that should have become appointments, and why they didn't.

## Configuration

| Variable               | Flag                         | Default                    |
| ---------------------- | ---------------------------- | -------------------------- |
| `LADOO_API_KEY`        |                              | Required                   |
| `LADOO_ALLOW_WRITES=1` | `--allow-writes`             | Read-only                  |
| `LADOO_TIME_ZONE`      |                              | The system time zone       |
| `LADOO_BASE_URL`       |                              | `https://api.tryladoo.com` |
|                        | `--http`, `--port`, `--host` | stdio                      |

Requests are pinned to API version `2026-11-16`. Rate limits and server errors are retried with backoff, and POSTs carry an `Idempotency-Key` so a retry never adds a source twice.

## Hosting over HTTP

```sh
LADOO_API_KEY=lsk_your_key npx -y github:TryLadoo/ladoo-mcp --http --port 3000
```

This serves Streamable HTTP at `http://127.0.0.1:3000/mcp`, statelessly. A request's own `Authorization: Bearer lsk_...` header takes precedence over `LADOO_API_KEY`, so one deployment can serve several workspaces without storing their keys. Omit `LADOO_API_KEY` to require that header.

It binds to `127.0.0.1` and rejects other `Host` headers. Before exposing it with `--host 0.0.0.0`, put it behind TLS and your own authentication: anyone who can reach it can use the configured key.

## Development

```sh
npm install
npm test
```

See [CONTRIBUTING.md](CONTRIBUTING.md). The API reference is at [tryladoo.com/docs/developers](https://tryladoo.com/docs/developers).

## License

[MIT](LICENSE)
