import React, { useState, useEffect } from 'react';
import { api } from '../api/client';

const ScriptGenerator = ({ summaryText, summaryUuid, editorArticleUuid, imageSummaryText }) => {
  const [loading, setLoading] = useState(false);
  const [script, setScript] = useState(null);
  const [audioPresets, setAudioPresets] = useState(null);
  const [useImageSummary, setUseImageSummary] = useState(false);

  // Audio params
  const [model, setModel] = useState('gemini-2.0-pro-tts');
  const [language, setLanguage] = useState('en-US');
  const [voice, setVoice] = useState('Puck');
  const [speakingRate, setSpeakingRate] = useState(1.0);
  const [pitch, setPitch] = useState(0.0);
  const [volumeGain, setVolumeGain] = useState(0.0);

  const [audioUrl, setAudioUrl] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    loadAudioPresets();
  }, []);

  const loadAudioPresets = async () => {
    try {
      const res = await api.getAudioPresets();
      setAudioPresets(res.data);
    } catch (err) {
      console.error('Failed to load presets:', err);
    }
  };

  const handleGenerateScript = async () => {
    setLoading(true);
    setError('');

    const textToUse = useImageSummary ? imageSummaryText : summaryText;

    try {
      const res = await api.generateScript({
        summary_uuid: summaryUuid,
        editor_article_uuid: editorArticleUuid,
        summary_text: textToUse,
        script_type: 'quick_take'
      });
      setScript(res.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to generate script');
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateAudio = async () => {
    if (!script) return;

    setLoading(true);
    setError('');

    try {
      const res = await api.generateAudio(script.script_uuid, {
        model,
        voice,
        languageCode: language,
        speakingRate: parseFloat(speakingRate),
        pitch: parseFloat(pitch),
        volumeGainDb: parseFloat(volumeGain),
        sampleRateHertz: 24000
      });

      setAudioUrl(res.data.audio_url);
      alert(`✅ Audio generated!\nProject: ${res.data.project_used}\nChars: ${res.data.chars_used_this_request}`);
    } catch (err) {
      setError(err.response?.data?.error || 'Audio generation failed');
    } finally {
      setLoading(false);
    }
  };

  const availableVoices = audioPresets?.voices[model] || [];

  return (
    <div className="mt-4 p-6 bg-white border rounded-lg">
      <h3 className="text-lg font-bold mb-4">🎙️ Audio Generator</h3>

      {error && <div className="mb-4 p-3 bg-red-50 text-red-700 rounded">{error}</div>}

      {imageSummaryText && (
        <label className="flex items-center gap-2 mb-4">
          <input
            type="checkbox"
            checked={useImageSummary}
            onChange={(e) => setUseImageSummary(e.target.checked)}
          />
          <span>Use image summary for audio</span>
        </label>
      )}

      {!script ? (
        <button onClick={handleGenerateScript} disabled={loading} className="px-4 py-2 bg-blue-600 text-white rounded">
          {loading ? 'Generating...' : 'Generate Script'}
        </button>
      ) : (
        <div className="space-y-4">
          <div className="p-4 bg-green-50 rounded">
            <p><strong>Duration:</strong> {script.duration?.toFixed(1)}s</p>
            <p><strong>Words:</strong> {script.word_count}</p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Model</label>
              <select value={model} onChange={(e) => { setModel(e.target.value); setVoice(audioPresets?.voices[e.target.value][0]?.name || 'Puck'); }} className="w-full p-2 border rounded">
                {audioPresets?.models.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Voice</label>
              <select value={voice} onChange={(e) => setVoice(e.target.value)} className="w-full p-2 border rounded">
                {availableVoices.map(v => <option key={v.name} value={v.name}>{v.name}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Speed ({speakingRate}x)</label>
              <input type="range" min="0.5" max="2.0" step="0.05" value={speakingRate} onChange={(e) => setSpeakingRate(e.target.value)} className="w-full" />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Pitch ({pitch})</label>
              <input type="range" min="-20" max="20" step="0.5" value={pitch} onChange={(e) => setPitch(e.target.value)} className="w-full" />
            </div>
          </div>

          <button onClick={handleGenerateAudio} disabled={loading} className="w-full px-4 py-2 bg-purple-600 text-white rounded">
            {loading ? 'Generating Audio...' : '🎙️ Generate Audio'}
          </button>

          {audioUrl && (
            <div className="p-4 bg-gray-50 rounded">
              <p className="mb-2 font-medium">🎵 Audio Preview:</p>
              <audio controls className="w-full" src={`http://localhost:5002${audioUrl}`} />
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ScriptGenerator;
