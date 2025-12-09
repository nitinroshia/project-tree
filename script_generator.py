import os
import json
import re
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Optional, Tuple
import psycopg2
from psycopg2.extras import RealDictCursor

DB_CONFIG = {
    'host': os.getenv('DB_HOST', 'localhost'),
    'database': os.getenv('DB_NAME', 'news_pipeline'),
    'user': os.getenv('DB_USER', 'postgres'),
    'password': os.getenv('DB_PASS', 'postgres')
}

OUTPUT_DIR = Path('output/scripts')
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

def get_db_conn():
    return psycopg2.connect(**DB_CONFIG, cursor_factory=RealDictCursor)

def calculate_duration(text: str, words_per_minute: int = 150) -> float:
    words = len(text.split())
    return (words / words_per_minute) * 60

def split_into_segments(text: str, max_chars_per_line: int = 35, max_lines: int = 2) -> List[Dict]:
    sentences = re.split(r'(?<=[.!?])\s+', text)
    segments = []
    current_segment = []
    current_length = 0
    
    for sentence in sentences:
        words = sentence.split()
        for word in words:
            test_line = ' '.join(current_segment + [word])
            if len(test_line) > max_chars_per_line * max_lines:
                if current_segment:
                    segments.append(' '.join(current_segment))
                    current_segment = [word]
                    current_length = len(word)
                else:
                    segments.append(word)
            else:
                current_segment.append(word)
                current_length = len(test_line)
    
    if current_segment:
        segments.append(' '.join(current_segment))
    
    return segments

def format_vtt_time(seconds: float) -> str:
    td = timedelta(seconds=seconds)
    hours = int(td.total_seconds() // 3600)
    minutes = int((td.total_seconds() % 3600) // 60)
    secs = td.total_seconds() % 60
    return f"{hours:02d}:{minutes:02d}:{secs:06.3f}"

def generate_tts_vtt(summary_text: str, total_duration: float) -> str:
    segments = split_into_segments(summary_text)
    duration_per_segment = total_duration / len(segments)
    
    vtt_lines = ["WEBVTT\n", "NOTE", "TTS instructions for voice synthesis", 
                 "Duration marks guide audio generation timing\n"]
    
    current_time = 0.0
    for i, segment in enumerate(segments):
        start_time = current_time
        end_time = current_time + duration_per_segment
        
        text = segment
        if i == 0:
            text = f"<rate slow>{text}</rate>"
        
        if any(word in text.lower() for word in ['important', 'critical', 'significant', 'major']):
            text = re.sub(r'\b(important|critical|significant|major)\b', 
                         r'<emphasis strong>\1</emphasis>', text, flags=re.IGNORECASE)
        
        vtt_lines.append(f"{format_vtt_time(start_time)} --> {format_vtt_time(end_time)}")
        vtt_lines.append(text + "\n")
        
        current_time = end_time
    
    return '\n'.join(vtt_lines)

def generate_captions_vtt(summary_text: str, total_duration: float, max_chars: int = 35) -> str:
    segments = split_into_segments(summary_text, max_chars)
    duration_per_segment = total_duration / len(segments)
    
    vtt_lines = ["WEBVTT\n"]
    
    current_time = 0.0
    for segment in segments:
        start_time = current_time
        end_time = current_time + duration_per_segment
        
        lines = []
        words = segment.split()
        current_line = []
        
        for word in words:
            test_line = ' '.join(current_line + [word])
            if len(test_line) > max_chars:
                if current_line:
                    lines.append(' '.join(current_line))
                    current_line = [word]
                else:
                    lines.append(word)
            else:
                current_line.append(word)
        
        if current_line:
            lines.append(' '.join(current_line))
        
        vtt_lines.append(f"{format_vtt_time(start_time)} --> {format_vtt_time(end_time)}")
        vtt_lines.append('\n'.join(lines[:2]) + "\n")
        
        current_time = end_time
    
    return '\n'.join(vtt_lines)

def build_manifest(summary_data: Dict, articles_data: List[Dict], 
                   template_config: Dict, script_type: str, 
                   script_uuid: str, total_duration: float) -> Dict:
    
    manifest = {
        "project": {
            "name": f"Script_{script_uuid[:8]}",
            "version": "1.0",
            "totalDuration": total_duration
        },
        "logo": template_config['logo'],
        "headline": {
            **template_config['headline'],
            "text": summary_data.get('headline', summary_data['summary_text'].split('.')[0]),
            "alignment": "left",
            "color": {"r": 255, "g": 255, "b": 255}
        },
        "speakerLabel": {
            "name": template_config['defaultSpeaker']['name'],
            "title": template_config['defaultSpeaker']['title']
        },
        "creditLabel": {"text": "Sources: " + ", ".join(set(a['source_name'] for a in articles_data))},
        "sectionLabel": {"text": template_config['sectionLabels'][0]},
        "closedCaptions": {
            "file": f"output/scripts/{script_uuid}/captions.vtt",
            "style": template_config['captionsStyle']
        },
        "flags": {
            "codes": [],
            "path": "assets/flags/",
            "spacing": 10
        },
        "captions": template_config['captionsStyle'],
        "articles": []
    }
    
    article_duration = total_duration / max(len(articles_data), 1)
    current_time = 5.0
    
    for article in articles_data:
        article_entry = {
            "id": article['article_uuid'],
            "source": article['source_name'],
            "startTime": current_time,
            "duration": article_duration,
            "label": {
                "text": article['source_name'],
                "inPoint": current_time,
                "outPoint": current_time + 2
            },
            "content": {
                "image": f"{article['article_uuid']}_700x520.png",
                "inPoint": current_time,
                "outPoint": current_time + article_duration
            },
            "graphics": []
        }
        manifest['articles'].append(article_entry)
        current_time += article_duration
    
    return manifest

def generate_script(summary_uuid: Optional[str] = None, 
                   editor_article_uuid: Optional[str] = None,
                   template_id: Optional[str] = None,
                   script_type: str = 'quick_take') -> str:
    
    if not summary_uuid and not editor_article_uuid:
        raise ValueError("Either summary_uuid or editor_article_uuid required")
    
    conn = get_db_conn()
    cur = conn.cursor()
   
    script_uuid = None

    try:
        if template_id:
            cur.execute("SELECT * FROM script_templates WHERE template_id = %s", (template_id,))
        else:
            cur.execute("SELECT * FROM script_templates WHERE script_type = %s AND is_active = true LIMIT 1", 
                       (script_type,))
        template = cur.fetchone()
        if not template:
            raise ValueError(f"No template found for script_type: {script_type}")
        
        if summary_uuid:
            cur.execute("SELECT * FROM summaries WHERE summary_uuid = %s", (summary_uuid,))
            summary_data = cur.fetchone()
            if not summary_data:
                raise ValueError(f"Summary not found: {summary_uuid}")
            
            article_ids = summary_data['article_ids']
            summary_text = summary_data['summary_text']
            headline = summary_text.split('.')[0]
        else:
            cur.execute("SELECT * FROM editor_articles WHERE editor_article_uuid = %s", (editor_article_uuid,))
            editor_data = cur.fetchone()
            if not editor_data:
                raise ValueError(f"Editor article not found: {editor_article_uuid}")
            
            summary_text = editor_data['summary_text']
            headline = editor_data['headline']
            article_ids = []
        
        if article_ids:
            placeholders = ','.join(['%s'] * len(article_ids))
            cur.execute(f"SELECT * FROM articles WHERE article_id = ANY(%s)", (article_ids,))
            articles_data = cur.fetchall()
        else:
            articles_data = []
        
        total_duration = calculate_duration(summary_text)
        word_count = len(summary_text.split())
        
        script_uuid = None
        cur.execute("""
            INSERT INTO scripts (summary_uuid, editor_article_uuid, script_type, template_id,
                               manifest_json, tts_vtt_path, captions_vtt_path, total_duration,
                               word_count, status, generated_by)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING script_uuid
        """, (summary_uuid, editor_article_uuid, script_type, template['template_id'],
              '{}', '', '', total_duration, word_count, 'pending', 'system'))
        script_uuid = cur.fetchone()['script_uuid']
        
        script_dir = OUTPUT_DIR / str(script_uuid)
        script_dir.mkdir(exist_ok=True)
        
        summary_dict = {'summary_text': summary_text, 'headline': headline}
        manifest = build_manifest(summary_dict, articles_data, template['config'], 
                                 script_type, str(script_uuid), total_duration)
        
        manifest_path = script_dir / 'manifest.json'
        with open(manifest_path, 'w') as f:
            json.dump(manifest, f, indent=2)
        
        tts_vtt = generate_tts_vtt(summary_text, total_duration)
        tts_path = script_dir / 'tts_script.vtt'
        with open(tts_path, 'w') as f:
            f.write(tts_vtt)
        
        captions_vtt = generate_captions_vtt(summary_text, total_duration)
        captions_path = script_dir / 'captions.vtt'
        with open(captions_path, 'w') as f:
            f.write(captions_vtt)

        # Convert articles to JSON-safe format
        articles_json = []
        for a in articles_data:
            article_dict = dict(a)
            # Remove or convert non-serializable fields
            for key, value in article_dict.items():
                if isinstance(value, datetime):
                    article_dict[key] = value.isoformat()
            articles_json.append(article_dict)

        metadata = {
            'script_uuid': str(script_uuid),
            'summary_uuid': summary_uuid,
            'editor_article_uuid': editor_article_uuid,
            'summary_text': summary_text,
            'articles': articles_json,
            'generated_at': datetime.now().isoformat(),
            'total_duration': total_duration,
            'word_count': word_count
}
        with open(script_dir / 'metadata.json', 'w') as f:
            json.dump(metadata, f, indent=2)
        
        cur.execute("""
            UPDATE scripts SET manifest_json = %s, tts_vtt_path = %s, 
                   captions_vtt_path = %s, status = %s, updated_at = NOW()
            WHERE script_uuid = %s
        """, (json.dumps(manifest), str(tts_path), str(captions_path), 'generated', script_uuid))
        
        conn.commit()
        return str(script_uuid)
        
    except Exception as e:
        conn.rollback()
        if script_uuid:
            cur.execute("UPDATE scripts SET status = %s, error_message = %s WHERE script_uuid = %s",
                       ('failed', str(e), script_uuid))
            conn.commit()
        raise
    finally:
        cur.close()
        conn.close()
