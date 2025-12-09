import React, { useEffect, useState } from 'react'
import SummaryReview from '../components/SummaryReview'
import { api } from '../api/client'

function QueuePage() {
  const [summaries, setSummaries] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('pending')

  useEffect(() => {
    loadSummaries()
  }, [])

  const loadSummaries = async () => {
    try {
      const response = await api.getSummaries()
      setSummaries(response.data.summaries || [])
    } catch (error) {
      console.error('Failed to load summaries:', error)
    } finally {
      setLoading(false)
    }
  }

  const filteredSummaries = summaries.filter(s => {
    if (filter === 'pending') return !s.approved
    if (filter === 'approved') return s.approved === true
    return true
  })

  const handleReview = () => {
    loadSummaries()
  }

  if (loading) {
    return <div className="text-center py-12">Loading summaries...</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-gray-900">Review Queue</h1>

        <div className="flex space-x-2">
          <button
            onClick={() => setFilter('pending')}
            className={`px-4 py-2 rounded ${filter === 'pending' ? 'bg-pellacia-blue text-white' : 'bg-gray-200 text-gray-700'
              }`}
          >
            Pending ({summaries.filter(s => !s.approved).length})
          </button>
          <button
            onClick={() => setFilter('approved')}
            className={`px-4 py-2 rounded ${filter === 'approved' ? 'bg-pellacia-blue text-white' : 'bg-gray-200 text-gray-700'
              }`}
          >
            Approved ({summaries.filter(s => s.approved).length})
          </button>
          <button
            onClick={() => setFilter('all')}
            className={`px-4 py-2 rounded ${filter === 'all' ? 'bg-pellacia-blue text-white' : 'bg-gray-200 text-gray-700'
              }`}
          >
            All ({summaries.length})
          </button>
        </div>
      </div>

      {filteredSummaries.length === 0 ? (
        <div className="bg-white p-8 rounded-lg shadow text-center text-gray-500">
          No summaries to review.
        </div>
      ) : (
        <div className="space-y-6">
          {filteredSummaries.map(summary => (
            <SummaryReview
              key={summary.summary_uuid}
              summary={summary}
              onReview={handleReview}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export default QueuePage

