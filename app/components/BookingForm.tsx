'use client'

import { useState } from 'react'
import { initiateBooking, processPayment } from '../actions/booking'
import toast from 'react-hot-toast'
import { Loader2 } from 'lucide-react'

export function BookingForm({ students, trialClasses }: { students: any[], trialClasses: any[] }) {
  const [selectedStudent, setSelectedStudent] = useState(students[0]?.id || '')
  const [selectedClass, setSelectedClass] = useState(trialClasses[0]?.id || '')
  const [loading, setLoading] = useState(false)

  const handleBook = async () => {
    setLoading(true)
    const holdToastId = toast.loading('Reserving seat...')
    
    // Step 1: Initiate Booking
    const res1 = await initiateBooking(selectedStudent, selectedClass)
    if (res1.error) {
      toast.error(`Error: ${res1.error}`, { id: holdToastId })
      setLoading(false)
      return
    }

    const bookingId = res1.booking!.id
    const idempotencyKey = res1.idempotencyKey!
    toast.loading('Seat reserved for 10 mins. Processing payment...', { id: holdToastId })

    // Step 2: Process Payment & Confirm Atomic
    const res2 = await processPayment(bookingId, idempotencyKey)
    if (res2.error) {
      toast.error(`Payment Error: ${res2.error}`, { id: holdToastId })
    } else {
      toast.success('Success! Your booking is confirmed.', { id: holdToastId })
    }
    
    setLoading(false)
  }

  return (
    <div className="p-6 bg-white/40 backdrop-blur-md border border-white/20 rounded-2xl shadow-xl max-w-md mx-auto mt-4 transition-all duration-300">
      <h2 className="text-2xl font-bold mb-6 text-gray-800 tracking-tight">Book a Trial Class</h2>
      
      <div className="mb-5">
        <label className="block text-sm font-semibold text-gray-700 mb-2">Select Child</label>
        <select 
          className="w-full bg-white/70 border border-gray-200 text-gray-800 p-3 rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none transition-shadow"
          value={selectedStudent} 
          onChange={e => setSelectedStudent(e.target.value)}
        >
          {students.map(s => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>

      <div className="mb-6">
        <label className="block text-sm font-semibold text-gray-700 mb-2">Select Class</label>
        <select 
          className="w-full bg-white/70 border border-gray-200 text-gray-800 p-3 rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none transition-shadow"
          value={selectedClass} 
          onChange={e => setSelectedClass(e.target.value)}
        >
          {trialClasses.map(c => {
            const activeCount = c.bookings.length
            const isFull = activeCount >= c.capacity
            return (
              <option key={c.id} value={c.id} disabled={isFull}>
                {new Date(c.startTime).toLocaleDateString()} at {new Date(c.startTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})} 
                {' '}({activeCount}/{c.capacity} booked)
              </option>
            )
          })}
        </select>
      </div>

      <button 
        onClick={handleBook}
        disabled={loading}
        className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 text-white font-medium p-3 rounded-xl hover:shadow-lg hover:from-blue-700 hover:to-indigo-700 disabled:opacity-70 disabled:cursor-not-allowed transition-all duration-300 flex justify-center items-center gap-2"
      >
        {loading && <Loader2 className="animate-spin w-5 h-5" />}
        {loading ? 'Processing...' : 'Reserve Seat & Pay'}
      </button>
    </div>
  )
}
