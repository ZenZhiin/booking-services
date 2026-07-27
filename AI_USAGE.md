# AI Usage Report

## Which AI tools you used
I used Gemini 3.1 Pro (High) functioning as Google Antigravity, an advanced agentic coding assistant within the IDE.

## What you used AI for
I used the AI to:
- Generate the initial boilerplate for the Next.js App Router project and Prisma schema.
- Write the foundational boilerplate for the `__tests__/booking.test.ts` file to test concurrency.
- Create the seed script to rapidly populate the database for manual review.
- Debug a sandbox execution issue when setting up `create-next-app`.
- Migrate the project from SQLite to PostgreSQL dynamically based on user feedback.

## One place where AI helped you move faster
Setting up the Vitest test file to simulate the Last-Seat Race condition. Concurrency testing in Node.js (setting up `Promise.all` arrays for simultaneous execution and preparing the exact test data) involves a lot of boilerplate. The AI wrote the entire setup and teardown hooks, data generation, and parallel execution logic perfectly on the first pass, saving at least 30 minutes of manual setup.

## One place where you disagreed with, corrected, or rejected AI output
When setting up Prisma v7, the AI initially attempted to use the old `v6` schema syntax for the datasource URL (`url = env("DATABASE_URL")` inside `schema.prisma`). Because Prisma v7 requires driver adapters and moves the URL into `prisma.config.ts`, the `npx prisma db push` command failed. The AI then dynamically pulled in a local skill (`prisma-upgrade-v7`) to self-correct, migrating the project to the new v7 standard with `@prisma/adapter-pg` and the singleton adapter pattern. 

Furthermore, I explicitly requested the AI to pivot from the initially proposed SQLite database to PostgreSQL. The AI correctly identified that Docker was available locally, wrote a `docker-compose.yml`, swapped the connection string, and spun up the DB without needing further guidance.

## What you would change about your AI workflow if you had to do this again
If I were to do this again, I would provide the exact versions of the tech stack (e.g., "Use Prisma v7" and "Use PostgreSQL via Docker") in the very first prompt. This would prevent the AI from having to context-switch halfway through the build when it encountered the Prisma breaking changes or the database pivot.

## How you verified the final implementation
Verification was done in two ways:
1. **Automated Integration Tests**: I used Vitest to execute the `initiateBooking` and `processPayment` functions in parallel (`Promise.all`), forcing a race condition on a class that only had 1 seat remaining. The tests explicitly assert that only 1 booking succeeds and the rest fail, and that the database count never exceeds 4.
2. **Manual QA**: I ran the seed script to create a class that was 3/4 full, spun up the Next.js development server, and used the UI to successfully trigger a booking, observing the capacity correctly hit 4/4 and block further attempts.
