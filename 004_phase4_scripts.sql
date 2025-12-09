-- Script templates configuration
CREATE TABLE script_templates (
    template_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_name TEXT NOT NULL UNIQUE,
    script_type TEXT NOT NULL CHECK (script_type IN ('quick_take', 'long_format')),
    is_active BOOLEAN DEFAULT true,
    config JSONB NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Generated scripts
CREATE TABLE scripts (
    script_uuid UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    summary_uuid UUID REFERENCES summaries(summary_uuid),
    editor_article_uuid UUID REFERENCES editor_articles(editor_article_uuid),
    script_type TEXT NOT NULL CHECK (script_type IN ('quick_take', 'long_format')),
    template_id UUID REFERENCES script_templates(template_id),
    manifest_json JSONB NOT NULL,
    tts_vtt_path TEXT NOT NULL,
    captions_vtt_path TEXT NOT NULL,
    audio_file_path TEXT,
    total_duration FLOAT NOT NULL,
    word_count INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'generated', 'audio_ready', 'failed')),
    generated_by TEXT,
    error_message TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    CONSTRAINT summary_or_editor CHECK (
        (summary_uuid IS NOT NULL AND editor_article_uuid IS NULL) OR
        (summary_uuid IS NULL AND editor_article_uuid IS NOT NULL)
    )
);

CREATE INDEX idx_scripts_summary ON scripts(summary_uuid);
CREATE INDEX idx_scripts_editor ON scripts(editor_article_uuid);
CREATE INDEX idx_scripts_status ON scripts(status);
CREATE INDEX idx_scripts_type ON scripts(script_type);

-- Insert default templates
INSERT INTO script_templates (template_name, script_type, config) VALUES
('quick_take_default', 'quick_take', '{
  "logo": {
    "date": {"fontSize": 20, "fontName": "SourceSans3-Italic_SemiBold-Italic"},
    "timer": {"fontSize": 25, "fontName": "RobotoCondensed-SemiBoldItalic"}
  },
  "headline": {
    "fontSize": 60,
    "fontName": "SourceSans3-Roman_Bold",
    "paragraphBox": {"width": 660, "height": 300}
  },
  "speakerLabel": {
    "name": {"fontSize": 26, "fontName": "RobotoCondensed-BoldItalic"},
    "title": {"fontSize": 26, "fontName": "RobotoCondensed-LightItalic"}
  },
  "defaultSpeaker": {"name": "AI Narrator", "title": "Pellacia Press"},
  "sectionLabels": ["Markets", "Technology", "Policy", "Geo-Politics", "Energy"],
  "captionsStyle": {
    "fontSize": 38,
    "fontName": "SourceSans3-Roman_Bold",
    "maxCharsPerLine": 35,
    "maxLines": 2
  }
}'),
('long_format_default', 'long_format', '{
  "logo": {
    "date": {"fontSize": 22, "fontName": "SourceSans3-Italic_SemiBold-Italic"},
    "timer": {"fontSize": 28, "fontName": "RobotoCondensed-SemiBoldItalic"}
  },
  "headline": {
    "fontSize": 65,
    "fontName": "SourceSans3-Roman_Bold",
    "paragraphBox": {"width": 700, "height": 350}
  },
  "speakerLabel": {
    "name": {"fontSize": 28, "fontName": "RobotoCondensed-BoldItalic"},
    "title": {"fontSize": 28, "fontName": "RobotoCondensed-LightItalic"}
  },
  "defaultSpeaker": {"name": "AI Narrator", "title": "Pellacia Press"},
  "sectionLabels": ["Markets", "Technology", "Policy", "Geo-Politics", "Energy"],
  "captionsStyle": {
    "fontSize": 40,
    "fontName": "SourceSans3-Roman_Bold",
    "maxCharsPerLine": 35,
    "maxLines": 2
  }
}');
