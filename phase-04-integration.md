Phase 4 Integration - Changes Documentation
Overview
Phase 4 adds audio script generation and TTS synthesis to the editorial workflow. Users can generate audio scripts from approved summaries and convert them to speech using Google Cloud TTS with multi-project rotation.

Files Modified in Phase 3
1. phase-03-editor/src/api/client.js
Link: https://raw.githubusercontent.com/nitinroshia/project-tree/refs/heads/main/client.js
Location: Line 78 (end of api object, before closing })
Changes Added:
javascript// Phase 4: Audio Generation
getAudioPresets: () =>
  apiClient.get('/api/audio/presets'),

generateScript: (data) =>
  apiClient.post('/api/script/generate', data),

generateAudio: (scriptUuid, audioParams) =>
  apiClient.post(`/api/script/${scriptUuid}/generate-audio`, audioParams),

getScript: (scriptUuid) =>
  apiClient.get(`/api/script/${scriptUuid}`),
Purpose: API methods for audio generation endpoints
Note: These call Phase 4 backend on port 5002. Ensure VITE_API_URL points to correct backend.

2. phase-03-editor/src/components/ScriptGenerator.jsx
Link: https://raw.githubusercontent.com/nitinroshia/project-tree/refs/heads/main/ScriptGenerator.jsx
Location: New file created
Purpose: Audio script generation UI component
Features:

Checkbox to use image summary (from editor_articles.summary_text) for audio
Google TTS parameter controls:

Model selection (Gemini-2.0-Pro, Chirp3-HD, Neural2, Wavenet)
Voice selection (dynamically populated based on model)
Speaking rate slider (0.5x - 2.0x)
Pitch slider (-20 to +20)
Volume gain


Audio preview player (plays generated MP3 in browser)
TTS usage monitoring (shows quota consumption across GCP projects)

Props Expected:
javascript{
  summaryText: string,           // From summaries.summary_text
  summaryUuid: string,           // From summaries.summary_uuid
  editorArticleUuid: string,     // From editor_articles.editor_article_uuid
  imageSummaryText: string,      // From editor_articles.summary_text (for images)
  onScriptGenerated: function    // Callback when script is generated
}

3. phase-03-editor/src/components/SummaryReview.jsx
Link: https://raw.githubusercontent.com/nitinroshia/project-tree/refs/heads/main/SummaryReview.jsx
Location: Lines added after approval section
Changes Added:
javascript// Line 3 - Import
import ScriptGenerator from './ScriptGenerator';

// Line ~10 - State
const [isApproved, setIsApproved] = useState(summary.status === 'approved')

// Inside handleApprove function - Add this line
setIsApproved(true)

// Line ~156 - Component integration (after approval message)
{isApproved && (
  <ScriptGenerator
    summaryText={summary.summary_text}
    summaryUuid={summary.summary_uuid}
    editorArticleUuid={summary.editor_article_uuid}
    imageSummaryText={summary.image_summary_text}
    onScriptGenerated={(script) => {
      console.log('Script generated:', script.script_uuid);
    }}
    defaultExpanded={false}
  />
)}
Purpose: Integrates audio generator into summary approval workflow
Behavior: Script generator appears after user clicks "Approve" button

New Files in Phase 4
4. phase-04-script/backend/api.py
Link: https://raw.githubusercontent.com/nitinroshia/project-tree/refs/heads/main/api.py
Purpose: Flask API server for audio generation (port 5002)
Key Endpoints:

POST /api/script/generate - Generate script from summary
POST /api/script/{uuid}/generate-audio - Generate TTS audio
GET /api/audio/presets - Get available TTS models/voices
GET /api/tts/usage - Get TTS quota usage
GET /api/script/{uuid}/audio - Serve audio file for playback

Critical Addition Needed:
python# Add after line 10
import os
import json

DB_CONFIG = {
    'host': os.getenv('DB_HOST', 'localhost'),
    'database': os.getenv('DB_NAME', 'news_pipeline'),
    'user': os.getenv('DB_USER', 'postgres'),
    'password': os.getenv('DB_PASS', 'postgres')
}

def get_db_conn():
    return psycopg2.connect(**DB_CONFIG, cursor_factory=RealDictCursor)

5. phase-04-script/backend/script_generator.py
Link: https://raw.githubusercontent.com/nitinroshia/project-tree/refs/heads/main/script_generator.py
Purpose: Generates VTT caption files and manifest JSON
Key Functions:

generate_script() - Main entry point
generate_tts_vtt() - Creates TTS script with SSML timing
generate_captions_vtt() - Creates caption overlay file
calculate_duration() - Estimates audio duration (150 words/min)

Output Files:

output/scripts/{uuid}/tts_script.vtt - Voice synthesis script
output/scripts/{uuid}/captions.vtt - Video caption overlay
output/scripts/{uuid}/manifest.json - Metadata
output/scripts/{uuid}/metadata.json - Generation info


6. phase-04-script/backend/tts_generator.py
Link: https://raw.githubusercontent.com/nitinroshia/project-tree/refs/heads/main/tts_generator.py
Purpose: Google Cloud TTS integration with multi-project rotation
Key Functions:

generate_audio() - Main TTS generation
load_tts_config() - Loads project rotation config
select_project() - Picks project with lowest usage
update_usage() - Tracks character consumption

Features:

Automatic rotation across 3-4 GCP projects
800k character safety limit per project
Monthly quota reset (auto-detected)
Supports all Google TTS models (Gemini, Chirp3, Neural2, Wavenet)


7. phase-04-script/config/tts_config.json
Link: https://raw.githubusercontent.com/nitinroshia/project-tree/refs/heads/main/tts_config.json
Purpose: TTS project rotation configuration
Structure:
json{
  "projects": [
    {"project_id": "...", "key_path": "~/.gcp-keys/...json"}
  ],
  "safety_limit": 800000,
  "voice_mapping": {...}
}
Maintenance: Add GCP project credentials here

8. phase-04-script/config/audio_presets.json
Link: https://raw.githubusercontent.com/nitinroshia/project-tree/refs/heads/main/audio_presets.json
Purpose: Defines available TTS models, voices, and languages
Structure:
json{
  "models": ["gemini-2.0-pro-tts", "chirp3-hd", "neural2", "wavenet"],
  "languages": [{"code": "en-US", "name": "English (US)"}],
  "voices": {
    "gemini-2.0-pro-tts": [
      {"name": "Puck", "gender": "NEUTRAL"},
      {"name": "Charon", "gender": "NEUTRAL"}
    ]
  }
}
Note: Remove "standard" from models array - not a valid Google TTS model

9. phase-04-script/config/tts_usage.json
Link: https://raw.githubusercontent.com/nitinroshia/project-tree/refs/heads/main/tts_usage.json
Purpose: Tracks TTS character consumption per project
Auto-generated: Created on first run
Structure:
json{
  "projects": [
    {"project_id": "...", "month": 12, "chars_used": 450000}
  ]
}
Resets: Automatically on 1st of each month

10. phase-04-script/migrations/004_phase4_scripts.sql
Purpose: Database schema for script storage
Tables Created:

scripts - Stores generated scripts and audio file paths
script_templates - Stores caption formatting templates (deprecated in current design)

Must Run:
bashpsql -U postgres -d news_pipeline -f migrations/004_phase4_scripts.sql

Environment Configuration
Phase 3 Frontend
File: phase-03-editor/.env
bashVITE_API_URL=http://localhost:5001        # Phase 2 backend
VITE_SCRIPT_API_URL=http://localhost:5002 # Phase 4 backend (if separate)
Phase 4 Backend
File: phase-04-script/.env
bashDB_HOST=localhost
DB_NAME=news_pipeline
DB_USER=postgres
DB_PASS=postgres
Note: No GOOGLE_APPLICATION_CREDENTIALS needed - handled via tts_config.json rotation

Server Startup
Terminal 1: Phase 2 Backend (Port 5001)
bashcd phase-02-summarization
python api.py
Terminal 2: Phase 4 Backend (Port 5002)
bashcd phase-04-script/backend
python api.py
Terminal 3: Phase 3 Frontend (Port 5173)
bashcd phase-03-editor
npm run dev

User Workflow

Navigate to Review Queue (http://localhost:5173/queue)
Click "Approved" tab - View approved summaries
Click on summary - Opens detail view
Click "Approve" button (if pending) - Script generator appears below
Optional: Check "Use image summary" - Uses editor_articles.summary_text instead
Select TTS parameters:

Model (Gemini-2.0-Pro recommended)
Voice (Puck, Charon, etc)
Speed (0.5x - 2.0x)
Pitch (-20 to +20)


Click "Generate Script" - Creates VTT files (~2 seconds)
Click "Generate Audio" - Calls Google TTS (~5-10 seconds)
Audio player appears - Preview generated audio in browser
Check TTS usage bars - Monitor quota consumption


Known Issues & Fixes Required
Issue 1: Empty Dropdowns
Cause: scriptClient not defined in client.js
Fix: Replace scriptClient with apiClient in Phase 4 methods OR define scriptClient pointing to port 5002
Issue 2: "standard" Model Error
Cause: Invalid model name in audio_presets.json
Fix: Remove "standard" from models array (line 3)
Issue 3: Missing Props
Cause: SummaryReview.jsx not passing editorArticleUuid and imageSummaryText
Fix: Verify these props exist on summary object and are passed to <ScriptGenerator />
Issue 4: get_db_conn Error
Cause: Missing database helper function in api.py
Fix: Add DB_CONFIG and get_db_conn() function (see section 4 above)

Testing Checklist

 Can view approved summaries in queue
 Script generator appears after approval
 Model dropdown populates with 4 options
 Voice dropdown populates based on selected model
 Speed/pitch sliders work
 "Generate Script" creates files in output/scripts/{uuid}/
 "Generate Audio" produces MP3 file
 Audio player loads and plays audio
 TTS usage bars update after generation
 Image summary checkbox works (if imageSummaryText prop exists)


API Endpoints Summary
EndpointMethodPurpose/api/script/generatePOSTGenerate script from summary/api/script/{uuid}GETGet script details/api/script/{uuid}/generate-audioPOSTGenerate TTS audio/api/script/{uuid}/audioGETServe audio file/api/audio/presetsGETGet available models/voices/api/tts/usageGETGet quota usage stats

Dependencies Added
Phase 4 Backend
bashpip install flask flask-cors google-cloud-texttospeech psycopg2-binary
Phase 3 Frontend
No new dependencies (uses existing axios)

File Permissions Required
bash# GCP service account keys
chmod 600 ~/.gcp-keys/*.json

# Output directories
mkdir -p phase-04-script/output/scripts
chmod 755 phase-04-script/output/scripts

Database Schema Changes
New tables: scripts, script_templates
Migration file: phase-04-script/migrations/004_phase4_scripts.sql
Columns in scripts table:

script_uuid (PK)
summary_uuid (FK to summaries)
editor_article_uuid (FK to editor_articles)
audio_file_path (path to MP3)
tts_vtt_path (path to voice script)
captions_vtt_path (path to captions)
total_duration (seconds)
status (pending/generated/audio_ready/failed)


Questions for Senior Developer

Port Configuration: Should Phase 4 backend run on separate port (5002) or merge into Phase 2 backend (5001)?
Props Availability: Does summary object in SummaryReview.jsx include editor_article_uuid and image_summary_text fields?
API Client Strategy: Should we use single apiClient with proxy or separate clients for Phase 2 vs Phase 4?
GCP Credentials: Confirm location of service account JSON files (currently expected at ~/.gcp-keys/)
Database Migration: Has 004_phase4_scripts.sql been run on production database?


Support
Phase 4 Developer Contact: [Your contact info]
Documentation Location: phase-04-script/README.md
Log Files:

Backend: Console output from python api.py
Frontend: Browser DevTools Console (F12)
TTS Usage: phase-04-script/config/tts_usage.json
Claude is AI and can make mistakes. Please double-check responses. Sonnet 4.5
