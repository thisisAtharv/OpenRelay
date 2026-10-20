# OpenRelay

> **Lightweight, self-hosted notification relay and real-time event dispatcher.**  
> Built for developers who need reliable notification pipelines, persistent event tracking, and live streaming without third-party vendor lock-in.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-20%20LTS-green.svg)](https://nodejs.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16%20Alpine-336791.svg)](https://www.postgresql.org/)
[![React](https://img.shields.io/badge/React-19-61dafb.svg)](https://react.dev/)
[![Docker Compose](https://img.shields.io/badge/Docker%20Compose-v2-2496ed.svg)](https://docs.docker.com/compose/)

---

## Table of Contents

1. [Overview & Problem Statement](#overview--problem-statement)
2. [Key Objectives](#key-objectives)
3. [System Architecture & Workflow](#system-architecture--workflow)
4. [Architecture Diagram](#architecture-diagram)
5. [Technology Stack](#technology-stack)
6. [Implemented Features](#implemented-features)
7. [API Reference & Usage](#api-reference--usage)
8. [Local Development Setup](#local-development-setup)
9. [Production Deployment (Ubuntu Azure VM)](#production-deployment-ubuntu-azure-vm)
10. [Testing & Verification Guide](#testing--verification-guide)
11. [Security & Isolation](#security--isolation)
12. [Current Limitations & Roadmap](#current-limitations--roadmap)
13. [Academic & Project Context](#academic--project-context)
14. [License](#license)

---

## Overview & Problem Statement

Modern software architectures rely heavily on asynchronous event notifications: order updates, verification codes, system health alerts, and transactional messages. While commercial notification SaaS platforms (e.g., Twilio, Pusher, Novu, Courier) provide turnkey solutions, they present distinct drawbacks for self-hosters, privacy-sensitive applications, and budget-constrained environments:

- **Vendor Lock-in & Per-Message Pricing:** Tiered pricing scales aggressively with volume, penalizing small teams and high-frequency internal events.
- **Data Privacy & Compliance Concerns:** Sending sensitive recipient data and event payloads through third-party servers violates strict data residency requirements.
- **Integration Overhead:** Heavy proprietary SDKs complicate straightforward HTTP notification pipelines.
- **Lack of Visibility:** Black-box delivery states make it difficult to audit when and whether a subscriber received an event.

**OpenRelay** solves this by providing a compact, self-hosted notification engine. Applications submit notifications via a standard REST API authenticated by project-scoped API keys. Notifications are persistently queued in PostgreSQL, streamed in real time to connected clients over Server-Sent Events (SSE), and updated to `delivered` upon receiving explicit client acknowledgement.

---

## Key Objectives

- **Self-Contained & Lightweight:** Engineered to run smoothly on minimal cloud infrastructure (tested on an Ubuntu Azure VM with 1 GiB RAM).
- **Data Sovereignty:** All notification payloads, recipient metadata, and audit logs remain strictly within your own PostgreSQL database.
- **Zero-Drop Resilience:** Notifications created while a client is offline remain safely queued in PostgreSQL and are automatically replayed when the client reconnects.
- **Explicit Two-Way Handshake:** Every delivery is tracked through a persistent state machine (`queued` &rarr; `delivered` or `failed`) with recorded delivery attempts.
- **Turnkey Production Setup:** Single-command deployment using Docker Compose, automated TLS through Caddy, and reverse-proxying via Nginx.

---

## System Architecture & Workflow

OpenRelay operates on an end-to-end event relay pipeline with explicit acknowledgement:

```
[ External App / Service ]
            │
            ▼ 1. POST /api/v1/notifications (Bearer Token)
[ Express REST API ]
            │
            ├─► 2. Validate API key hash against PostgreSQL `api_keys`
            ├─► 3. Insert notification into PostgreSQL `notifications` (status: 'queued')
            │
            ▼ 4. Publish in-memory event to active project subscribers
[ Server-Sent Events (SSE) Stream ]
            │
            ▼ 5. Push event payload (`notification.created`)
[ Receiver Client / Dashboard ]
            │
            ▼ 6. POST /api/v1/notifications/:id/ack (Bearer Token)
[ Express REST API ]
            │
            ├─► 7. UPDATE `notifications` SET status='delivered', delivered_at=NOW()
            ├─► 8. INSERT INTO `notification_attempts` (status: 'delivered')
            └─► 9. Broadcast SSE update (`notification.updated`)
```

### Detailed Workflow Steps

1. **Authentication & Authorization:** The external application issues an HTTP request containing an API key (`Authorization: Bearer or_live_...`). OpenRelay computes the SHA-256 hash of the bearer token and checks it against active (non-revoked) keys in the database.
2. **Persistence First:** Before any client delivery is attempted, the notification is committed to PostgreSQL in the `queued` state with a unique UUID.
3. **Real-Time Dispatch:** The Express backend dispatches the newly committed record to an in-memory client registry matching the authenticated `project_id`.
4. **SSE Streaming:** Connected receiver clients receive the event immediately over an open `text/event-stream` HTTP connection. Heartbeats (`: heartbeat\n\n`) are broadcast every 25 seconds to keep intermediary proxies alive.
5. **Offline Queue Replay:** When a client establishes an SSE connection (`GET /api/projects/:projectId/events`), OpenRelay queries PostgreSQL for all pending notifications (`status = 'queued'`) for that project and replays them sequentially before streaming live traffic.
6. **Two-Way Delivery Handshake:** Upon receiving an event, the receiver client submits an acknowledgement request (`POST /api/v1/notifications/:notificationId/ack`). OpenRelay marks the notification as `delivered`, records the delivery timestamp, logs the attempt in `notification_attempts`, and broadcasts a `notification.updated` event to keep all dashboards synchronized.

---

## Architecture Diagram

```mermaid
flowchart TD
    subgraph PublicInternet["Public Internet"]
        App["External Application<br/>(Sender)"]
        Browser["Web Browser<br/>(Developer Console / Receiver)"]
    end

    subgraph HostVM["Azure Linux VM (1 GiB RAM)"]
        subgraph EdgeLayer["Edge / Ingress (Public Ports 80 & 443)"]
            Caddy["Caddy Server<br/>(Auto Let's Encrypt TLS & Reverse Proxy)"]
        end

        subgraph InternalNetwork["Docker Bridge Network ('openrelay-network')"]
            Nginx["Frontend Container (Nginx Alpine)<br/>• Port 80 (Internal)<br/>• Serves React SPA<br/>• Proxies /api/ and /health<br/>• Unbuffered SSE Proxy"]
            
            Backend["Backend Container (Node.js 20 Alpine)<br/>• Port 4000 (Internal)<br/>• Express REST API<br/>• In-memory SSE Dispatcher<br/>• SHA-256 Key Auth Validator"]
            
            DB[("PostgreSQL 16 Alpine<br/>• Port 5432 (Internal Only)<br/>• Persistent Volume (postgres_data)<br/>• Low-Memory Tuned (64MB shared_buffers)")]
        end
    end

    App -->|"HTTPS / POST /api/v1/notifications"| Caddy
    Browser -->|"HTTPS / Web Traffic & SSE"| Caddy

    Caddy -->|"Proxy to frontend:80"| Nginx
    Nginx -->|"Static files (SPA)"| Browser
    Nginx -->|"Proxy /api/* & /health"| Backend
    Backend -->|"Query / Insert / Update"| DB
    Backend -.->|"SSE Stream (unbuffered)"| Nginx
    Nginx -.->|"SSE Stream"| Caddy
    Caddy -.->|"SSE Stream"| Browser
```

---

## Technology Stack

| Layer | Technology | Version | Purpose |
|---|---|---|---|
| **Frontend Framework** | React | 19.2 | Interactive developer console & live receiver interface |
| **Frontend Tooling** | Vite | 8.2 | Fast bundle generation and client development |
| **Web Server** | Nginx | Alpine | Static asset hosting, unbuffered SSE proxying, SPA routing |
| **Edge & TLS** | Caddy | 2-alpine | Automated HTTPS certificate provisioning & ingress reverse proxy |
| **Backend Runtime** | Node.js | 20 LTS Alpine | High-throughput asynchronous event processing |
| **Backend Framework**| Express | 5.2 | REST API routing, streaming endpoints, and middleware |
| **Database** | PostgreSQL | 16 Alpine | ACID storage for projects, hashed API keys, and notification logs |
| **Streaming Protocol**| Server-Sent Events | Standard HTTP | One-way real-time push streaming with client keepalive |
| **Containerization** | Docker & Compose | v2+ | Multi-container orchestration and private network isolation |
| **Host Environment** | Ubuntu Linux | 22.04 / 24.04 | Standard deployment target (Azure B1s 1 GiB RAM VM) |
| **License** | MIT License | Open Source | Unrestricted academic, personal, and commercial usage |

---

## Implemented Features

- **Project-Level Multi-Tenancy:** Organize notification streams into distinct workspaces. Each project maintains its own isolated API keys, delivery logs, and SSE channel.
- **Hashed API Key Management:**
  - Secure keys generated with an identifiable prefix (`or_live_...`).
  - Keys are cryptographically hashed using **SHA-256** prior to database storage.
  - Raw secret keys are displayed exactly once at creation and never stored in plaintext.
  - Granular key revocation with instant invalidation.
- **Notification Lifecycle & Ingestion:**
  - `POST /api/v1/notifications` accepts payload attributes: `recipient`, `title`, `message`, and `type` (`general`, `order`, `alert`, `system`).
  - Strict payload validation ensures bounded memory consumption.
  - Initial state is persistently set to `queued`.
- **Live Real-Time Receiver via SSE:**
  - Native browser `EventSource` listener under `/api/projects/:projectId/events`.
  - Visual status pill indicating stream state (`connected`, `connecting`, `reconnecting`, `error`, `disconnected`).
  - Stream controls: Pause incoming stream, buffer new events while inspecting, and resume/flush on demand.
  - Expandable inspector for examining raw JSON event payloads.
- **Resilient Pending-Notification Replay:**
  - If a consumer drops offline or disconnects, unacknowledged notifications remain safely stored as `queued`.
  - Upon reconnection, OpenRelay automatically replays all queued notifications in chronological order before live events.
- **Explicit Delivery Acknowledgement:**
  - Dedicated endpoint `POST /api/v1/notifications/:id/ack`.
  - Transitions status from `queued` to `delivered` and logs a delivery record in `notification_attempts`.
  - Prevents illegal state transitions (e.g., failed notifications cannot be marked delivered; duplicate acks are handled idempotently).
- **Searchable Audit Logs:**
  - Developer console displays real-time and historical notification logs.
  - Instant client-side filtering by search keyword (ID, recipient, title, message) and delivery status (`all`, `queued`, `delivered`, `failed`).
- **Comprehensive Failure Handling:**
  - Missing or malformed authentication headers immediately return `401 Unauthorized`.
  - Attempts to access projects outside the scope of the authenticated key return `403 Forbidden`.
  - Database reconnect loop allows the backend to tolerate temporary PostgreSQL cold starts gracefully.

---

## API Reference & Usage

All API endpoints are served under `/api` (except health and metadata endpoints).

### Authentication
Include the project API key in the standard `Authorization` header:
```http
Authorization: Bearer or_live_your_actual_key_here
```
For SSE endpoints in environments where custom headers are unsupported by native `EventSource`, the key may be passed as a query parameter:
```http
GET /api/projects/:projectId/events?token=or_live_your_actual_key_here
```

---

### Endpoints Overview

| Method | Endpoint | Auth Required | Description |
|---|---|:---:|---|
| `GET` | `/` | No | Service metadata, version, and documentation link |
| `GET` | `/health` | No | Health check validating backend & PostgreSQL database connectivity |
| `POST` | `/api/projects` | No | Bootstrap a new project and receive its initial root API key |
| `GET` | `/api/projects` | No | List all projects with associated notification counts |
| `DELETE` | `/api/projects/:projectId` | Yes | Permanently delete a project, its keys, and all notification history |
| `GET` | `/api/projects/:projectId/keys` | Yes | List active and revoked API keys for the specified project |
| `POST` | `/api/projects/:projectId/keys` | Yes | Generate a new named API key for the project |
| `POST` | `/api/projects/:projectId/keys/:keyId/revoke` | Yes | Revoke an existing API key |
| `POST` | `/api/v1/notifications` | Yes | Ingest a new notification and publish to the SSE stream |
| `GET` | `/api/v1/notifications/:notificationId` | Yes | Fetch single notification details by UUID |
| `POST` | `/api/v1/notifications/:notificationId/ack` | Yes | Acknowledge delivery and transition status to `delivered` |
| `GET` | `/api/projects/:projectId/notifications` | Yes | Fetch paginated notification audit history for a project |
| `GET` | `/api/projects/:projectId/events` | Yes | Establish a persistent SSE stream for real-time notification events |

---

### Request & Response Examples

#### 1. Check System Health
```bash
curl -X GET https://notify.example.com/health
```
**Response (`200 OK`):**
```json
{
  "ok": true,
  "service": "openrelay",
  "database": "connected"
}
```

#### 2. Create a Project (Initial Bootstrap)
```bash
curl -X POST https://notify.example.com/api/projects \
  -H "Content-Type: application/json" \
  -d '{"name": "E-Commerce Production"}'
```
**Response (`201 Created`):**
```json
{
  "project": {
    "id": "7b0d87a5-c49b-449e-9907-75e1140228cf",
    "name": "E-Commerce Production"
  },
  "apiKey": "or_live_a3f81e9b2c4d6f8a0e1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e"
}
```
> [!IMPORTANT]
> The full `apiKey` is returned only once at creation time. OpenRelay stores a one-way SHA-256 hash. Store the returned secret in a secure secrets manager.

#### 3. Send a Notification
```bash
curl -X POST https://notify.example.com/api/v1/notifications \
  -H "Authorization: Bearer or_live_a3f81e9b2c4d6f8a0e1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e" \
  -H "Content-Type: application/json" \
  -d '{
    "recipient": "customer_9821",
    "title": "Order Dispatched",
    "message": "Package #4821 has left our fulfilment warehouse.",
    "type": "order"
  }'
```
**Response (`202 Accepted`):**
```json
{
  "id": "a98a8a4f-5cf8-4c22-b5e1-cfcf5877fba1",
  "status": "queued"
}
```

#### 4. Connect to Real-Time SSE Stream
```bash
curl -N -H "Authorization: Bearer or_live_a3f81e9b2c4d6f8a0e1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e" \
  https://notify.example.com/api/projects/7b0d87a5-c49b-449e-9907-75e1140228cf/events
```
**Stream Output:**
```text
data: {"event":"connected"}

data: {"event":"notification.created","id":"a98a8a4f-5cf8-4c22-b5e1-cfcf5877fba1","recipient":"customer_9821","title":"Order Dispatched","message":"Package #4821 has left our fulfilment warehouse.","type":"order","status":"queued","created_at":"2026-10-21T00:15:20.123Z","data":{"id":"a98a8a4f-5cf8-4c22-b5e1-cfcf5877fba1","recipient":"customer_9821","title":"Order Dispatched","message":"Package #4821 has left our fulfilment warehouse.","type":"order","status":"queued","created_at":"2026-10-21T00:15:20.123Z"}}

: heartbeat
```

#### 5. Acknowledge Delivery
```bash
curl -X POST https://notify.example.com/api/v1/notifications/a98a8a4f-5cf8-4c22-b5e1-cfcf5877fba1/ack \
  -H "Authorization: Bearer or_live_a3f81e9b2c4d6f8a0e1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e"
```
**Response (`200 OK`):**
```json
{
  "ok": true,
  "id": "a98a8a4f-5cf8-4c22-b5e1-cfcf5877fba1",
  "status": "delivered",
  "delivered_at": "2026-10-21T00:15:21.842Z"
}
```

---

## Local Development Setup

### Prerequisites
- **Node.js**: v20 LTS or higher
- **PostgreSQL**: v16 (local installation or Docker container)
- **npm**: v10+

### 1. Clone Repository
```bash
git clone https://github.com/thisisAtharv/OpenRelay.git
cd OpenRelay
```

### 2. Configure Backend
Navigate to `backend/` and configure environment variables:
```bash
cd backend
cp ../.env.example .env
```
Edit `backend/.env` with your local PostgreSQL credentials:
```env
PORT=4000
DATABASE_URL=postgresql://openrelay_user:your_password@localhost:5432/openrelay_app
CORS_ORIGIN=http://localhost:5173
API_KEY_PREFIX=or_live_
```
Install dependencies and launch the dev server:
```bash
npm install
npm run dev
```
*The backend automatically initializes required tables (`projects`, `api_keys`, `notifications`, `notification_attempts`) on startup and listens at `http://localhost:4000`.*

### 3. Configure Frontend
In a separate terminal, navigate to `frontend/`:
```bash
cd frontend
cp ../.env.example .env
```
Edit `frontend/.env`:
```env
VITE_API_URL=http://localhost:4000
```
Install dependencies and start the Vite development server:
```bash
npm install
npm run dev
```
Open your browser at `http://localhost:5173` to access the developer dashboard.

---

## Production Deployment (Ubuntu Azure VM)

OpenRelay is fully containerized and pre-configured for automated production deployment on a single cloud VM (e.g., an Azure B1s instance: 1 vCPU, 1 GiB RAM).

### 1. Prerequisites on Azure VM
- Ubuntu Linux 22.04 or 24.04 LTS
- Docker and Docker Compose plugin installed (`sudo apt install docker.io docker-compose-v2`)
- Inbound firewall rules (Azure Network Security Group) allowing ports **80** (HTTP) and **443** (HTTPS)
- A DNS `A` record pointing your domain (e.g., `notify.yourdomain.com`) to the VM's public IP address

### 2. Clone Repository & Set Environment Variables
```bash
git clone https://github.com/thisisAtharv/OpenRelay.git /opt/openrelay
cd /opt/openrelay

# Copy configuration template
cp .env.example .env
```

Edit `/opt/openrelay/.env`:
```env
# Public domain pointing to this VM
DOMAIN=notify.yourdomain.com

# Public origin used by the browser console & backend CORS
PUBLIC_ORIGIN=https://notify.yourdomain.com

# PostgreSQL Credentials (use a strong, generated password)
POSTGRES_USER=openrelay_admin
POSTGRES_PASSWORD=generate_a_cryptographically_secure_password_here
POSTGRES_DB=openrelay_production

# Optional key prefix
API_KEY_PREFIX=or_live_
```

> [!CAUTION]
> Never commit `/opt/openrelay/.env` to source control. Ensure its permissions are locked down:
> ```bash
> chmod 600 .env
> ```

### 3. Launch Services with Docker Compose
```bash
# Build images and start all 4 containers in the background
docker compose up -d --build
```

### 4. Verify Service Health
Check that all containers are healthy:
```bash
docker compose ps
```
Expected output:
```text
NAME                 IMAGE               COMMAND                  SERVICE    STATUS
openrelay_caddy      caddy:2-alpine      "caddy run --config …"   caddy      running (healthy)
openrelay_frontend   openrelay-frontend  "/docker-entrypoint.…"   frontend   running (healthy)
openrelay_backend    openrelay-backend   "docker-entrypoint.s…"   backend    running (healthy)
openrelay_postgres   postgres:16-alpine  "docker-entrypoint.s…"   postgres   running (healthy)
```

Test public health over HTTPS:
```bash
curl -I https://notify.yourdomain.com/health
```
*(Caddy will automatically provision a Let's Encrypt / ZeroSSL TLS certificate during the first request).*

---

## Testing & Verification Guide

Follow these testing scenarios to validate the integrity of your OpenRelay deployment:

### Scenario 1: Live Real-Time Delivery & Auto-Acknowledgement
1. Open the OpenRelay console in your browser (`https://notify.yourdomain.com`).
2. Navigate to **Projects** and create a project named `Staging Test`. Copy the generated API key.
3. Open the **Receiver** tab. The status indicator should turn green: **Connected (Live)**.
4. Open a terminal and dispatch a notification via `curl` using the `POST /api/v1/notifications` endpoint.
5. **Expected Result:**
   - The notification card immediately pops up in the Receiver tab with a `LIVE` pulse badge.
   - The receiver automatically dispatches an acknowledgement request (`/ack`).
   - The status tag transitions from `queued` to `delivered` in real time.

### Scenario 2: Offline Pending Queue Replay
1. On the **Receiver** tab, click **Pause stream** (or simply close the browser tab to simulate network disconnection).
2. While disconnected, send 3 new notifications via `curl`.
3. Re-open or unpause the **Receiver** tab.
4. **Expected Result:**
   - OpenRelay connects and executes an offline replay query against PostgreSQL.
   - All 3 queued notifications appear in chronological order and are acknowledged sequentially.

### Scenario 3: Idempotent Acknowledgement Handling
1. Take the ID of an already delivered notification.
2. Submit an acknowledgement request using `curl`:
   ```bash
   curl -X POST https://notify.yourdomain.com/api/v1/notifications/<ID>/ack \
     -H "Authorization: Bearer <API_KEY>"
   ```
3. **Expected Result:**
   - The endpoint returns `200 OK` with `"duplicate": true` and preserves the original `delivered_at` timestamp without duplicating audit logs.

### Scenario 4: Authentication & Security Rejection
1. Attempt to send a notification without an `Authorization` header:
   - **Result:** `401 Unauthorized` (`{"error": "Missing API key"}`).
2. Attempt to send a notification with a malformed key (e.g., `Bearer or_live_fake`):
   - **Result:** `401 Unauthorized` (`{"error": "Invalid or revoked API key"}`).
3. Revoke an active key in the **API keys** tab, then immediately retry using that key:
   - **Result:** `401 Unauthorized` (`{"error": "Invalid or revoked API key"}`).
4. Attempt to query or modify a project using a valid key that belongs to a different project:
   - **Result:** `403 Forbidden` (`{"error": "API key does not belong to this project"}`).

---

## Security & Isolation

- **Zero Public Port Exposure for Internal Services:**
  - Neither PostgreSQL (port 5432) nor Express (port 4000) are mapped to the host's public network interface.
  - Only Caddy binds to public host ports **80** and **443**.
  - All communication between Caddy, Nginx, Express, and PostgreSQL is contained within an internal Docker bridge network (`openrelay-network`).
- **Cryptographic Key Hashing:**
  - API keys are hashed with **SHA-256** prior to insertion into PostgreSQL.
  - A potential database leak does not expose plaintext API keys.
- **Strict Environment Isolation:**
  - Production secrets (`POSTGRES_PASSWORD`, etc.) are injected strictly at runtime via `.env` and are excluded from Docker images via `.dockerignore`.
  - `.env` is ignored by Git to avoid accidental secret leaks.
- **Input Sanitization & Length Limits:**
  - Express limits JSON request bodies to `64kb`.
  - String constraints: `recipient` &le; 200 chars, `title` &le; 160 chars, `message` &le; 4000 chars.

---

## Current Limitations & Roadmap

### Current Capabilities & Boundaries
- **In-Memory Event Bus:** Live event distribution currently utilizes an in-memory client registry inside the single Node.js container instance. Horizontal clustering across multiple backend instances requires an external pub/sub broker (e.g., Redis).
- **Client Protocol:** Real-time event consumption is currently implemented via **Server-Sent Events (SSE)**.
- **Delivery Scope:** OpenRelay currently serves as an ingestion, queuing, persistence, and SSE relay mechanism. Outbound email and SMS transports are not yet implemented.

### Planned Roadmap
- [ ] **Webhook Dispatcher:** Outbound HTTP push delivery to external subscriber URLs with exponential backoff and retry policies.
- [ ] **Email Delivery Adapter:** Pluggable SMTP / AWS SES / Resend integration for transactional email forwarding.
- [ ] **Web Push / Mobile Notifications:** Native browser push notifications using VAPID / Web Push standards and mobile push via Firebase Cloud Messaging (FCM).
- [ ] **Redis Pub/Sub Adapter:** Enable multi-instance horizontal scaling for high-concurrency environments.
- [ ] **Role-Based Access Control (RBAC):** Read-only audit roles and fine-grained permissions for developer teams.

---

## Academic & Project Context

OpenRelay was designed and presented as part of the **Real-World Open Source Project Lab (ROSPL)** curriculum. The project demonstrates core principles of modern distributed system engineering:

1. **Decoupled Architecture:** Separation of edge TLS routing (Caddy), static SPA serving and unbuffered proxying (Nginx), business logic (Node.js/Express), and relational persistence (PostgreSQL).
2. **Resilience & Fault Tolerance:** Combining durable persistence with streaming relays ensures zero data loss during client disconnection.
3. **Resource Efficiency:** Full containerized stack tuned to run stably on a 1 vCPU / 1 GiB RAM virtual machine under real-world memory constraints.
4. **Open-Source Compliance:** Developed under the permissive [MIT License](LICENSE), complete with reproducible development environments, automated Docker workflows, and security hygiene.

---

## License

Distributed under the **MIT License**. See [`LICENSE`](LICENSE) for complete details.

```text
Copyright (c) 2026 Atharv
```
