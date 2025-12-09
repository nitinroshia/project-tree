import React, { useState } from 'react'
import { api } from '../api/client'
import ScriptGenerator from './ScriptGenerator';

function SummaryReview({ summary, onReview }) {
  const [editorNotes, setEditorNotes] = useState(summary.editor_notes || '')
  const [reviewedBy, setReviewedBy] = useState('editor')
  const [loading, setLoading] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editedSummary, setEditedSummary] = useState(summary.summary_text)
  const [isApproved, setIsApproved] = useState(summary.status === 'approved' || summary.editor_notes)

  const handleApprove = async () => {
    setLoading(true)
    try {
      await api.approveSummary(summary.summary_uuid, {
        editor_notes: editorNotes,
        reviewed_by: reviewedBy
      })
      setIsApproved(true)
      onReview()
    } catch (error) {
      console.error('Failed to approve summary:', error)
      alert('Failed to approve summary')
    } finally {
      setLoading(false)
    }
  }

  const handleReject = async () => {
    if (!editorNotes.trim()) {
      alert('Please provide editor notes for rejection')
      return
    }

    setLoading(true)
    try {
      await api.rejectSummary(summary.summary_uuid, {
        editor_notes: editorNotes,
        reviewed_by: reviewedBy
      })
      onReview()
    } catch (error) {
      console.error('Failed to reject summary:', error)
      alert('Failed to reject summary')
    } finally {
      setLoading(false)
    }
  }

  const handleUpdateSummary = async () => {
    if (!editedSummary.trim()) {
      alert('Summary text cannot be empty')
      return
    }

    setLoading(true)
    try {
      await api.updateSummary(summary.summary_uuid, {
        summary_text: editedSummary,
        editor_notes: editorNotes
      })
      setIsEditing(false)
      onReview()
    } catch (error) {
      console.error('Failed to update summary:', error)
      alert('Failed to update summary')
    } finally {
      setLoading(false)
    }
  }

  // Determine review status display
  const getStatusBadge = () => {
    if (summary.approved === true) {
      return <span className="px-3 py-1 text-sm rounded bg-green-100 text-green-800 font-medium">✓ Approved</span>
    } else if (summary.approved === false) {
      return <span className="px-3 py-1 text-sm rounded bg-red-100 text-red-800 font-medium">✗ Rejected</span>
    } else {
      return <span className="px-3 py-1 text-sm rounded bg-yellow-100 text-yellow-800 font-medium">⏳ Pending Review</span>
    }
  }

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex justify-between items-start mb-4">
        <div>
          <div className="text-sm text-gray-500">Summary UUID: {summary.summary_uuid}</div>
          <div className="text-sm text-gray-500">
            Created: {new Date(summary.created_at).toLocaleString()}
          </div>
        </div>
        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-2">
            <span className="text-sm font-medium text-gray-700">Quality:</span>
            <span className={`px-2 py-1 text-sm rounded ${summary.quality_score >= 0.8 ? 'bg-green-100 text-green-800' :
              summary.quality_score >= 0.6 ? 'bg-yellow-100 text-yellow-800' :
                'bg-red-100 text-red-800'
              }`}>
              {(summary.quality_score * 100).toFixed(0)}%
            </span>
          </div>
          {getStatusBadge()}
        </div>
      </div>

      {/* Summary Text Display/Edit */}
      <div className="mb-4 p-4 bg-gray-50 rounded">
        <div className="flex justify-between items-center mb-2">
          <div className="text-sm font-medium text-gray-700">Summary Text:</div>
          {summary.approved !== null && !isEditing && (
            <button
              onClick={() => setIsEditing(true)}
              className="text-xs px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              ✏️ Edit Summary
            </button>
          )}
        </div>

        {isEditing ? (
          <div className="space-y-2">
            <textarea
              value={editedSummary}
              onChange={(e) => setEditedSummary(e.target.value)}
              className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              rows="6"
            />
            <div className="flex space-x-2">
              <button
                onClick={handleUpdateSummary}
                disabled={loading}
                className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50 text-sm"
              >
                {loading ? 'Saving...' : 'Save Changes'}
              </button>
              <button
                onClick={() => {
                  setEditedSummary(summary.summary_text)
                  setIsEditing(false)
                }}
                disabled={loading}
                className="px-4 py-2 bg-gray-300 text-gray-700 rounded hover:bg-gray-400 disabled:opacity-50 text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div>
            <div className="text-gray-900">{summary.summary_text}</div>
            <div className="text-xs text-gray-500 mt-2">
              {summary.summary_text.split(' ').length} words
            </div>
            {/* ScriptGenerator */}
            {isApproved && (
              <ScriptGenerator
                summaryText={summary.summary_text}
                summaryUuid={summary.summary_uuid}
                editorArticleUuid={summary.editor_article_uuid}
                editorSummaryText={summary.editor_summary_text}
                articleMetadata={{
                  headline: summary.headline,
                  source: summary.source_name
                }}
                onScriptGenerated={(script) => {
                  console.log('Script generated:', script.script_uuid);
                }}
                defaultExpanded={false}
              />
            )}
          </div>
        )}
      </div>

      {/* Show existing editor notes if present */}
      {summary.editor_notes && !isEditing && (
        <div className="mb-4 p-4 border-l-4 border-blue-500 bg-blue-50 rounded">
          <div className="flex items-start space-x-2">
            <div className="text-blue-600 font-medium text-sm">💬 Editor Notes:</div>
          </div>
          <div className="text-gray-800 mt-2 whitespace-pre-wrap">{summary.editor_notes}</div>
          <div className="text-xs text-gray-500 mt-2">
            Review completed: {new Date(summary.created_at).toLocaleString()}
          </div>
        </div>
      )}

      {/* Only show review form if not yet reviewed */}
      {summary.approved === null && !isEditing && (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Editor Notes {summary.approved === false && <span className="text-red-600">*</span>}
            </label>
            <textarea
              value={editorNotes}
              onChange={(e) => setEditorNotes(e.target.value)}
              placeholder="Add your review notes..."
              className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              rows="3"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Reviewed By
            </label>
            <input
              type="text"
              value={reviewedBy}
              onChange={(e) => setReviewedBy(e.target.value)}
              className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="flex space-x-4">
            <button
              onClick={handleApprove}
              disabled={loading}
              className="flex-1 px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
            >
              {loading ? 'Processing...' : 'Approve'}
            </button>
            <button
              onClick={handleReject}
              disabled={loading}
              className="flex-1 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
            >
              {loading ? 'Processing...' : 'Reject'}
            </button>
          </div>
        </div>
      )}

      {/* Show message if already reviewed but allow editing */}
      {summary.approved !== null && !isEditing && (
        <div className="text-center py-2 text-gray-600 text-sm bg-gray-50 rounded">
          This summary has been {summary.approved ? 'approved' : 'rejected'}.
          You can edit the summary text using the "Edit Summary" button above.
        </div>
      )}
    </div>
  )
}

export default SummaryReview
