import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { initiateBooking, processPayment } from '../app/actions/booking'
import { prisma } from '../lib/prisma'

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn()
}))

describe('Trial Booking Race Conditions', () => {
  let parent: any
  let classWith1SeatLeft: any
  
  beforeEach(async () => {
    // Clear bookings
    await prisma.paymentAttempt.deleteMany()
    await prisma.booking.deleteMany()
    await prisma.trialClass.deleteMany()
    await prisma.student.deleteMany()
    await prisma.parent.deleteMany()

    parent = await prisma.parent.create({
      data: {
        name: 'Test Parent',
        email: 'test@example.com',
        students: {
          create: [
            { name: 'Student A' },
            { name: 'Student B' },
            { name: 'Student C' },
            { name: 'Student D' },
            { name: 'Student E' },
          ]
        }
      },
      include: { students: true }
    })

    // Create a class
    classWith1SeatLeft = await prisma.trialClass.create({
      data: {
        startTime: new Date(),
        capacity: 4
      }
    })

    // Fill 3 seats (leaving only 1 left)
    const dummyStudents = parent.students.slice(0, 3)
    for (const st of dummyStudents) {
      await prisma.booking.create({
        data: {
          studentId: st.id,
          trialClassId: classWith1SeatLeft.id,
          status: 'CONFIRMED'
        }
      })
    }
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('prevents overbooking under high concurrency (Last-Seat Race)', async () => {
    // We have 1 seat left. Two users try to book at the exact same time.
    const studentA = parent.students[3]
    const studentB = parent.students[4]

    // Both initiate bookings (PENDING_PAYMENT)
    const resA = await initiateBooking(studentA.id, classWith1SeatLeft.id)
    const resB = await initiateBooking(studentB.id, classWith1SeatLeft.id)

    expect(resA.error).toBeUndefined()
    expect(resB.error).toBeUndefined()

    // Both process payments concurrently. We expect exactly one to succeed and one to fail.
    const promises = [
      processPayment(resA.booking!.id),
      processPayment(resB.booking!.id)
    ]

    const results = await Promise.all(promises)

    const successes = results.filter(r => r.success)
    const errors = results.filter(r => r.error)

    expect(successes.length).toBe(1)
    expect(errors.length).toBe(1)
    
    // Check that total confirmed is exactly 4
    const confirmedCount = await prisma.booking.count({
      where: {
        trialClassId: classWith1SeatLeft.id,
        status: 'CONFIRMED'
      }
    })

    expect(confirmedCount).toBe(4)
  })

  it('prevents duplicate confirmed bookings for the same child', async () => {
    const studentA = parent.students[3]
    
    // Initiate and confirm booking
    const resA = await initiateBooking(studentA.id, classWith1SeatLeft.id)
    await processPayment(resA.booking!.id)
    
    // Try to initiate booking again for the same child and class
    const resB = await initiateBooking(studentA.id, classWith1SeatLeft.id)
    expect(resB.error).toBe('Student is already confirmed for this class.')
  })
})
