<!-- CLAUDE.md for Kumo Backend -->
<!-- Place this file in the backend project root as CLAUDE.md -->

## Project Context

This is the backend for **Kumo** - a mental wellness React Native app (Expo). The backend serves a REST API with JWT authentication and SSE streaming for AI chat. The mobile client uses Axios for requests and native fetch for SSE.

## Tech Stack

- **Runtime:** Node.js with **Fastify** (v5)
- **Database:** PostgreSQL (production) / SQLite (local dev) with **Prisma**
- **Auth:** JWT (Bearer token in Authorization header) — single token, no refresh tokens
- **File Storage:** AWS S3-compatible (audio uploads)
- **AI Provider:** OpenAI API for chat responses (streaming)
- **Email:** SMTP via Nodemailer
- **SSE:** Native response streaming (`reply.raw.write` with `text/event-stream`)

---

## Database Schema

### users

| Column          | Type      | Notes                                    |
| --------------- | --------- | ---------------------------------------- |
| id              | UUID (PK) | Auto-generated                           |
| email           | VARCHAR   | Unique, required                         |
| password        | VARCHAR   | Hashed (bcrypt, 10 rounds)               |
| firstName       | VARCHAR   | Nullable                                 |
| lastName        | VARCHAR   | Nullable                                 |
| emailConfirmed  | BOOLEAN   | Default: false                           |
| subscription    | ENUM      | `free`, `free-trial`, `pro`, `cancelled` |
| nextPaymentDate | TIMESTAMP | Nullable                                 |
| trialEndsDate   | TIMESTAMP | Nullable                                 |
| role            | ENUM      | `user`, `admin`. Default: `user`         |
| notification    | BOOLEAN   | Default: true                            |
| createdAt       | TIMESTAMP | Auto-generated                           |

### weekly_streaks

| Column | Type      | Notes               |
| ------ | --------- | ------------------- |
| id     | UUID (PK) |                     |
| userId | UUID (FK) | References users.id |
| date   | TIMESTAMP |                     |

### verification_tokens

| Column    | Type      | Notes               |
| --------- | --------- | ------------------- |
| id        | UUID (PK) |                     |
| userId    | UUID (FK) | References users.id |
| token     | VARCHAR   | Unique              |
| expiresAt | TIMESTAMP | 24-hour TTL         |
| createdAt | TIMESTAMP |                     |

> **Note:** `conversations` and `messages` tables are not yet implemented. The chat endpoint is stateless — the client sends full message history in each request.

---

## API Endpoints

All endpoints prefixed with base URL. Authenticated endpoints require: `Authorization: Bearer <jwt-token>`

### Auth

#### `POST /auth/register`

```
Request:  { email: string, password: string }
Response: { token: string, user: User }
Status:   201
```

- Password min 6 characters
- Hash password with bcrypt (10 rounds)
- Generate JWT token
- Return full user object

#### `POST /auth/login`

```
Request:  { email: string, password: string }
Response: { token: string, user: User }
```

- Validate credentials
- Generate JWT token
- Include weeklyStreak array in user response

#### `POST /auth/logout`

```
Response: { success: boolean, message: string }
```

- JWT is stateless — client should delete token locally
- This endpoint is for API consistency only

#### `POST /auth/google`

```
Request:  { idToken: string, platform: 'android' | 'ios' | 'web', firstName?: string | null, lastName?: string | null }
Response: { token: string, user: User }
```

- Verify Google ID token using `google-auth-library`
- Optional `firstName`/`lastName` are used as fallback if the token payload doesn't include them (needed for some Expo Go flows)
- Token payload claims take priority over client-provided name fields
- If user exists by email: update firstName/lastName if missing, set `emailConfirmed: true`, return with new JWT
- If new user: create with random hashed password (Google users don't use password auth), `emailConfirmed: true`
- **CRITICAL:** Must return both `token` AND full `user` object. If `user` is missing, the app enters an invalid state where `isAuth=true` but `user=null`.

**Google Client IDs required in env:**

- `GOOGLE_WEB_CLIENT_ID` — For Expo Go / web auth
- `GOOGLE_ANDROID_CLIENT_ID` — For Android standalone builds
- `GOOGLE_IOS_CLIENT_ID` — For iOS standalone builds

**Token verification implementation:**

```typescript
import { OAuth2Client } from "google-auth-library";

const CLIENT_IDS = {
  web: process.env.GOOGLE_WEB_CLIENT_ID,
  android: process.env.GOOGLE_ANDROID_CLIENT_ID,
  ios: process.env.GOOGLE_IOS_CLIENT_ID,
};

async function verifyGoogleToken(idToken: string) {
  const client = new OAuth2Client();
  const ticket = await client.verifyIdToken({
    idToken,
    audience: Object.values(CLIENT_IDS).filter(Boolean),
  });
  return ticket.getPayload();
  // payload contains: email, name, picture, sub (Google user ID), email_verified
}
```

**Error responses:**

- 400: "Invalid Google token" — Token verification failed
- 400: "No email in Google token" — Token missing email claim

### Profile (all auth required)

#### `GET /me`

```
Response: { user: User }
```

- Return authenticated user's profile with weeklyStreak array

#### `PATCH /me`

```
Request:  { firstName?: string, lastName?: string }
Response: { success: boolean, message: string, user: User }
```

- At least one field required
- Only `firstName` and `lastName` can be updated via this route
- Fields: min 1 char, max 50 chars

#### `DELETE /me`

```
Request:  { password: string, confirmDelete: true }
Response: { success: boolean, message: string }
```

- Requires password confirmation
- All related data (weeklyStreaks, verificationTokens) cascade deleted

#### `POST /change-email`

```
Request:  { newEmail: string, password: string }
Response: { success: boolean, message: string }
```

- Verify current password before changing
- Check new email not already in use
- Set `emailConfirmed = false` after change

#### `POST /change-password`

```
Request:  { currentPassword: string, newPassword: string }
Response: { success: boolean, message: string }
```

- newPassword min 6 characters

#### `POST /send-verification`

```
Request:  { email: string }
Response: { success: boolean, message: string }
```

- Verifies the email matches the authenticated user's account
- Deletes any existing verification tokens for user
- Generates new token with 24-hour expiry
- Sends verification email via SMTP

#### `POST /verify-email`

```
Request:  { token: string }
Response: { success: boolean, message: string }
```

- Validates token and expiry
- Sets `emailConfirmed = true`
- Deletes used token

### Chat (auth required)

#### `POST /chat/stream`

SSE endpoint. Client sends the full message history; backend streams the AI response. **No server-side conversation persistence.**

```
Request:  { messages: Array<{ role: 'user' | 'assistant', content: string }> }
```

- `messages` array: 1–100 items, each content max 10,000 chars
- Auth required

**Response headers:**

```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
```

**SSE event format:**

```
data: {"type":"token","content":"<token_text>"}\n\n   (streamed tokens)
data: {"type":"done"}\n\n                               (stream complete)
data: [DONE]\n\n                                        (end signal)
data: {"type":"error","content":"<description>"}\n\n   (on error)
```

**Implementation:**

1. Validate messages array
2. Build system prompt + message history via `buildChatMessages()`
3. Call OpenAI with streaming enabled via `streamChatResponse()`
4. Write each token as an SSE event
5. Send `done` then `[DONE]`, close stream
6. Keep-alive: write `: keepalive\n\n` every 15 seconds
7. Clean up interval on client disconnect

### Subscription (auth required)

#### `POST /subscription/verify`

```
Request:  { purchaseToken: string, productId: string }
Response: { success: boolean, message: string, user: User }
```

- Verify Google Play purchase via Android Publisher API
- Checks `paymentState === 1` (payment received)
- Updates user `subscription: 'pro'` and `nextPaymentDate` from `expiryTimeMillis`

### Streak (auth required)

#### `GET /streak`

```
Response: {
  streak: [
    { day: "monday", date: "2026-01-26", visited: boolean },
    ...
    { day: "sunday", date: "2026-02-01", visited: boolean }
  ],
  totalVisits: number
}
```

- Returns current week (Monday–Sunday UTC) with visited status
- Dates in `YYYY-MM-DD` format

#### `POST /streak/check-in`

```
Request:  {} (empty body)
Response: {
  success: boolean,
  message: "Check-in recorded" | "Already checked in today",
  streak: [...],
  totalVisits: number
}
```

- Idempotent — safe to call multiple times per day
- Returns updated streak for the current week

### Feedback (NO AUTH REQUIRED)

#### `POST /feedback`

```
Request:  { feedback?: string, rating?: number, name?: string }
Response: { success: boolean, message?: string }
```

- No authentication required — accessible to all users including guests
- Appends row to Google Sheets "Calmisu feedbacks"
- Rating: `0 = Poor`, `1 = Average`, `2 = Great`
- All fields optional
- Google Sheets columns: Name, Timestamp, Rating, Feedbacks

**Env vars required:**

- `GOOGLE_SHEETS_PRIVATE_KEY`
- `GOOGLE_SHEETS_CLIENT_EMAIL`
- `GOOGLE_SHEETS_SPREADSHEET_ID`

### Health Check

#### `GET /health`

```
Response: { status: "ok" }
```

---

## Response Formats

### User object (returned in auth responses)

```json
{
  "firstName": "string | null",
  "lastName": "string | null",
  "email": "string",
  "emailConfirmed": "boolean",
  "subscription": "free | free-trial | pro | cancelled",
  "nextPaymentDate": "ISO string | null",
  "trialEndsDate": "ISO string | null",
  "weeklyStreak": [{ "date": "ISO string" }],
  "role": "user | admin",
  "notification": "boolean",
  "createdAt": "ISO string"
}
```

### WeeklyStreakDay object

```json
{
  "day": "monday | tuesday | wednesday | thursday | friday | saturday | sunday",
  "date": "YYYY-MM-DD",
  "visited": "boolean"
}
```

### Error response (all error cases)

```json
{
  "message": "Human-readable error message",
  "statusCode": 400
}
```

Status codes: 400 (validation), 401 (unauthorized), 403 (forbidden), 404 (not found), 500 (server error)

---

## Security Rules

- Hash passwords with bcrypt (10 rounds)
- JWT tokens expire in 7 days (`JWT_EXPIRES_IN`)
- Never return password hash in any response
- Validate file uploads: accept only audio/m4a, audio/mp4, audio/mpeg; max 10MB
- Sanitize all user input before storing
- On 401: client clears local auth state and redirects to login

---

## AI Chat System Prompt

The AI assistant is named **Calmisu** — a calming, supportive mental wellness companion:

```
You are Calmisu, a gentle and supportive mental wellness companion. You:
- Listen with empathy and validate feelings
- Ask thoughtful follow-up questions
- Suggest grounding techniques, breathing exercises, or mindfulness practices when appropriate
- Never diagnose or replace professional mental health support
- Keep responses concise (2-4 sentences unless the user needs more)
- Use a warm, calm tone
```

---

## Environment Variables

```env
# Database
DATABASE_URL=postgresql://...  # or file:./prisma/test.db for local SQLite

# JWT
JWT_SECRET=your-secret-key
JWT_EXPIRES_IN=7d

# OpenAI
OPENAI_API_KEY=sk-...

# AWS S3 (audio uploads)
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=us-east-1
AWS_S3_BUCKET=...

# SMTP (email verification)
SMTP_HOST=...
SMTP_PORT=587
SMTP_USER=...
SMTP_PASS=...
SMTP_FROM=noreply@example.com

# Google OAuth
GOOGLE_WEB_CLIENT_ID=...
GOOGLE_ANDROID_CLIENT_ID=...
GOOGLE_IOS_CLIENT_ID=...

# Google Play (subscription verification)
GOOGLE_SERVICE_ACCOUNT_KEY={"type":"service_account",...}  # JSON string
ANDROID_PACKAGE_NAME=com.yourapp.kumo

# Google Sheets (feedback)
GOOGLE_SHEETS_PRIVATE_KEY=...
GOOGLE_SHEETS_CLIENT_EMAIL=...
GOOGLE_SHEETS_SPREADSHEET_ID=...

# Server
PORT=3001
NODE_ENV=development
```

> External service env vars (AWS, SMTP, OpenAI, Google Play, Google Sheets) are only required in production. Services are lazy-initialized — the server starts without them.

---

## Local Development (SQLite, no external services)

The backend runs locally with SQLite instead of PostgreSQL. Server runs on **port 3001**.

### Files

| File                        | Purpose                                                     |
| --------------------------- | ----------------------------------------------------------- |
| `prisma/schema.prisma`      | Production PostgreSQL schema                                |
| `prisma/schema.test.prisma` | SQLite version (enums replaced with `String`)               |
| `.env`                      | Dev env: `DATABASE_URL=file:./prisma/test.db`, port 3001    |
| `prisma/seed.ts`            | Seed script: 3 users, 2 conversations, 4 messages, 5 streaks |

### Scripts

```bash
npm run db:local:generate  # Generate Prisma client for SQLite
npm run db:local:push      # Create/sync SQLite tables
npm run db:local:seed      # Populate with test data
npm run db:local:studio    # Open Prisma Studio for SQLite
npm run db:local:setup     # Run generate + push + seed in one command
npm run dev                # Start dev server on port 3001
```

### First-time setup

```bash
npm install
npm run db:local:setup
npm run dev
```

### Test credentials

All seeded users share the password `Password123!`:

| Email          | Role  | Subscription |
| -------------- | ----- | ------------ |
| alice@test.com | user  | pro          |
| bob@test.com   | user  | free         |
| admin@test.com | admin | pro          |

### Notes

- SQLite does not support Prisma enums; the test schema uses `String` fields instead
- The Prisma plugin (`src/plugins/prisma.ts`) resolves SQLite `file:` paths to absolute paths at runtime
- `prisma/test.db` and `.env.test` are in `.gitignore`

---

## Implementation Notes

- All dates must be ISO 8601 strings in responses
- Use UUIDs (v4) for all IDs
- **CRITICAL: All auth endpoints (`/auth/login`, `/auth/register`, `/auth/google`) MUST return the full `user` object alongside the token.** The mobile app sets `isAuth=true` and `user` from the same response. If `user` is missing, the app enters an invalid state where `isAuth=true` but `user=null`.
- SSE keep-alive: send `: keepalive\n\n` every 15s to prevent timeout
- The stream endpoint handles client disconnect gracefully (clears keep-alive interval on `request.raw.on('close', ...)`)
- Chat is stateless — the client owns conversation history and sends it with each stream request
