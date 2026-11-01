# OpenRelay Standalone Demo Client

A minimal, dependency-free external client script demonstrating how any application can integrate with **OpenRelay** and dispatch email notifications directly via the REST API.

---

## Features

- **Zero External Dependencies:** Built with modern native Node.js and native `fetch`. No `npm install` required.
- **Native Environment Loading:** Automatically loads `.env` files using Node.js built-in `process.loadEnvFile()` (supported on Node.js 20.6+), or reads from shell environment variables.
- **CLI Parameter Support:** Easily override recipient, title, or message from the command line.
- **Clean Error Handling:** Inspects HTTP responses, reports API error messages, and validates recipient email formats.

---

## Prerequisites

- **Node.js 18+** (Node.js 20+ recommended for native `.env` loading).
- A running **OpenRelay** instance (local dev server or production deployment).
- An active project **API key** (`or_live_...`).

---

## Setup Instructions

### 1. Configure Environment Variables

Copy the example environment file:

```bash
# On Windows PowerShell:
Copy-Item .env.example .env

# On Linux / macOS / Bash:
cp .env.example .env
```

Edit `.env` and provide your OpenRelay details:

```ini
# Base URL of the OpenRelay backend
OPENRELAY_URL=http://localhost:4000

# Project API Key generated from OpenRelay
OPENRELAY_API_KEY=or_live_your_actual_key_here

# Recipient email address
RECIPIENT_EMAIL=your_email@example.com

# Optional custom title and message
EMAIL_TITLE=Order Confirmation
EMAIL_MESSAGE=Your order #9821 has been processed.
EMAIL_TYPE=order
```

> [!TIP]
> **How to get an API key without the dashboard:**
> You can bootstrap a project directly via curl:
> ```bash
> curl -X POST http://localhost:4000/api/projects \
>   -H "Content-Type: application/json" \
>   -d '{"name": "External App"}'
> ```
> The response returns `{ project, apiKey }`.

---

## Execution Instructions

### Option A: Standard Run (Reads from `.env`)

```bash
node send-email.mjs
```

### Option B: Command-Line Overrides

You can pass recipient, title, and message directly as positional arguments:

```bash
node send-email.mjs user@example.com "Payment Received" "Invoice #1024 is now paid."
```

### Option C: Inline Environment Variables

#### Windows PowerShell:
```powershell
$env:OPENRELAY_URL="http://localhost:4000"
$env:OPENRELAY_API_KEY="or_live_your_actual_key_here"
$env:RECIPIENT_EMAIL="user@example.com"
node send-email.mjs
```

#### Linux / macOS:
```bash
OPENRELAY_URL=http://localhost:4000 \
OPENRELAY_API_KEY=or_live_your_actual_key_here \
RECIPIENT_EMAIL=user@example.com \
node send-email.mjs
```

---

## Expected Output

### Success Response (`200 OK`)
```text
----------------------------------------------------
 OpenRelay External Client - Send Email
----------------------------------------------------
 Endpoint:   http://localhost:4000/api/v1/notifications
 Recipient:  user@example.com
 Title:      Order Confirmation
 Channel:    email
 Type:       order
----------------------------------------------------

✅ Notification successfully processed:
   Notification ID: 3fa85f64-5717-4562-b3fc-2c963f66afa6
   Status:          sent
   Channel:         email

Dispatch completed successfully.
```

### Error Responses

| Status Code | Cause | Sample Output |
|---|---|---|
| `400 Bad Request` | Invalid email format or missing parameters | `❌ HTTP Error 400: Message: Invalid recipient email address` |
| `401 Unauthorized` | Invalid, missing, or revoked API key | `❌ HTTP Error 401: Message: Missing API key` |
| `502 Bad Gateway` | SMTP server connection or credential issue | `❌ HTTP Error 502: Message: Email delivery failed: ...` |

---

## Security Best Practices

- Never commit your `.env` file containing actual API keys or credentials.
- Ensure `demo-client/.env` is included in your `.gitignore`.
