# Ottodot — Trial Booking System

> **Take-Home Task** | Senior Full-Stack Engineer | Timebox: 4 hours

A production-reliable trial booking system built for Ottodot's online science and math classes. Prioritises **backend correctness**, **concurrency safety**, and **edge-case handling** over frontend polish — exactly as the brief requested.

---

## Table of Contents

- [How to Run](#how-to-run)
- [What Was Built](#what-was-built)
- [Architecture & Data Model](#architecture--data-model)
- [Booking Statuses](#booking-statuses)
- [Edge Cases Handled](#edge-cases-handled)
- [The Last-Seat Race Condition](#the-last-seat-race-condition)
- [Idempotency Keys](#idempotency-keys)
- [Seat Hold Pattern](#seat-hold-pattern)
- [Which Checks Belong Where](#which-checks-belong-where)
- [Test Suite](#test-suite)
- [What Was Deliberately Cut](#what-was-deliberately-cut)
- [What I Would Monitor After Release](#what-i-would-monitor-after-release)
- [What I Would Do Next With More Time](#what-i-would-do-next-with-more-time)
- [Time Spent](#time-spent)
- [Assumptions](#assumptions)

---

## How to Run

### Prerequisites
- Node.js v20+
- Docker (for PostgreSQL)

### 1. Start the Database
```bash
docker-compose up -d
```
This spins up a PostgreSQL 15 instance at `localhost:5433`.

### 2. Install Dependencies
```bash
npm install
```

### 3. Apply Schema & Seed Data
```bash
npx prisma db push
npx prisma generate
npm run seed
```

The seed script creates:
- 1 parent (`Jane Doe`, `jane@example.com`) with 2 children (Alice, Bob)
- **Class A**: Empty — 0/4 seats taken
- **Class B**: Near-full — 3/4 seats taken (the "last seat" scenario)

### 4. Run the Tests
```bash
npm test
```

### 5. Start the Application
```bash
npm run dev
```

| Route | Purpose |
|-------|---------|
| `http://localhost:3000` | Parent Booking Portal |
| `http://localhost:3000/admin` | Admin / Teacher Roster Dashboard |

---

## What Was Built

### Core Requirements ✅
- Parent selects a child and picks an available trial class
- Parent submits a trial booking with a mock payment step
- Booking status is shown after submission (CONFIRMED, PAYMENT_FAILED)
- Admin/teacher view shows full class roster at `/admin`

### Edge Cases Handled ✅
| Scenario | How it's handled |
|----------|-----------------|
| Duplicate confirmed booking for same child | Pre-check in `initiateBooking`; `@@unique` DB constraint as backstop |
| Overbooking beyond 4 students | Atomic conditional SQL `UPDATE` at confirmation time |
| Payment failure without roster contamination | Booking stays/transitions to `PAYMENT_FAILED`; never counted as confirmed |
| Last-seat race condition | Atomic SQL with embedded subquery — see below |
| User double-clicks "Pay" | Idempotency key prevents duplicate charge and double-booking |
| Seat held but payment never completes | `holdExpiresAt` expires after 10 minutes, freeing the slot |

---

## Architecture & Data Model

### Tech Stack
- **Framework**: Next.js 16 (App Router) with React Server Actions
- **Database**: PostgreSQL 15 (Docker) via Prisma ORM v7
- **Driver Adapter**: `@prisma/adapter-pg` (Prisma v7 requirement)
- **Testing**: Vitest (integration tests against a live test DB)

### Schema

```prisma
model Parent {
  id       String    @id @default(uuid())
  name     String
  email    String    @unique
  students Student[]
}

model Student {
  id       String    @id @default(uuid())
  parentId String
  name     String
  bookings Booking[]
}

model TrialClass {
  id        String    @id @default(uuid())
  startTime DateTime
  capacity  Int       @default(4)
  bookings  Booking[]
}

model Booking {
  id            String   @id @default(uuid())
  studentId     String
  trialClassId  String
  status        String   // PENDING_PAYMENT | CONFIRMED | PAYMENT_FAILED | CANCELLED
  holdExpiresAt DateTime?

  @@unique([studentId, trialClassId])  // One booking attempt per student per class
}

model PaymentAttempt {
  id             String   @id @default(uuid())
  bookingId      String
  idempotencyKey String?  @unique  // Prevents duplicate charges
  status         String   // SUCCESS | FAILED
  amount         Int
  createdAt      DateTime @default(now())
}
```

### Key API / Server Actions

All backend logic lives in [`app/actions/booking.ts`](./app/actions/booking.ts).

| Action | Purpose |
|--------|---------|
| `initiateBooking(studentId, trialClassId)` | Validates eligibility, checks capacity (incl. active holds), creates a `PENDING_PAYMENT` booking with a 10-minute hold, returns an idempotency key |
| `processPayment(bookingId, idempotencyKey)` | Checks idempotency, simulates payment, atomically confirms booking via raw SQL |
| `getDashboardData()` | Fetches parent/student/class data for the UI (counts confirmed + active holds) |

---

## Booking Statuses

```
PENDING_PAYMENT  ──(payment success + seat available)──► CONFIRMED
                 ──(class full at payment time)────────► PAYMENT_FAILED
                 ──(hold expires, no payment)──────────► (slot freed, booking stale)
```

| Status | Meaning | Counts toward capacity? |
|--------|---------|------------------------|
| `PENDING_PAYMENT` | User is in checkout, hold is active | ✅ Yes (while `holdExpiresAt > NOW()`) |
| `CONFIRMED` | Payment succeeded, seat secured | ✅ Yes |
| `PAYMENT_FAILED` | Payment failed or race condition lost | ❌ No |
| `CANCELLED` | Manually cancelled | ❌ No |

---

## Edge Cases Handled

### 1. Duplicate Confirmed Bookings

Two guards:
1. **Application layer**: `initiateBooking` checks for an existing `CONFIRMED` booking for the same `(student, class)` pair before proceeding.
2. **Database layer**: `@@unique([studentId, trialClassId])` on `Booking` means only one booking record can ever exist per student/class pair.

### 2. Overbooking

Capacity is enforced at two stages:
1. **Initiation**: The capacity count (confirmed + active holds) is checked before creating a `PENDING_PAYMENT` booking. If full, the user is rejected immediately.
2. **Confirmation** (atomic SQL): Even if two users slip through to payment simultaneously, the atomic UPDATE (see below) ensures only one lands as `CONFIRMED`.

### 3. Payment Failure

A failed payment transitions the booking to `PAYMENT_FAILED`. This status is never counted in capacity checks — the student is never on the roster.

---

## The Last-Seat Race Condition

### Scenario
> User A selects the last slot → User B selects the same slot → User B pays first → User A pays second.

### Naive (Broken) Approach
```typescript
// ❌ Race condition — SELECT then UPDATE is NOT atomic
const count = await prisma.booking.count({ where: { status: 'CONFIRMED', trialClassId } })
if (count < 4) {
  await prisma.booking.update({ data: { status: 'CONFIRMED' } })
}
```
Between the `SELECT` and the `UPDATE`, another process can sneak in.

### Our Solution — Atomic Conditional SQL UPDATE

```sql
UPDATE "Booking"
SET "status" = 'CONFIRMED'
WHERE "id" = $bookingId
AND (
    SELECT COUNT(*)
    FROM "Booking"
    WHERE "trialClassId" = $trialClassId
    AND (
        "status" = 'CONFIRMED'
        OR ("status" = 'PENDING_PAYMENT' AND "holdExpiresAt" > NOW())
    )
    AND "id" != $bookingId
) < 4;
```

**Why this works**: PostgreSQL processes this as a single atomic operation. When two connections race:
- **Connection 1 (User B)**: Subquery returns 3 → condition passes → 1 row updated → status = `CONFIRMED`
- **Connection 2 (User A)**: Subquery now returns 4 → condition fails → 0 rows updated → backend detects this and transitions to `PAYMENT_FAILED`

The `rowsAffected` return value from `$executeRaw` is our signal: `0` means the race was lost.

### Tradeoffs
| Decision | Tradeoff |
|----------|---------|
| Raw SQL vs. Prisma ORM | Loses ORM type-safety for this one query; gains unambiguous atomicity |
| `COUNT(*)` subquery on every update | Slightly more DB work than a materialized counter column; simpler and no denormalization required |
| First-pay, first-serve (no pre-reservation) | Simpler architecture; users can lose a seat after starting payment (mitigated by the hold pattern) |

---

## Idempotency Keys

Every `initiateBooking` call returns a client-generated UUID (`idempotencyKey`). This key must be passed to `processPayment`.

**What it prevents**: If a user double-clicks "Pay" or a network retry fires, the second call detects the existing `PaymentAttempt` with that key and returns success immediately — no duplicate charge, no duplicate booking.

**Race handling**: If two concurrent requests somehow share the same key (e.g. from a misbehaving client), the `UNIQUE` DB constraint on `PaymentAttempt.idempotencyKey` ensures only one insert succeeds. The loser catches the `P2002` Prisma error and reads the existing successful attempt.

---

## Seat Hold Pattern

When a user clicks "Reserve Seat & Pay", a hold is immediately placed:
- `booking.status` → `PENDING_PAYMENT`
- `booking.holdExpiresAt` → `NOW() + 10 minutes`

All capacity checks treat active holds as occupied seats. This means User B cannot even initiate a booking while User A holds the last slot.

After 10 minutes, the hold expires and the slot is freed for others — without any background job or cron (expiry is evaluated at query time using `holdExpiresAt > NOW()`).

> **Production note**: In a real system, we'd additionally run a background cleanup job to transition stale `PENDING_PAYMENT` bookings to `CANCELLED` for audit clarity.

---

## Which Checks Belong Where

| Check | Layer | Reason |
|-------|-------|--------|
| Is student already confirmed? | Application (Server Action) | Fast, readable business rule |
| Is capacity full (incl. holds)? | Application (Server Action) | Fast rejection before creating DB records |
| Unique booking per student/class | Database (`@@unique`) | Absolute backstop — cannot be bypassed |
| Seat available at payment time | Database (atomic SQL UPDATE) | Only the DB can guarantee this under concurrency |
| Idempotent payment | Database (`UNIQUE` on idempotencyKey) | Concurrent duplicates must be resolved at DB level |
| Form validation (student selected?) | UI | Immediate feedback, no server round-trip needed |

---

## Test Suite

5 integration tests in [`__tests__/booking.test.ts`](./__tests__/booking.test.ts) that run against the live PostgreSQL database:

```
✓ prevents overbooking under high concurrency (Last-Seat Race)
✓ prevents duplicate confirmed bookings for the same child
✓ does not add a student to the roster if payment fails
✓ processes payment exactly once with the same idempotency key
✓ respects active seat holds when checking class availability
```

Run with:
```bash
npm test
```

Each test uses `beforeEach` to reset the database to a clean state, ensuring tests are fully isolated.

---

## What Was Deliberately Cut

| Feature | Reason |
|---------|--------|
| Authentication / Login | Out of scope for the booking reliability slice |
| Stripe / real payment | Replaced with a 1-second simulated delay |
| Background job for hold cleanup | Holds expire at query time via `holdExpiresAt > NOW()` — sufficient for this scope |
| Per-class configuration (subject, teacher) | Not required by the brief |
| Email notifications | Out of scope |

---

## What I Would Monitor After Release

1. **`PAYMENT_FAILED` where cause = "class full"** — indicates the hold window (10 min) is too short or demand is very high. Alert if this exceeds 5% of payment attempts.
2. **Long-lived `PENDING_PAYMENT` bookings** — a high count means users are abandoning checkout. May indicate UX friction or payment gateway issues.
3. **`idempotencyKey` collision rate** — a non-zero rate would indicate client-side bugs or retry storms.
4. **`$executeRaw` query latency** — the atomic SQL runs on every payment. Alert if P99 exceeds 500ms.

---

## What I Would Do Next With More Time

1. **Stripe Webhooks**: Replace the mock payment with a real `payment_intent.succeeded` webhook handler. The webhook fires the atomic `processPayment` action, ensuring the payment gateway and booking DB are always in sync.
2. **Background Hold Expiry Job**: A cron job (every 5 minutes) that cleans up stale `PENDING_PAYMENT` bookings to `CANCELLED`, keeping the audit trail tidy.
3. **Authentication**: Add NextAuth.js (or Clerk) so parents log in and see only their own children.
4. **Admin Auth**: Protect `/admin` behind a role-based auth check.
5. **Class Management UI**: Allow admins to create/cancel classes, set capacity, assign teachers.

---

## Time Spent

| Phase | Time |
|-------|------|
| Architecture design & plan | ~30 min |
| Infrastructure setup (Next.js, Prisma v7, PostgreSQL, Docker) | ~40 min |
| Backend actions & atomic SQL | ~30 min |
| Test suite (5 tests, concurrency scenarios) | ~25 min |
| UI (parent portal + admin roster) | ~20 min |
| Enhancements (hold, idempotency, polish) | ~35 min |
| Documentation | ~20 min |
| **Total** | **~3.5 hours** |

---

## Assumptions

- **Capacity is per class, not per time slot**: Two classes at the same time each have their own 4-seat cap.
- **First-pay, first-serve (with hold)**: A 10-minute hold prevents most race conditions; the atomic SQL prevents any that slip through.
- **Mock payment always succeeds** (unless the class fills up between hold and payment): A real system would handle payment processor failures explicitly.
- **Single parent per seeding session**: The seed script creates one demo parent. A production system would support many parents with full auth.
