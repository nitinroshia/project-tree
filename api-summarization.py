from flask import Flask, request, jsonify
from flask_cors import CORS
from summarizer import summarize_multiple
from sentence_transformers import SentenceTransformer
from quality_checker import calculate_quality_score
from datetime import datetime
import psycopg2
import hashlib
import json
import os
from dotenv import load_dotenv
import re
from groq import Groq
from html.parser import HTMLParser
from supabase import create_client

load_dotenv()
# Initialize Groq client
groq_client = Groq(api_key=os.environ.get("GROQ_API_KEY"))

# Initialize Flask app
app = Flask(__name__)
CORS(app)

# Load embedding model once at startup
embedding_model = SentenceTransformer('all-MiniLM-L6-v2')

# Database connection string
DB_CONN = "postgresql://apple@localhost/news_pipeline"

@app.route('/summarize', methods=['POST'])
def summarize():
    """Generate summary from multiple articles with quality checks."""
    data = request.json
    if not data or 'articles' not in data:
        return jsonify({'error': 'Missing articles array'}), 400
    
    article_uuids = data['articles']
    story_uuid = data.get('story_uuid', None)
    
    if not isinstance(article_uuids, list) or len(article_uuids) == 0:
        return jsonify({'error': 'Articles must be a non-empty list'}), 400
    
    try:
        # Fetch article IDs and text from database FIRST
        conn = psycopg2.connect(DB_CONN)
        cur = conn.cursor()
        cur.execute("""
            SELECT article_id, cleaned_html
            FROM articles
            WHERE article_uuid::text = ANY(%s)
        """, (article_uuids,))
        
        results = cur.fetchall()
        
        if not results:
            cur.close()
            conn.close()
            return jsonify({'error': 'No articles found for provided UUIDs'}), 404
        
        # Separate IDs and text content
        article_ids = [row[0] for row in results]
        article_texts = [row[1] for row in results]
        
        # NOW check for duplicates using the integer article_ids
        cur.execute("""
            SELECT summary_uuid, summary_text, quality_score, summary_id
            FROM summaries
            WHERE article_ids = %s
            AND story_uuid IS NOT DISTINCT FROM %s
            AND created_at > NOW() - INTERVAL '5 minutes'
            ORDER BY created_at DESC
            LIMIT 1
        """, (article_ids, story_uuid))
        
        existing = cur.fetchone()
        
        if existing:
            # Return existing summary
            cur.close()
            conn.close()
            print(f"⚠️  DUPLICATE REQUEST DETECTED - Returning existing summary {existing[0]}")
            return jsonify({
                'summary': existing[1],
                'summary_uuid': str(existing[0]),
                'summary_id': existing[3],
                'quality_score': float(existing[2]),
                'warnings': ['Returned existing summary (duplicate request detected)'],
                'is_duplicate': True
            }), 200
        
        cur.close()
        conn.close()
        
        # Generate summary
        print(f"🔄 Generating new summary for {len(article_ids)} articles...")
        summary_text = summarize_multiple(article_texts)
        
        # Run quality checks
        quality_score_calc, quality_warnings = calculate_quality_score(summary_text, article_texts)
        
        # Generate embedding
        embedding = embedding_model.encode(summary_text)
        embedding_list = embedding.tolist()
        
        # Save to database
        conn = psycopg2.connect(DB_CONN)
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO summaries (
                article_ids,
                summary_text,
                summary_embedding,
                quality_score,
                summary_type,
                story_uuid
            )
            VALUES (%s, %s, %s, %s, %s, %s)
            RETURNING summary_uuid, summary_id
        """, (
            article_ids,
            summary_text,
            embedding_list,
            float(quality_score_calc),
            'multi-article',
            story_uuid
        ))
        
        summary_uuid, summary_id = cur.fetchone()
        conn.commit()
        cur.close()
        conn.close()
        
        print(f"✅ New summary created: {summary_uuid}")
        
        return jsonify({
            'summary': summary_text,
            'summary_uuid': str(summary_uuid),
            'summary_id': summary_id,
            'quality_score': float(quality_score_calc),
            'warnings': quality_warnings,
            'is_duplicate': False
        }), 200
        
    except Exception as e:
        print(f"ERROR: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/summaries', methods=['GET'])
def get_summaries():
    """Get all summaries from database."""
    try:
        conn = psycopg2.connect(DB_CONN)
        cur = conn.cursor()
        cur.execute("""
            SELECT summary_uuid, summary_text, quality_score,
                   summary_type, created_at, approved, editor_notes
            FROM summaries
            ORDER BY created_at DESC
            LIMIT 100
        """)
        rows = cur.fetchall()
        cur.close()
        conn.close()
        
        summaries = []
        for row in rows:
            summaries.append({
                'summary_uuid': str(row[0]),
                'summary_text': row[1],
                'quality_score': row[2],
                'summary_type': row[3],
                'created_at': row[4].isoformat() if row[4] else None,
                'approved': row[5],
                'editor_notes': row[6]
            })
        
        return jsonify({'summaries': summaries}), 200
        
    except Exception as e:
        print(f"ERROR: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/editorial/articles', methods=['GET'])
def get_editorial_articles():
    """Get paginated list of articles with search and filters."""
    try:
        search = request.args.get('search', '').strip()
        source = request.args.get('source', '').strip()
        limit = int(request.args.get('limit', 50))
        offset = int(request.args.get('offset', 0))
        
        conn = psycopg2.connect(DB_CONN)
        cur = conn.cursor()
        
        query = """
            SELECT article_uuid, source_headline, source_name, 
                   source_url, created_at,
                   LEFT(cleaned_html, 500) as text_preview
            FROM articles
            WHERE 1=1
        """
        params = []
        
        if search:
            query += " AND (source_headline ILIKE %s OR cleaned_html ILIKE %s)"
            params.extend([f"%{search}%", f"%{search}%"])
        
        if source:
            query += " AND source_name ILIKE %s"
            params.append(f"%{source}%")
        
        query += " ORDER BY created_at DESC LIMIT %s OFFSET %s"
        params.extend([limit, offset])
        
        cur.execute(query, params)
        articles = cur.fetchall()
        
        count_query = "SELECT COUNT(*) FROM articles WHERE 1=1"
        count_params = []
        
        if search:
            count_query += " AND (source_headline ILIKE %s OR cleaned_html ILIKE %s)"
            count_params.extend([f"%{search}%", f"%{search}%"])
        
        if source:
            count_query += " AND source_name ILIKE %s"
            count_params.append(f"%{source}%")
        
        cur.execute(count_query, count_params)
        total = cur.fetchone()[0]
        
        cur.close()
        conn.close()
        
        result = {
            'articles': [
                {
                    'article_uuid': str(row[0]),
                    'headline': row[1] or 'Untitled',
                    'source_name': row[2],
                    'article_url': row[3],
                    'created_at': row[4].isoformat() if row[4] else None,
                    'text_preview': row[5]
                }
                for row in articles
            ],
            'total': total,
            'page': (offset // limit) + 1,
            'has_more': (offset + limit) < total
        }
        
        return jsonify(result), 200
        
    except Exception as e:
        print(f"ERROR: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/editorial/summarize', methods=['POST'])
def editorial_summarize():
    """Generate summary with editorial control (custom text, length control)."""
    try:
        data = request.json
        article_uuids = data.get('article_uuids', [])
        story_uuid = data.get('story_uuid', None)
        max_length = int(data.get('max_length', 400))
        min_length = int(data.get('min_length', 200))
        custom_text = data.get('custom_text', '').strip()
        
        if not article_uuids:
            return jsonify({'error': 'article_uuids required'}), 400
        
        conn = psycopg2.connect(DB_CONN)
        cur = conn.cursor()
        
        # Fetch articles
        cur.execute("""
            SELECT article_id, cleaned_html
            FROM articles
            WHERE article_uuid::text = ANY(%s)
        """, (article_uuids,))
        
        results = cur.fetchall()
        
        if not results:
            cur.close()
            conn.close()
            return jsonify({'error': 'No articles found'}), 404
        
        article_ids = [row[0] for row in results]
        article_texts = [row[1] for row in results]
        
        # Use custom text OR generate summary
        if custom_text:
            summary_text = custom_text
            quality_score = 1.0  # Custom text assumed high quality
        else:
            # Generate AI summary with specified lengths
            summary_text = summarize_multiple(
                article_texts, 
                max_length=max_length, 
                min_length=min_length
            )
            quality_score, _ = calculate_quality_score(summary_text, article_texts)
        
        # Generate embedding
        embedding = embedding_model.encode(summary_text)
        embedding_list = embedding.tolist()
        
        # Save to database
        cur.execute("""
            INSERT INTO summaries (
                article_ids,
                summary_text,
                summary_embedding,
                quality_score,
                summary_type,
                story_uuid
            )
            VALUES (%s, %s, %s, %s, %s, %s)
            RETURNING summary_uuid
        """, (
            article_ids,
            summary_text,
            embedding_list,
            float(quality_score),
            'custom' if custom_text else 'multi-article',
            story_uuid
        ))
        
        summary_uuid = cur.fetchone()[0]
        conn.commit()
        cur.close()
        conn.close()
        
        return jsonify({
            'summary_uuid': str(summary_uuid),
            'summary_text': summary_text,
            'quality_score': float(quality_score)
        }), 200
        
    except Exception as e:
        print(f"ERROR: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/editorial/stories', methods=['POST'])
def create_story():
    """Create new story grouping articles."""
    try:
        data = request.json
        title = data.get('title', '').strip()
        article_uuids = data.get('article_uuids', [])
        created_by = data.get('created_by', 'editor').strip()
        
        if not title:
            return jsonify({'error': 'title required'}), 400
        if not article_uuids:
            return jsonify({'error': 'article_uuids required'}), 400
        
        conn = psycopg2.connect(DB_CONN)
        cur = conn.cursor()
        
        cur.execute("""
            INSERT INTO stories (story_name, article_uuids, status, created_by)
            VALUES (%s, %s, %s, %s)
            RETURNING story_uuid, created_at
        """, (title, article_uuids, 'draft', created_by))
        
        story_uuid, created_at = cur.fetchone()
        conn.commit()
        cur.close()
        conn.close()
        
        return jsonify({
            'story_uuid': str(story_uuid),
            'created_at': created_at.isoformat()
        }), 201
        
    except Exception as e:
        print(f"ERROR: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/editorial/stories/<story_uuid>', methods=['PUT'])
def update_story(story_uuid):
    """Update existing story."""
    try:
        data = request.json
        article_uuids = data.get('article_uuids')
        custom_text = data.get('custom_text')
        status = data.get('status')
        
        conn = psycopg2.connect(DB_CONN)
        cur = conn.cursor()
        
        # Build dynamic update
        updates = []
        params = []
        
        if article_uuids is not None:
            updates.append("article_uuids = %s")
            params.append(article_uuids)
        
        if custom_text is not None:
            updates.append("custom_text = %s")
            params.append(custom_text)
        
        if status is not None:
            if status not in ['draft', 'ready', 'approved']:
                return jsonify({'error': 'Invalid status'}), 400
            updates.append("status = %s")
            params.append(status)
        
        if not updates:
            return jsonify({'error': 'No fields to update'}), 400
        
        params.append(story_uuid)
        query = f"UPDATE stories SET {', '.join(updates)} WHERE story_uuid = %s RETURNING updated_at"
        
        cur.execute(query, params)
        result = cur.fetchone()
        
        if not result:
            cur.close()
            conn.close()
            return jsonify({'error': 'Story not found'}), 404
        
        updated_at = result[0]
        conn.commit()
        cur.close()
        conn.close()
        
        return jsonify({
            'story_uuid': story_uuid,
            'updated_at': updated_at.isoformat()
        }), 200
        
    except Exception as e:
        print(f"ERROR: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/editorial/stories', methods=['GET'])
def get_stories():
    """Get list of stories with filters."""
    try:
        status = request.args.get('status', '').strip()
        limit = int(request.args.get('limit', 20))
        
        conn = psycopg2.connect(DB_CONN)
        cur = conn.cursor()
        
        # Query using ACTUAL columns from your schema
        query = """
            SELECT story_uuid, story_name, article_uuids, editor_article_uuids,
                   status, created_at, updated_at
            FROM stories
        """
        params = []
        
        if status:
            query += " WHERE status = %s"
            params.append(status)
        
        query += " ORDER BY updated_at DESC LIMIT %s"
        params.append(limit)
        
        cur.execute(query, params)
        stories = cur.fetchall()
        
        cur.close()
        conn.close()
        
        result = [
            {
                'story_uuid': str(row[0]),
                'story_title': row[1],
                'article_count': len(row[2]) if row[2] else 0,
                'editor_article_count': len(row[3]) if row[3] else 0,
                'has_custom_text': False,  # Not in your schema
                'status': row[4],
                'created_by': 'system',  # Not in your schema, default value
                'created_at': row[5].isoformat() if row[5] else None,
                'updated_at': row[6].isoformat() if row[6] else None
            }
            for row in stories
        ]
        
        return jsonify({'stories': result}), 200
        
    except Exception as e:
        print(f"ERROR: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/editorial/summaries/<summary_uuid>/approve', methods=['PUT'])
def approve_summary(summary_uuid):
    """Approve summary for next phase."""
    try:
        data = request.json
        editor_notes = data.get('editor_notes', '').strip()
        reviewed_by = data.get('reviewed_by', 'editor').strip()
        
        conn = psycopg2.connect(DB_CONN)
        cur = conn.cursor()
        
        # Update summaries table
        cur.execute("""
            UPDATE summaries
            SET approved = TRUE, editor_notes = %s
            WHERE summary_uuid = %s
            RETURNING story_uuid
        """, (editor_notes, summary_uuid))
        
        result = cur.fetchone()
        
        if not result:
            cur.close()
            conn.close()
            return jsonify({'error': 'Summary not found'}), 404
        
        story_uuid = result[0]
        
        # Insert into editorial queue
        cur.execute("""
            INSERT INTO editorial_queue 
            (summary_uuid, story_uuid, status, editor_notes, reviewed_by, reviewed_at)
            VALUES (%s, %s, %s, %s, %s, %s)
        """, (summary_uuid, story_uuid, 'approved', editor_notes, reviewed_by, datetime.now()))
        
        conn.commit()
        cur.close()
        conn.close()
        
        return jsonify({
            'summary_uuid': summary_uuid,
            'status': 'approved'
        }), 200
        
    except Exception as e:
        print(f"ERROR: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/editorial/summaries/<summary_uuid>/reject', methods=['PUT'])
def reject_summary(summary_uuid):
    """Reject summary."""
    try:
        data = request.json
        editor_notes = data.get('editor_notes', '').strip()
        reviewed_by = data.get('reviewed_by', 'editor').strip()
        
        if not editor_notes:
            return jsonify({'error': 'editor_notes required for rejection'}), 400
        
        conn = psycopg2.connect(DB_CONN)
        cur = conn.cursor()
        
        # Update summaries table
        cur.execute("""
            UPDATE summaries
            SET approved = FALSE, editor_notes = %s
            WHERE summary_uuid = %s
            RETURNING story_uuid
        """, (editor_notes, summary_uuid))
        
        result = cur.fetchone()
        
        if not result:
            cur.close()
            conn.close()
            return jsonify({'error': 'Summary not found'}), 404
        
        story_uuid = result[0]
        
        # Insert into editorial queue
        cur.execute("""
            INSERT INTO editorial_queue 
            (summary_uuid, story_uuid, status, editor_notes, reviewed_by, reviewed_at)
            VALUES (%s, %s, %s, %s, %s, %s)
        """, (summary_uuid, story_uuid, 'rejected', editor_notes, reviewed_by, datetime.now()))
        
        conn.commit()
        cur.close()
        conn.close()
        
        return jsonify({
            'summary_uuid': summary_uuid,
            'status': 'rejected'
        }), 200
        
    except Exception as e:
        print(f"ERROR: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

# Add these imports at the top
from datetime import datetime
import json

# ============================================================
# PHASE 3.2 ENDPOINTS - Editorial Workspace
# ============================================================

@app.route('/api/editorial/editor-articles', methods=['GET'])
def get_editor_articles():
    """Get list of editor articles with filters."""
    try:
        status = request.args.get('status', '').strip()
        post_type = request.args.get('post_type', '').strip()
        editor_name = request.args.get('editor_name', '').strip()
        limit = int(request.args.get('limit', 50))
        offset = int(request.args.get('offset', 0))
        
        conn = psycopg2.connect(DB_CONN)
        cur = conn.cursor()
        
        query = """
            SELECT editor_article_uuid, headline, post_text, summary_text,
                   image_headline, image_body_text, editor_name, byline,
                   word_count_post, char_count_post, content_type, post_type,
                   status, video_compatible, social_compatible, web_compatible,
                   attribution_text, platform_warnings, created_at, updated_at
            FROM editor_articles
            WHERE 1=1
        """
        params = []
        
        if status:
            query += " AND status = %s"
            params.append(status)
        
        if post_type:
            query += " AND post_type = %s"
            params.append(post_type)
        
        if editor_name:
            query += " AND editor_name = %s"
            params.append(editor_name)
        
        query += " ORDER BY created_at DESC LIMIT %s OFFSET %s"
        params.extend([limit, offset])
        
        cur.execute(query, params)
        articles = cur.fetchall()
        
        # Get total count
        count_query = "SELECT COUNT(*) FROM editor_articles WHERE 1=1"
        count_params = []
        
        if status:
            count_query += " AND status = %s"
            count_params.append(status)
        if post_type:
            count_query += " AND post_type = %s"
            count_params.append(post_type)
        if editor_name:
            count_query += " AND editor_name = %s"
            count_params.append(editor_name)
        
        cur.execute(count_query, count_params)
        total = cur.fetchone()[0]
        
        cur.close()
        conn.close()
        
        result = {
            'editor_articles': [
                {
                    'editor_article_uuid': str(row[0]),
                    'headline': row[1],
                    'post_text': row[2],
                    'summary_text': row[3],
                    'image_headline': row[4],
                    'image_body_text': row[5],
                    'editor_name': row[6],
                    'byline': row[7],
                    'word_count_post': row[8],
                    'char_count_post': row[9],
                    'content_type': row[10],
                    'post_type': row[11],
                    'status': row[12],
                    'video_compatible': row[13],
                    'social_compatible': row[14],
                    'web_compatible': row[15],
                    'attribution_text': row[16],
                    'platform_warnings': row[17],
                    'created_at': row[18].isoformat() if row[18] else None,
                    'updated_at': row[19].isoformat() if row[19] else None
                }
                for row in articles
            ],
            'total': total,
            'page': (offset // limit) + 1,
            'has_more': (offset + limit) < total
        }
        
        return jsonify(result), 200
        
    except Exception as e:
        print(f"ERROR: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/editorial/editor-articles', methods=['POST'])
def create_editor_article():
    """Create new editor article (copy source or original)."""
    try:
        data = request.json
        
        # Required fields
        headline = data.get('headline', '').strip()
        post_text = data.get('post_text', '').strip()
        editor_name = data.get('editor_name', 'editor').strip()
        content_type = data.get('content_type', 'original')  # original, sourced, enhanced
        post_type = data.get('post_type', 'original_research')
        
        if not headline or not post_text:
            return jsonify({'error': 'headline and post_text required'}), 400
        
        # Optional fields
        source_article_uuid = data.get('source_article_uuid')
        source_story_uuid = data.get('source_story_uuid')
        summary_text = data.get('summary_text', '').strip()
        image_headline = data.get('image_headline', '').strip()
        image_body_text = data.get('image_body_text', '').strip()
        byline = data.get('byline', '').strip()
        video_compatible = data.get('video_compatible', False)
        social_compatible = data.get('social_compatible', True)
        web_compatible = data.get('web_compatible', True)
        attribution_text = data.get('attribution_text', '').strip() or None
        
        # Calculate counts
        word_count = len(post_text.split())
        char_count = len(post_text)
        word_count_summary = len(summary_text.split()) if summary_text else 0
        
        # Validate platform limits
        platform_warnings = []
        if char_count > 280:
            platform_warnings.append('twitter')
        if char_count > 2200:
            platform_warnings.extend(['instagram', 'tiktok'])
        if char_count > 3000:
            platform_warnings.append('linkedin')
        if char_count > 5000:
            platform_warnings.append('youtube')
        
        # Check summary requirement
        if video_compatible and not summary_text:
            return jsonify({'error': 'summary_text required when video_compatible=true'}), 400
        
        conn = psycopg2.connect(DB_CONN)
        cur = conn.cursor()
        
        cur.execute("""
            INSERT INTO editor_articles (
                source_article_uuid, source_story_uuid, content_type,
                headline, post_text, summary_text,
                image_headline, image_body_text,
                editor_name, byline,
                word_count_post, word_count_summary, char_count_post,
                attribution_text,
                video_compatible, social_compatible, web_compatible,
                post_type, status, platform_warnings
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING editor_article_uuid, created_at, attribution_text
        """, (
            source_article_uuid, source_story_uuid, content_type,
            headline, post_text, summary_text,
            image_headline, image_body_text,
            editor_name, byline,
            word_count, word_count_summary, char_count,
            attribution_text,
            video_compatible, social_compatible, web_compatible,
            post_type, 'draft', json.dumps(platform_warnings)
        ))
        
        editor_article_uuid, created_at, final_attribution = cur.fetchone()
        conn.commit()
        cur.close()
        conn.close()
        
        return jsonify({
            'editor_article_uuid': str(editor_article_uuid),
            'created_at': created_at.isoformat(),
            'attribution_text': final_attribution,
            'platform_warnings': platform_warnings,
            'word_count': word_count,
            'char_count': char_count
        }), 201
        
    except Exception as e:
        print(f"ERROR: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/editorial/editor-articles/<editor_article_uuid>', methods=['PUT'])
def update_editor_article(editor_article_uuid):
    """Update existing editor article."""
    try:
        data = request.json
        
        conn = psycopg2.connect(DB_CONN)
        cur = conn.cursor()
        
        # Build dynamic update
        updates = []
        params = []
        
        # Content fields
        if 'headline' in data:
            updates.append("headline = %s")
            params.append(data['headline'])
        
        if 'post_text' in data:
            updates.append("post_text = %s")
            params.append(data['post_text'])
            # Recalculate counts
            updates.append("word_count_post = %s")
            params.append(len(data['post_text'].split()))
            updates.append("char_count_post = %s")
            char_count = len(data['post_text'])
            params.append(char_count)
            
            # Recalculate platform warnings
            warnings = []
            if char_count > 280: warnings.append('twitter')
            if char_count > 2200: warnings.extend(['instagram', 'tiktok'])
            if char_count > 3000: warnings.append('linkedin')
            if char_count > 5000: warnings.append('youtube')
            updates.append("platform_warnings = %s")
            params.append(json.dumps(warnings))
        
        if 'summary_text' in data:
            updates.append("summary_text = %s")
            params.append(data['summary_text'])
            updates.append("word_count_summary = %s")
            params.append(len(data['summary_text'].split()) if data['summary_text'] else 0)
        
        if 'image_headline' in data:
            updates.append("image_headline = %s")
            params.append(data['image_headline'])
        
        if 'image_body_text' in data:
            updates.append("image_body_text = %s")
            params.append(data['image_body_text'])
        
        if 'attribution_text' in data:
            updates.append("attribution_text = %s")
            params.append(data['attribution_text'])
        
        # Compatibility flags
        for field in ['video_compatible', 'social_compatible', 'web_compatible']:
            if field in data:
                updates.append(f"{field} = %s")
                params.append(data[field])
        
        # Status change
        if 'status' in data:
            status = data['status']
            if status not in ['draft', 'approved', 'published', 'archived']:
                return jsonify({'error': 'Invalid status'}), 400
            updates.append("status = %s")
            params.append(status)
            
            if status == 'approved':
                updates.append("approved_at = NOW()")
            elif status == 'published':
                updates.append("published_at = NOW()")
        
        if not updates:
            return jsonify({'error': 'No fields to update'}), 400
        
        params.append(editor_article_uuid)
        query = f"UPDATE editor_articles SET {', '.join(updates)} WHERE editor_article_uuid = %s RETURNING updated_at"
        
        cur.execute(query, params)
        result = cur.fetchone()
        
        if not result:
            cur.close()
            conn.close()
            return jsonify({'error': 'Editor article not found'}), 404
        
        updated_at = result[0]
        conn.commit()
        cur.close()
        conn.close()
        
        return jsonify({
            'editor_article_uuid': editor_article_uuid,
            'updated_at': updated_at.isoformat()
        }), 200
        
    except Exception as e:
        print(f"ERROR: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/editorial/editor-articles/<editor_article_uuid>', methods=['GET'])
def get_editor_article(editor_article_uuid):
    """Get single editor article with full details."""
    try:
        conn = psycopg2.connect(DB_CONN)
        cur = conn.cursor()
        
        cur.execute("""
            SELECT ea.*, 
                   a.source_headline, a.source_name, a.source_url, a.cleaned_html,
                   s.story_name
            FROM editor_articles ea
            LEFT JOIN articles a ON ea.source_article_uuid = a.article_uuid
            LEFT JOIN stories s ON ea.source_story_uuid = s.story_uuid
            WHERE ea.editor_article_uuid = %s
        """, (editor_article_uuid,))
        
        row = cur.fetchone()
        cur.close()
        conn.close()
        
        if not row:
            return jsonify({'error': 'Editor article not found'}), 404
        
        result = {
            'editor_article_uuid': str(row[0]),
            'source_article_uuid': str(row[1]) if row[1] else None,
            'source_story_uuid': str(row[2]) if row[2] else None,
            'content_type': row[3],
            'headline': row[4],
            'post_text': row[5],
            'summary_text': row[6],
            'image_headline': row[7],
            'image_body_text': row[8],
            'editor_name': row[9],
            'byline': row[10],
            'word_count_post': row[11],
            'word_count_summary': row[12],
            'char_count_post': row[13],
            'source_attribution': row[14],
            'original_urls': row[15],
            'attribution_text': row[16],
            'video_compatible': row[17],
            'social_compatible': row[18],
            'web_compatible': row[19],
            'post_type': row[20],
            'status': row[21],
            'platform_warnings': row[22],
            'created_at': row[23].isoformat() if row[23] else None,
            'updated_at': row[24].isoformat() if row[24] else None,
            'approved_at': row[25].isoformat() if row[25] else None,
            'published_at': row[26].isoformat() if row[26] else None,
            # Source article details (if applicable)
            'source_article': {
                'source_headline': row[27],
                'source_name': row[28],
                'source_url': row[29],
                'cleaned_html': row[30][:500] if row[30] else None  # Preview only
            } if row[27] else None,
            'source_story': {
                'story_name': row[31]
            } if row[31] else None
        }
        
        return jsonify(result), 200
        
    except Exception as e:
        print(f"ERROR: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/editorial/platform-limits', methods=['GET'])
def get_platform_limits():
    """Get all platform character limits for validation."""
    try:
        conn = psycopg2.connect(DB_CONN)
        cur = conn.cursor()
        
        cur.execute("""
            SELECT platform_name, char_limit, description
            FROM platform_limits
            WHERE active = true
            ORDER BY char_limit ASC
        """)
        
        limits = cur.fetchall()
        cur.close()
        conn.close()
        
        result = {
            'platforms': [
                {
                    'platform_name': row[0],
                    'char_limit': row[1],
                    'description': row[2]
                }
                for row in limits
            ]
        }
        
        return jsonify(result), 200
        
    except Exception as e:
        print(f"ERROR: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/editorial/validate-summary', methods=['POST'])
def validate_summary_requirement():
    """Check if summary is required for given post configuration."""
    try:
        data = request.json
        post_type = data.get('post_type')
        video_compatible = data.get('video_compatible', False)
        
        if not post_type:
            return jsonify({'error': 'post_type required'}), 400
        
        conn = psycopg2.connect(DB_CONN)
        cur = conn.cursor()
        
        cur.execute("""
            SELECT summary_required, rule_description
            FROM summary_rules
            WHERE post_type = %s AND video_compatible = %s
        """, (post_type, video_compatible))
        
        result = cur.fetchone()
        cur.close()
        conn.close()
        
        if result:
            return jsonify({
                'summary_required': result[0],
                'rule_description': result[1]
            }), 200
        else:
            return jsonify({
                'summary_required': False,
                'rule_description': 'No specific rule found'
            }), 200
        
    except Exception as e:
        print(f"ERROR: {e}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/articles/<article_uuid>', methods=['GET'])
def get_article_full(article_uuid):
    """Get full article details including cleaned_html."""
    try:
        conn = psycopg2.connect(DB_CONN)
        cur = conn.cursor()
        
        cur.execute("""
            SELECT article_uuid, source_headline, source_name, 
                   source_url, cleaned_html, raw_html, created_at
            FROM articles
            WHERE article_uuid::text = %s
        """, (article_uuid,))
        
        row = cur.fetchone()
        cur.close()
        conn.close()
        
        if not row:
            return jsonify({'error': 'Article not found'}), 404
        
        result = {
            'article_uuid': str(row[0]),
            'source_headline': row[1],
            'headline': row[1],
            'source_name': row[2],
            'source_url': row[3],
            'cleaned_html': row[4],
            'raw_html': row[5],
            'created_at': row[6].isoformat() if row[6] else None
        }
        
        return jsonify(result), 200
        
    except Exception as e:
        print(f"ERROR in get_article_full: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/editorial/summaries/<summary_uuid>', methods=['PUT'])
def update_summary(summary_uuid):
    """Update summary text and editor notes (allows editing approved summaries)."""
    try:
        data = request.json
        summary_text = data.get('summary_text')
        editor_notes = data.get('editor_notes')
        
        if not summary_text:
            return jsonify({'error': 'summary_text required'}), 400
        
        conn = psycopg2.connect(DB_CONN)
        cur = conn.cursor()
        
        # Recalculate embedding for updated summary
        embedding = embedding_model.encode(summary_text)
        embedding_list = embedding.tolist()
        
        # Build update query
        updates = ['summary_text = %s', 'summary_embedding = %s']
        params = [summary_text, embedding_list]
        
        if editor_notes is not None:
            updates.append('editor_notes = %s')
            params.append(editor_notes)
        
        params.append(summary_uuid)
        query = f"UPDATE summaries SET {', '.join(updates)} WHERE summary_uuid = %s RETURNING updated_at"
        
        cur.execute(query, params)
        result = cur.fetchone()
        
        if not result:
            cur.close()
            conn.close()
            return jsonify({'error': 'Summary not found'}), 404
        
        updated_at = result[0]
        conn.commit()
        cur.close()
        conn.close()
        
        return jsonify({
            'summary_uuid': summary_uuid,
            'updated_at': updated_at.isoformat() if updated_at else None,
            'message': 'Summary updated successfully'
        }), 200
        
    except Exception as e:
        print(f"ERROR: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/editorial/articles', methods=['GET'])
def get_editorial_articles_enhanced():
    """Get paginated list of articles with editor copy status."""
    try:
        search = request.args.get('search', '').strip()
        source = request.args.get('source', '').strip()
        limit = int(request.args.get('limit', 50))
        offset = int(request.args.get('offset', 0))
        
        conn = psycopg2.connect(DB_CONN)
        cur = conn.cursor()
        
        query = """
            SELECT a.article_uuid, a.source_headline, a.source_name, 
                   a.source_url, a.created_at,
                   LEFT(a.cleaned_html, 500) as text_preview,
                   EXISTS(
                       SELECT 1 FROM editor_articles ea 
                       WHERE ea.source_article_uuid = a.article_uuid
                   ) as has_editor_copy
            FROM articles a
            WHERE 1=1
        """
        params = []
        
        if search:
            query += " AND (a.source_headline ILIKE %s OR a.cleaned_html ILIKE %s)"
            params.extend([f"%{search}%", f"%{search}%"])
        
        if source:
            query += " AND a.source_name ILIKE %s"
            params.append(f"%{source}%")
        
        query += " ORDER BY a.created_at DESC LIMIT %s OFFSET %s"
        params.extend([limit, offset])
        
        cur.execute(query, params)
        articles = cur.fetchall()
        
        count_query = "SELECT COUNT(*) FROM articles WHERE 1=1"
        count_params = []
        
        if search:
            count_query += " AND (source_headline ILIKE %s OR cleaned_html ILIKE %s)"
            count_params.extend([f"%{search}%", f"%{search}%"])
        
        if source:
            count_query += " AND source_name ILIKE %s"
            count_params.append(f"%{source}%")
        
        cur.execute(count_query, count_params)
        total = cur.fetchone()[0]
        
        cur.close()
        conn.close()
        
        result = {
            'articles': [
                {
                    'article_uuid': str(row[0]),
                    'headline': row[1] or 'Untitled',
                    'source_name': row[2],
                    'article_url': row[3],
                    'created_at': row[4].isoformat() if row[4] else None,
                    'text_preview': row[5],
                    'has_editor_copy': row[6]
                }
                for row in articles
            ],
            'total': total,
            'page': (offset // limit) + 1,
            'has_more': (offset + limit) < total
        }
        
        return jsonify(result), 200
        
    except Exception as e:
        print(f"ERROR: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/editorial/editor-articles/<editor_article_uuid>/source-edit', methods=['PUT'])
def update_source_article_edit(editor_article_uuid):
    """Update edited source article content."""
    try:
        data = request.json
        edited_headline = data.get('edited_headline')
        edited_html = data.get('edited_html')
        use_edited_version = data.get('use_edited_version', False)
        
        if not edited_headline and not edited_html:
            return jsonify({'error': 'edited_headline or edited_html required'}), 400
        
        conn = psycopg2.connect(DB_CONN)
        cur = conn.cursor()
        
        updates = []
        params = []
        
        if edited_headline is not None:
            updates.append("edited_headline = %s")
            params.append(edited_headline)
        
        if edited_html is not None:
            updates.append("edited_html = %s")
            params.append(edited_html)
        
        updates.append("use_edited_version = %s")
        params.append(use_edited_version)
        
        params.append(editor_article_uuid)
        query = f"UPDATE editor_articles SET {', '.join(updates)} WHERE editor_article_uuid = %s RETURNING updated_at"
        
        cur.execute(query, params)
        result = cur.fetchone()
        
        if not result:
            cur.close()
            conn.close()
            return jsonify({'error': 'Editor article not found'}), 404
        
        updated_at = result[0]
        conn.commit()
        cur.close()
        conn.close()
        
        return jsonify({
            'editor_article_uuid': editor_article_uuid,
            'updated_at': updated_at.isoformat(),
            'message': 'Source article edit saved'
        }), 200
        
    except Exception as e:
        print(f"ERROR: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/editorial/original-articles', methods=['POST'])
def create_original_article():
    """Create a new original article written by staff."""
    try:
        data = request.json
        
        # Required fields
        headline = data.get('headline', '').strip()
        content_html = data.get('content_html', '').strip()
        author_name = data.get('author_name', '').strip()
        
        if not headline:
            return jsonify({'error': 'headline required'}), 400
        if not content_html:
            return jsonify({'error': 'content_html required'}), 400
        if not author_name:
            return jsonify({'error': 'author_name required'}), 400
        
        # Optional fields
        editor_notes = data.get('editor_notes', '').strip()
        source_name = data.get('source_name', 'Pellacia Press').strip()
        
        conn = psycopg2.connect(DB_CONN)
        cur = conn.cursor()
        
        # Insert into articles table as original content
        cur.execute("""
            INSERT INTO articles (
                source_headline,
                source_name,
                cleaned_html,
                raw_html,
                content_source,
                author_name,
                editor_notes,
                pipeline_status,
                created_at
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, NOW())
            RETURNING article_uuid, article_id, created_at
        """, (
            headline,
            source_name,
            content_html,
            content_html,  # raw_html = cleaned_html for originals
            'original',
            author_name,
            editor_notes,
            'ready'  # Original articles are ready for processing
        ))
        
        article_uuid, article_id, created_at = cur.fetchone()
        conn.commit()
        cur.close()
        conn.close()
        
        return jsonify({
            'article_uuid': str(article_uuid),
            'article_id': article_id,
            'created_at': created_at.isoformat(),
            'message': 'Original article created successfully'
        }), 201
        
    except Exception as e:
        print(f"ERROR: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

@app.route('/api/editorial/original-articles/<article_uuid>', methods=['PUT'])
def update_original_article(article_uuid):
    """Update an existing original article."""
    try:
        data = request.json
        
        conn = psycopg2.connect(DB_CONN)
        cur = conn.cursor()
        
        # First verify this is an original article
        cur.execute("""
            SELECT content_source FROM articles WHERE article_uuid::text = %s
        """, (article_uuid,))
        
        result = cur.fetchone()
        if not result:
            cur.close()
            conn.close()
            return jsonify({'error': 'Article not found'}), 404
        
        if result[0] != 'original':
            cur.close()
            conn.close()
            return jsonify({'error': 'Can only edit original articles'}), 403
        
        # Build dynamic update
        updates = []
        params = []
        
        if 'headline' in data:
            updates.append("source_headline = %s")
            params.append(data['headline'])
        
        if 'content_html' in data:
            updates.append("cleaned_html = %s")
            params.append(data['content_html'])
            updates.append("raw_html = %s")
            params.append(data['content_html'])
        
        if 'author_name' in data:
            updates.append("author_name = %s")
            params.append(data['author_name'])
        
        if 'editor_notes' in data:
            updates.append("editor_notes = %s")
            params.append(data['editor_notes'])
        
        if 'published_at' in data:
            updates.append("published_at = %s")
            params.append(data['published_at'])
        
        if not updates:
            cur.close()
            conn.close()
            return jsonify({'error': 'No fields to update'}), 400
        
        params.append(article_uuid)
        query = f"UPDATE articles SET {', '.join(updates)} WHERE article_uuid::text = %s RETURNING created_at"
        
        cur.execute(query, params)
        result = cur.fetchone()
        
        if not result:
            cur.close()
            conn.close()
            return jsonify({'error': 'Update failed'}), 500
        
        conn.commit()
        cur.close()
        conn.close()
        
        return jsonify({
            'article_uuid': article_uuid,
            'message': 'Original article updated successfully'
        }), 200
        
    except Exception as e:
        print(f"ERROR: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500

# Load configuration files
def load_metadata_rules():
    """Load METADATA_RULES.md content"""
    try:
        with open('context/METADATA_RULES.md', 'r') as f:
            return f.read()
    except:
        return "Generate high-quality, accurate social media metadata."

def load_field_config():
    """Load AI_FIELD_CONFIG.json"""
    try:
        with open('ai_prefill/AI_FIELD_CONFIG.json', 'r') as f:
            return json.load(f)
    except:
        return {}

# HTML stripper for character counting
class HTMLStripper(HTMLParser):
    def __init__(self):
        super().__init__()
        self.text = []
    def handle_data(self, d):
        self.text.append(d)
    def get_data(self):
        return ''.join(self.text)

def strip_html(html):
    s = HTMLStripper()
    s.feed(html)
    return s.get_data()

def calculate_platform_validation(post_text):
    """Calculate character counts for platforms"""
    char_count = len(strip_html(post_text))
    
    platforms = {
        'twitter': {'limit': 280, 'count': char_count},
        'instagram': {'limit': 2200, 'count': char_count},
        'linkedin': {'limit': 3000, 'count': char_count},
        'tiktok': {'limit': 2200, 'count': char_count},
        'youtube': {'limit': 5000, 'count': char_count},
        'facebook': {'limit': 63206, 'count': char_count}
    }
    
    for platform, info in platforms.items():
        if info['count'] > info['limit']:
            info['status'] = 'invalid'
        elif info['count'] > info['limit'] * 0.9:
            info['status'] = 'warning'
        else:
            info['status'] = 'valid'
    
    return platforms

def build_groq_prompt(headline, content, source, rules):
    """Build prompt for Groq API"""
    # Truncate content if too long
    content_preview = content[:3000] if len(content) > 3000 else content
    
    prompt = f"""Generate social media metadata for this article.

SOURCE ARTICLE:
Headline: {headline}
Source: {source}
Content: {content_preview}

REQUIREMENTS:
1. Generate a NEW headline (must differ from source by 30%+)
2. Create engaging post_text (200-500 chars, use HTML: <p>, <strong>)
3. Write conversational summary_text for TTS (150-400 chars, plain text)
4. Create short image_headline (15-40 chars)
5. Add image_body_text (20-80 chars)
6. Generate 4-6 relevant hashtags (JSON array format)
7. Add attribution_text citing the source

RULES:
{rules[:1000]}

OUTPUT FORMAT (JSON only):
{{
  "headline": "transformed headline with specific data",
  "post_text": "<p><strong>Hook.</strong></p><p>Details with data.</p>",
  "summary_text": "Conversational TTS script starting with: In today's video...",
  "image_headline": "SHORT DATA POINT",
  "image_body_text": "Context or timeframe",
  "hashtags": ["#Tag1", "#Tag2", "#Tag3"],
  "attribution_text": "Source: {source}"
}}"""
    
    return prompt

def calculate_similarity(text1, text2):
    """Simple similarity check"""
    if not text1 or not text2:
        return 0.0
    
    t1 = text1.lower().strip()
    t2 = text2.lower().strip()
    
    if t1 == t2:
        return 1.0
    
    # Length-based similarity
    len_diff = abs(len(t1) - len(t2)) / max(len(t1), len(t2))
    return 1.0 - len_diff

@app.route('/api/editorial/ai-generate-metadata', methods=['POST'])
def ai_generate_metadata():
    """Generate AI metadata for social media posts"""
    try:
        data = request.json
        source_article_uuid = data.get('source_article_uuid')
        generation_mode = data.get('generation_mode', 'social_post')
        locked_fields = data.get('locked_fields', [])
        regenerate = data.get('regenerate', False)
        
        if not source_article_uuid:
            return jsonify({'success': False, 'error': 'source_article_uuid required'}), 400
        
        # Check cache first (unless regenerate=true)
        if not regenerate:
            conn = psycopg2.connect(DB_CONN)
            cur = conn.cursor()
            cur.execute("""
                SELECT cache_id, metadata, confidence_scores, platform_validation
                FROM ai_metadata_cache
                WHERE source_article_uuid = %s AND generation_mode = %s
                AND expires_at > NOW()
            """, (source_article_uuid, generation_mode))
            
            cached = cur.fetchone()
            cur.close()
            conn.close()
            
            if cached:
                return jsonify({
                    'success': True,
                    'metadata': cached[1],
                    'confidence_scores': cached[2],
                    'platform_validation': cached[3],
                    'cache_key': str(cached[0]),
                    'from_cache': True
                }), 200
        
        # Fetch article
        conn = psycopg2.connect(DB_CONN)
        cur = conn.cursor()
        cur.execute("""
            SELECT source_headline, source_name, cleaned_html, source_url
            FROM articles WHERE article_uuid::text = %s
        """, (source_article_uuid,))
        
        article = cur.fetchone()
        cur.close()
        conn.close()
        
        if not article:
            return jsonify({'success': False, 'error': 'Article not found'}), 404
        
        source_headline, source_name, cleaned_html, source_url = article
        
        # Load rules
        rules = load_metadata_rules()
        
        # Build prompt
        prompt = build_groq_prompt(source_headline, cleaned_html, source_name, rules)
        
        # Call Groq API
        import time
        start_time = time.time()
        
        try:
            chat_completion = groq_client.chat.completions.create(
                messages=[
                    {
                        "role": "system",
                        "content": "You are a professional social media content creator. Generate metadata in JSON format only. No markdown, no explanation, just valid JSON."
                    },
                    {
                        "role": "user",
                        "content": prompt
                    }
                ],
                model="llama-3.3-70b-versatile",
                temperature=0.7,
                max_tokens=2000,
                response_format={"type": "json_object"}
            )
            
            generation_time_ms = int((time.time() - start_time) * 1000)
            response_text = chat_completion.choices[0].message.content
            metadata = json.loads(response_text)
            
        except Exception as e:
            print(f"Groq API Error: {e}")
            return jsonify({
                'success': False,
                'error': 'ai_generation_failed',
                'message': 'AI service error. Please try again or fill manually.',
                'fallback_required': True
            }), 500
        
        # Remove locked fields from metadata
        for field in locked_fields:
            metadata.pop(field, None)
        
        # Calculate platform validation
        platform_validation = calculate_platform_validation(metadata.get('post_text', ''))
        
        # Calculate confidence scores (mock for now)
        confidence_scores = {field: 0.85 for field in metadata.keys()}
        
        # Cache result
        conn = psycopg2.connect(DB_CONN)
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO ai_metadata_cache (
                source_article_uuid, metadata, confidence_scores, 
                platform_validation, model_version, generation_mode
            ) VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT (source_article_uuid, generation_mode) 
            DO UPDATE SET 
                metadata = EXCLUDED.metadata,
                confidence_scores = EXCLUDED.confidence_scores,
                platform_validation = EXCLUDED.platform_validation,
                generated_at = NOW(),
                expires_at = NOW() + INTERVAL '30 days'
            RETURNING cache_id
        """, (
            source_article_uuid,
            json.dumps(metadata),
            json.dumps(confidence_scores),
            json.dumps(platform_validation),
            'llama-3.1-8b-instant',
            generation_mode
        ))
        
        cache_id = cur.fetchone()[0]
        
        # Log metrics
        cur.execute("""
            INSERT INTO ai_generation_metrics (
                cache_id, generation_time_ms, fields_generated, 
                fields_locked, success
            ) VALUES (%s, %s, %s, %s, %s)
        """, (
            cache_id,
            generation_time_ms,
            len(metadata),
            len(locked_fields),
            True
        ))
        
        conn.commit()
        cur.close()
        conn.close()
        
        return jsonify({
            'success': True,
            'metadata': metadata,
            'confidence_scores': confidence_scores,
            'platform_validation': platform_validation,
            'cache_key': str(cache_id),
            'generated_at': datetime.now().isoformat(),
            'model_version': 'llama-3.1-8b-instant',
            'from_cache': False,
            'generation_time_ms': generation_time_ms
        }), 200
        
    except Exception as e:
        print(f"ERROR in ai_generate_metadata: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500

# Update existing create_editor_article endpoint to log feedback
# Add this BEFORE the final response in create_editor_article():

        # Log AI feedback if source article exists
        if source_article_uuid:
            try:
                conn_fb = psycopg2.connect(DB_CONN)
                cur_fb = conn_fb.cursor()
                
                # Get cached AI metadata
                cur_fb.execute("""
                    SELECT cache_id, metadata FROM ai_metadata_cache
                    WHERE source_article_uuid = %s
                    ORDER BY generated_at DESC LIMIT 1
                """, (source_article_uuid,))
                
                cached = cur_fb.fetchone()
                
                if cached:
                    cache_id, ai_metadata = cached
                    
                    # Compare each field
                    for field_name in ['headline', 'post_text', 'summary_text', 'hashtags']:
                        if field_name in data:
                            ai_value = str(ai_metadata.get(field_name, ''))
                            editor_value = str(data[field_name])
                            
                            similarity = calculate_similarity(ai_value, editor_value)
                            
                            if similarity > 0.95:
                                mod_type = 'accepted'
                            elif similarity > 0.80:
                                mod_type = 'minor_edit'
                            elif similarity > 0.20:
                                mod_type = 'major_rewrite'
                            else:
                                mod_type = 'rejected'
                            
                            cur_fb.execute("""
                                INSERT INTO ai_feedback (
                                    article_uuid, cache_id, field_name, 
                                    ai_generated, editor_final, modification_type, 
                                    similarity_score, editor_name
                                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                            """, (
                                source_article_uuid, cache_id, field_name,
                                ai_value, editor_value, mod_type,
                                similarity, editor_name
                            ))
                    
                    conn_fb.commit()
                
                cur_fb.close()
                conn_fb.close()
            except Exception as fb_error:
                print(f"Feedback logging error: {fb_error}")
                # Don't fail the request if feedback fails

@app.route('/api/editorial/ai-generate-platform-specific', methods=['POST'])
def ai_generate_platform_specific():
    """Generate platform-optimized content with custom parameters"""
    try:
        data = request.json
        source_article_uuid = data.get('source_article_uuid')
        platform = data.get('platform')  # 'twitter', 'instagram', etc.
        custom_prompt = data.get('custom_prompt', '')
        ai_params = data.get('ai_params', {})
        
        if not source_article_uuid or not platform:
            return jsonify({'success': False, 'error': 'source_article_uuid and platform required'}), 400
        
        # Fetch article
        conn = psycopg2.connect(DB_CONN)
        cur = conn.cursor()
        cur.execute("""
            SELECT source_headline, source_name, cleaned_html, source_url
            FROM articles WHERE article_uuid::text = %s
        """, (source_article_uuid,))
        
        article = cur.fetchone()
        cur.close()
        conn.close()
        
        if not article:
            return jsonify({'success': False, 'error': 'Article not found'}), 404
        
        source_headline, source_name, cleaned_html, source_url = article
        
        # Load base rules
        rules = load_metadata_rules()
        
        # Build platform-specific prompt
        platform_config = {
            'twitter': {
                'name': 'Twitter/X',
                'char_limit': 280,
                'hashtag_limit': 2,
                'style': 'concise, newsworthy'
            },
            'instagram': {
                'name': 'Instagram',
                'char_limit': 2200,
                'hashtag_limit': 30,
                'style': 'visual storytelling, engaging'
            },
            'linkedin': {
                'name': 'LinkedIn',
                'char_limit': 3000,
                'hashtag_limit': 5,
                'style': 'professional insights'
            },
            'tiktok': {
                'name': 'TikTok',
                'char_limit': 2200,
                'hashtag_limit': 5,
                'style': 'casual, trending'
            },
            'youtube': {
                'name': 'YouTube',
                'char_limit': 5000,
                'hashtag_limit': 15,
                'style': 'detailed, informative'
            },
            'facebook': {
                'name': 'Facebook',
                'char_limit': 63206,
                'hashtag_limit': 10,
                'style': 'conversational, community'
            }
        }
        
        config = platform_config.get(platform, platform_config['twitter'])
        
        # Extract AI parameters
        tone = ai_params.get('tone', 'professional')
        max_length = ai_params.get('maxLength', config['char_limit'])
        emphasis = ai_params.get('emphasis', 'balanced')
        
        prompt = f"""Generate {config['name']}-optimized social media content.

SOURCE ARTICLE:
Headline: {source_headline}
Source: {source_name}
Content: {cleaned_html[:3000]}

PLATFORM REQUIREMENTS:
- Platform: {config['name']}
- Character Limit: {max_length} (strict)
- Style: {config['style']}
- Tone: {tone}
- Emphasis: {emphasis}
- Max Hashtags: {config['hashtag_limit']}

{custom_prompt}

CRITICAL RULES:
1. Content MUST be under {max_length} characters
2. Use {tone} tone throughout
3. Emphasize {emphasis} aspects
4. Include {config['hashtag_limit']} hashtags maximum
5. Style must match {config['style']}

OUTPUT (JSON only):
{{
  "headline": "platform-optimized headline",
  "post_text": "platform-optimized content under {max_length} chars",
  "hashtags": ["#Tag1", "#Tag2", ...],
  "platform": "{platform}"
}}"""
        
        # Call Groq API
        import time
        start_time = time.time()
        
        try:
            chat_completion = groq_client.chat.completions.create(
                messages=[
                    {
                        "role": "system",
                        "content": f"You are a {config['name']} content specialist. Generate platform-optimized content in JSON format only."
                    },
                    {
                        "role": "user",
                        "content": prompt
                    }
                ],
                model="llama-3.3-70b-versatile",
                temperature=0.7,
                max_tokens=2000,
                response_format={"type": "json_object"}
            )
            
            generation_time_ms = int((time.time() - start_time) * 1000)
            response_text = chat_completion.choices[0].message.content
            metadata = json.loads(response_text)
            
        except Exception as e:
            print(f"Groq API Error: {e}")
            return jsonify({
                'success': False,
                'error': 'ai_generation_failed',
                'message': f'AI generation failed for {platform}'
            }), 500
        
        # Validate length
        post_text = metadata.get('post_text', '')
        from html.parser import HTMLParser
        class MLStripper(HTMLParser):
            def __init__(self):
                super().__init__()
                self.reset()
                self.strict = False
                self.convert_charrefs = True
                self.text = []
            def handle_data(self, d):
                self.text.append(d)
            def get_data(self):
                return ''.join(self.text)
        
        s = MLStripper()
        s.feed(post_text)
        char_count = len(s.get_data())
        
        return jsonify({
            'success': True,
            'platform': platform,
            'metadata': metadata,
            'char_count': char_count,
            'char_limit': max_length,
            'within_limit': char_count <= max_length,
            'generation_time_ms': generation_time_ms,
            'ai_params': ai_params
        }), 200
        
    except Exception as e:
        print(f"ERROR: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({'success': False, 'error': str(e)}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5001, debug=True)
