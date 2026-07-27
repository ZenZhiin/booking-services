'use client'

import { useState } from 'react'
import { initiateBooking, processPayment } from '../actions/booking'

export function BookingForm({ students, trialClasses }: { students: any[], trialClasses: any[] }) {
  const [selectedStudent, setSelectedStudent] = useState(students[0]?.id || '')
  const [selectedClass, setSelectedClass] = useState(trialClasses[0]?.id || '')
  const [statusMsg, setStatusMsg] = useState('')
  const [loading, setLoading] = useState(false)

  const handleBook = async () => {
    setStatusMsg('')
    setLoading(true)
    
    // Step 1: Initiate Booking
    const res1 = await initiateBooking(selectedStudent, selectedClass)
    if (res1.error) {
      setStatusMsg(`Error: ${res1.error}`)
      setLoading(false)
      return
    }

    const bookingId = res1.booking!.id
    setStatusMsg('Booking initiated. Proceeding to mock payment...')

    // Step 2: Process Payment & Confirm Atomic
    const res2 = await processPayment(bookingId)
    if (res2.error) {
      setStatusMsg(`Payment/Confirmation Error: ${res2.error}`)
    } else {
      setStatusMsg('Success! Your booking is confirmed.')
    }
    
    setLoading(false)
  }

  return (
    <div className="p-4 border rounded-md shadow-sm max-w-md mt-4">
      <h2 className="text-xl font-bold mb-4">Book a Trial Class</h2>
      
      <div className="mb-4">
        <label className="block text-sm font-medium mb-1">Select Child</label>
        <select 
          className="w-full border p-2 rounded"
          value={selectedStudent} 
          onChange={e => setSelectedStudent(e.target.value)}
        >
          {students.map(s => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>

      <div className="mb-4">
        <label className="block text-sm font-medium mb-1">Select Class</label>
        <select 
          className="w-full border p-2 rounded"
          value={selectedClass} 
          onChange={e => setSelectedClass(e.target.value)}
        >
          {trialClasses.map(c => {
            const confirmedCount = c.bookings.length
            return (
              <option key={c.id} value={c.id}>
                Class at {new Date(c.startTime).toLocaleString()} ({confirmedCount}/{c.capacity} booked)
              </option>
            )
          })}
        </select>
      </div>

      <button 
        onClick={handleBook}
        disabled={loading}
        className="w-full bg-blue-600 text-white p-2 rounded hover:bg-blue-700 disabled:opacity-50"
      >
        {loading ? 'Processing...' : 'Book & Pay'}
      </button>

      {statusMsg && (
        <div className="mt-4 p-3 bg-gray-100 rounded text-sm">
          {statusMsg}
        </div>
      )}
    </div>
  )
}
