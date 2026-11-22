# Security

Please report vulnerabilities privately to support@tryladoo.com with "Security" in the subject, not in a public issue. Include steps to reproduce and what an attacker could do. We'll confirm we got it and keep you updated until it's fixed.

Our disclosure policy is at [tryladoo.com/security](https://tryladoo.com/security#disclosure).

## Using this server safely

- Use a key with the fewest scopes you need. The Read only preset is enough unless you turn on write tools.
- Write tools are off by default. Turn them on only in clients that ask before running a tool.
- Treat call transcripts as untrusted text. A caller can say anything, and the model reads it.
- The HTTP mode binds to `127.0.0.1`. Put TLS and authentication in front of it before exposing it.
