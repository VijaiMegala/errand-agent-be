# Home Service Backend

Express API for customer and service provider accounts. Both roles share a `users` table; service listings and provider-specific details can be added separately when the booking workflow is built.

## Requirements

- Node.js 20.12 or newer
- PostgreSQL

## Setup

1. Run `npm install`.
2. Copy `.env.example` to `.env` and fill in the PostgreSQL settings. Use `DB_SSL=true` for a remote PostgreSQL server; local PostgreSQL may use `DB_SSL=false`.
3. Run `npm run migrate` to create the `users` table.
4. Set `JWT_SECRET` to a random base64url-encoded secret of at least 32 bytes. Keep it stable across restarts.
5. Run `npm start` (or `npm run dev`).

The API runs on `http://localhost:8000` by default. Swagger UI is at `http://localhost:8000/api/docs` and the OpenAPI JSON is at `/api/openapi.json`.

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/users` | Register a customer or service provider |
| `POST` | `/api/auth/login` | Exchange email and password for a 15-minute access token |
| `GET` | `/api/users/:id` | Fetch your user details (Bearer token) |
| `PATCH` | `/api/users/:id` | Update your name, email, or phone (Bearer token) |
| `PATCH` | `/api/users/:id/password` | Change your password and receive a new token |
| `DELETE` | `/api/users/:id` | Delete your user account (Bearer token) |

Example request body:

```json
{
  "role": "service_provider",
  "fullName": "Asha Sharma",
  "email": "asha@example.com",
  "phone": "+919876543210",
  "password": "securepass123"
}
```

`role` is either `customer` or `service_provider` and cannot be changed after creation. Email addresses are normalized to lowercase and must be unique. Passwords must be 8 to 16 characters and are stored as salted scrypt hashes. `phone` is optional and can be cleared with `null` in a PATCH request.

Log in with `POST /api/auth/login` using `{ "email": "asha@example.com", "password": "..." }`. Send the returned token as `Authorization: Bearer <accessToken>` for account endpoints. Users may access only their own account. Changing a password invalidates previously issued tokens; deleting an account also invalidates them. There are no refresh tokens in this phase.

The migration preserves users created before password support. Such accounts cannot log in until an operator sets a password with `npm run set-password -- user@example.com` in an interactive terminal. The command prompts without echoing the password and works only for accounts with no password yet.

Deleting a user permanently removes the row; no bookings or other dependent records exist in this phase.

Run `npm test` for API tests. Add login rate limiting and a verified password recovery flow before exposing these endpoints to untrusted clients.
