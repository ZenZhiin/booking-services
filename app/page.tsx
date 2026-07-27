import { getDashboardData } from './actions/booking'
import { BookingForm } from './components/BookingForm'

export default async function Home() {
  const data = await getDashboardData()

  if (!data.parent) {
    return <div className="p-8">No data found. Please run the seed script.</div>
  }

  return (
    <main className="p-8 font-sans max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold mb-6">Ottodot Trial Booking Dashboard</h1>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        <div>
          <h2 className="text-xl font-bold mb-4">Your Students</h2>
          <ul className="space-y-4">
            {data.parent.students.map(student => (
              <li key={student.id} className="p-4 border rounded-md">
                <p className="font-semibold">{student.name}</p>
                <div className="text-sm text-gray-600 mt-2">
                  <p className="font-bold">Bookings:</p>
                  {student.bookings.length === 0 ? (
                    <p>No bookings yet.</p>
                  ) : (
                    <ul className="list-disc pl-4 mt-1">
                      {student.bookings.map(b => (
                        <li key={b.id}>
                          Class at {new Date(b.trialClass.startTime).toLocaleString()} - Status: <span className="font-bold">{b.status}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h2 className="text-xl font-bold mb-4">Available Classes</h2>
          <ul className="space-y-2 mb-6">
            {data.classes.map(c => (
              <li key={c.id} className="p-3 border rounded-md">
                Class at {new Date(c.startTime).toLocaleString()} - {c.bookings.length}/{c.capacity} booked
              </li>
            ))}
          </ul>

          <BookingForm students={data.parent.students} trialClasses={data.classes} />
        </div>
      </div>
    </main>
  )
}
