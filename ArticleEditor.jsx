import React, { useState, useEffect, useRef } from 'react'
import { api } from '../api/client'
import TipTapEditor from './TipTapEditor'
import HashtagEditor from './HashtagEditor'
import PlatformPreview from './PlatformPreview'
import FieldValidationIndicator from './FieldValidationIndicator'
import ConfidenceScore from './ConfidenceScore'
import BulkFieldOperations from './BulkFieldOperations'
import GenerationHistory from './GenerationHistory'
import LiveCharCounter from './LiveCharCounter'
import PlatformCustomization from './PlatformCustomization'

function ArticleEditor({ sourceArticle, mode, onSave, onCancel }) {
  // mode: 'create_copy' | 'create_original' | 'edit'

  const [activeTab, setActiveTab] = useState('post') // 'post' | 'source'

  const [formData, setFormData] = useState({
    headline: '',
    post_text: '',
    summary_text: '',
    image_headline: '',
    image_body_text: '',
    editor_name: 'editor',
    byline: '',
    content_type: mode === 'create_original' ? 'original' : 'sourced',
    post_type: 'original_research',
    video_compatible: false,
    social_compatible: true,
    web_compatible: true,
    attribution_text: '',
    // Source editing fields
    edited_headline: '',
    edited_html: '',
    use_edited_version: false
  })

  const [fullArticle, setFullArticle] = useState(null)
  const [counts, setCounts] = useState({
    wordCount: 0,
    charCount: 0,
    summaryWords: 0
  })

  const [platformWarnings, setPlatformWarnings] = useState([])
  const [platformLimits, setPlatformLimits] = useState([])
  const [summaryRequired, setSummaryRequired] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadingArticle, setLoadingArticle] = useState(false)
  const [error, setError] = useState(null)
  const [validationWarnings, setValidationWarnings] = useState([])
  const [isHeadlineModified, setIsHeadlineModified] = useState(false)
  const [showWYSIWYG, setShowWYSIWYG] = useState(true)

  const [aiMetadata, setAiMetadata] = useState(null)
  const [lockedFields, setLockedFields] = useState([])
  const [isGenerating, setIsGenerating] = useState(false)
  const [generationError, setGenerationError] = useState(null)
  const [showPlatformPreview, setShowPlatformPreview] = useState(false)

  const [hashtags, setHashtags] = useState([])
  const [autoAttribution, setAutoAttribution] = useState(true)
  const [fieldValidations, setFieldValidations] = useState({
    headline: 'empty',
    post_text: 'empty',
    summary_text: 'empty',
    image_headline: 'empty',
    image_body_text: 'empty',
    hashtags: 'empty',
    attribution_text: 'empty'
  })
  const [originalAIMetadata, setOriginalAIMetadata] = useState(null)
  const [generationHistory, setGenerationHistory] = useState([])
  const [showHistory, setShowHistory] = useState(false)
  const [compareData, setCompareData] = useState(null)
  const [liveCharCounts, setLiveCharCounts] = useState({
    headline: 0,
    post_text: 0,
    summary_text: 0,
    image_headline: 0,
    image_body_text: 0
  })
  const [platformOverrides, setPlatformOverrides] = useState({})
  const [showPlatformCustomization, setShowPlatformCustomization] = useState(false)

  const editorRef = useRef(null)

  // Load platform limits on mount
  useEffect(() => {
    loadPlatformLimits()
  }, [])

  // Load full article data if editing copy
  useEffect(() => {
    if (sourceArticle && mode === 'create_copy') {
      loadFullArticle(sourceArticle.article_uuid)
    }
  }, [sourceArticle, mode])

  // Check summary requirement when video_compatible or post_type changes
  useEffect(() => {
    checkSummaryRequirement()
  }, [formData.video_compatible, formData.post_type])

  // Sync content when switching back to WYSIWYG
  useEffect(() => {
    if (showWYSIWYG && editorRef.current && formData.post_text) {
      editorRef.current.innerHTML = formData.post_text
    }
  }, [showWYSIWYG])

  useEffect(() => {
    if (fullArticle && autoAttribution && formData.content_type === 'sourced') {
      const attribution = generateAttribution()
      setFormData(prev => ({ ...prev, attribution_text: attribution }))
    }
  }, [fullArticle, autoAttribution])

  useEffect(() => {
    const validations = {
      headline: validateField('headline', formData.headline, { required: true }),
      post_text: validateField('post_text', formData.post_text, { required: true }),
      summary_text: validateField('summary_text', formData.summary_text, { required: summaryRequired }),
      image_headline: validateField('image_headline', formData.image_headline),
      image_body_text: validateField('image_body_text', formData.image_body_text),
      hashtags: validateField('hashtags', hashtags),
      attribution_text: validateField('attribution_text', formData.attribution_text)
    }

    setFieldValidations(validations)
  }, [formData, hashtags, summaryRequired, fullArticle, showWYSIWYG])

  const loadFullArticle = async (articleUuid) => {
    setLoadingArticle(true)
    try {
      const response = await api.getArticle(articleUuid)
      const article = response.data
      setFullArticle(article)

      // Pre-fill form with full article data
      setFormData(prev => ({
        ...prev,
        headline: article.source_headline || article.headline || '',
        post_text: '', // Intentionally empty as per requirement #3
        content_type: 'sourced',
        edited_headline: article.source_headline || '',
        edited_html: article.cleaned_html || ''
      }))

      // Load article content into WYSIWYG
      if (editorRef.current && article.cleaned_html) {
        editorRef.current.innerHTML = article.cleaned_html
      }
    } catch (err) {
      console.error('Failed to load full article:', err)
      setError('Failed to load article content')
    } finally {
      setLoadingArticle(false)
    }
  }

  const loadPlatformLimits = async () => {
    try {
      const response = await api.getPlatformLimits()
      setPlatformLimits(response.data.platforms)
    } catch (err) {
      console.error('Failed to load platform limits:', err)
    }
  }

  const checkSummaryRequirement = async () => {
    try {
      const response = await api.validateSummaryRequirement({
        post_type: formData.post_type,
        video_compatible: formData.video_compatible
      })
      setSummaryRequired(response.data.summary_required)
    } catch (err) {
      console.error('Failed to check summary requirement:', err)
    }
  }

  const calculateCounts = (text) => {
    const words = text.trim().split(/\s+/).filter(w => w.length > 0).length
    const chars = text.length
    return { words, chars }
  }

  const validatePlatformLimits = (charCount) => {
    const warnings = []
    platformLimits.forEach(platform => {
      if (charCount > platform.char_limit) {
        warnings.push(platform.platform_name)
      }
    })
    return warnings
  }

  const handleInputChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }))

    // Check if headline matches original (copyright warning)
    if (field === 'headline' && fullArticle) {
      setIsHeadlineModified(value !== fullArticle.source_headline)
    }

    // Update counts for post_text
    if (field === 'post_text') {
      const { words, chars } = calculateCounts(value)
      setCounts(prev => ({ ...prev, wordCount: words, charCount: chars }))
      setPlatformWarnings(validatePlatformLimits(chars))
    }

    // Update summary word count
    if (field === 'summary_text') {
      const { words } = calculateCounts(value)
      setCounts(prev => ({ ...prev, summaryWords: words }))
    }

    // NEW: Update live char counts
    const charCount = typeof value === 'string' ? value.length : 0
    setLiveCharCounts(prev => ({ ...prev, [field]: charCount }))
  }

  const toggleFieldLock = (fieldName) => {
    setLockedFields(prev =>
      prev.includes(fieldName)
        ? prev.filter(f => f !== fieldName)
        : [...prev, fieldName]
    )
  }

  const handleAIGenerate = async () => {
    if (!sourceArticle?.article_uuid) {
      setError('No source article to generate from')
      return
    }

    setIsGenerating(true)
    setGenerationError(null)

    try {
      const response = await api.generateAIMetadata({
        source_article_uuid: sourceArticle.article_uuid,
        generation_mode: 'social_post',
        locked_fields: lockedFields,
        regenerate: false
      })

      if (response.data.success) {
        setAiMetadata(response.data)
        setOriginalAIMetadata(response.data)

        setGenerationHistory(prev => [response.data, ...prev])

        // Populate unlocked fields only
        const metadata = response.data.metadata
        const updates = {}

        if (!lockedFields.includes('headline')) updates.headline = metadata.headline
        if (!lockedFields.includes('post_text')) updates.post_text = metadata.post_text
        if (!lockedFields.includes('summary_text')) updates.summary_text = metadata.summary_text || ''
        if (!lockedFields.includes('image_headline')) updates.image_headline = metadata.image_headline || ''
        if (!lockedFields.includes('image_body_text')) updates.image_body_text = metadata.image_body_text || ''

        // Handle hashtags separately
        if (!lockedFields.includes('hashtags') && metadata.hashtags) {
          setHashtags(Array.isArray(metadata.hashtags) ? metadata.hashtags : [])
        }

        setFormData(prev => ({ ...prev, ...updates }))

        setLiveCharCounts({
          headline: (updates.headline || '').length,
          post_text: (updates.post_text || '').length,
          summary_text: (updates.summary_text || '').length,
          image_headline: (updates.image_headline || '').length,
          image_body_text: (updates.image_body_text || '').length
        })

        // Update WYSIWYG editor if visible
        if (showWYSIWYG && editorRef.current && updates.post_text) {
          editorRef.current.innerHTML = updates.post_text
          handleEditorInput()
        }

        alert('✨ AI metadata generated successfully! Review and edit as needed.')
      }
    } catch (err) {
      setGenerationError(err.response?.data?.message || 'AI generation failed')
      console.error('AI generation error:', err)
    } finally {
      setIsGenerating(false)
    }
  }
  const handleGeneratePlatformSpecific = async (platform, customPrompt) => {
    if (!sourceArticle?.article_uuid) {
      setError('No source article available')
      return
    }

    setIsGenerating(true)
    setGenerationError(null)

    try {
      const response = await api.generatePlatformSpecific({
        source_article_uuid: sourceArticle.article_uuid,
        platform: platform,
        custom_prompt: customPrompt,
        ai_params: {} // Will be populated from PlatformCustomization component
      })

      if (response.data.success) {
        const metadata = response.data.metadata

        // Update platform override
        const newOverrides = {
          ...platformOverrides,
          [platform]: {
            headline: metadata.headline,
            post_text: metadata.post_text,
            hashtags: metadata.hashtags || [],
            use_default: false
          }
        }

        setPlatformOverrides(newOverrides)
        alert(`✨ ${platform.charAt(0).toUpperCase() + platform.slice(1)} content generated successfully!`)
      }
    } catch (err) {
      setGenerationError(err.response?.data?.message || 'Platform generation failed')
      console.error('Platform generation error:', err)
    } finally {
      setIsGenerating(false)
    }
  }

  const handleAIRegenerate = async () => {
    if (!sourceArticle?.article_uuid) {
      setError('No source article to regenerate from')
      return
    }

    setIsGenerating(true)
    setGenerationError(null)

    try {
      const response = await api.generateAIMetadata({
        source_article_uuid: sourceArticle.article_uuid,
        generation_mode: 'social_post',
        locked_fields: lockedFields,
        regenerate: true
      })

      if (response.data.success) {
        setAiMetadata(response.data)
        setOriginalAIMetadata(response.data)

        setGenerationHistory(prev => [response.data, ...prev])

        const metadata = response.data.metadata
        const updates = {}

        if (!lockedFields.includes('headline')) updates.headline = metadata.headline
        if (!lockedFields.includes('post_text')) updates.post_text = metadata.post_text
        if (!lockedFields.includes('summary_text')) updates.summary_text = metadata.summary_text || ''
        if (!lockedFields.includes('image_headline')) updates.image_headline = metadata.image_headline || ''
        if (!lockedFields.includes('image_body_text')) updates.image_body_text = metadata.image_body_text || ''

        if (!lockedFields.includes('hashtags') && metadata.hashtags) {
          setHashtags(Array.isArray(metadata.hashtags) ? metadata.hashtags : [])
        }

        setFormData(prev => ({ ...prev, ...updates }))

        if (showWYSIWYG && editorRef.current && updates.post_text) {
          editorRef.current.innerHTML = updates.post_text
          handleEditorInput()
        }

        alert('✨ AI metadata regenerated! Locked fields were preserved.')
      }
    } catch (err) {
      setGenerationError(err.response?.data?.message || 'AI regeneration failed')
    } finally {
      setIsGenerating(false)
    }
  }

  const generateAttribution = () => {
    if (!fullArticle) return ''

    const source = fullArticle.source_name || 'Unknown Source'
    const date = fullArticle.created_at
      ? new Date(fullArticle.created_at).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      })
      : new Date().toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      })

    return `Source: ${source} • ${date}`
  }

  const handleLockAll = () => {
    const allFields = ['headline', 'post_text', 'summary_text', 'image_headline', 'image_body_text', 'hashtags', 'attribution_text']
    setLockedFields(allFields)
  }

  const handleUnlockAll = () => {
    setLockedFields([])
  }

  const handleResetToAI = () => {
    if (!originalAIMetadata) {
      alert('⚠️ No AI-generated content available to reset to.')
      return
    }

    const metadata = originalAIMetadata.metadata

    // Reset all fields to original AI values
    const updates = {
      headline: metadata.headline || '',
      post_text: metadata.post_text || '',
      summary_text: metadata.summary_text || '',
      image_headline: metadata.image_headline || '',
      image_body_text: metadata.image_body_text || '',
      attribution_text: metadata.attribution_text || ''
    }

    setFormData(prev => ({ ...prev, ...updates }))

    // Reset hashtags
    if (metadata.hashtags) {
      setHashtags(Array.isArray(metadata.hashtags) ? metadata.hashtags : [])
    }

    // Update WYSIWYG editor if visible
    if (showWYSIWYG && editorRef.current && updates.post_text) {
      editorRef.current.innerHTML = updates.post_text
      handleEditorInput()
    }

    // Unlock all fields after reset
    setLockedFields([])

    alert('✓ All fields reset to original AI-generated content')
  }

  const handleRestoreVersion = (versionData) => {
    const metadata = versionData.metadata

    // Restore all fields to this version
    const updates = {
      headline: metadata.headline || '',
      post_text: metadata.post_text || '',
      summary_text: metadata.summary_text || '',
      image_headline: metadata.image_headline || '',
      image_body_text: metadata.image_body_text || '',
      attribution_text: metadata.attribution_text || ''
    }

    setFormData(prev => ({ ...prev, ...updates }))

    // Restore hashtags
    if (metadata.hashtags) {
      setHashtags(Array.isArray(metadata.hashtags) ? metadata.hashtags : [])
    }

    // Update WYSIWYG editor if visible
    if (showWYSIWYG && editorRef.current && updates.post_text) {
      editorRef.current.innerHTML = updates.post_text
      handleEditorInput()
    }

    // Update current AI metadata
    setAiMetadata(versionData)
    setOriginalAIMetadata(versionData)

    alert('✓ Version restored successfully')
  }

  const handleCompareVersions = (version1, version2) => {
    setCompareData({ version1, version2 })
  }

  const validateField = (fieldName, value, rules = {}) => {
    // Handle different field types
    let actualValue = value

    if (fieldName === 'hashtags') {
      actualValue = Array.isArray(value) ? value : []
    }

    if (fieldName === 'post_text' && showWYSIWYG && editorRef.current) {
      actualValue = editorRef.current.innerText || ''
    }

    // Check if empty
    if (!actualValue || (Array.isArray(actualValue) && actualValue.length === 0) || actualValue.toString().trim() === '') {
      return {
        status: rules.required ? 'error' : 'empty',
        message: rules.required ? 'This field is required' : 'Optional field'
      }
    }

    // Field-specific validations
    switch (fieldName) {
      case 'headline':
        const headlineLength = actualValue.length
        if (headlineLength < 40) {
          return { status: 'warning', message: `Too short (${headlineLength}/40 min chars)` }
        }
        if (headlineLength > 120) {
          return { status: 'error', message: `Too long (${headlineLength}/120 max chars)` }
        }
        // Check if matches source headline (copyright issue)
        if (fullArticle && actualValue === fullArticle.source_headline) {
          return { status: 'error', message: 'Matches source - copyright risk!' }
        }
        return { status: 'valid', message: `Perfect (${headlineLength} chars)` }

      case 'post_text':
        const textContent = actualValue
        const charCount = textContent.length
        const wordCount = textContent.trim().split(/\s+/).length

        if (charCount < 200) {
          return { status: 'warning', message: `Short (${charCount}/200 min chars)` }
        }
        if (charCount > 5000) {
          return { status: 'error', message: `Too long (${charCount}/5000 max)` }
        }

        // Check platform limits
        if (charCount > 280) {
          return { status: 'warning', message: `Exceeds Twitter limit (${charCount}/280)` }
        }

        return { status: 'valid', message: `Great! (${wordCount} words, ${charCount} chars)` }

      case 'summary_text':
        const summaryLength = actualValue.length
        const summaryWords = actualValue.trim().split(/\s+/).length

        if (summaryRequired) {
          if (summaryLength < 150) {
            return { status: 'warning', message: `Too short (${summaryLength}/150 min)` }
          }
          if (summaryLength > 800) {
            return { status: 'error', message: `Too long (${summaryLength}/800 max)` }
          }
          return { status: 'valid', message: `Good (${summaryWords} words)` }
        }

        return { status: 'valid', message: `Optional (${summaryWords} words)` }

      case 'image_headline':
        const imgHeadlineLength = actualValue.length
        if (imgHeadlineLength < 15) {
          return { status: 'warning', message: `Short (${imgHeadlineLength}/15 min)` }
        }
        if (imgHeadlineLength > 60) {
          return { status: 'error', message: `Too long (${imgHeadlineLength}/60 max)` }
        }
        return { status: 'valid', message: `Perfect (${imgHeadlineLength} chars)` }

      case 'image_body_text':
        const imgBodyLength = actualValue.length
        if (imgBodyLength > 0 && imgBodyLength < 20) {
          return { status: 'warning', message: `Very short (${imgBodyLength}/20 min)` }
        }
        if (imgBodyLength > 120) {
          return { status: 'error', message: `Too long (${imgBodyLength}/120 max)` }
        }
        return imgBodyLength > 0
          ? { status: 'valid', message: `Good (${imgBodyLength} chars)` }
          : { status: 'empty', message: 'Optional' }

      case 'hashtags':
        const hashtagCount = actualValue.length
        if (hashtagCount < 3) {
          return { status: 'warning', message: `Add more (${hashtagCount}/3 min recommended)` }
        }
        if (hashtagCount > 10) {
          return { status: 'error', message: `Too many (${hashtagCount}/10 max)` }
        }
        return { status: 'valid', message: `Perfect (${hashtagCount} hashtags)` }

      case 'attribution_text':
        if (formData.content_type === 'sourced') {
          const attrLength = actualValue.length
          if (attrLength < 10) {
            return { status: 'warning', message: 'Attribution too short' }
          }
          return { status: 'valid', message: 'Attribution set' }
        }
        return { status: 'empty', message: 'Not needed for original content' }

      default:
        return { status: 'valid', message: 'OK' }
    }
  }

  const handleEditorInput = () => {
    if (editorRef.current) {
      const htmlContent = editorRef.current.innerHTML
      const textContent = editorRef.current.innerText

      // Update form data
      setFormData(prev => ({ ...prev, post_text: htmlContent }))

      // Update counts
      const { words, chars } = calculateCounts(textContent)
      setCounts({ wordCount: words, charCount: chars, summaryWords: counts.summaryWords })
      setPlatformWarnings(validatePlatformLimits(chars))

      // NEW: Update live char count for post_text
      setLiveCharCounts(prev => ({ ...prev, post_text: textContent.length }))
    }
  }

  const toggleEditor = () => {
    if (showWYSIWYG && editorRef.current) {
      // Capture content FIRST
      const currentContent = editorRef.current.innerHTML
      setFormData(prev => ({ ...prev, post_text: currentContent }))
    }
    // Toggle happens after state capture
    setShowWYSIWYG(!showWYSIWYG)
  }

  const validateForPublishing = () => {
    const warnings = []

    if (!formData.headline.trim()) {
      warnings.push('Post Headline is required for publishing')
    }

    const contentToCheck = showWYSIWYG && editorRef.current
      ? editorRef.current.innerHTML
      : formData.post_text

    if (!contentToCheck.trim()) {
      warnings.push('Post text is required for publishing')
    }

    if (summaryRequired && !formData.summary_text.trim()) {
      warnings.push('Summary is required for video-compatible posts')
    }

    if (platformWarnings.length > 0) {
      warnings.push(`Content exceeds character limits for: ${platformWarnings.join(', ')}`)
    }

    return warnings
  }

  const handleSubmit = async (status = 'draft') => {
    // Sync WYSIWYG content before saving
    if (showWYSIWYG && editorRef.current) {
      setFormData(prev => ({ ...prev, post_text: editorRef.current.innerHTML }))
    }

    const warnings = validateForPublishing()
    setValidationWarnings(warnings)

    if (status === 'approved' && warnings.length > 0) {
      const proceed = window.confirm(
        `⚠️ Publishing Requirements Not Met:\n\n${warnings.join('\n')}\n\nDo you want to save as DRAFT instead?`
      )
      if (proceed) {
        status = 'draft'
      } else {
        return
      }
    }

    // Minimal validation for draft
    const finalPostText = showWYSIWYG && editorRef.current
      ? editorRef.current.innerHTML
      : formData.post_text

    if (!formData.headline.trim() && !finalPostText.trim()) {
      setError('At least headline or post text is required to save a draft')
      return
    }

    setLoading(true)
    setError(null)

    try {
      const payload = {
        ...formData,
        post_text: finalPostText,
        hashtags: JSON.stringify(hashtags),
        platform_overrides: JSON.stringify(platformOverrides),
        source_article_uuid: sourceArticle?.article_uuid || null,
        status
      }

      const response = await api.createEditorArticle(payload)
      onSave(response.data)
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save article')
    } finally {
      setLoading(false)
    }
  }

  const handleSaveSourceEdit = async () => {
    if (!sourceArticle?.article_uuid) {
      setError('No source article to save edits for')
      return
    }

    setLoading(true)
    setError(null)

    try {
      // First create/update the editor article
      const payload = {
        ...formData,
        source_article_uuid: sourceArticle.article_uuid,
        status: 'draft'
      }

      const response = await api.createEditorArticle(payload)
      const editorArticleUuid = response.data.editor_article_uuid

      // Then save the source edits
      await api.updateSourceArticleEdit(editorArticleUuid, {
        edited_headline: formData.edited_headline,
        edited_html: formData.edited_html,
        use_edited_version: formData.use_edited_version
      })

      alert('✅ Source article edits saved successfully!')
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save source edits')
    } finally {
      setLoading(false)
    }
  }

  if (loadingArticle) {
    return (
      <div className="bg-white rounded-lg shadow-lg p-12 text-center">
        <div className="text-gray-500">Loading article content...</div>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-lg shadow-lg p-6 space-y-6">
      {/* Header with Back Button */}
      <div className="border-b pb-4">
        <div className="flex items-center justify-between mb-2">
          <button
            onClick={onCancel}
            className="flex items-center space-x-2 text-gray-600 hover:text-gray-900"
          >
            <span className="text-xl">←</span>
            <span className="text-sm font-medium">Back to Articles</span>
          </button>
        </div>

        <h2 className="text-2xl font-bold text-gray-900">
          {mode === 'create_original' ? '✏️ Write Original Post' :
            mode === 'create_copy' ? '📋 Prepare for Publishing' :
              'Edit Article'}
        </h2>

        {fullArticle && mode === 'create_copy' && (
          <div className="text-sm text-gray-500 mt-2 space-y-1">
            <div>📰 Source: {fullArticle.source_name || 'Unknown'}</div>
            <div>🔗 Original: {fullArticle.source_headline || 'Untitled'}</div>
            <div className="text-xs text-blue-600">💡 Original article is protected. Editing creates a separate copy.</div>
          </div>
        )}
      </div>

      {/* Tabs - Only show if editing sourced content */}
      {mode === 'create_copy' && fullArticle && (
        <div className="flex border-b">
          <button
            onClick={() => setActiveTab('post')}
            className={`px-6 py-3 font-medium ${activeTab === 'post'
              ? 'border-b-2 border-blue-600 text-blue-600'
              : 'text-gray-600 hover:text-gray-900'
              }`}
          >
            📱 Post Creation
          </button>
          <button
            onClick={() => setActiveTab('source')}
            className={`px-6 py-3 font-medium ${activeTab === 'source'
              ? 'border-b-2 border-blue-600 text-blue-600'
              : 'text-gray-600 hover:text-gray-900'
              }`}
          >
            📝 Source Article Editing
          </button>
        </div>
      )}

      {/* Validation Warnings Alert */}
      {validationWarnings.length > 0 && (
        <div className="bg-yellow-50 border-l-4 border-yellow-400 p-4 rounded">
          <div className="flex items-start">
            <div className="text-yellow-700">
              <div className="font-medium mb-2">⚠️ Publishing Requirements Not Met:</div>
              <ul className="list-disc list-inside space-y-1 text-sm">
                {validationWarnings.map((warning, i) => (
                  <li key={i}>{warning}</li>
                ))}
              </ul>
              <div className="mt-2 text-xs">
                You can still save as draft and complete these later.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB CONTENT: POST CREATION */}
      {activeTab === 'post' && (
        <div className="space-y-6">
          {mode === 'create_copy' && sourceArticle && (
            <>
              {/* AI Generation Controls */}
              <div className="flex gap-3 mb-6 p-4 bg-gradient-to-r from-purple-50 to-blue-50 border border-purple-200 rounded-lg">
                <button
                  onClick={handleAIGenerate}
                  disabled={isGenerating}
                  className="flex-1 px-4 py-3 bg-gradient-to-r from-purple-600 to-blue-600 text-white rounded-lg hover:from-purple-700 hover:to-blue-700 disabled:opacity-50 font-medium shadow-md transition-all"
                >
                  {isGenerating ? '⏳ Generating...' : '✨ Generate AI Metadata'}
                </button>

                {aiMetadata && (
                  <>
                    <button
                      onClick={handleAIRegenerate}
                      disabled={isGenerating}
                      className="px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium shadow-md transition-all"
                      title="Regenerate while preserving locked fields"
                    >
                      🔄 Regenerate
                    </button>

                    <button
                      onClick={() => setShowPlatformPreview(!showPlatformPreview)}
                      className="px-4 py-3 bg-gray-700 text-white rounded-lg hover:bg-gray-800 font-medium shadow-md transition-all"
                      title="View platform compatibility"
                    >
                      {showPlatformPreview ? '👁️ Hide Preview' : '📱 Platform Preview'}
                    </button>
                    <button
                      onClick={() => setShowPlatformCustomization(!showPlatformCustomization)}
                      className="px-4 py-3 bg-purple-600 text-white rounded-lg hover:bg-purple-700 font-medium shadow-md transition-all"
                      title="Customize content per platform"
                    >
                      {showPlatformCustomization ? '✏️ Hide Customization' : '⚙️ Platform Customization'}
                    </button>
                    {/* NEW: History button */}
                    <button
                      onClick={() => setShowHistory(!showHistory)}
                      className={`px-4 py-3 rounded-lg font-medium shadow-md transition-all ${showHistory
                        ? 'bg-purple-600 text-white hover:bg-purple-700'
                        : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-300'
                        }`}
                      title="View generation history"
                    >
                      📜 History {generationHistory.length > 0 && (
                        <span className="ml-1 px-2 py-0.5 bg-purple-100 text-purple-800 rounded-full text-xs">
                          {generationHistory.length}
                        </span>
                      )}
                    </button>
                  </>
                )}
              </div>

              {mode === 'create_copy' && sourceArticle && aiMetadata && (
                <div className="mb-6">
                  <BulkFieldOperations
                    lockedFields={lockedFields}
                    onLockAll={handleLockAll}
                    onUnlockAll={handleUnlockAll}
                    onResetToAI={handleResetToAI}
                    aiMetadata={originalAIMetadata}
                    availableFields={['headline', 'post_text', 'summary_text', 'image_headline', 'image_body_text', 'hashtags', 'attribution_text']}
                  />
                </div>
              )}

              {/* AI Generation Info with Confidence Scores */}
              {aiMetadata && (
                <div className="mb-6 space-y-3">
                  {/* Summary card */}
                  <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                    <div className="flex items-center justify-between mb-3">
                      <div className="text-sm text-green-800">
                        <span className="font-medium">✓ AI Generated</span>
                        {aiMetadata.from_cache && <span className="ml-2 text-xs">(from cache)</span>}
                        <span className="ml-2 text-xs text-gray-600">
                          {aiMetadata.generation_time_ms}ms • {aiMetadata.model_version}
                        </span>
                      </div>
                      <div className="text-xs text-gray-600">
                        🔒 {lockedFields.length} field(s) locked
                      </div>
                    </div>

                    {/* Overall confidence */}
                    {aiMetadata.confidence_scores && (
                      <div className="pt-3 border-t border-green-200">
                        <div className="text-xs font-medium text-gray-700 mb-2">AI Confidence Levels:</div>
                        <div className="grid grid-cols-2 gap-3">
                          {Object.entries(aiMetadata.confidence_scores).map(([field, score]) => (
                            <div key={field} className="flex items-center justify-between bg-white rounded px-3 py-2 border border-gray-200">
                              <span className="text-xs text-gray-600 capitalize">
                                {field.replace(/_/g, ' ')}
                              </span>
                              <ConfidenceScore score={score} showLabel={false} size="sm" />
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Field-level confidence indicators */}
                  <details className="group">
                    <summary className="cursor-pointer p-3 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-blue-800">
                          📊 View Detailed Confidence Analysis
                        </span>
                        <span className="text-blue-600 group-open:rotate-180 transition-transform">▼</span>
                      </div>
                    </summary>

                    <div className="mt-2 p-4 bg-white border border-gray-200 rounded-lg space-y-3">
                      {aiMetadata.confidence_scores && Object.entries(aiMetadata.confidence_scores).map(([field, score]) => {
                        const percentage = Math.round(score * 100)
                        let recommendation = ''

                        if (percentage >= 85) {
                          recommendation = 'AI is highly confident. Minor edits may be needed.'
                        } else if (percentage >= 70) {
                          recommendation = 'Good quality. Review and refine as needed.'
                        } else if (percentage >= 50) {
                          recommendation = 'Medium confidence. Significant editing recommended.'
                        } else {
                          recommendation = 'Low confidence. Consider manual rewrite.'
                        }

                        return (
                          <div key={field} className="p-3 bg-gray-50 rounded-lg border border-gray-200">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-sm font-semibold text-gray-900 capitalize">
                                {field.replace(/_/g, ' ')}
                              </span>
                              <ConfidenceScore score={score} showLabel={true} size="md" />
                            </div>
                            <div className="text-xs text-gray-600 mt-1">
                              💡 {recommendation}
                            </div>
                          </div>
                        )
                      })}

                      {/* Average confidence */}
                      {aiMetadata.confidence_scores && (
                        <div className="pt-3 border-t border-gray-200">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-semibold text-gray-900">Overall Average</span>
                            <ConfidenceScore
                              score={
                                Object.values(aiMetadata.confidence_scores).reduce((a, b) => a + b, 0) /
                                Object.keys(aiMetadata.confidence_scores).length
                              }
                              showLabel={true}
                              size="lg"
                            />
                          </div>
                          <div className="text-xs text-gray-500 mt-2">
                            This represents the AI's overall confidence across all generated fields.
                          </div>
                        </div>
                      )}
                    </div>
                  </details>
                </div>
              )}

              {/* Generation Error */}
              {generationError && (
                <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
                  <div className="text-sm text-red-800">
                    <span className="font-medium">⚠️ AI Generation Failed</span>
                    <p className="mt-1">{generationError}</p>
                    <p className="mt-2 text-xs">You can fill the fields manually or try again.</p>
                  </div>
                </div>
              )}

              {/* Platform Preview Panel */}
              {showPlatformPreview && aiMetadata && (
                <div className="mb-6 p-6 bg-white border-2 border-blue-300 rounded-lg shadow-lg">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-bold text-gray-900">📱 Platform Preview</h3>
                    <button
                      onClick={() => setShowPlatformPreview(false)}
                      className="text-gray-500 hover:text-gray-700 text-xl"
                      title="Close preview"
                    >
                      ✕
                    </button>
                  </div>

                  <PlatformPreview
                    platformValidation={aiMetadata.platform_validation}
                    headline={formData.headline}
                    postText={formData.post_text}
                    hashtags={hashtags}
                  />
                </div>
              )}
              {/* Platform Customization Panel */}
              {showPlatformCustomization && aiMetadata && (
                <div className="mb-6 p-6 bg-white border-2 border-purple-300 rounded-lg shadow-lg">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-bold text-gray-900">⚙️ Platform-Specific Customization</h3>
                    <button
                      onClick={() => setShowPlatformCustomization(false)}
                      className="text-gray-500 hover:text-gray-700 text-xl"
                      title="Close customization"
                    >
                      ✕
                    </button>
                  </div>

                  <div className="mb-4 p-3 bg-purple-50 border border-purple-200 rounded">
                    <div className="text-sm text-purple-800">
                      <strong>💡 Pro Tip:</strong> Customize content for each platform with AI-assisted generation.
                      Adjust tone, length, and emphasis per platform. Changes are saved separately per platform.
                    </div>
                  </div>

                  <PlatformCustomization
                    defaultContent={{
                      headline: formData.headline,
                      post_text: formData.post_text,
                      hashtags: hashtags
                    }}
                    platformOverrides={platformOverrides}
                    onChange={setPlatformOverrides}
                    onGeneratePlatformSpecific={handleGeneratePlatformSpecific}
                    sourceArticleUuid={sourceArticle?.article_uuid}
                  />
                </div>
              )}
              {/* Generation History Panel */}
              {showHistory && generationHistory.length > 0 && (
                <div className="mb-6 p-6 bg-white border-2 border-purple-300 rounded-lg shadow-lg">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-bold text-gray-900">📜 Generation History</h3>
                    <button
                      onClick={() => setShowHistory(false)}
                      className="text-gray-500 hover:text-gray-700 text-xl"
                      title="Close history"
                    >
                      ✕
                    </button>
                  </div>

                  <GenerationHistory
                    history={generationHistory}
                    currentVersion={aiMetadata}
                    onRestore={handleRestoreVersion}
                    onCompare={handleCompareVersions}
                  />
                </div>
              )}
            </>
          )}
          {/* Post Headline */}
          <div>
            {fullArticle && mode === 'create_copy' && (
              <div className="mb-2 p-3 bg-gray-50 rounded border border-gray-200">
                <span className="text-gray-600 text-sm">Original Headline: </span>
                <span className="text-gray-900 font-medium">{fullArticle.source_headline}</span>
              </div>
            )}

            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium text-gray-700">
                  Post Headline {validationWarnings.some(w => w.includes('Headline')) && <span className="text-red-600">*</span>}
                </label>
                <FieldValidationIndicator
                  status={fieldValidations.headline.status}
                  message={fieldValidations.headline.message}
                  required={true}
                />
                {aiMetadata?.confidence_scores?.headline && (
                  <ConfidenceScore
                    score={aiMetadata.confidence_scores.headline}
                    showLabel={false}
                    size="sm"
                  />
                )}
              </div>

              {mode === 'create_copy' && sourceArticle && (
                <button
                  onClick={() => toggleFieldLock('headline')}
                  className="text-xl hover:scale-110 transition-transform"
                  title={lockedFields.includes('headline') ? 'Unlock field for AI regeneration' : 'Lock field to prevent AI changes'}
                >
                  {lockedFields.includes('headline') ? '🔒' : '🔓'}
                </button>
              )}
            </div>

            <input
              type="text"
              value={formData.headline}
              onChange={(e) => handleInputChange('headline', e.target.value)}
              className={`w-full px-4 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 ${!isHeadlineModified && fullArticle ? 'bg-red-50 border-red-300' : ''
                } ${lockedFields.includes('headline') ? 'bg-yellow-50 border-yellow-300' : ''}`}
              placeholder="Enter post headline (must differ from original)"
            />
            {!isHeadlineModified && fullArticle && (
              <div className="text-xs text-red-600 mt-1">
                ⚠️ Post Headline matches original source - potential copyright issue. Please modify.
              </div>
            )}
            {lockedFields.includes('headline') && (
              <div className="text-xs text-yellow-600 mt-1">
                🔒 This field is locked and won't change during AI regeneration
              </div>
            )}
            {/* NEW: Live character counter */}
            <div className="mt-2">
              <LiveCharCounter
                current={liveCharCounts.headline}
                min={40}
                max={120}
                target={80}
                fieldName="headline"
                showSuggestions={true}
              />
            </div>
          </div>

          {/* WYSIWYG Editor / HTML Editor Toggle */}
          <div>
            <div className="flex justify-between items-center mb-2">
              <div className="flex items-center gap-2">
                <label className="block text-sm font-medium text-gray-700">
                  Post Text {validationWarnings.some(w => w.includes('Post text')) && <span className="text-red-600">*</span>}
                </label>
                <FieldValidationIndicator
                  status={fieldValidations.post_text.status}
                  message={fieldValidations.post_text.message}
                  required={true}
                />
              </div>

              <div className="flex items-center gap-2">
                {mode === 'create_copy' && sourceArticle && (
                  <button
                    onClick={() => toggleFieldLock('post_text')}
                    className="text-xl hover:scale-110 transition-transform"
                    title={lockedFields.includes('post_text') ? 'Unlock field' : 'Lock field'}
                  >
                    {lockedFields.includes('post_text') ? '🔒' : '🔓'}
                  </button>
                )}
                <button
                  onClick={toggleEditor}
                  className="text-xs px-3 py-1 bg-gray-200 rounded hover:bg-gray-300"
                >
                  {showWYSIWYG ? '📝 Switch to HTML' : '👁️ Switch to Visual'}
                </button>
              </div>
            </div>

            {showWYSIWYG ? (
              <div
                ref={editorRef}
                contentEditable
                onInput={handleEditorInput}
                className="w-full min-h-[300px] px-4 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white prose max-w-none"
                style={{ maxHeight: '500px', overflowY: 'auto' }}
              />
            ) : (
              <textarea
                value={formData.post_text}
                onChange={(e) => handleInputChange('post_text', e.target.value)}
                className="w-full px-4 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                rows="15"
                placeholder="HTML content"
              />
            )}

            <div className="mt-2 flex justify-between items-center text-sm">
              <div className="text-gray-600">
                {counts.wordCount} words | {counts.charCount} characters
              </div>
              {platformWarnings.length > 0 && (
                <div className="text-red-600">
                  🔴 Exceeds limits: {platformWarnings.join(', ')}
                </div>
              )}
            </div>

            {/* Platform limit indicators */}
            <div className="mt-2 space-y-1 text-xs">
              {platformLimits.map(platform => {
                const exceeded = counts.charCount > platform.char_limit
                return (
                  <div key={platform.platform_name} className={exceeded ? 'text-red-600' : 'text-green-600'}>
                    {exceeded ? '🔴' : '🟢'} {platform.platform_name}: {counts.charCount}/{platform.char_limit} chars
                  </div>
                )
              })}
            </div>
            {/* Enhanced live character counter for post_text */}
            <div className="mt-3">
              <LiveCharCounter
                current={liveCharCounts.post_text}
                min={200}
                max={5000}
                target={400}
                fieldName="post_text"
                showSuggestions={true}
              />
            </div>
          </div>

          {/* Summary Text */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <label className="text-sm font-medium text-gray-700">
                  Summary (for audio/video) {summaryRequired && <span className="text-red-600">*</span>}
                </label>
                <FieldValidationIndicator
                  status={fieldValidations.summary_text.status}
                  message={fieldValidations.summary_text.message}
                  required={summaryRequired}
                />
                {aiMetadata?.confidence_scores?.summary_text && (
                  <ConfidenceScore
                    score={aiMetadata.confidence_scores.summary_text}
                    showLabel={false}
                    size="sm"
                  />
                )}
              </div>

              {mode === 'create_copy' && sourceArticle && (
                <button
                  onClick={() => toggleFieldLock('summary_text')}
                  className="text-xl hover:scale-110 transition-transform"
                  title={lockedFields.includes('summary_text') ? 'Unlock field' : 'Lock field'}
                >
                  {lockedFields.includes('summary_text') ? '🔒' : '🔓'}
                </button>
              )}
            </div>

            {summaryRequired && (
              <div className="text-xs text-orange-600 mb-2">
                ⚠️ Summary required for this post type with video enabled
              </div>
            )}
            <textarea
              value={formData.summary_text}
              onChange={(e) => handleInputChange('summary_text', e.target.value)}
              className={`w-full px-4 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 ${lockedFields.includes('summary_text') ? 'bg-yellow-50 border-yellow-300' : ''
                }`}
              rows="4"
              placeholder="Optional summary for audio/video conversion"
            />
            <div className="mt-1 text-sm text-gray-600">
              {counts.summaryWords} words
            </div>
            {/* NEW: Live character counter for summary */}
            <div className="mt-2">
              <LiveCharCounter
                current={liveCharCounts.summary_text}
                min={150}
                max={800}
                target={400}
                fieldName="summary_text"
                showSuggestions={true}
              />
            </div>
          </div>

          {/* Image Rendering Section */}
          <div className="border-t pt-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-3">🖼️ Image Rendering Text (Optional)</h3>
            <div className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <label className="text-sm font-medium text-gray-700">
                      Image Headline
                    </label>
                    <FieldValidationIndicator
                      status={fieldValidations.image_headline.status}
                      message={fieldValidations.image_headline.message}
                      required={false}
                    />
                    {aiMetadata?.confidence_scores?.image_headline && (
                      <ConfidenceScore
                        score={aiMetadata.confidence_scores.image_headline}
                        showLabel={false}
                        size="sm"
                      />
                    )}
                  </div>

                  {mode === 'create_copy' && sourceArticle && (
                    <button
                      onClick={() => toggleFieldLock('image_headline')}
                      className="text-xl hover:scale-110 transition-transform"
                      title={lockedFields.includes('image_headline') ? 'Unlock field' : 'Lock field'}
                    >
                      {lockedFields.includes('image_headline') ? '🔒' : '🔓'}
                    </button>
                  )}
                </div>

                <input
                  type="text"
                  value={formData.image_headline}
                  onChange={(e) => handleInputChange('image_headline', e.target.value)}
                  className={`w-full px-4 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 ${lockedFields.includes('image_headline') ? 'bg-yellow-50 border-yellow-300' : ''
                    }`}
                  placeholder="Text for image overlay headline"
                />
                {/* NEW: Compact counter for image headline */}
                <div className="mt-1 text-xs flex items-center justify-between">
                  <span className={liveCharCounts.image_headline > 60 ? 'text-red-600' : 'text-gray-600'}>
                    {liveCharCounts.image_headline}/60 characters
                  </span>
                  {liveCharCounts.image_headline >= 15 && liveCharCounts.image_headline <= 60 && (
                    <span className="text-green-600">✓ Good length</span>
                  )}
                  {liveCharCounts.image_headline < 15 && liveCharCounts.image_headline > 0 && (
                    <span className="text-yellow-600">⚠️ Too short</span>
                  )}
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <label className="text-sm font-medium text-gray-700">
                      Image Body Text
                    </label>
                    <FieldValidationIndicator
                      status={fieldValidations.image_body_text.status}
                      message={fieldValidations.image_body_text.message}
                      required={false}
                    />
                    {aiMetadata?.confidence_scores?.image_body_text && (
                      <ConfidenceScore
                        score={aiMetadata.confidence_scores.image_body_text}
                        showLabel={false}
                        size="sm"
                      />
                    )}
                  </div>

                  {mode === 'create_copy' && sourceArticle && (
                    <button
                      onClick={() => toggleFieldLock('image_body_text')}
                      className="text-xl hover:scale-110 transition-transform"
                      title={lockedFields.includes('image_body_text') ? 'Unlock field' : 'Lock field'}
                    >
                      {lockedFields.includes('image_body_text') ? '🔒' : '🔓'}
                    </button>
                  )}
                </div>

                <textarea
                  value={formData.image_body_text}
                  onChange={(e) => handleInputChange('image_body_text', e.target.value)}
                  className={`w-full px-4 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 ${lockedFields.includes('image_body_text') ? 'bg-yellow-50 border-yellow-300' : ''
                    }`}
                  rows="3"
                  placeholder="Text for image overlay body"
                />
                {/* NEW: Compact counter for image body */}
                <div className="mt-1 text-xs flex items-center justify-between">
                  <span className={liveCharCounts.image_body_text > 120 ? 'text-red-600' : 'text-gray-600'}>
                    {liveCharCounts.image_body_text}/120 characters
                  </span>
                  {liveCharCounts.image_body_text >= 20 && liveCharCounts.image_body_text <= 120 && (
                    <span className="text-green-600">✓ Good length</span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Hashtags Section */}
          <div className="border-t pt-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-3">🏷️ Hashtags</h3>
            <HashtagEditor
              hashtags={hashtags}
              onChange={setHashtags}
              locked={lockedFields.includes('hashtags')}
              onToggleLock={mode === 'create_copy' && sourceArticle ? () => toggleFieldLock('hashtags') : null}
            />
          </div>

          {/* Attribution (for sourced content) */}
          {formData.content_type !== 'original' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-gray-700">
                  Source Attribution
                </label>

                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-2 text-xs text-gray-600">
                    <input
                      type="checkbox"
                      checked={autoAttribution}
                      onChange={(e) => setAutoAttribution(e.target.checked)}
                      className="h-4 w-4"
                    />
                    Auto-generate
                  </label>

                  {mode === 'create_copy' && sourceArticle && (
                    <button
                      onClick={() => toggleFieldLock('attribution_text')}
                      className="text-xl hover:scale-110 transition-transform"
                      title={lockedFields.includes('attribution_text') ? 'Unlock field' : 'Lock field'}
                    >
                      {lockedFields.includes('attribution_text') ? '🔒' : '🔓'}
                    </button>
                  )}
                </div>
              </div>

              {fullArticle && (
                <div className="p-3 bg-blue-50 rounded-lg border border-blue-200 text-sm">
                  <div className="text-gray-700 mb-2">
                    <strong>Source Information:</strong>
                  </div>
                  <div className="space-y-1 text-xs text-gray-600">
                    <div>📰 Publication: <strong>{fullArticle.source_name || 'Unknown'}</strong></div>
                    <div>📅 Date: <strong>{fullArticle.created_at
                      ? new Date(fullArticle.created_at).toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric'
                      })
                      : 'Unknown'}</strong></div>
                    <div>🔗 URL: <a href={fullArticle.source_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline break-all">{fullArticle.source_url || 'Not available'}</a></div>
                  </div>
                </div>
              )}

              <div className="flex gap-2">
                <input
                  type="text"
                  value={formData.attribution_text}
                  onChange={(e) => handleInputChange('attribution_text', e.target.value)}
                  className={`flex-1 px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${lockedFields.includes('attribution_text') ? 'bg-yellow-50 border-yellow-300' : ''
                    }`}
                  placeholder="e.g., Source: Bloomberg • Dec 8, 2024"
                  disabled={autoAttribution}
                />

                {!autoAttribution && (
                  <button
                    onClick={() => {
                      const attribution = generateAttribution()
                      setFormData(prev => ({ ...prev, attribution_text: attribution }))
                    }}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors whitespace-nowrap"
                    title="Generate attribution from source info"
                  >
                    ✨ Generate
                  </button>
                )}
              </div>

              {lockedFields.includes('attribution_text') && (
                <div className="text-xs text-yellow-600">
                  🔒 Attribution is locked and won't change during AI regeneration
                </div>
              )}

              <div className="text-xs text-gray-500">
                <strong>Tips:</strong> Auto-generation extracts publication name and date from source. Uncheck to customize manually.
              </div>
            </div>
          )}

          {/* Byline (for original content) */}
          {formData.content_type === 'original' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Byline
              </label>
              <input
                type="text"
                value={formData.byline}
                onChange={(e) => handleInputChange('byline', e.target.value)}
                className="w-full px-4 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="By John Smith, Senior Editor"
              />
            </div>
          )}

          {/* Post Type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Post Type
            </label>
            <select
              value={formData.post_type}
              onChange={(e) => handleInputChange('post_type', e.target.value)}
              className="w-full px-4 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="breaking_news">Breaking News</option>
              <option value="analysis">Analysis</option>
              <option value="market_update">Market Update</option>
              <option value="original_research">Original Research</option>
            </select>
          </div>

          {/* Output Compatibility */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-3">
              Output Compatibility
            </label>
            <div className="space-y-2">
              <label className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={formData.video_compatible}
                  onChange={(e) => handleInputChange('video_compatible', e.target.checked)}
                  className="h-4 w-4"
                />
                <span className="text-sm">🎥 Video Script Compatible</span>
              </label>
              <label className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={formData.social_compatible}
                  onChange={(e) => handleInputChange('social_compatible', e.target.checked)}
                  className="h-4 w-4"
                />
                <span className="text-sm">📱 Social Media Compatible</span>
              </label>
              <label className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  checked={formData.web_compatible}
                  onChange={(e) => handleInputChange('web_compatible', e.target.checked)}
                  className="h-4 w-4"
                />
                <span className="text-sm">🌐 Web Article Compatible</span>
              </label>
            </div>
          </div>
        </div>
      )}

      {/* TAB CONTENT: SOURCE ARTICLE EDITING */}
      {activeTab === 'source' && fullArticle && (
        <div className="space-y-6">
          <div className="bg-blue-50 border-l-4 border-blue-400 p-4 rounded mb-4">
            <p className="text-sm text-blue-800">
              <strong>📝 Source Article Editor:</strong> Edit the original article for cleanup and customization.
              This creates a separate copy that can be used for summarization.
            </p>
          </div>

          {/* Original Headline Reference */}
          <div className="p-3 bg-gray-50 rounded border border-gray-200">
            <span className="text-gray-600 text-sm font-medium">Original Headline: </span>
            <span className="text-gray-900">{fullArticle.source_headline}</span>
          </div>

          {/* Edited Headline */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Edited Headline
            </label>
            <input
              type="text"
              value={formData.edited_headline}
              onChange={(e) => handleInputChange('edited_headline', e.target.value)}
              className="w-full px-4 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Edit the source headline"
            />
            <div className="text-xs text-gray-500 mt-1">
              Customize the headline for your editorial needs
            </div>
          </div>

          {/* Edited Article Body - TipTap Editor */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Article Body
            </label>
            <TipTapEditor
              content={formData.edited_html}
              onChange={(html) => handleInputChange('edited_html', html)}
              placeholder="Edit the source article content..."
            />
            <div className="text-xs text-gray-500 mt-1">
              Remove noise, add context, and customize the article
            </div>
          </div>

          {/* Use Edited Version Toggle */}
          <div className="border-t pt-4">
            <label className="flex items-start space-x-3">
              <input
                type="checkbox"
                checked={formData.use_edited_version}
                onChange={(e) => handleInputChange('use_edited_version', e.target.checked)}
                className="h-5 w-5 mt-1"
              />
              <div>
                <span className="text-sm font-medium text-gray-900">Use edited version for summarization</span>
                <p className="text-xs text-gray-600 mt-1">
                  When checked, the AI summarization will use your edited version instead of the original source article
                </p>
              </div>
            </label>
          </div>

          {/* Save Source Edit Button */}
          <div className="flex space-x-4 pt-4 border-t">
            <button
              onClick={handleSaveSourceEdit}
              disabled={loading}
              className="flex-1 px-6 py-3 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
            >
              {loading ? 'Saving...' : '💾 Save Source Edits'}
            </button>
          </div>
        </div>
      )}

      {/* Error Display */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
          {error}
        </div>
      )}

      {/* Action Buttons - Only show for Post Creation tab */}
      {activeTab === 'post' && (
        <>
          <div className="flex space-x-4 pt-4 border-t">
            <button
              onClick={onCancel}
              disabled={loading}
              className="px-6 py-3 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={() => handleSubmit('draft')}
              disabled={loading}
              className="flex-1 px-6 py-3 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? 'Saving...' : '💾 Save Draft'}
            </button>
            <button
              onClick={() => handleSubmit('approved')}
              disabled={loading}
              className="flex-1 px-6 py-3 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
            >
              {loading ? 'Approving...' : '✓ Approve for Publish'}
            </button>
          </div>

          <div className="text-xs text-gray-500 text-center">
            💡 Tip: Save as draft to continue with summarization. Complete publishing requirements later.
          </div>
        </>
      )}
      {/* Comparison Modal */}
      {compareData && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-2xl max-w-6xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            {/* Header */}
            <div className="p-6 border-b border-gray-200 flex items-center justify-between bg-gradient-to-r from-purple-50 to-blue-50">
              <h3 className="text-xl font-bold text-gray-900">🔍 Compare Versions</h3>
              <button
                onClick={() => setCompareData(null)}
                className="text-gray-500 hover:text-gray-700 text-2xl"
              >
                ✕
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6">
              <div className="grid grid-cols-2 gap-6">
                {/* Version 1 */}
                <div className="space-y-4">
                  <div className="p-3 bg-purple-50 border border-purple-200 rounded-lg">
                    <div className="font-semibold text-purple-900">
                      Version #{generationHistory.indexOf(compareData.version1) + 1}
                    </div>
                    <div className="text-xs text-gray-600">
                      {new Date(compareData.version1.generated_at).toLocaleString()}
                    </div>
                  </div>

                  {Object.entries(compareData.version1.metadata).map(([field, value]) => (
                    <div key={field} className="p-3 bg-gray-50 rounded-lg border border-gray-200">
                      <div className="text-xs font-semibold text-gray-700 mb-2 capitalize">
                        {field.replace(/_/g, ' ')}
                      </div>
                      <div className="text-sm text-gray-900 whitespace-pre-wrap">
                        {Array.isArray(value) ? value.join(', ') : value || '(empty)'}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Version 2 */}
                <div className="space-y-4">
                  <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                    <div className="font-semibold text-blue-900">
                      Version #{generationHistory.indexOf(compareData.version2) + 1}
                    </div>
                    <div className="text-xs text-gray-600">
                      {new Date(compareData.version2.generated_at).toLocaleString()}
                    </div>
                  </div>

                  {Object.entries(compareData.version2.metadata).map(([field, value]) => {
                    const v1Value = compareData.version1.metadata[field]
                    const isDifferent = JSON.stringify(v1Value) !== JSON.stringify(value)

                    return (
                      <div
                        key={field}
                        className={`p-3 rounded-lg border ${isDifferent
                          ? 'bg-yellow-50 border-yellow-300'
                          : 'bg-gray-50 border-gray-200'
                          }`}
                      >
                        <div className="text-xs font-semibold text-gray-700 mb-2 capitalize flex items-center gap-2">
                          {field.replace(/_/g, ' ')}
                          {isDifferent && <span className="text-yellow-600">⚠️ Different</span>}
                        </div>
                        <div className="text-sm text-gray-900 whitespace-pre-wrap">
                          {Array.isArray(value) ? value.join(', ') : value || '(empty)'}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-gray-200 bg-gray-50 flex gap-3">
              <button
                onClick={() => {
                  handleRestoreVersion(compareData.version1)
                  setCompareData(null)
                }}
                className="flex-1 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 font-medium"
              >
                Restore Version 1
              </button>
              <button
                onClick={() => {
                  handleRestoreVersion(compareData.version2)
                  setCompareData(null)
                }}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
              >
                Restore Version 2
              </button>
              <button
                onClick={() => setCompareData(null)}
                className="px-6 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 font-medium"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default ArticleEditor
