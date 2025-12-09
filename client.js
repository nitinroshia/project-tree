import axios from 'axios'

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5001'

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json'
  }
})

const SCRIPT_API_URL = import.meta.env.VITE_SCRIPT_API_URL || 'http://localhost:5002'

const scriptClient = axios.create({
  baseURL: SCRIPT_API_URL,
  headers: { 'Content-Type': 'application/json' }
})

// Error interceptor
apiClient.interceptors.response.use(
  response => response,
  error => {
    console.error('API Error:', error.response?.data || error.message)
    return Promise.reject(error)
  }
)

// API methods
export const api = {
  // Articles (Phase 3.1)
  getArticles: (params) =>
    apiClient.get('/api/editorial/articles', { params }),

  getArticle: (articleUuid) =>
    apiClient.get(`/api/articles/${articleUuid}`),

  // Summarization (Phase 3.1)
  createSummary: (data) =>
    apiClient.post('/api/editorial/summarize', data),

  getSummaries: () =>
    apiClient.get('/summaries'),

  approveSummary: (summaryUuid, data) =>
    apiClient.put(`/api/editorial/summaries/${summaryUuid}/approve`, data),

  rejectSummary: (summaryUuid, data) =>
    apiClient.put(`/api/editorial/summaries/${summaryUuid}/reject`, data),

  updateSummary: (summaryUuid, data) =>
    apiClient.put(`/api/editorial/summaries/${summaryUuid}`, data),

  // Stories (Phase 3.1)
  getStories: (params) =>
    apiClient.get('/api/editorial/stories', { params }),

  createStory: (data) =>
    apiClient.post('/api/editorial/stories', data),

  updateStory: (storyUuid, data) =>
    apiClient.put(`/api/editorial/stories/${storyUuid}`, data),

  // Editor Articles (Phase 3.2)
  getEditorArticles: (params) =>
    apiClient.get('/api/editorial/editor-articles', { params }),

  getEditorArticle: (editorArticleUuid) =>
    apiClient.get(`/api/editorial/editor-articles/${editorArticleUuid}`),

  createEditorArticle: (data) =>
    apiClient.post('/api/editorial/editor-articles', data),

  updateEditorArticle: (editorArticleUuid, data) =>
    apiClient.put(`/api/editorial/editor-articles/${editorArticleUuid}`, data),

  // Platform Validation (Phase 3.2)
  getPlatformLimits: () =>
    apiClient.get('/api/editorial/platform-limits'),

  validateSummaryRequirement: (data) =>
    apiClient.post('/api/editorial/validate-summary', data),

  // Phase 2.5: AI Metadata Generation
  generateAIMetadata: (data) =>
    apiClient.post('/api/editorial/ai-generate-metadata', data),

  updateSourceArticleEdit: (editorArticleUuid, data) =>
    apiClient.put(`/api/editorial/editor-articles/${editorArticleUuid}/source-edit`, data),

  // Original Articles
  createOriginalArticle: (data) =>
    apiClient.post(`/api/editorial/original-articles`, data),

  updateOriginalArticle: (articleUuid, data) =>
    apiClient.put(`/api/editorial/original-articles/${articleUuid}`, data),

  // ============================================
  // PHASE 4: SCRIPT GENERATION (ADD THIS BLOCK)
  // ============================================

  // Phase 4: Script Generation
  generateScript: (data) => scriptClient.post('/api/script/generate', data),

  getScript: (scriptUuid) => scriptClient.get(`/api/script/${scriptUuid}`),

  downloadScript: (scriptUuid, format = 'vtt') =>
    scriptClient.get(`/api/script/${scriptUuid}/download`, {
      params: { format },
      responseType: 'blob',
    }),

  generateAudio: (scriptUuid, voiceSettings) =>
    scriptClient.post(`/api/script/${scriptUuid}/generate-audio`, voiceSettings),

  getTtsUsage: () => scriptClient.get('/api/tts/usage'),

  getScriptTemplates: () => scriptClient.get('/api/scripts/templates'),

  getAudioPresets: () =>
    scriptClient.get('/api/audio/presets'),

  // END PHASE 4
  // ============================================
}

export default apiClient
