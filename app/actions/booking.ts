'use server'

import { prisma } from '../../lib/prisma'
import { revalidatePath } from 'next/cache'

// Initiate a booking, setting it to PENDING_PAYMENT
export async function initiateBooking(studentId: string, trialClassId: string) {
  // Check if there is already a confirmed booking for this student and class
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

  // Find existing booking (might be pending or failed) or create a new one
  let booking = await prisma.booking.findUnique({
    where: {
      studentId_trialClassId: {
        studentId,
        trialClassId
      }
    }
  })

  if (booking) {
    // If it exists, reset status to PENDING_PAYMENT
    booking = await prisma.booking.update({
      where: { id: booking.id },
      data: { status: 'PENDING_PAYMENT' }
    })
  } else {
    booking = await prisma.booking.create({
      data: {
        studentId,
        trialClassId,
        status: 'PENDING_PAYMENT'
      }
    })
  }

  revalidatePath('/')
  return { booking }
}

// Process mock payment and confirm booking with atomic update
export async function processPayment(bookingId: string) {
  // 1. Fetch booking to ensure it's pending payment
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId }
  })

  if (!booking) {
    return { error: 'Booking not found' }
  }

  if (booking.status === 'CONFIRMED') {
    return { error: 'Booking is already confirmed' }
  }

  // 2. Mock payment logic (simulate delay)
  await new Promise(resolve => setTimeout(resolve, 1000))
  
  // Record payment attempt
  await prisma.paymentAttempt.create({
    data: {
      bookingId,
      status: 'SUCCESS',
      amount: 1000 // e.g. 10.00 USD
    }
  })

  // 3. Atomic confirmation
  // The subquery checks if the class currently has < 4 confirmed bookings.
  // If true, the update succeeds and returns rows affected = 1.
  // If false, it returns rows affected = 0.
  const updatedRows = await prisma.$executeRaw`
    UPDATE "Booking"
    SET "status" = 'CONFIRMED'
    WHERE "id" = ${bookingId}
    AND (
        SELECT COUNT(*)
        FROM "Booking"
        WHERE "trialClassId" = ${booking.trialClassId} AND "status" = 'CONFIRMED'
    ) < 4;
  `

  if (updatedRows === 0) {
    // Check if the class is actually full to differentiate from "booking not found" error
    const confirmedCount = await prisma.booking.count({
      where: {
        trialClassId: booking.trialClassId,
        status: 'CONFIRMED'
      }
    })

    if (confirmedCount >= 4) {
      // Transition booking to PAYMENT_FAILED or similar since it was overbooked
      await prisma.booking.update({
        where: { id: bookingId },
        data: { status: 'PAYMENT_FAILED' } // Note: real system might do REFUND_REQUIRED
      })
      revalidatePath('/')
      return { error: 'The class reached full capacity before your payment completed. Your payment has been refunded.' }
    }
    
    return { error: 'Failed to confirm booking.' }
  }

  revalidatePath('/')
  return { success: true }
}

// Helper to fetch data for the dashboard
export async function getDashboardData() {
  const parent = await prisma.parent.findFirst({
    include: {
      students: {
        include: {
          bookings: {
            include: {
              trialClass: true
            }
          }
        }
      }
    }
  })

  const classes = await prisma.trialClass.findMany({
    include: {
      bookings: {
        where: { status: 'CONFIRMED' }
      }
    },
    orderBy: { startTime: 'asc' }
  })

  return { parent, classes }
}
