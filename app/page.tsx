import { getDashboardData } from './actions/booking'
import { BookingForm } from './components/BookingForm'
import Link from 'next/link'
import { format } from 'date-fns'

export const dynamic = 'force-dynamic'

export default async function Home() {
  const data = await getDashboardData()

  if (!data.parent) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="p-8 text-center bg-white/60 backdrop-blur-md rounded-2xl shadow-xl">
          <h1 className="text-2xl font-bold text-red-500 mb-2">No Data Found</h1>
          <p className="text-gray-600">Please run the seed script: <code className="bg-gray-100 px-2 py-1 rounded">npx tsx prisma/seed.ts</code></p>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen p-6 md:p-10">
      {/* Header */}
      <div className="flex items-center justify-between mb-10">
        <div>
          <h1 className="text-4xl font-extrabold tracking-tight text-slate-800">Ottodot</h1>
          <p className="text-slate-500 text-sm mt-1">Trial Booking Portal</p>
        </div>
        <Link
          href="/admin"
          className="bg-white/60 backdrop-blur-sm border border-slate-200 text-slate-700 px-4 py-2 rounded-xl text-sm font-medium hover:bg-white/80 hover:shadow-md transition-all"
        >
          Admin / Roster View →
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left: Welcome & Student Info */}
        <div className="lg:col-span-1 space-y-4">
          <div className="bg-white/60 backdrop-blur-sm border border-white/50 rounded-2xl shadow-lg p-6">
            <h2 className="text-lg font-bold text-slate-700 mb-1">Welcome, {data.parent.name}</h2>
            <p className="text-slate-500 text-sm">{data.parent.email}</p>
          </div>

          <div className="bg-white/60 backdrop-blur-sm border border-white/50 rounded-2xl shadow-lg p-6">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-500 mb-4">Your Children</h3>
            <ul className="space-y-4">
              {data.parent.students.map(student => (
                <li key={student.id}>
                  <p className="font-semibold text-slate-800">{student.name}</p>
                  {student.bookings.length === 0 ? (
                    <p className="text-xs text-slate-400 mt-1">No bookings yet.</p>
                  ) : (
                    <ul className="mt-2 space-y-1.5">
                      {student.bookings.map(b => (
                        <li key={b.id} className="flex items-center gap-2 text-xs">
                          <span className={`inline-block px-2 py-0.5 rounded-full font-bold text-white ${
                            b.status === 'CONFIRMED' ? 'bg-emerald-500' :
                            b.status === 'PENDING_PAYMENT' ? 'bg-amber-400' :
                            'bg-red-400'
                          }`}>
                            {b.status}
                          </span>
                          <span className="text-slate-500">{format(new Date(b.trialClass.startTime), 'MMM d, yyyy')}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Right: Classes & Booking Form */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-white/60 backdrop-blur-sm border border-white/50 rounded-2xl shadow-lg p-6">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-500 mb-4">Available Trial Classes</h3>
            <ul className="space-y-3">
              {data.classes.map(c => {
                const activeCount = c.bookings.length
                const pct = Math.round((activeCount / c.capacity) * 100)
                const isFull = activeCount >= c.capacity
                return (
                  <li key={c.id} className="p-4 bg-white/70 border border-slate-100 rounded-xl">
                    <div className="flex justify-between items-center mb-2">
                      <p className="font-semibold text-slate-700">
                        {format(new Date(c.startTime), "EEEE, MMMM d")}
                        <span className="text-slate-400 font-normal text-sm ml-2">{format(new Date(c.startTime), "h:mm a")}</span>
                      </p>
                      <span className={`text-xs font-bold px-2 py-1 rounded-full ${isFull ? 'bg-red-100 text-red-600' : 'bg-emerald-100 text-emerald-600'}`}>
                        {isFull ? 'Full' : `${c.capacity - activeCount} seats left`}
                      </span>
                    </div>
                    {/* Capacity bar */}
                    <div className="w-full bg-slate-100 rounded-full h-1.5">
                      <div
                        className={`h-1.5 rounded-full transition-all ${pct >= 100 ? 'bg-red-400' : pct >= 75 ? 'bg-amber-400' : 'bg-emerald-400'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <p className="text-xs text-slate-400 mt-1">{activeCount} of {c.capacity} seats booked / held</p>
                  </li>
                )
              })}
            </ul>
          </div>

          <BookingForm students={data.parent.students} trialClasses={data.classes} />
        </div>
      </div>
    </main>
  )
}
