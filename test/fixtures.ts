// Demo data shaped by the OpenAPI schemas. Typecheck fails if a fixture drifts from the snapshot.
import type { Response } from "../src/client.js";
import type { Schemas } from "../src/format.js";

export const ids = {
  call: "c2a1e9b8-4f3d-4a2c-9b1e-8d7c6b5a4f3e",
  call2: "0b9f6c2d-1e3a-4d5b-8c7e-9f0a1b2c3d4e",
  person: "5d4c3b2a-1f0e-4d9c-8b7a-6f5e4d3c2b1a",
  agent: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
  number: "9e8d7c6b-5a4f-4e3d-9c2b-1a0f9e8d7c6b",
  kb: "3f2e1d0c-9b8a-4766-8544-332211009988",
  source: "7a6b5c4d-3e2f-4a1b-9c8d-7e6f5a4b3c2d",
  endpoint: "4b3a2918-0f7e-4d6c-9b5a-483726150f0e",
  delivery: "8c7b6a59-4e3d-4c2b-9a19-0f8e7d6c5b4a",
  version3: "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
  workspace: "6e5d4c3b-2a19-4f8e-9d7c-6b5a4f3e2d1c",
  attention: "2d1c0b9a-8f7e-4d6c-9b5a-4f3e2d1c0b9a",
  booking: "bk_demo_001",
};

const callSummary: Schemas["CallSummary"] = {
  id: ids.call,
  kind: "live",
  channel: "phone",
  widget_id: null,
  language: "en",
  direction: "inbound",
  status: "completed",
  phone_number_id: ids.number,
  deployment_id: null,
  workflow_version_id: ids.version3,
  config_hash: "demo",
  time_zone: "America/Chicago",
  from_number: "+15555550100",
  to_number: "+15555550001",
  started_at: "2026-11-18T15:00:00.000Z",
  ended_at: "2026-11-18T15:02:22.000Z",
  duration_seconds: 142,
  end_reason: "caller_hangup",
  summary: "Jordan Rivera called about a leaking water heater and asked for someone to come out today.",
  outcome: { type: "message_taken", crm_ref: null, details: {}, reached: ["message_taken", "urgent_escalated"] },
  extracted: { caller_name: "Jordan Rivera", reason: "Leaking water heater", urgency: "high", callback_number: null },
  urgency: "high",
  recording_url: null,
  hung_up_early: false,
  billable: true,
  created_at: "2026-11-18T15:00:00.000Z",
};

export const callList: Response<"/v1/calls", "get"> = {
  data: [
    { ...callSummary, person: { id: ids.person, name: "Jordan Rivera" }, success: "passed" },
    {
      ...callSummary,
      id: ids.call2,
      from_number: "+15555550142",
      urgency: "normal",
      summary: "Caller hung up while picking an appointment time.",
      outcome: { type: "no_action", crm_ref: null, details: {}, reached: ["no_action"] },
      extracted: { caller_name: null, reason: "Drain cleaning" },
      person: null,
      success: null,
    },
  ],
  next_cursor: "cur_page2",
};

export const callDetail: Response<"/v1/calls/{id}", "get"> = {
  ...callSummary,
  binding_id: null,
  provider_call_id: null,
  transcript: [
    { role: "agent", text: "Thanks for calling Rivera Plumbing, how can I help?", start_ms: 0, end_ms: 1800 },
    { role: "caller", text: "My water heater is leaking.", start_ms: 2000, end_ms: 4200 },
    { role: "agent", text: "We open at 8 tomorrow.", start_ms: 64_000, end_ms: 66_000 },
  ],
  flags: [
    {
      entry_index: 2,
      who: "agent",
      category: "incorrect",
      severity: "medium",
      issue: "Said the office opens at 8; it opens at 7.",
      expected: "We open at 7.",
      source: null,
    },
  ],
  guardrail_breaches: null,
  tool_calls: [{ name: "take_message", args: {}, ok: true, latency_ms: 120 }],
  latency: { p50_ms: 800, p95_ms: 1400, turns: 2, per_turn: [] },
  node_trail: null,
  completed_at: "2026-11-18T15:02:23.000Z",
  person: { id: ids.person, name: "Jordan Rivera" },
  steps: [],
  judgment: {
    status: "judged",
    skip_reason: null,
    skip_message: null,
    outcome: "failed",
    results: [
      { criterion: "Took a callback number", verdict: "pass", reason: "Confirmed the number." },
      { criterion: "Gave correct hours", verdict: "fail", reason: "Said 8am instead of 7am." },
    ],
    csat: 4,
    csat_reason: null,
    judged_at: "2026-11-18T15:03:00.000Z",
  },
  crm_sync: null,
  follow_up: { user_id: ids.person, name: "Sam Ortiz" },
  text_back: null,
  booking_notices: [],
};

export const analytics: Response<"/v1/analytics/calls", "get"> = {
  range: { from: "2026-11-16T06:00:00.000Z", to: "2026-11-23T06:00:00.000Z", time_zone: "America/Chicago" },
  calls: 42,
  minutes: 96,
  average_seconds: 131,
  after_hours: 9,
  hours_known: 42,
  business_hours: "Mon–Fri 7am–5pm, Central",
  hung_up_early: 3,
  outcomes: [
    { outcome: "booked", calls: 14 },
    { outcome: "message_taken", calls: 11 },
  ],
  conversations: 35,
  booking_rate: 0.4,
  previous: {
    from: "2026-11-09T06:00:00.000Z",
    to: "2026-11-16T06:00:00.000Z",
    calls: 38,
    minutes: 80,
    hung_up_early: 2,
    conversations: 30,
    booking_rate: 0.3333,
  },
  callbacks_waiting: { calls: 4, booking: 3, message: 1 },
  urgent: 2,
  flagged: 1,
  calendar_errors: 0,
  callers: { new: 20, returning: 15, repeat: 4, unknown: 3 },
  busiest: [
    { day: 1, hour: 9, calls: 6 },
    { day: 2, hour: 8, calls: 4 },
  ],
  daily: [{ date: "2026-11-16", calls: 6 }],
  languages: [{ language: "en", calls: 42 }],
  judging: { judged: 30, passed: 25, failed: 3, unclear: 2, success_rate: 0.8333, csat_average: 4.2, csat_calls: 28 },
  latency: { p50_ms: 820, p95_ms: 1500, turns: 400 },
  reasons: [{ reason: "Leaking water heater", calls: 5 }],
  workflow: null,
  versions: null,
  clients: null,
};

const person: Schemas["Person"] = {
  id: ids.person,
  name: "Jordan Rivera",
  phone: "+15555550100",
  email: "jordan@example.com",
  first_contact_at: "2026-10-02T14:00:00.000Z",
  last_contact_at: "2026-11-18T15:00:00.000Z",
  channels: ["phone"],
  conversations: 3,
  possible_match: false,
  possible_matches: 0,
};

export const peopleList: Response<"/v1/people", "get"> = { data: [person], next_cursor: null };

export const personDetail: Response<"/v1/people/{id}", "get"> = {
  ...person,
  notes: "Prefers mornings.",
  name_edited: false,
  created_from: "phone",
  other_phones: [],
  other_emails: [],
  crm_url: null,
  crm_contact: null,
  history: [
    {
      id: ids.call,
      channel: "phone",
      started_at: "2026-11-18T15:00:00.000Z",
      duration_seconds: 142,
      summary: "Leaking water heater.",
      outcome: "message_taken",
    },
  ],
  matches: [],
};

const agent: Schemas["Agent"] = {
  id: ids.agent,
  name: "Front desk",
  engine: "workflow",
  defaults: {
    language: "en",
    system_prompt: "You answer the phone for Rivera Plumbing.",
    first_message: "Thanks for calling Rivera Plumbing, how can I help?",
    llm: { provider: "demo", model: "demo-model" },
    stt: { provider: "demo", model: "demo-stt", keyterms: [] },
    tts: { provider: "demo", voice_id: "voice_demo", model: "demo-tts", pace: "medium" },
    max_call_seconds: 900,
    languages: "en_es",
    pronunciations: [],
    disclosure: "",
    variables: {},
  },
  created_at: "2026-09-01T12:00:00.000Z",
  updated_at: "2026-11-10T12:00:00.000Z",
};

export const agentList: Response<"/v1/agents", "get"> = { data: [agent] };

export const agentDetail: Response<"/v1/agents/{id}", "get"> = {
  ...agent,
  workflow: {
    id: ids.agent,
    version_id: ids.version3,
    version_number: 3,
    published_at: "2026-11-10T12:00:00.000Z",
    tools: [{ name: "book_appointment", kind: "calendar" }],
    fields: [
      {
        key: "address",
        label: "Service address",
        type: "string",
        options: [],
        description: "",
        collect: "required",
        crm_field: null,
      },
    ],
    dev_fixtures: {},
    booking_calendars: { mode: "all" },
    booking: { state: "on", calendars: ["Google Calendar"], notice: null },
  },
  versions: [
    { version_id: ids.version3, version_number: 3, published_at: "2026-11-10T12:00:00.000Z", changelog: "Fixed hours" },
  ],
  phone_numbers: [{ id: ids.number, e164: "+15555550001" }],
  notifications: { team_id: null },
  success_criteria: ["Took a callback number"],
  pre_call_webhook: { url: null },
};

export const agentVersions: Response<"/v1/agents/{id}/versions", "get"> = {
  data: [
    {
      version_id: ids.version3,
      version_number: 3,
      published_at: "2026-11-10T12:00:00.000Z",
      changelog: "Fixed hours",
      created_by: null,
      live: true,
    },
    {
      version_id: ids.agent,
      version_number: 2,
      published_at: "2026-10-01T12:00:00.000Z",
      changelog: null,
      created_by: ids.person,
      live: false,
    },
  ],
};

export const versionDiff: Response<"/v1/agents/{id}/versions/{a}/diff/{b}", "get"> = {
  from: agentVersions.data[1] as Schemas["WorkflowVersionSummary"],
  to: agentVersions.data[0] as Schemas["WorkflowVersionSummary"],
  steps: [
    {
      id: "greeting",
      name: "Greeting",
      type: "conversation",
      change: "changed",
      changes: [{ key: "prompt", before: "We open at 8.", after: "We open at 7." }],
      before: null,
      after: null,
    },
  ],
  flow: [],
  settings: [],
  text_keys: ["prompt"],
};

export const phoneNumbers: Response<"/v1/phone-numbers", "get"> = {
  data: [
    {
      id: ids.number,
      e164: "+15555550001",
      carrier: "telnyx",
      status: "active",
      type: "local",
      locality: "Austin",
      monthly_price_cents: null,
      agent: { id: ids.agent, name: "Front desk" },
      created_at: "2026-09-01T12:00:00.000Z",
    },
  ],
};

export const attention: Response<"/v1/attention", "get"> = {
  data: [
    {
      id: ids.attention,
      kind: "calendar_disconnected",
      level: "red",
      message: "Google Calendar is disconnected, so bookings are failing.",
      path: "/settings/integrations",
      workspace: null,
      opened_at: "2026-11-20T10:00:00.000Z",
    },
  ],
};

export const workspace: Response<"/v1/workspace", "get"> = {
  id: ids.workspace,
  name: "Rivera Plumbing",
  slug: "rivera-plumbing",
  kind: "direct",
  parent: null,
  seats: { limit: 5, used: 2 },
  recognize_callers: true,
  caller_booking_changes: true,
  text_back: false,
  text_back_message: null,
  follow_up_user_id: null,
  brand: null,
  viewer: { role: null, access: "api_key", scopes: ["calls:read", "people:read"] },
};

const knowledgeBase: Schemas["KnowledgeBase"] = {
  id: ids.kb,
  name: "Services and pricing",
  description: "What we do and what it costs.",
  status: "ready",
  source_count: 1,
  document_count: 4,
  chunk_count: 20,
  char_count: 8000,
  token_estimate: 2000,
  agents: [{ id: ids.agent, name: "Front desk" }],
  created_at: "2026-09-01T12:00:00.000Z",
  updated_at: "2026-11-01T12:00:00.000Z",
};

export const knowledgeSource: Schemas["KnowledgeSource"] = {
  id: ids.source,
  knowledge_base_id: ids.kb,
  kind: "qa",
  name: "Fixes from calls",
  config: { kind: "qa", from_calls: true },
  status: "queued",
  summary: "1 question",
  error: null,
  failures: [],
  document_count: 0,
  chunk_count: 0,
  char_count: 0,
  queued_at: "2026-11-22T12:00:00.000Z",
  started_at: null,
  finished_at: null,
  created_at: "2026-11-22T12:00:00.000Z",
  updated_at: "2026-11-22T12:00:00.000Z",
};

export const knowledgeBases: Response<"/v1/knowledge-bases", "get"> = { data: [knowledgeBase] };

export const knowledgeBaseDetail: Response<"/v1/knowledge-bases/{id}", "get"> = {
  ...knowledgeBase,
  sources: [knowledgeSource],
};

export const knowledgeSearch: Response<"/v1/knowledge-bases/{id}/search", "post"> = {
  mode: "all",
  results: [
    {
      chunk_id: ids.source,
      knowledge_base_id: ids.kb,
      source_id: ids.source,
      document_id: ids.source,
      title: "Pricing",
      heading_path: ["Water heaters"],
      uri: "https://example.com/pricing",
      text: "Water heater replacement starts at $1,200 installed.",
      score: 0.87654,
    },
  ],
};

export const booking: Schemas["CalendarBooking"] = {
  id: ids.booking,
  start: "2026-11-24T15:00:00.000Z",
  end: "2026-11-24T16:00:00.000Z",
  title: "Jordan Rivera: water heater",
  caller_name: "Jordan Rivera",
  person_name: "Jordan Rivera",
  caller_phone: "+15555550100",
  call_id: ids.call,
  agent_name: "Front desk",
  calendars: ["Google Calendar"],
  reason: "Water heater",
  status: "booked",
  cancellable: true,
  events: [{ label: "Google Calendar", provider: "google", state: "booked", error: null }],
  cancelled_at: null,
  cancelled_by: null,
  summary: null,
  notices: [],
};

export const bookings: Response<"/v1/calendar/bookings", "get"> = {
  timezone: "America/Chicago",
  bookings: [booking],
};

export const webhookEndpoints: Response<"/v1/webhook-endpoints", "get"> = {
  data: [
    {
      id: ids.endpoint,
      url: "https://example.com/hooks/ladoo",
      description: "CRM sync",
      events: ["call.completed"],
      enabled: true,
      failing_since: "2026-11-21T00:00:00.000Z",
      auto_disabled_at: null,
      previous_secret_expires_at: null,
      created_at: "2026-09-01T12:00:00.000Z",
      updated_at: "2026-09-01T12:00:00.000Z",
    },
  ],
};

export const delivery: Schemas["WebhookDelivery"] = {
  id: ids.delivery,
  endpoint_id: ids.endpoint,
  event_id: ids.call,
  event_type: "call.completed",
  status: "failed",
  test: false,
  attempts: 6,
  response_code: 500,
  response_body: "Internal Server Error",
  latency_ms: 300,
  error: null,
  payload: {},
  created_at: "2026-11-21T00:00:00.000Z",
  last_attempt_at: "2026-11-21T06:00:00.000Z",
  next_attempt_at: null,
  delivered_at: null,
};

export const deliveries: Response<"/v1/webhook-endpoints/{id}/deliveries", "get"> = {
  data: [delivery, { ...delivery, id: ids.call2, status: "delivered", response_code: 200, response_body: "ok" }],
};
