# Phase 2.5-4 Integration Workflow Gap - Handoff Document

**Date:** December 8, 2024  
**Context Tokens Used:** 116K/190K  
**Status:** Critical architecture issue identified  
**Priority:** HIGH - Blocks Phase 04 audio generation workflow

---

## 🎯 **CORE ISSUE**

Editor articles with AI-generated metadata and TTS summaries are saved but **not accessible in Review Queue** for audio generation.

### **User's Complaint:**
> "I generate AI metadata, save as draft/approve, but cannot recall it in Review Queue to generate audio. The TTS summary field is missing from the workflow."

---

## 📊 **CURRENT SYSTEM STATE**

### **Database Tables (Verified Working):**

```sql
-- Phase 01
articles (
  article_uuid UUID PK,
  source_headline TEXT,
  cleaned_html TEXT,
  source_name TEXT
)

-- Phase 03
editor_articles (
  editor_article_uuid UUID PK,
  source_article_uuid UUID FK,
  headline TEXT,
  post_text TEXT,
  summary_text TEXT,              -- ⚠️ THIS IS THE TTS SCRIPT!
  image_headline TEXT,
  status VARCHAR(50),             -- draft, approved, published
  platform_overrides JSONB,       -- NEW: Phase 2.5
  created_at TIMESTAMP
)

-- Phase 02
summaries (
  summary_uuid UUID PK,
  article_ids INTEGER[],
  summary_text TEXT,              -- ⚠️ DIFFERENT from editor_articles.summary_text
  approved BOOLEAN,
  editor_article_uuid UUID FK,    -- ⚠️ CONNECTION EXISTS BUT UNDERUTILIZED
  created_at TIMESTAMP
)

-- Phase 04
scripts (
  script_uuid UUID PK,
  summary_uuid UUID FK,
  editor_article_uuid UUID FK,
  audio_file_path TEXT,
  tts_vtt_path TEXT
)
```

### **The Gap:**

```
ArticleEditor.jsx (Phase 03)
    ↓ Saves to
editor_articles.summary_text = "TTS optimized script"
editor_articles.status = "draft" or "approved"
    ↓
    ❌ NO PATH TO ↓
    ↓
Review Queue (Phase 03)
    ↓ Only shows
summaries table (different content!)
    ↓
ScriptGenerator (Phase 04)
    ↓ Cannot access
editor_articles.summary_text
```

---

## 🔧 **WHAT USER WANTS**

### **Review Queue Requirements:**

1. **Unified View:** Show BOTH summaries AND editor_articles
   - Tab: "Pending (3) | Approved (5) | All (8)"
   - Each entry shows BOTH summary types:
     - `summaries.summary_text` (main summary)
     - `editor_articles.summary_text` (TTS script)

2. **Dual Summary Editing:**
   ```
   [ ] Use Main Summary    (summaries.summary_text)
   [ ] Use TTS Summary     (editor_articles.summary_text)
   
   [✏️ Edit Main Summary]
   [✏️ Edit TTS Summary]
   ```

3. **Audio Generation:**
   - Checkbox toggles which summary feeds ScriptGenerator
   - Both summaries editable inline
   - Audio generation works from either source

---

## 📁 **FILES INVOLVED**

### **Frontend (Phase 03):**

**1. SummaryReview.jsx**
- Location: `phase-03-editor/src/components/SummaryReview.jsx`
- Current: Only displays `summary.summary_text`
- Needed: Display BOTH `summary.summary_text` AND `editorArticle.summary_text`
- Link: https://raw.githubusercontent.com/nitinroshia/project-tree/refs/heads/main/SummaryReview.jsx

**2. ScriptGenerator.jsx**
- Location: `phase-03-editor/src/components/ScriptGenerator.jsx`
- Current Props: `summaryText, imageSummaryText`
- Needed Props: `summaryText, editorSummaryText` (rename)
- Link: https://raw.githubusercontent.com/nitinroshia/project-tree/refs/heads/main/ScriptGenerator.jsx

**3. QueuePage.jsx**
- Location: `phase-03-editor/src/pages/QueuePage.jsx`
- Current: Fetches only summaries
- Needed: Fetch summaries + JOIN editor_articles
- Link: https://raw.githubusercontent.com/nitinroshia/project-tree/refs/heads/main/QueuePage.jsx

### **Backend (Phase 02):**

**4. api.py**
- Location: `phase-02-summarization/api.py`
- Endpoint to fix: `/api/editorial/summaries` or similar
- Current query: `SELECT * FROM summaries WHERE approved IS NOT NULL`
- Needed query:
```python
cur.execute("""
    SELECT 
        s.summary_uuid,
        s.summary_text as main_summary,
        s.approved,
        s.created_at,
        ea.editor_article_uuid,
        ea.summary_text as tts_summary,
        ea.headline,
        ea.status
    FROM summaries s
    LEFT JOIN editor_articles ea ON s.editor_article_uuid = ea.editor_article_uuid
    WHERE s.approved IS NOT NULL
    ORDER BY s.created_at DESC
""")
```
- Link: https://raw.githubusercontent.com/nitinroshia/project-tree/refs/heads/main/api.py
---

## 🎯 **SOLUTION ARCHITECTURE**

### **Option A: Unified Review Queue (Recommended)**

**Data Structure:**
```javascript
// Fetch merged data
{
  summary_uuid: "uuid-1",
  main_summary: "Article summarizes...",      // from summaries.summary_text
  tts_summary: "In today's video...",         // from editor_articles.summary_text
  approved: true,
  editor_article_uuid: "uuid-2",
  status: "approved"
}
```

**UI Changes:**
```jsx
<SummaryReview summary={mergedData}>
  {/* Main Summary Section */}
  <div>
    <label>Main Summary</label>
    <textarea value={mainSummary} />
    <button onClick={editMainSummary}>✏️ Edit</button>
  </div>

  {/* TTS Summary Section */}
  {ttsSummary && (
    <div>
      <label>TTS Summary (for audio/video)</label>
      <textarea value={ttsSummary} />
      <button onClick={editTTSSummary}>✏️ Edit</button>
    </div>
  )}

  {/* Audio Generation */}
  <ScriptGenerator
    summaryOptions={[
      { label: "Main Summary", text: mainSummary },
      { label: "TTS Summary", text: ttsSummary }
    ]}
    onGenerate={(selectedText) => generateAudio(selectedText)}
  />
</SummaryReview>
```

### **Option B: Separate Tabs**

```
Review Queue
├── Summaries Tab (current)
│   └── Shows summaries.summary_text
└── Editor Articles Tab (NEW)
    └── Shows editor_articles with summary_text
```

---

## 🔨 **IMPLEMENTATION STEPS**

### **Step 1: Backend Query Fix**

**File:** `phase-02-summarization/api.py`

Find the endpoint that serves summaries to Review Queue (likely `/api/editorial/summaries` or `/api/queue/approved`).

**Replace with:**
```python
@app.route('/api/editorial/summaries', methods=['GET'])
def get_summaries_for_review():
    try:
        conn = psycopg2.connect(DB_CONN)
        cur = conn.cursor()
        
        cur.execute("""
            SELECT 
                s.summary_uuid,
                s.summary_text as main_summary,
                s.approved,
                s.quality_score,
                s.created_at,
                s.editor_notes,
                ea.editor_article_uuid,
                ea.summary_text as tts_summary,
                ea.headline,
                ea.post_text,
                ea.status as article_status
            FROM summaries s
            LEFT JOIN editor_articles ea ON s.editor_article_uuid = ea.editor_article_uuid
            ORDER BY s.created_at DESC
        """)
        
        rows = cur.fetchall()
        cur.close()
        conn.close()
        
        summaries = []
        for row in rows:
            summaries.append({
                'summary_uuid': str(row[0]),
                'summary_text': row[1],        # Main summary
                'approved': row[2],
                'quality_score': row[3],
                'created_at': row[4].isoformat() if row[4] else None,
                'editor_notes': row[5],
                'editor_article_uuid': str(row[6]) if row[6] else None,
                'editor_summary_text': row[7],  # TTS summary
                'headline': row[8],
                'post_text': row[9],
                'article_status': row[10]
            })
        
        return jsonify({'summaries': summaries}), 200
        
    except Exception as e:
        print(f"ERROR: {e}")
        return jsonify({'error': str(e)}), 500
```

### **Step 2: Frontend - SummaryReview.jsx**

**Add state for TTS summary:**
```javascript
const [ttsSummary, setTtsSummary] = useState(summary.editor_summary_text || '')
const [editingTTS, setEditingTTS] = useState(false)
```

**Add TTS summary section after main summary:**
```jsx
{/* TTS Summary Section */}
{summary.editor_summary_text && (
  <div className="mb-4 p-4 bg-purple-50 rounded border border-purple-200">
    <div className="flex justify-between items-center mb-2">
      <div className="text-sm font-medium text-purple-900">
        🎙️ TTS Summary (for audio/video):
      </div>
      {!editingTTS && (
        <button
          onClick={() => setEditingTTS(true)}
          className="text-xs px-3 py-1 bg-purple-600 text-white rounded hover:bg-purple-700"
        >
          ✏️ Edit TTS Summary
        </button>
      )}
    </div>

    {editingTTS ? (
      <div className="space-y-2">
        <textarea
          value={ttsSummary}
          onChange={(e) => setTtsSummary(e.target.value)}
          className="w-full px-3 py-2 border rounded focus:ring-2 focus:ring-purple-500"
          rows="6"
        />
        <div className="flex space-x-2">
          <button
            onClick={handleUpdateTTSSummary}
            disabled={loading}
            className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
          >
            Save TTS Summary
          </button>
          <button
            onClick={() => {
              setTtsSummary(summary.editor_summary_text)
              setEditingTTS(false)
            }}
            className="px-4 py-2 bg-gray-300 text-gray-700 rounded"
          >
            Cancel
          </button>
        </div>
      </div>
    ) : (
      <div className="text-gray-900 whitespace-pre-wrap">{ttsSummary}</div>
    )}
  </div>
)}
```

### **Step 3: Frontend - ScriptGenerator.jsx**

**Update props and add selector:**
```javascript
const ScriptGenerator = ({ 
  summaryText,           // Main summary
  editorSummaryText,     // TTS summary
  summaryUuid,
  editorArticleUuid
}) => {
  const [summarySource, setSummarySource] = useState('editor') // 'main' or 'editor'
  
  const selectedText = summarySource === 'editor' ? editorSummaryText : summaryText
  
  return (
    <div className="mt-4 p-6 bg-white border rounded-lg">
      <h3 className="text-lg font-bold mb-4">🎙️ Audio Generator</h3>
      
      {/* Summary Source Selector */}
      {editorSummaryText && (
        <div className="mb-4 p-3 bg-blue-50 rounded">
          <label className="text-sm font-medium text-gray-700 mb-2 block">
            Select summary for audio generation:
          </label>
          <div className="space-y-2">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                value="main"
                checked={summarySource === 'main'}
                onChange={(e) => setSummarySource(e.target.value)}
              />
              <span>Main Summary ({summaryText?.length || 0} chars)</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                value="editor"
                checked={summarySource === 'editor'}
                onChange={(e) => setSummarySource(e.target.value)}
              />
              <span>TTS Summary ({editorSummaryText?.length || 0} chars) - Optimized for audio</span>
            </label>
          </div>
        </div>
      )}
      
      {/* Rest of ScriptGenerator UI */}
      {/* ... */}
    </div>
  )
}
```

---

## 🧪 **TESTING CHECKLIST**

- [ ] Backend query returns both `summary_text` and `editor_summary_text`
- [ ] Review Queue displays both summaries
- [ ] Can edit main summary independently
- [ ] Can edit TTS summary independently
- [ ] ScriptGenerator shows radio buttons for summary selection
- [ ] Audio generates from selected summary source
- [ ] Draft editor articles appear in Review Queue
- [ ] Approved editor articles appear in Review Queue

---

## 🚨 **CRITICAL QUESTIONS TO ANSWER**

1. **Where is the Review Queue fetch happening?**
   - Find the API endpoint that QueuePage.jsx calls
   - Likely in `api.py` - search for "summaries" endpoints

2. **Is there a separate endpoint for editor_articles?**
   - Or should summaries endpoint JOIN both tables?

3. **Should draft editor_articles show in Review Queue?**
   - Current: Only approved summaries show
   - Desired: Show drafts + approved from editor_articles?

4. **Update API for TTS summary:**
   - New endpoint: `PUT /api/editorial/editor-articles/{uuid}/summary`
   - Or extend existing summary update endpoint?

---

## 📞 **NEXT SESSION PROMPT**

Start new Claude conversation with:

```
I'm working on Phase 2.5-4 integration for a news editorial system. There's a workflow gap:

PROBLEM:
- ArticleEditor saves TTS summaries to editor_articles.summary_text
- Review Queue only shows summaries.summary_text (different table)
- Cannot access editor TTS summaries for audio generation

GOAL:
- Unified Review Queue showing BOTH summary types
- Dual editing capability
- Audio generation from either source

FILES TO ANALYZE:
- phase-02-summarization/api.py (backend)
- phase-03-editor/src/components/SummaryReview.jsx
- phase-03-editor/src/components/ScriptGenerator.jsx

DATABASE SCHEMA:
[Paste schema from above]

Please implement the backend query fix first, then frontend updates.
```

---

**End of Handoff Document**  
**Token Efficiency:** This document contains all context needed without full conversation history.
