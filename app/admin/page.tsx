import { prisma } from '@/lib/prisma'
import Link from 'next/link'
import { format } from 'date-fns'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Admin | Ottodot Trial Class Roster',
}

async function getAdminData() {
  return prisma.trialClass.findMany({
    include: {
      bookings: {
        include: {
          student: {
            include: { parent: true }
          }
        },
        orderBy: { status: 'asc' }
      }
    },
    orderBy: { startTime: 'asc' }
  })
}

export default async function AdminPage() {
  const classes = await getAdminData()

  const statusStyle: Record<string, string> = {
    CONFIRMED: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    PENDING_PAYMENT: 'bg-amber-100 text-amber-700 border-amber-200',
    PAYMENT_FAILED: 'bg-red-100 text-red-600 border-red-200',
    CANCELLED: 'bg-slate-100 text-slate-500 border-slate-200',
  }

  return (
    <main className="min-h-screen p-6 md:p-10">
      <div className="flex items-center justify-between mb-10">
        <div>
          <h1 className="text-4xl font-extrabold tracking-tight text-slate-800">Admin</h1>
          <p className="text-slate-500 text-sm mt-1">Class Roster Dashboard</p>
        </div>
        <Link
          href="/"
          className="bg-white/60 backdrop-blur-sm border border-slate-200 text-slate-700 px-4 py-2 rounded-xl text-sm font-medium hover:bg-white/80 hover:shadow-md transition-all"
        >
          ← Parent Booking Portal
        </Link>
      </div>

      <div className="space-y-8">
        {classes.map(c => {
          const confirmed = c.bookings.filter(b => b.status === 'CONFIRMED')
          const active = c.bookings.filter(b => b.status === 'CONFIRMED' || b.status === 'PENDING_PAYMENT')
          const pct = Math.round((confirmed.length / c.capacity) * 100)
          const isFull = confirmed.length >= c.capacity

          return (
            <div key={c.id} className="bg-white/60 backdrop-blur-sm border border-white/50 rounded-2xl shadow-lg overflow-hidden">
              {/* Class Header */}
              <div className="p-6 border-b border-slate-100">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-bold text-slate-800">
                      {format(new Date(c.startTime), "EEEE, MMMM d, yyyy")}
                    </h2>
                    <p className="text-slate-500 text-sm mt-0.5">
                      {format(new Date(c.startTime), "h:mm a")} · {confirmed.length} confirmed / {c.capacity} capacity
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`text-sm font-bold px-3 py-1.5 rounded-full ${isFull ? 'bg-red-100 text-red-600' : 'bg-emerald-100 text-emerald-600'}`}>
                      {isFull ? 'Class Full' : `${c.capacity - confirmed.length} seats open`}
                    </span>
                    <div className="text-sm text-slate-500">
                      {active.length} total active
                    </div>
                  </div>
                </div>
                {/* Capacity bar */}
                <div className="mt-4 w-full bg-slate-100 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full transition-all duration-500 ${pct >= 100 ? 'bg-red-400' : pct >= 75 ? 'bg-amber-400' : 'bg-emerald-400'}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>

              {/* Roster */}
              <div className="overflow-x-auto">
                {c.bookings.length === 0 ? (
                  <p className="text-center text-slate-400 py-8 text-sm">No bookings yet</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-100">
                        <th className="text-left text-xs uppercase tracking-wider text-slate-400 px-6 py-3 font-semibold">Student</th>
                        <th className="text-left text-xs uppercase tracking-wider text-slate-400 px-6 py-3 font-semibold">Parent</th>
                        <th className="text-left text-xs uppercase tracking-wider text-slate-400 px-6 py-3 font-semibold">Parent Email</th>
                        <th className="text-left text-xs uppercase tracking-wider text-slate-400 px-6 py-3 font-semibold">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {c.bookings.map(b => (
                        <tr key={b.id} className="hover:bg-slate-50/80 transition-colors">
                          <td className="px-6 py-4 font-semibold text-slate-700">{b.student.name}</td>
                          <td className="px-6 py-4 text-slate-600">{b.student.parent.name}</td>
                          <td className="px-6 py-4 text-slate-500">{b.student.parent.email}</td>
                          <td className="px-6 py-4">
                            <span className={`inline-block px-2.5 py-1 rounded-lg border text-xs font-bold ${statusStyle[b.status] ?? 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                              {b.status.replace('_', ' ')}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </main>
  )
}
