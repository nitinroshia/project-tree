import React, { useEffect, useState } from 'react'
import { api } from '../api/client'

function EditorArticlesPage() {
  const [editorArticles, setEditorArticles] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState({ status: '', post_type: '' })

  useEffect(() => {
    loadEditorArticles()
  }, [filter])

  const loadEditorArticles = async () => {
    setLoading(true)
    try {
      const response = await api.getEditorArticles(filter)
      setEditorArticles(response.data.editor_articles || [])
    } catch (error) {
      console.error('Failed to load editor articles:', error)
    } finally {
      setLoading(false)
    }
  }

  const getStatusBadge = (status) => {
    const colors = {
      draft: 'bg-yellow-100 text-yellow-800',
      approved: 'bg-green-100 text-green-800',
      published: 'bg-blue-100 text-blue-800',
      archived: 'bg-gray-100 text-gray-800'
    }
    return colors[status] || 'bg-gray-100 text-gray-800'
  }

  const getTypeBadge = (type) => {
    const colors = {
      breaking_news: 'bg-red-100 text-red-800',
      analysis: 'bg-purple-100 text-purple-800',
      market_update: 'bg-blue-100 text-blue-800',
      original_research: 'bg-green-100 text-green-800'
    }
    return colors[type] || 'bg-gray-100 text-gray-800'
  }

  if (loading) {
    return <div className="text-center py-12">Loading editor articles...</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-gray-900">Editor Articles</h1>
      </div>

      {/* Filters */}
      <div className="bg-white p-4 rounded-lg shadow flex space-x-4">
        <select
          value={filter.status}
          onChange={(e) => setFilter({ ...filter, status: e.target.value })}
          className="px-4 py-2 border rounded"
        >
          <option value="">All Statuses</option>
          <option value="draft">Draft</option>
          <option value="approved">Approved</option>
          <option value="published">Published</option>
          <option value="archived">Archived</option>
        </select>

        <select
          value={filter.post_type}
          onChange={(e) => setFilter({ ...filter, post_type: e.target.value })}
          className="px-4 py-2 border rounded"
        >
          <option value="">All Types</option>
          <option value="breaking_news">Breaking News</option>
          <option value="analysis">Analysis</option>
          <option value="market_update">Market Update</option>
          <option value="original_research">Original Research</option>
        </select>
      </div>

      {/* Articles Grid */}
      {editorArticles.length === 0 ? (
        <div className="bg-white p-8 rounded-lg shadow text-center text-gray-500">
          No editor articles found. Create your first post in the Articles section.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {editorArticles.map(article => (
            <div key={article.editor_article_uuid} className="bg-white p-6 rounded-lg shadow hover:shadow-lg transition">
              <div className="flex justify-between items-start mb-3">
                <h3 className="text-lg font-bold text-gray-900 line-clamp-2">
                  {article.headline}
                </h3>
              </div>

              <div className="space-y-2 mb-4">
                <div className="flex space-x-2">
                  <span className={`px-2 py-1 text-xs rounded ${getStatusBadge(article.status)}`}>
                    {article.status}
                  </span>
                  <span className={`px-2 py-1 text-xs rounded ${getTypeBadge(article.post_type)}`}>
                    {article.post_type.replace('_', ' ')}
                  </span>
                </div>

                <div className="text-sm text-gray-600">
                  <div>{article.content_type}</div>
                  <div>{article.word_count_post} words | {article.char_count_post} chars</div>
                  <div>By {article.editor_name}</div>
                </div>
              </div>

              <div className="text-sm text-gray-700 line-clamp-3 mb-4">
                {article.post_text}
              </div>

              {/* Compatibility Icons */}
              <div className="flex space-x-2 text-xs">
                {article.video_compatible && (
                  <span className="px-2 py-1 bg-purple-100 text-purple-800 rounded">
                    🎥 Video
                  </span>
                )}
                {article.social_compatible && (
                  <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded">
                    📱 Social
                  </span>
                )}
                {article.web_compatible && (
                  <span className="px-2 py-1 bg-green-100 text-green-800 rounded">
                    🌐 Web
                  </span>
                )}
              </div>

              {/* Platform Warnings */}
              {article.platform_warnings && article.platform_warnings.length > 0 && (
                <div className="mt-3 text-xs text-red-600">
                  ⚠️ Exceeds: {JSON.parse(article.platform_warnings).join(', ')}
                </div>
              )}

              <div className="mt-4 text-xs text-gray-500">
                {new Date(article.updated_at).toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default EditorArticlesPage
