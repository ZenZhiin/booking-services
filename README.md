# Ottodot Trial Booking System

This project is a minimal, backend-focused slice of the Ottodot Trial Booking system. It guarantees reliability under race conditions, handles payment failures gracefully, and prevents double bookings.

## How to Run the Solution

### Prerequisites
- Node.js (v20+)
- Docker (for PostgreSQL)

### Setup Steps
1. **Start the Database**
   ```bash
   docker-compose up -d
   ```
2. **Install Dependencies**
   ```bash
   npm install
   ```
3. **Run Prisma Migrations & Seed Database**
   ```bash
   npx prisma db push
   npx prisma generate
   npx tsx --env-file=.env prisma/seed.ts
   ```
   *This seeds a parent, students, and two trial classes (one empty, one with 3/4 seats taken).*
4. **Start the Application**
   ```bash
   npm run dev
   ```
   *Open `http://localhost:3000` to interact with the UI.*

### Running the Tests
To verify the core invariants (especially the Last-Seat Race condition), run:
```bash
npx vitest run
```

---

## What I Built
I built a Next.js (App Router) full-stack application using Server Actions to handle backend logic, with a PostgreSQL database managed by Prisma. 

It includes:
- A data model for Parents, Students, TrialClasses, Bookings, and PaymentAttempts.
- A minimal React UI to initiate a booking.
- A robust, transactional server action to handle the exact moment a booking goes from `PENDING_PAYMENT` to `CONFIRMED`.
- A Vitest test suite explicitly proving the concurrency invariants.

## Time Spent
Roughly 1.5 - 2 hours on architecture design, prompt iterations, configuring Prisma v7, Docker setup, UI implementation, and writing concurrency tests.

---

## Backend Design Requirements

### Data Model
- **Parent**: `id`, `name`, `email`
- **Student**: `id`, `parentId`, `name`
- **TrialClass**: `id`, `startTime`, `capacity` (default 4)
- **Booking**: `id`, `studentId`, `trialClassId`, `status` (`PENDING_PAYMENT`, `CONFIRMED`, `PAYMENT_FAILED`, `CANCELLED`)
  - *Constraint*: `@@unique([studentId, trialClassId])` guarantees one booking attempt (active or otherwise) per student per class, preventing duplicates inherently.
- **PaymentAttempt**: `id`, `bookingId`, `status`, `amount`, `createdAt`

### Key API / Server Actions
All logic resides in `app/actions/booking.ts`:
1. `initiateBooking(studentId, trialClassId)`: Verifies if a confirmed booking already exists. If not, creates or resets a booking to `PENDING_PAYMENT`.
2. `processPayment(bookingId)`: Simulates a 1-second mock payment, records a `PaymentAttempt`, and then atomically attempts to set the booking to `CONFIRMED`.

### Invariants & Edge Cases
- **Duplicate Bookings**: A Prisma `@@unique` constraint on `[studentId, trialClassId]` combined with a `status === 'CONFIRMED'` check before proceeding prevents a child from double-booking.
- **Payment Failure**: If payment fails (or if the class fills up before payment finishes), the booking status transitions to `PAYMENT_FAILED`. It does not count towards the class capacity, meaning the child is NOT incorrectly added to the roster.
- **Which checks belong where**:
  - *UI*: Fast feedback, disabling buttons during load, basic validation (e.g. must select child).
  - *Backend*: Core business rules (does this student already have a booking, is the class full).
  - *Database*: Concurrency guarantees (atomic locks / conditional updates) and unique constraint guarantees.

---

## Required Technical Scenario: Last-Seat Race

### Scenario
User A and User B both select the same last available slot. Both transition their booking to `PENDING_PAYMENT`. User B completes payment first. User A completes payment second.

### Approach Chosen
I used a **Database-Level Atomic Conditional Update** using a raw SQL query. 
Instead of a `SELECT count` followed by an `UPDATE` (which introduces a Time-Of-Check to Time-Of-Use vulnerability), the backend executes a single atomic statement:

```sql
UPDATE "Booking"
SET "status" = 'CONFIRMED'
WHERE "id" = $1
AND (
    SELECT COUNT(*)
    FROM "Booking"
    WHERE "trialClassId" = $2 AND "status" = 'CONFIRMED'
) < 4;
```

If User B hits this first, the subquery returns 3, the condition passes, and the database updates 1 row.
When User A's transaction hits the database a few milliseconds later, the subquery returns 4. The condition evaluates to false, and the database updates **0 rows**. 

The application code detects that 0 rows were updated, deduces the class filled up during the payment step, transitions User A's booking to `PAYMENT_FAILED`, and issues a refund notification.

### Why I Chose It
- It relies on PostgreSQL's inherent atomic record locking during `UPDATE` queries. 
- It requires no distributed locks (like Redis Mutexes) or complex application-level state.
- It is perfectly immune to server scaling issues (e.g., if User A and User B hit different Node.js instances).

### Tradeoffs Accepted
- **Raw SQL**: Because Prisma's standard ORM methods (`prisma.booking.update`) cannot do subquery conditional updates in a single statement, I had to drop down to `prisma.$executeRaw`. This slightly reduces ORM type safety for this specific query.
- **Database Load**: While negligible at this scale, running a `COUNT(*)` subquery on every update is technically less efficient than maintaining a materialized `confirmed_count` integer on the `TrialClass` table and doing an atomic decrement/increment. I chose the subquery for simplicity and correctness (no denormalization required).

---

## Assumptions Made
- A mock payment involves just waiting a bit and assuming success. A real system would use Stripe webhooks.
- The `PENDING_PAYMENT` state acts as an intent, but does *not* reserve a seat. Seats are first-pay, first-serve.

## What I Deliberately Cut
- **Authentication**: There is no login flow. You simply select a student from a dropdown on the UI.
- **Extensive UI Polish**: I used minimal Tailwind classes to make it readable, but focused the vast majority of time on the backend and test suite.
- **Webhooks**: Stripe webhook handling was substituted with a simulated server sleep.

## What I Would Monitor After Release
1. **Overbooking Errors**: I would monitor logs for the exact error path where `updatedRows === 0`. If this happens frequently, it means demand is very high and the user experience is degrading (users paying and then getting rejected). We might need a temporary 10-minute hold feature instead of first-pay first-serve.
2. **Payment Abandonment Rate**: How many bookings stay in `PENDING_PAYMENT` forever?

## What I Would Do Next With More Time
1. **Implement Stripe integration**: Properly handle `payment_intent.succeeded` webhooks to drive the atomic update, ensuring no dropped payments.
2. **Seat Reservation (Hold)**: Transition from "first-pay first-serve" to "hold a seat for 10 minutes while paying" using Redis or a `holdExpiresAt` timestamp on the Booking table.
3. **Full UI/UX**: Build a proper calendar picker for classes and a secure checkout flow.
4. **Admin Dashboard**: Build out a dedicated UI route for teachers to view the roster. (Currently, the dashboard just lists it plainly).
