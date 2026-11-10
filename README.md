# Home Service Backend

Express API for customer and service provider accounts. Login details live in `users`; a provider listing lives in `providers` and references its owner through `providers.user_id`.

## Requirements

- Node.js 20.12 or newer
- PostgreSQL

## Setup

1. Run `npm install`.
2. Copy `.env.example` to `.env` and fill in the PostgreSQL settings. Use `DB_SSL=true` for a remote PostgreSQL server; local PostgreSQL may use `DB_SSL=false`.
3. Run `npm run migrate` to create the user and provider tables.
4. Set `JWT_SECRET` to a random base64url-encoded secret of at least 32 bytes. Keep it stable across restarts.
5. Run `npm start` (or `npm run dev`).

The API runs on `http://localhost:8000` by default. Swagger UI is at `http://localhost:8000/api/docs` and the OpenAPI JSON is at `/api/openapi.json`.

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/users` | Register a customer or service provider |
| `GET` | `/api/users?role=customer&limit=20&offset=0` | Admin lists users |
| `POST` | `/api/auth/login` | Exchange email and password for a 15-minute access token |
| `GET` | `/api/users/:id` | Fetch your own details, or any user's details as admin |
| `PATCH` | `/api/users/:id` | Update your own details, or any user's details as admin |
| `PATCH` | `/api/users/:id/password` | Change your password and receive a new token |
| `DELETE` | `/api/users/:id` | Delete your own account, or any account as admin |
| `POST` | `/api/providers/:providerId/services` | Provider owner creates a priced service |
| `GET` | `/api/providers/:providerId/services` | List active services |
| `POST` | `/api/providers/:providerId/slots` | Provider owner creates an available slot |
| `GET` | `/api/providers/:providerId/slots` | List upcoming slots |
| `POST` | `/api/providers/:providerId/bookings` | Customer holds a time for ten minutes |
| `GET` | `/api/bookings` | Customer lists their bookings |
| `PATCH` | `/api/bookings/:bookingId/reschedule` | Customer reschedules their rejected booking |
| `GET` | `/api/providers/:providerId/bookings` | Provider lists booking requests |
| `PATCH` | `/api/providers/:providerId/bookings/:bookingId/accept` | Provider accepts an active hold |
| `PATCH` | `/api/providers/:providerId/bookings/:bookingId/reject` | Provider rejects an active hold |
| `POST` | `/api/providers/:providerId/reviews` | Customer adds a review |
| `GET` | `/api/providers/:providerId/reviews` | List recent reviews |

Example request body:

```json
{
  "role": "service_provider",
  "fullName": "Asha Sharma",
  "email": "asha@example.com",
  "phone": "+919876543210",
  "password": "securepass123",
  "providerDetails": {
    "serviceType": "Plumbing",
    "serviceArea": "Indiranagar",
    "basePrice": 1200,
    "attributes": { "emergencyService": true }
  }
}
```

Public registration accepts `customer` or `service_provider`; it cannot create an admin. A user's role cannot be changed through the API. `providerDetails` is optional for a service provider and is not accepted for a customer. When supplied at registration, the user and provider listing are created in one transaction. Email addresses are normalized to lowercase and must be unique. Passwords must be 8 to 16 characters and are stored as salted scrypt hashes. `phone` is optional and can be cleared with `null` in a PATCH request.

For a service provider, `GET /api/users/:id` includes `providerDetails` with the provider ID and listing fields. If no listing has been created, `providerDetails` is `null` until they submit the three required listing fields through `PATCH /api/users/:id`. Later PATCH requests can change one or more listing fields without resubmitting the rest. The provider ID is separate from the user ID and will be used by slots, reviews, and booking tools.

The provider ID comes from `providerDetails.id`. A provider owner can create a service with `{ "name": "Kitchen tap repair", "price": 1200, "durationMinutes": 60, "description": "Fix a leaking tap" }`. They can create an availability window with ISO timestamps such as `{ "startsAt": "2026-12-01T10:00:00+05:30", "endsAt": "2026-12-01T17:00:00+05:30" }`. Windows must be in the future, last no more than 24 hours, and not overlap another window for that provider. The provider chooses specific days by creating windows on those dates.

A customer holds a time within a window using `{ "slotId": "<availability UUID>", "serviceId": "<service UUID>", "startsAt": "2026-12-01T10:30:00+05:30" }` at `POST /api/providers/:providerId/bookings`. The end time follows the service duration. The response has `status: "held"` and `holdExpiresAt` ten minutes later. The provider owner sees the request at `GET /api/providers/:providerId/bookings` and accepts or rejects it before that deadline. Acceptance confirms the booking; rejection frees the time immediately. Customers cannot accept or reject. The database checks that the time fits availability and does not overlap a confirmed booking or unexpired hold, including concurrent requests. A conflict returns HTTP 409. Expired holds stop blocking immediately, and booking lists report them as `expired`. Adjacent bookings are allowed.

If the provider rejects a booking, its customer can call `PATCH /api/bookings/:bookingId/reschedule` with a new `slotId`, `serviceId`, and `startsAt` for the same provider. The booking ID stays the same, its status returns to `held`, and a new ten-minute hold begins. The provider must decide again. Confirmed, held, cancelled, and expired bookings cannot use this route.

Only an authenticated customer can add a review with `{ "rating": 5, "reviewText": "Helpful technician" }`. The reviewer ID is taken from the access token; it is not accepted in the request. Reviews can be read without a token. Reviews are not currently restricted to customers with a completed booking.

`provider_services` stores individual priced offerings. `providers.service_type` and `providers.base_price` remain the provider's general specialty and starting price for compatibility with existing accounts.

Log in with `POST /api/auth/login` using `{ "email": "asha@example.com", "password": "..." }`. Send the returned token as `Authorization: Bearer <accessToken>` for account endpoints. Customers and service providers may access only their own user account. An admin may list, fetch, update, and delete customer and service provider accounts. Password changes still require the account owner's current password. Changing a password invalidates previously issued tokens; deleting an account also invalidates them. There are no refresh tokens in this phase.

Create the first admin from a trusted terminal after running migrations: `npm run create-admin -- admin@example.com "Admin Name"`. The command prompts for a password without echoing it. Admin accounts cannot be created through public registration. Admin tokens do not grant permission to write customer reviews or manage a provider's services and slots; those routes retain their role and ownership rules.

The migration preserves users created before password support. Such accounts cannot log in until an operator sets a password with `npm run set-password -- user@example.com` in an interactive terminal. The command prompts without echoing the password and works only for accounts with no password yet.

Deleting a user permanently removes their bookings and, for providers, their listing, services, slots, and reviews.

Run `npm test` for API tests. Add login rate limiting and a verified password recovery flow before exposing these endpoints to untrusted clients.
