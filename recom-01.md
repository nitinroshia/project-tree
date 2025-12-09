# Phase 3 Editorial Workflow Fixes

## 1. State Diagram: Current vs Expected Flow

### Current Flow (Broken):
```
Articles → Summaries (approved=false) → Editor Articles (summary_uuid=NULL)
                                      ↓
                               Approve Summary → No editor_articles updated (summary_uuid mismatch)
```

### Expected Flow (Fixed):
```
Articles → Summaries (approved=NULL/pending) → Editor Articles (summary_uuid set)
                                               ↓
                                        Approve Summary → Editor Articles status='approved'
```

## 2. Root Cause Analysis

1. **Summaries created as rejected**: INSERT statement doesn't set `approved=NULL`, table default may be `false`
2. **summary_uuid NULL in editor_articles**: `create_editor_article` doesn't lookup summary_uuid from source_article_uuid
3. **Approved editor_articles missing from queue**: Approval propagation fails due to NULL summary_uuid mismatch
4. **BASE_URL undefined**: Likely refers to `API_BASE_URL` in client.js (line 3), may be undefined in production

## 3. Exact Line Numbers Needing Fixes

### api.py:
- Line 110-127: `/summarize` INSERT - add `approved=NULL`
- Line 781-803: `create_editor_article` INSERT - add summary_uuid lookup and field
- Line 539-543: `approve_summary` - logic correct, but won't work until summary_uuid set

### client.js:
- Line 3: `API_BASE_URL` (possibly called BASE_URL in error) - ensure env var set

## 4. SQL Migration Needed

```sql
-- Ensure summaries.approved defaults to NULL for pending status
ALTER TABLE summaries ALTER COLUMN approved SET DEFAULT NULL;

-- Update existing false values to NULL if they should be pending
-- (Only if confirmed these are actually pending, not rejected)
-- UPDATE summaries SET approved = NULL WHERE approved = false AND editor_notes IS NULL;
```

## 5. Step-by-Step Fix Implementation

### Step 1: Fix Summary Creation (api.py lines 110-127)
Add `approved=NULL` to the INSERT in `/summarize` endpoint:

```python
cur.execute("""
    INSERT INTO summaries (
        article_ids,
        summary_text,
        summary_embedding,
        quality_score,
        summary_type,
        story_uuid,
        approved  -- Add this
    )
    VALUES (%s, %s, %s, %s, %s, %s, %s)  -- Add %s
    RETURNING summary_uuid, summary_id
""", (
    article_ids,
    summary_text,
    embedding_list,
    float(quality_score_calc),
    'multi-article',
    story_uuid,
    None  # approved=NULL
))
```

### Step 2: Fix Editor Article Creation (api.py lines 781-803)
Add summary_uuid lookup in `create_editor_article`:

Before the INSERT, add:
```python
# Lookup summary_uuid from source_article_uuid
summary_uuid = None
if source_article_uuid:
    cur.execute("""
        SELECT summary_uuid 
        FROM summaries 
        WHERE %s = ANY(article_ids)
        ORDER BY created_at DESC 
        LIMIT 1
    """, (article_id,))  # Need article_id from source_article_uuid
    
    summary_row = cur.fetchone()
    summary_uuid = summary_row[0] if summary_row else None
```

Then add `summary_uuid` to the INSERT fields and VALUES.

### Step 3: Fix BASE_URL in client.js
Ensure environment variable is set:
- Development: `VITE_API_URL=http://localhost:5001`
- Production: Set appropriate production URL

### Step 4: Test the Flow
1. Create summary → should have approved=NULL
2. Create editor article from article → should have summary_uuid set
3. Approve summary → should update linked editor articles to approved
4. Queue should show approved editor articles
