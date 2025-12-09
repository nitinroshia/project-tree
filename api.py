from flask_cors import CORS
import json
import sys
sys.path.append('..')

from flask import Flask, request, jsonify, send_file
from script_generator import generate_script as generate_script_files
from tts_generator import generate_audio as generate_tts_audio, load_usage_data, load_tts_config
import psycopg2
from psycopg2.extras import RealDictCursor
import os

DB_CONFIG = {
    'host': os.getenv('DB_HOST', 'localhost'),
    'database': os.getenv('DB_NAME', 'news_pipeline'),
    'user': os.getenv('DB_USER', 'postgres'),
    'password': os.getenv('DB_PASS', 'postgres')
}

def get_db_conn():
    return psycopg2.connect(**DB_CONFIG, cursor_factory=RealDictCursor)

app = Flask(__name__)
CORS(app)

@app.route('/api/scripts/generate', methods=['POST'])
def api_generate_script():
    data = request.json
    summary_uuid = data.get('summary_uuid')
    editor_article_uuid = data.get('editor_article_uuid')
    template_id = data.get('template_id')
    script_type = data.get('script_type', 'quick_take')
    
    try:
        script_uuid = generate_script(summary_uuid, editor_article_uuid, template_id, script_type)
        
        conn = get_db_conn()
        cur = conn.cursor()
        cur.execute("SELECT * FROM scripts WHERE script_uuid = %s", (script_uuid,))
        script = cur.fetchone()
        cur.close()
        conn.close()
        
        return jsonify({
            'script_uuid': script_uuid,
            'manifest_path': script['manifest_json'],
            'tts_vtt_path': script['tts_vtt_path'],
            'captions_vtt_path': script['captions_vtt_path'],
            'total_duration': script['total_duration'],
            'status': script['status']
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/scripts/<script_uuid>', methods=['GET'])
def api_get_script(script_uuid):
    conn = get_db_conn()
    cur = conn.cursor()
    cur.execute("SELECT * FROM scripts WHERE script_uuid = %s", (script_uuid,))
    script = cur.fetchone()
    cur.close()
    conn.close()
    
    if not script:
        return jsonify({'error': 'Script not found'}), 404
    
    return jsonify(dict(script))

@app.route('/api/scripts', methods=['GET'])
def api_list_scripts():
    status = request.args.get('status')
    script_type = request.args.get('script_type')
    limit = int(request.args.get('limit', 50))
    
    conn = get_db_conn()
    cur = conn.cursor()
    
    query = "SELECT * FROM scripts WHERE 1=1"
    params = []
    
    if status:
        query += " AND status = %s"
        params.append(status)
    if script_type:
        query += " AND script_type = %s"
        params.append(script_type)
    
    query += " ORDER BY created_at DESC LIMIT %s"
    params.append(limit)
    
    cur.execute(query, params)
    scripts = cur.fetchall()
    cur.close()
    conn.close()
    
    return jsonify([dict(s) for s in scripts])

@app.route('/api/scripts/<script_uuid>/regenerate', methods=['PUT'])
def api_regenerate_script(script_uuid):
    conn = get_db_conn()
    cur = conn.cursor()
    cur.execute("SELECT summary_uuid, editor_article_uuid, script_type, template_id FROM scripts WHERE script_uuid = %s", 
                (script_uuid,))
    script = cur.fetchone()
    cur.close()
    conn.close()
    
    if not script:
        return jsonify({'error': 'Script not found'}), 404
    
    try:
        new_uuid = generate_script(
            script['summary_uuid'],
            script['editor_article_uuid'],
            script['template_id'],
            script['script_type']
        )
        return jsonify({'script_uuid': new_uuid})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/scripts/templates', methods=['GET'])
def api_list_templates():
    conn = get_db_conn()
    cur = conn.cursor()
    cur.execute("SELECT * FROM script_templates WHERE is_active = true ORDER BY template_name")
    templates = cur.fetchall()
    cur.close()
    conn.close()
    
    return jsonify([dict(t) for t in templates])

@app.route('/api/scripts/templates', methods=['POST'])
def api_create_template():
    data = request.json
    
    conn = get_db_conn()
    cur = conn.cursor()
    cur.execute("""
        INSERT INTO script_templates (template_name, script_type, config, is_active)
        VALUES (%s, %s, %s, %s)
        RETURNING template_id
    """, (data['template_name'], data['script_type'], json.dumps(data['config']), 
          data.get('is_active', True)))
    template_id = cur.fetchone()['template_id']
    conn.commit()
    cur.close()
    conn.close()
    
    return jsonify({'template_id': template_id})

@app.route('/api/scripts/<script_uuid>/generate-audio', methods=['POST'])
def api_generate_audio(script_uuid):
    data = request.json or {}
    news_type = data.get('news_type', 'default')
    
    try:
        result = generate_audio(script_uuid, news_type)
        return jsonify(result)
    except Exception as e:
        if "quota limit" in str(e).lower():
            return jsonify({'error': str(e)}), 429
        return jsonify({'error': str(e)}), 500

@app.route('/api/tts/usage', methods=['GET'])
def api_tts_usage():
    try:
        usage = load_usage_data()
        config = load_tts_config()
        safety_limit = config.get("safety_limit", 800000)
        
        projects_info = []
        for project in usage["projects"]:
            projects_info.append({
                "project_id": project["project_id"],
                "chars_used": project["chars_used"],
                "chars_remaining": safety_limit - project["chars_used"],
                "usage_percent": (project["chars_used"] / safety_limit) * 100
            })
        
        return jsonify({"projects": projects_info})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/script/generate', methods=['POST'])
def generate_script():
    """Generate TTS-optimized script from summary"""
    data = request.json
    summary_uuid = data.get('summary_uuid')
    editor_article_uuid = data.get('editor_article_uuid')
    template_id = data.get('template_id')
    script_type = data.get('script_type', 'quick_take')
    
    try:
        script_uuid = generate_script_files(
            summary_uuid=summary_uuid,
            editor_article_uuid=editor_article_uuid,
            template_id=template_id,
            script_type=script_type
        )
        
        conn = get_db_conn()
        cur = conn.cursor()
        cur.execute("""
            SELECT script_uuid, total_duration, word_count, status,
                   tts_vtt_path, captions_vtt_path, manifest_json
            FROM scripts WHERE script_uuid = %s
        """, (script_uuid,))
        script = cur.fetchone()
        cur.close()
        conn.close()
        
        return jsonify({
            'script_uuid': str(script['script_uuid']),
            'duration': script['total_duration'],
            'word_count': script['word_count'],
            'status': script['status'],
            'vtt_path': script['tts_vtt_path'],
            'captions_path': script['captions_vtt_path']
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/script/<script_uuid>', methods=['GET'])
def get_script(script_uuid):
    """Get full script details"""
    conn = get_db_conn()
    cur = conn.cursor()
    cur.execute("SELECT * FROM scripts WHERE script_uuid = %s", (script_uuid,))
    script = cur.fetchone()
    cur.close()
    conn.close()
    
    if not script:
        return jsonify({'error': 'Script not found'}), 404
    
    return jsonify(dict(script))

@app.route('/api/script/<script_uuid>/download', methods=['GET'])
def download_script(script_uuid):
    """Download script in various formats"""
    format_type = request.args.get('format', 'vtt')
    
    conn = get_db_conn()
    cur = conn.cursor()
    cur.execute("SELECT tts_vtt_path, captions_vtt_path FROM scripts WHERE script_uuid = %s", 
                (script_uuid,))
    script = cur.fetchone()
    cur.close()
    conn.close()
    
    if not script:
        return jsonify({'error': 'Script not found'}), 404
    
    if format_type == 'vtt':
        file_path = script['tts_vtt_path']
    elif format_type == 'captions':
        file_path = script['captions_vtt_path']
    else:
        return jsonify({'error': 'Invalid format'}), 400
    
    return send_file(file_path, as_attachment=True)

@app.route('/api/script/<script_uuid>/generate-audio', methods=['POST'])
def generate_audio_endpoint(script_uuid):
    """Generate TTS audio"""
    data = request.json or {}
    news_type = data.get('news_type', 'default')
    
    try:
        result = generate_tts_audio(script_uuid, news_type)
        return jsonify(result)
    except Exception as e:
        if "quota limit" in str(e).lower():
            return jsonify({'error': str(e)}), 429
        return jsonify({'error': str(e)}), 500

@app.route('/api/tts/usage', methods=['GET'])
def get_tts_usage():
    """Get TTS usage statistics"""
    try:
        from tts_generator import load_usage_data, load_tts_config
        usage = load_usage_data()
        config = load_tts_config()
        safety_limit = config.get("safety_limit", 800000)
        
        projects_info = []
        for project in usage["projects"]:
            projects_info.append({
                "project_id": project["project_id"],
                "chars_used": project["chars_used"],
                "chars_remaining": safety_limit - project["chars_used"],
                "usage_percent": round((project["chars_used"] / safety_limit) * 100, 1)
            })
        
        return jsonify({"projects": projects_info})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/audio/presets', methods=['GET'])
def get_audio_presets():
    """Get audio configuration options"""
    with open('config/audio_presets.json', 'r') as f:
        presets = json.load(f)
    return jsonify(presets)

@app.route('/api/scripts/<script_uuid>/audio', methods=['GET'])
def serve_audio(script_uuid):
    """Serve audio file for playback"""
    conn = get_db_conn()
    cur = conn.cursor()
    cur.execute("SELECT audio_file_path FROM scripts WHERE script_uuid = %s", (script_uuid,))
    script = cur.fetchone()
    cur.close()
    conn.close()
    
    if not script or not script['audio_file_path']:
        return jsonify({'error': 'Audio not found'}), 404
    
    return send_file(script['audio_file_path'], mimetype='audio/mpeg')

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5002, debug=True)
