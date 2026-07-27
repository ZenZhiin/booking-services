import { prisma } from '../lib/prisma'

async function main() {
  console.log('Seeding database...')

  // Clean up existing data
  await prisma.paymentAttempt.deleteMany()
  await prisma.booking.deleteMany()
  await prisma.trialClass.deleteMany()
  await prisma.student.deleteMany()
  await prisma.parent.deleteMany()

  // 1. Create a Parent and some Students
  const parent = await prisma.parent.create({
    data: {
      name: 'Jane Doe',
      email: 'jane@example.com',
      students: {
        create: [
          { name: 'Alice' },
          { name: 'Bob' },
        ],
      },
    },
    include: {
      students: true,
    },
  })

  // 2. Create Trial Classes
  // Class A: Empty (0/4)
  const classA = await prisma.trialClass.create({
    data: {
      startTime: new Date(Date.now() + 86400000), // Tomorrow
      capacity: 4,
    },
  })

  // Class B: Almost Full (3/4)
  const classB = await prisma.trialClass.create({
    data: {
      startTime: new Date(Date.now() + 86400000 * 2), // Day after tomorrow
      capacity: 4,
    },
  })

  // Add 3 dummy students and confirmed bookings to Class B to simulate almost full
  const dummyParent = await prisma.parent.create({
    data: {
      name: 'Dummy Parent',
      email: 'dummy@example.com',
      students: {
        create: [
          { name: 'Dummy 1' },
          { name: 'Dummy 2' },
          { name: 'Dummy 3' },
        ],
      },
    },
    include: {
      students: true,
    },
  })

  for (const dummyStudent of dummyParent.students) {
    await prisma.booking.create({
      data: {
        studentId: dummyStudent.id,
        trialClassId: classB.id,
        status: 'CONFIRMED',
      },
    })
  }

  console.log('Seeding finished.')
  console.log('Parent ID:', parent.id)
  console.log('Students:', parent.students.map((s) => s.id))
  console.log('Class A (0/4) ID:', classA.id)
  console.log('Class B (3/4) ID:', classB.id)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
