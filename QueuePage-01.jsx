import React, { useEffect, useState } from 'react'
import SummaryReview from '../components/SummaryReview'
import ScriptGenerator from '../components/ScriptGenerator'
import { api } from '../api/client'

function QueuePage() {
  const [activeTab, setActiveTab] = useState('summaries') // 'summaries', 'editor_articles', 'articles', or 'audio'
  const [summaries, setSummaries] = useState([])
  const [editorArticles, setEditorArticles] = useState([])
  const [approvedArticles, setApprovedArticles] = useState([])
  const [ttsSummaries, setTtsSummaries] = useState([]) // Approved editor articles with TTS summaries
  const [audioSummaries, setAudioSummaries] = useState([]) // Combined approved summaries for audio generation
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('pending')

  useEffect(() => {
    loadData()
  }, [activeTab])

  const loadData = async () => {
    setLoading(true)
    try {
      if (activeTab === 'summaries') {
        const response = await api.getSummaries()
        setSummaries(response.data.summaries || [])
      } else if (activeTab === 'editor_articles') {
        const response = await api.getQueueEditorArticles()
        setEditorArticles(response.data.editor_articles || [])
      } else if (activeTab === 'articles') {
        const response = await api.getEditorArticles({ status: 'approved' })
        setApprovedArticles(response.data.editor_articles || [])
      } else if (activeTab === 'audio') {
        // Load both approved AI summaries and approved editor articles with TTS summaries
        const [summariesResponse, editorResponse] = await Promise.all([
          api.getSummaries(),
          api.getEditorArticles({ status: 'approved' })
        ])

        const approvedSummaries = (summariesResponse.data.summaries || []).filter(s => s.approved === true)
        const ttsArticles = (editorResponse.data.editor_articles || []).filter(article =>
          article.summary_text && article.summary_text.trim()
        )

        // Combine and group by source UUID
        const combined = {}

        // Add approved AI summaries
        approvedSummaries.forEach(summary => {
          const key = summary.article_uuid || summary.summary_uuid
          if (!combined[key]) {
            combined[key] = { aiSummary: null, ttsSummary: null, sourceInfo: null }
          }
          combined[key].aiSummary = summary
          combined[key].sourceInfo = {
            source_name: summary.source_name,
            headline: summary.source_headline,
            article_uuid: summary.article_uuid
          }
        })

        // Add TTS summaries
        ttsArticles.forEach(article => {
          const key = article.source_article_uuid || article.editor_article_uuid
          if (!combined[key]) {
            combined[key] = { aiSummary: null, ttsSummary: null, sourceInfo: null }
          }
          combined[key].ttsSummary = article
          if (!combined[key].sourceInfo) {
            combined[key].sourceInfo = {
              source_name: article.source_name || 'Editor Created',
              headline: article.headline,
              article_uuid: article.source_article_uuid
            }
          }
        })

        setAudioSummaries(Object.values(combined))
      }
    } catch (error) {
      console.error('Failed to load data:', error)
    } finally {
      setLoading(false)
    }
  }


  const filteredSummaries = summaries.filter(s => {
    if (filter === 'pending') return s.approved === null
    if (filter === 'approved') return s.approved === true
    if (filter === 'rejected') return s.approved === false
    return true
  })

  const filteredEditorArticles = editorArticles.filter(ea => {
    if (filter === 'pending') return ea.status === 'draft'
    if (filter === 'approved') return ea.status === 'approved'
    if (filter === 'rejected') return ea.status === 'rejected'
    return true
  })

  const handleReview = () => {
    loadData()
  }

  if (loading) {
    return <div className="text-center py-12">Loading...</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-gray-900">Review Queue</h1>

        {/* Tab Switcher */}
        <div className="flex space-x-2 bg-gray-100 p-1 rounded">
          <button
            onClick={() => setActiveTab('summaries')}
            className={`px-4 py-2 rounded ${activeTab === 'summaries'
                ? 'bg-white shadow text-pellacia-blue font-medium'
                : 'text-gray-600 hover:text-gray-900'
              }`}
          >
            📝 Summaries
          </button>
          <button
            onClick={() => setActiveTab('editor_articles')}
            className={`px-4 py-2 rounded ${activeTab === 'editor_articles'
                ? 'bg-white shadow text-pellacia-blue font-medium'
                : 'text-gray-600 hover:text-gray-900'
              }`}
          >
            🎨 Editor Articles
          </button>
          <button
            onClick={() => setActiveTab('articles')}
            className={`px-4 py-2 rounded ${activeTab === 'articles'
                ? 'bg-white shadow text-pellacia-blue font-medium'
                : 'text-gray-600 hover:text-gray-900'
              }`}
          >
            📰 Articles
          </button>
          <button
            onClick={() => setActiveTab('audio')}
            className={`px-4 py-2 rounded ${activeTab === 'audio'
                ? 'bg-white shadow text-pellacia-blue font-medium'
                : 'text-gray-600 hover:text-gray-900'
              }`}
          >
            🎵 Audio Generation
          </button>
        </div>
      </div>

      {/* Filter Buttons - Only show for summaries and editor_articles tabs */}
      {activeTab !== 'articles' && activeTab !== 'audio' && (
        <div className="flex space-x-2">
          <button
            onClick={() => setFilter('pending')}
            className={`px-4 py-2 rounded ${filter === 'pending' ? 'bg-pellacia-blue text-white' : 'bg-gray-200 text-gray-700'
              }`}
          >
            Pending ({activeTab === 'summaries'
              ? summaries.filter(s => s.approved === null).length
              : editorArticles.filter(ea => ea.status === 'draft').length})
          </button>
          <button
            onClick={() => setFilter('approved')}
            className={`px-4 py-2 rounded ${filter === 'approved' ? 'bg-pellacia-blue text-white' : 'bg-gray-200 text-gray-700'
              }`}
          >
            Approved ({activeTab === 'summaries'
              ? summaries.filter(s => s.approved === true).length
              : editorArticles.filter(ea => ea.status === 'approved').length})
          </button>
          <button
            onClick={() => setFilter('rejected')}
            className={`px-4 py-2 rounded ${filter === 'rejected' ? 'bg-pellacia-blue text-white' : 'bg-gray-200 text-gray-700'
              }`}
          >
            Rejected ({activeTab === 'summaries'
              ? summaries.filter(s => s.approved === false).length
              : editorArticles.filter(ea => ea.status === 'rejected').length})
          </button>
          <button
            onClick={() => setFilter('all')}
            className={`px-4 py-2 rounded ${filter === 'all' ? 'bg-pellacia-blue text-white' : 'bg-gray-200 text-gray-700'
              }`}
          >
            All ({activeTab === 'summaries' ? summaries.length : editorArticles.length})
          </button>
        </div>
      )}

      {/* Content Area */}
      {activeTab === 'summaries' ? (
        filteredSummaries.length === 0 ? (
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
        )
      ) : activeTab === 'editor_articles' ? (
        filteredEditorArticles.length === 0 ? (
          <div className="bg-white p-8 rounded-lg shadow text-center text-gray-500">
            No editor articles to review.
          </div>
        ) : (
          <div className="space-y-6">
            {filteredEditorArticles.map(article => (
              <EditorArticleReview
                key={article.editor_article_uuid}
                article={article}
                onReview={handleReview}
              />
            ))}
          </div>
        )
      ) : activeTab === 'audio' ? (
        // Audio Generation tab - approved summaries for TTS
        audioSummaries.length === 0 ? (
          <div className="bg-white p-8 rounded-lg shadow text-center text-gray-500">
            No approved summaries available for audio generation.
          </div>
        ) : (
          <div className="space-y-6">
            {audioSummaries.map((item, index) => (
              <AudioGenerationCard
                key={item.sourceInfo?.article_uuid || `audio-${index}`}
                item={item}
              />
            ))}
          </div>
        )
      ) : (
        // Articles tab - only approved articles
        approvedArticles.length === 0 ? (
          <div className="bg-white p-8 rounded-lg shadow text-center text-gray-500">
            No approved articles ready for publishing.
          </div>
        ) : (
          <div className="space-y-6">
            {approvedArticles.map(article => (
              <ArticlePublishCard
                key={article.editor_article_uuid}
                article={article}
                onPublish={handleReview}
              />
            ))}
          </div>
        )
      )}
    </div>
  )
}

export default QueuePage

// Editor Article Review Component
function EditorArticleReview({ article, onReview }) {
  const [loading, setLoading] = useState(false)

  const handleApprove = async () => {
    setLoading(true)
    try {
      await api.updateEditorArticle(article.editor_article_uuid, { status: 'approved' })
      onReview()
    } catch (error) {
      console.error('Failed to approve editor article:', error)
      alert('Failed to approve editor article')
    } finally {
      setLoading(false)
    }
  }

  const handleReject = async () => {
    const reason = prompt('Please provide a reason for rejection:')
    if (!reason || !reason.trim()) {
      alert('Rejection reason is required')
      return
    }

    setLoading(true)
    try {
      await api.updateEditorArticle(article.editor_article_uuid, {
        status: 'archived',
        editor_notes: reason
      })
      onReview()
    } catch (error) {
      console.error('Failed to reject editor article:', error)
      alert('Failed to reject editor article')
    } finally {
      setLoading(false)
    }
  }

  const getStatusBadge = () => {
    if (article.status === 'approved') {
      return <span className="px-3 py-1 text-sm rounded bg-green-100 text-green-800 font-medium">✓ Approved</span>
    } else if (article.status === 'archived') {
      return <span className="px-3 py-1 text-sm rounded bg-red-100 text-red-800 font-medium">✗ Rejected</span>
    } else {
      return <span className="px-3 py-1 text-sm rounded bg-yellow-100 text-yellow-800 font-medium">⏳ Pending Review</span>
    }
  }

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex justify-between items-start mb-4">
        <div className="flex-1">
          <h3 className="text-xl font-bold text-gray-900">{article.headline}</h3>
          <div className="text-sm text-gray-500 mt-1">
            By {article.editor_name} • {article.created_at && new Date(article.created_at).toLocaleString()}
          </div>
          <div className="flex items-center space-x-2 mt-2">
            {getStatusBadge()}
            <span className="inline-block px-3 py-1 text-sm rounded bg-blue-100 text-blue-800">
              {article.post_type.replace('_', ' ')}
            </span>
            {article.video_compatible && (
              <span className="inline-block px-3 py-1 text-sm rounded bg-purple-100 text-purple-800">
                🎥 Video
              </span>
            )}
            {article.social_compatible && (
              <span className="inline-block px-3 py-1 text-sm rounded bg-blue-100 text-blue-800">
                📱 Social
              </span>
            )}
            {article.web_compatible && (
              <span className="inline-block px-3 py-1 text-sm rounded bg-green-100 text-green-800">
                🌐 Web
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Content Preview */}
      <div className="mb-4">
        <div className="text-sm font-medium text-gray-700 mb-2">📝 Content Preview:</div>
        <div className="text-gray-900 line-clamp-3" dangerouslySetInnerHTML={{ __html: article.post_text }} />
      </div>

      {/* TTS Summary */}
      {article.summary_text && (
        <div className="mb-4 p-4 bg-purple-50 rounded">
          <div className="text-sm font-medium text-purple-900 mb-2">🎙️ TTS Summary:</div>
          <div className="text-gray-900">{article.summary_text}</div>
        </div>
      )}

      {/* Review Actions - Only show if not yet reviewed */}
      {article.status === 'draft' && (
        <div className="flex space-x-4 pt-4 border-t">
          <button
            onClick={handleApprove}
            disabled={loading}
            className="flex-1 px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
          >
            {loading ? 'Processing...' : '✓ Approve'}
          </button>
          <button
            onClick={handleReject}
            disabled={loading}
            className="flex-1 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
          >
            {loading ? 'Processing...' : '✗ Reject'}
          </button>
        </div>
      )}

      {/* Status Message - If already reviewed */}
      {article.status !== 'draft' && (
        <div className="pt-4 border-t">
          <div className="text-center py-2 text-gray-600 text-sm bg-gray-50 rounded">
            This editor article has been {article.status === 'approved' ? 'approved' : 'rejected'}.
          </div>
        </div>
      )}
    </div>
  )
}

// Article Publish Card Component
function ArticlePublishCard({ article, onPublish }) {
  const [showDetails, setShowDetails] = useState(false)
  const [publishing, setPublishing] = useState(false)

  const handlePublish = async () => {
    if (!confirm('Are you sure you want to publish this article? This will freeze all details for the pipeline.')) {
      return
    }

    setPublishing(true)
    try {
      await api.updateEditorArticle(article.editor_article_uuid, { status: 'published' })
      onPublish()
    } catch (error) {
      console.error('Failed to publish article:', error)
      alert('Failed to publish article')
    } finally {
      setPublishing(false)
    }
  }

  // Convert HTML to clean text for social media
  const getCleanText = (html) => {
    if (!html) return ''
    // Simple HTML stripping - remove tags and decode entities
    return html
      .replace(/<[^>]*>/g, '') // Remove HTML tags
      .replace(/&nbsp;/g, ' ') // Decode non-breaking spaces
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .trim()
  }

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex justify-between items-start mb-4">
        <div className="flex-1">
          <h3 className="text-lg font-bold text-gray-900">{article.headline}</h3>
          <div className="text-sm text-gray-500 mt-1">
            By {article.editor_name} • {article.created_at && new Date(article.created_at).toLocaleString()}
          </div>
          <div className="flex items-center space-x-2 mt-2">
            <span className="inline-block px-3 py-1 text-sm rounded bg-green-100 text-green-800">
              ✓ Approved
            </span>
            <span className="inline-block px-3 py-1 text-sm rounded bg-blue-100 text-blue-800">
              {article.post_type.replace('_', ' ')}
            </span>
            {article.video_compatible && (
              <span className="inline-block px-3 py-1 text-sm rounded bg-purple-100 text-purple-800">
                🎥 Video
              </span>
            )}
            {article.social_compatible && (
              <span className="inline-block px-3 py-1 text-sm rounded bg-blue-100 text-blue-800">
                📱 Social
              </span>
            )}
            {article.web_compatible && (
              <span className="inline-block px-3 py-1 text-sm rounded bg-green-100 text-green-800">
                🌐 Web
              </span>
            )}
          </div>
        </div>

        <div className="flex space-x-2">
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="px-4 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
          >
            {showDetails ? 'Hide Details' : 'Show Details'}
          </button>
          <button
            onClick={handlePublish}
            disabled={publishing}
            className="px-6 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
          >
            {publishing ? 'Publishing...' : '🚀 Publish'}
          </button>
        </div>
      </div>

      {/* Summary */}
      {article.summary_text && (
        <div className="mb-4 p-4 bg-purple-50 rounded">
          <div className="text-sm font-medium text-purple-900 mb-2">🎙️ TTS Summary:</div>
          <div className="text-gray-900">{article.summary_text}</div>
        </div>
      )}

      {/* Content Preview */}
      <div className="mb-4">
        <div className="text-sm font-medium text-gray-700 mb-2">📝 Content Preview:</div>
        <div className="text-gray-900 line-clamp-3" dangerouslySetInnerHTML={{ __html: article.post_text }} />
      </div>

      {/* Detailed View */}
      {showDetails && (
        <div className="border-t pt-4 space-y-4">
          {/* Clean Text for Social Media */}
          <div>
            <div className="text-sm font-medium text-gray-700 mb-2">📱 Clean Text (Social Media):</div>
            <div className="bg-gray-50 p-4 rounded text-sm font-mono whitespace-pre-wrap max-h-40 overflow-y-auto">
              {getCleanText(article.post_text)}
            </div>
          </div>

          {/* HTML for Website */}
          <div>
            <div className="text-sm font-medium text-gray-700 mb-2">🌐 HTML (Website):</div>
            <div className="bg-gray-50 p-4 rounded text-sm font-mono whitespace-pre-wrap max-h-40 overflow-y-auto">
              {article.post_text}
            </div>
          </div>

          {/* Image Assets */}
          {(article.image_headline || article.image_body_text) && (
            <div>
              <div className="text-sm font-medium text-gray-700 mb-2">🖼️ Image Assets:</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {article.image_headline && (
                  <div className="bg-yellow-50 p-3 rounded">
                    <div className="text-xs font-medium text-yellow-900 mb-1">Image Headline:</div>
                    <div className="text-sm text-yellow-800">{article.image_headline}</div>
                  </div>
                )}
                {article.image_body_text && (
                  <div className="bg-yellow-50 p-3 rounded">
                    <div className="text-xs font-medium text-yellow-900 mb-1">Image Body Text:</div>
                    <div className="text-sm text-yellow-800">{article.image_body_text}</div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Metadata */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <div className="font-medium text-gray-700">Word Count:</div>
              <div>{article.word_count_post || 0}</div>
            </div>
            <div>
              <div className="font-medium text-gray-700">Char Count:</div>
              <div>{article.char_count_post || 0}</div>
            </div>
            <div>
              <div className="font-medium text-gray-700">Content Type:</div>
              <div>{article.content_type}</div>
            </div>
            <div>
              <div className="font-medium text-gray-700">Byline:</div>
              <div>{article.byline || 'None'}</div>
            </div>
          </div>

          {/* Attribution */}
          {article.attribution_text && (
            <div>
              <div className="text-sm font-medium text-gray-700 mb-2">📚 Attribution:</div>
              <div className="bg-blue-50 p-3 rounded text-sm text-blue-800">
                {article.attribution_text}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// Audio Generation Card Component
function AudioGenerationCard({ item }) {
  const { aiSummary, ttsSummary, sourceInfo } = item
  const [selectedForTTS, setSelectedForTTS] = useState({
    aiSummary: aiSummary ? true : false,
    ttsSummary: ttsSummary ? true : false
  })

  return (
    <div className="bg-white rounded-lg shadow p-6">
      {/* Header */}
      <div className="mb-4 pb-3 border-b border-gray-200">
        <div className="flex justify-between items-start">
          <div className="flex-1">
            <h3 className="text-lg font-bold text-gray-900">
              {sourceInfo?.headline || 'Unknown Article'}
            </h3>
            <div className="text-sm text-gray-600 mt-1">
              Source: {sourceInfo?.source_name || 'Unknown'} • UUID: {sourceInfo?.article_uuid || 'N/A'}
            </div>
          </div>
          <div className="text-sm text-gray-500">
            {aiSummary && ttsSummary ? 'AI + TTS Available' :
             aiSummary ? 'AI Summary Only' :
             ttsSummary ? 'TTS Summary Only' : 'No Summary'}
          </div>
        </div>
      </div>

      {/* Summary Selection */}
      <div className="space-y-4 mb-6">
        {aiSummary && (
          <div className="flex items-start space-x-3">
            <input
              type="checkbox"
              checked={selectedForTTS.aiSummary}
              onChange={(e) => setSelectedForTTS(prev => ({ ...prev, aiSummary: e.target.checked }))}
              className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <div className="flex-1">
              <div className="text-sm font-medium text-gray-700 mb-1">🎙️ TTS Summary:</div>
              <div className="text-gray-900 bg-gray-50 p-3 rounded text-sm">
                {aiSummary.summary_text}
              </div>
              <div className="text-xs text-gray-500 mt-1">
                {aiSummary.summary_text.split(' ').length} words • AI Generated
              </div>
            </div>
          </div>
        )}

        {ttsSummary && (
          <div className="flex items-start space-x-3">
            <input
              type="checkbox"
              checked={selectedForTTS.ttsSummary}
              onChange={(e) => setSelectedForTTS(prev => ({ ...prev, ttsSummary: e.target.checked }))}
              className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <div className="flex-1">
              <div className="text-sm font-medium text-gray-700 mb-1">🎙️ TTS Summary (from Editor Article):</div>
              <div className="text-gray-900 bg-purple-50 p-3 rounded text-sm">
                {ttsSummary.summary_text}
              </div>
              <div className="text-xs text-gray-500 mt-1">
                {ttsSummary.summary_text.split(' ').length} words • By {ttsSummary.editor_name} • {new Date(ttsSummary.updated_at).toLocaleString()}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Audio Generator */}
      {(selectedForTTS.aiSummary || selectedForTTS.ttsSummary) && (
        <div className="border-t pt-4">
          <div className="text-sm font-medium text-gray-700 mb-3">🎙️ Audio Generator</div>
          <div className="space-y-4">
            {selectedForTTS.aiSummary && aiSummary && (
              <div className="bg-blue-50 p-4 rounded">
                <div className="text-sm font-medium text-blue-900 mb-2">📝 AI Summary Audio Generation:</div>
                <ScriptGenerator
                  summaryText={aiSummary.summary_text}
                  summaryUuid={aiSummary.summary_uuid}
                  editorArticleUuid={null}
                  editorSummaryText={null}
                  articleMetadata={{
                    headline: sourceInfo?.headline,
                    source: sourceInfo?.source_name
                  }}
                  onScriptGenerated={(script) => {
                    console.log('AI Summary script generated:', script.script_uuid);
                  }}
                  defaultExpanded={true}
                />
              </div>
            )}

            {selectedForTTS.ttsSummary && ttsSummary && (
              <div className="bg-purple-50 p-4 rounded">
                <div className="text-sm font-medium text-purple-900 mb-2">🎙️ Editor TTS Summary Audio Generation:</div>
                <ScriptGenerator
                  summaryText={ttsSummary.summary_text}
                  summaryUuid={null}
                  editorArticleUuid={ttsSummary.editor_article_uuid}
                  editorSummaryText={ttsSummary.summary_text}
                  articleMetadata={{
                    headline: ttsSummary.headline,
                    source: ttsSummary.source_name || 'Editor Created'
                  }}
                  onScriptGenerated={(script) => {
                    console.log('TTS Summary script generated:', script.script_uuid);
                  }}
                  defaultExpanded={true}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
