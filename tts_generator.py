import os
import json
from pathlib import Path
from datetime import datetime
from google.cloud import texttospeech
import psycopg2
from psycopg2.extras import RealDictCursor
import re

DB_CONFIG = {
    'host': os.getenv('DB_HOST', 'localhost'),
    'database': os.getenv('DB_NAME', 'news_pipeline'),
    'user': os.getenv('DB_USER', 'postgres'),
    'password': os.getenv('DB_PASS', 'postgres')
}

CONFIG_FILE = Path('config') / 'tts_config.json'
USAGE_FILE = Path('config') / 'tts_usage.json'

def get_db_conn():
    return psycopg2.connect(**DB_CONFIG, cursor_factory=RealDictCursor)

def load_tts_config():
    if not CONFIG_FILE.exists():
        raise FileNotFoundError(f"TTS config not found: {CONFIG_FILE}")
    with open(CONFIG_FILE, 'r') as f:
        return json.load(f)

def load_usage_data():
    if not USAGE_FILE.exists():
        config = load_tts_config()
        usage = {
            "projects": [
                {"project_id": p["project_id"], "month": datetime.now().month, "chars_used": 0}
                for p in config["projects"]
            ]
        }
        save_usage_data(usage)
        return usage
    
    with open(USAGE_FILE, 'r') as f:
        usage = json.load(f)
    
    current_month = datetime.now().month
    for project in usage["projects"]:
        if project["month"] != current_month:
            project["month"] = current_month
            project["chars_used"] = 0
    
    save_usage_data(usage)
    return usage

def save_usage_data(usage):
    with open(USAGE_FILE, 'w') as f:
        json.dump(usage, f, indent=2)

def select_project(config, usage):
    safety_limit = config.get("safety_limit", 800000)
    
    available = [
        p for p in usage["projects"]
        if p["chars_used"] < safety_limit
    ]
    
    if not available:
        raise Exception("All projects at quota limit. Try again next month.")
    
    selected = min(available, key=lambda p: p["chars_used"])
    
    project_config = next(
        p for p in config["projects"]
        if p["project_id"] == selected["project_id"]
    )
    
    return selected, project_config

def get_voice_config(news_type, config):
    voice_map = config.get("voice_mapping", {})
    voice_config = voice_map.get(news_type, voice_map.get("default"))
    
    if not voice_config:
        voice_config = {
            "language_code": "en-US",
            "name": "en-US-Neural2-C"
        }
    
    return voice_config

def update_usage(project_id, chars_used):
    usage = load_usage_data()
    
    for project in usage["projects"]:
        if project["project_id"] == project_id:
            project["chars_used"] += chars_used
            break
    
    save_usage_data(usage)

def parse_vtt_file(vtt_path: str) -> list:
    with open(vtt_path, 'r') as f:
        content = f.read()
    
    segments = []
    lines = content.split('\n')
    i = 0
    
    while i < len(lines):
        line = lines[i].strip()
        if '-->' in line:
            timing = line
            i += 1
            text_lines = []
            while i < len(lines) and lines[i].strip() and '-->' not in lines[i]:
                text_lines.append(lines[i].strip())
                i += 1
            
            text = ' '.join(text_lines)
            if text:
                segments.append({'timing': timing, 'text': text})
        i += 1
    
    return segments

def generate_audio(script_uuid: str, audio_params: dict) -> dict:
    """
    audio_params = {
        "model": "gemini-2.0-pro-tts",
        "voice": "Puck",
        "languageCode": "en-US",
        "speakingRate": 1.0,
        "pitch": 0.0,
        "volumeGainDb": 0.0,
        "sampleRateHertz": 24000
    }
    """
    conn = get_db_conn()
    cur = conn.cursor()
    
    try:
        cur.execute("SELECT tts_vtt_path FROM scripts WHERE script_uuid = %s", (script_uuid,))
        result = cur.fetchone()
        if not result:
            raise ValueError(f"Script not found: {script_uuid}")
        
        vtt_path = result['tts_vtt_path']
        segments = parse_vtt_file(vtt_path)
        full_text = ' '.join(seg['text'] for seg in segments)
        full_text = re.sub(r'<[^>]+>', '', full_text)
        
        config = load_tts_config()
        usage = load_usage_data()
        selected_usage, selected_config = select_project(config, usage)
        
        key_path = os.path.expanduser(selected_config["key_path"])
        os.environ['GOOGLE_APPLICATION_CREDENTIALS'] = key_path
        
        client = texttospeech.TextToSpeechClient()
        
        # Build voice name based on model
        model = audio_params.get("model", "gemini-2.0-pro-tts")
        voice_name = audio_params.get("voice", "Puck")
        language_code = audio_params.get("languageCode", "en-US")

        # Build full voice name based on model
        if model == "gemini-2.0-pro-tts":
            full_voice_name = voice_name  # "Puck", "Charon"
        elif "neural2" in model.lower() or "wavenet" in model.lower():
            full_voice_name = voice_name  # Already formatted "en-US-Neural2-A"
        elif "chirp3" in model.lower():
            full_voice_name = voice_name  # "en-US-Chirp3-HD-Charon"
        else:
            full_voice_name = voice_name  # Fallback
        
        synthesis_input = texttospeech.SynthesisInput(text=full_text)
        
        voice = texttospeech.VoiceSelectionParams(
            language_code=language_code,
            name=full_voice_name
        )
        
        audio_config = texttospeech.AudioConfig(
            audio_encoding=texttospeech.AudioEncoding.MP3,
            speaking_rate=audio_params.get("speakingRate", 1.0),
            pitch=audio_params.get("pitch", 0.0),
            volume_gain_db=audio_params.get("volumeGainDb", 0.0),
            sample_rate_hertz=audio_params.get("sampleRateHertz", 24000)
        )
        
        response = client.synthesize_speech(
            input=synthesis_input,
            voice=voice,
            audio_config=audio_config
        )
        
        output_dir = Path(f"output/scripts/{script_uuid}")
        output_dir.mkdir(parents=True, exist_ok=True)
        audio_path = output_dir / "audio.mp3"
        
        with open(audio_path, "wb") as out:
            out.write(response.audio_content)
        
        chars_used = len(full_text)
        update_usage(selected_usage["project_id"], chars_used)
        
        usage_updated = load_usage_data()
        current_project = next(
            p for p in usage_updated["projects"]
            if p["project_id"] == selected_usage["project_id"]
        )
        
        chars_remaining = config["safety_limit"] - current_project["chars_used"]
        
        cur.execute("""
            UPDATE scripts SET audio_file_path = %s, status = %s, updated_at = NOW()
            WHERE script_uuid = %s
        """, (str(audio_path), 'audio_ready', script_uuid))
        conn.commit()
        
        return {
            "audio_file_path": str(audio_path),
            "audio_url": f"/api/scripts/{script_uuid}/audio",
            "project_used": selected_usage["project_id"],
            "chars_used_this_request": chars_used,
            "chars_remaining_this_project": chars_remaining
        }
        
    except Exception as e:
        conn.rollback()
        cur.execute("UPDATE scripts SET status = %s, error_message = %s WHERE script_uuid = %s",
                   ('failed', str(e), script_uuid))
        conn.commit()
        raise
    finally:
        cur.close()
        conn.close()
