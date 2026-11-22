# Changelog

## 0.1.0

First release.

- 18 read-only tools for calls, analytics, people, agents and versions, knowledge bases, bookings, phone numbers, attention items and webhooks.
- 5 write tools behind `--allow-writes`: edit a person, add a knowledge source or answer, cancel a booking, redeliver a webhook.
- `ladoo://calls/{id}` transcript resource and three prompts: `daily_call_digest`, `find_callbacks`, `missed_bookings_review`.
- stdio and Streamable HTTP transports.
- Typed client generated from the API's OpenAPI document, pinned to API version `2026-11-16`.
