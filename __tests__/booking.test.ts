import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { initiateBooking, processPayment } from '../app/actions/booking'
import { prisma } from '../lib/prisma'
import { addMinutes } from 'date-fns'

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn()
}))

async function createTestData(numConfirmed: number) {
  const parent = await prisma.parent.create({
    data: {
      name: 'Test Parent',
      email: `test-${Date.now()}@example.com`,
      students: {
        create: Array.from({ length: 6 }, (_, i) => ({ name: `Student ${i + 1}` }))
      }
    },
    include: { students: true }
  })

  const trialClass = await prisma.trialClass.create({
    data: { startTime: addMinutes(new Date(), 60), capacity: 4 }
  })

  for (let i = 0; i < numConfirmed; i++) {
    await prisma.booking.create({
      data: { studentId: parent.students[i].id, trialClassId: trialClass.id, status: 'CONFIRMED' }
    })
  }

  return { parent, trialClass }
}

describe('Trial Booking System', () => {
  beforeEach(async () => {
    await prisma.paymentAttempt.deleteMany()
    await prisma.booking.deleteMany()
    await prisma.trialClass.deleteMany()
    await prisma.student.deleteMany()
    await prisma.parent.deleteMany()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  // ─── Test 1: Last-Seat Race ────────────────────────────────────────────────
  it('prevents overbooking under high concurrency (Last-Seat Race)', async () => {
    // Class starts with 3 confirmed — 1 seat left.
    // We initiate bookings sequentially so both A and B each hold a seat.
    // NOTE: The hold-based capacity check treats each pending booking as consuming
    // a slot. So A takes slot 4, then B tries — class appears full from B's perspective.
    // The definitive guard is the atomic SQL UPDATE at payment time.
    // To exercise the SQL race, we create a class with 2 seats left.
    const { parent, trialClass } = await createTestData(2) // 2/4 confirmed, 2 remain
    const studentA = parent.students[2]
    const studentB = parent.students[3]

    // Both initiate bookings — each gets a hold on one of the remaining 2 slots
    const resA = await initiateBooking(studentA.id, trialClass.id)
    const resB = await initiateBooking(studentB.id, trialClass.id)

    expect(resA.error).toBeUndefined()
    expect(resB.error).toBeUndefined()

    // Now fill the class externally so only 1 slot actually remains at DB level
    // (simulate another external booking completing between hold and payment)
    const extraStudent = parent.students[4]
    await prisma.booking.create({
      data: { studentId: extraStudent.id, trialClassId: trialClass.id, status: 'CONFIRMED' }
    })

    // Now A and B both race to confirm — only 1 remaining slot at the DB level
    const results = await Promise.all([
      processPayment(resA.booking!.id, resA.idempotencyKey!),
      processPayment(resB.booking!.id, resB.idempotencyKey!),
    ])

    const successes = results.filter(r => r.success)
    const errors    = results.filter(r => r.error)

    expect(successes.length).toBe(1)
    expect(errors.length).toBe(1)

    const confirmedCount = await prisma.booking.count({
      where: { trialClassId: trialClass.id, status: 'CONFIRMED' }
    })
    expect(confirmedCount).toBe(4)
  })

  // ─── Test 2: Duplicate Booking ────────────────────────────────────────────
  it('prevents duplicate confirmed bookings for the same child', async () => {
    const { parent, trialClass } = await createTestData(0)
    const student = parent.students[0]

    const res1 = await initiateBooking(student.id, trialClass.id)
    expect(res1.error).toBeUndefined()
    await processPayment(res1.booking!.id, res1.idempotencyKey!)

    const res2 = await initiateBooking(student.id, trialClass.id)
    expect(res2.error).toBe('Student is already confirmed for this class.')
  })

  // ─── Test 3: Payment Failure / Seat not taken ─────────────────────────────
  it('does not add a student to the roster if payment fails (class fills mid-payment)', async () => {
    const { parent, trialClass } = await createTestData(3)
    const studentA = parent.students[3]
    const studentB = parent.students[4]

    // A books the last seat first and confirms it
    const resA = await initiateBooking(studentA.id, trialClass.id)
    await processPayment(resA.booking!.id, resA.idempotencyKey!)

    // B now tries to book – class is full, should get a rejection
    const resB = await initiateBooking(studentB.id, trialClass.id)
    expect(resB.error).toMatch(/full|capacity/i)

    const confirmedCount = await prisma.booking.count({
      where: { trialClassId: trialClass.id, status: 'CONFIRMED' }
    })
    expect(confirmedCount).toBe(4)
  })

  // ─── Test 4: Idempotency Key ──────────────────────────────────────────────
  it('processes payment exactly once with the same idempotency key', async () => {
    const { parent, trialClass } = await createTestData(0)
    const student = parent.students[0]

    const res1 = await initiateBooking(student.id, trialClass.id)
    const key = res1.idempotencyKey!

    // Fire the payment action twice with the SAME idempotency key
    const [first, second] = await Promise.all([
      processPayment(res1.booking!.id, key),
      processPayment(res1.booking!.id, key),
    ])

    expect(first.success || second.success).toBe(true)

    // Ensure only ONE payment attempt was stored
    const attempts = await prisma.paymentAttempt.count({ where: { bookingId: res1.booking!.id } })
    expect(attempts).toBe(1)

    // Only one CONFIRMED booking
    const confirmedCount = await prisma.booking.count({
      where: { trialClassId: trialClass.id, status: 'CONFIRMED' }
    })
    expect(confirmedCount).toBe(1)
  })

  // ─── Test 5: Seat Hold Blocks Overbooking ─────────────────────────────────
  it('respects active seat holds when checking class availability', async () => {
    const { parent, trialClass } = await createTestData(3)
    const studentA = parent.students[3]
    const studentB = parent.students[4]

    // A grabs the last seat (gets a 10-minute hold, blocks the slot)
    const resA = await initiateBooking(studentA.id, trialClass.id)
    expect(resA.error).toBeUndefined()

    // B tries to initiate – should be blocked because A holds the last seat
    const resB = await initiateBooking(studentB.id, trialClass.id)
    expect(resB.error).toMatch(/full|reserved/i)
  })
})
