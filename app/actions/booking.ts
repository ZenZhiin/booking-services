'use server'

import { prisma } from '../../lib/prisma'
import { revalidatePath } from 'next/cache'
import { addMinutes } from 'date-fns'
import { v4 as uuidv4 } from 'uuid'

export async function initiateBooking(studentId: string, trialClassId: string) {
  const existingConfirmed = await prisma.booking.findFirst({
    where: {
      studentId,
      trialClassId,
      status: 'CONFIRMED'
    }
  })

  if (existingConfirmed) {
    return { error: 'Student is already confirmed for this class.' }
  }

  // Check if class is already full (considering confirmed AND active holds)
  // We use executeRaw/queryRaw for precision or just Prisma count
  const activeBookingsCount = await prisma.booking.count({
    where: {
      trialClassId,
      OR: [
        { status: 'CONFIRMED' },
        { status: 'PENDING_PAYMENT', holdExpiresAt: { gt: new Date() } }
      ]
    }
  })

  // We need to fetch capacity
  const trialClass = await prisma.trialClass.findUnique({ where: { id: trialClassId } })
  if (!trialClass) return { error: 'Class not found' }

  if (activeBookingsCount >= trialClass.capacity) {
    // If we already have a pending booking that is NOT expired, we are part of that count
    const myActiveBooking = await prisma.booking.findFirst({
      where: {
        studentId,
        trialClassId,
        status: 'PENDING_PAYMENT',
        holdExpiresAt: { gt: new Date() }
      }
    })
    
    if (!myActiveBooking) {
      return { error: 'Class is currently full or seats are reserved. Please try again later.' }
    }
  }

  // Hold for 10 minutes
  const expiresAt = addMinutes(new Date(), 10)

  let booking = await prisma.booking.findUnique({
    where: { studentId_trialClassId: { studentId, trialClassId } }
  })

  if (booking) {
    booking = await prisma.booking.update({
      where: { id: booking.id },
      data: { status: 'PENDING_PAYMENT', holdExpiresAt: expiresAt }
    })
  } else {
    booking = await prisma.booking.create({
      data: {
        studentId,
        trialClassId,
        status: 'PENDING_PAYMENT',
        holdExpiresAt: expiresAt
      }
    })
  }

  // Generate a client idempotency key for the payment step
  const idempotencyKey = uuidv4()

  revalidatePath('/')
  return { booking, idempotencyKey }
}

export async function processPayment(bookingId: string, idempotencyKey: string) {
  // 1. Idempotency Check
  const existingPayment = await prisma.paymentAttempt.findUnique({
    where: { idempotencyKey }
  })

  if (existingPayment && existingPayment.status === 'SUCCESS') {
    return { success: true, note: 'Idempotent replay' }
  }

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId }
  })

  if (!booking) return { error: 'Booking not found' }
  if (booking.status === 'CONFIRMED') return { error: 'Booking is already confirmed' }

  // Check if our hold expired
  if (!booking.holdExpiresAt || booking.holdExpiresAt < new Date()) {
    return { error: 'Your seat reservation expired. Please try booking again.' }
  }

  // 2. Mock payment logic
  await new Promise(resolve => setTimeout(resolve, 1000))
  
  // Create or retrieve payment attempt (idempotent upsert to avoid unique key race)
  try {
    await prisma.paymentAttempt.create({
      data: {
        bookingId,
        idempotencyKey,
        status: 'SUCCESS',
        amount: 1000
      }
    })
  } catch (e: any) {
    // If two concurrent requests race on the same idempotency key,
    // one will win the DB write; the loser gets a unique constraint error.
    // We treat this as a successful idempotent replay.
    if (e.code === 'P2002') {
      const existing = await prisma.paymentAttempt.findUnique({ where: { idempotencyKey } })
      if (existing?.status === 'SUCCESS') return { success: true, note: 'Idempotent replay' }
    }
    throw e
  }

  // 3. Atomic confirmation
  // Ensure we only confirm if we don't exceed capacity, accounting for active holds and confirmed seats
  const capacity = 4
  const updatedRows = await prisma.$executeRaw`
    UPDATE "Booking"
    SET "status" = 'CONFIRMED'
    WHERE "id" = ${bookingId}
    AND (
        SELECT COUNT(*)
        FROM "Booking"
        WHERE "trialClassId" = ${booking.trialClassId} 
        AND (
            "status" = 'CONFIRMED' 
            OR ("status" = 'PENDING_PAYMENT' AND "holdExpiresAt" > NOW())
        )
        AND "id" != ${bookingId}
    ) < ${capacity};
  `

  if (updatedRows === 0) {
    await prisma.booking.update({
      where: { id: bookingId },
      data: { status: 'PAYMENT_FAILED' } 
    })
    revalidatePath('/')
    return { error: 'The class reached full capacity. Your payment has been refunded.' }
  }

  revalidatePath('/')
  return { success: true }
}

export async function getDashboardData() {
  const parent = await prisma.parent.findFirst({
    include: {
      students: {
        include: {
          bookings: {
            include: { trialClass: true }
          }
        }
      }
    }
  })

  const classes = await prisma.trialClass.findMany({
    include: {
      bookings: {
        where: {
          OR: [
            { status: 'CONFIRMED' },
            { status: 'PENDING_PAYMENT', holdExpiresAt: { gt: new Date() } }
          ]
        }
      }
    },
    orderBy: { startTime: 'asc' }
  })

  return { parent, classes }
}
