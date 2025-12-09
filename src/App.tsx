import { useState } from 'react';
import { GameCanvas } from './components/GameCanvas';
import { getWorker } from './workers/WorkerManager';
import { MapConfig } from './types/MapConfig';

function App() {
  const [status, setStatus] = useState<string>('Idle');
  const [isCalculating, setIsCalculating] = useState(false);
  
  // Gemini State
  const [prompt, setPrompt] = useState('A spooky haunted victorian mansion with a grand foyer and a hidden basement.');
  const [generatedConfig, setGeneratedConfig] = useState<MapConfig | null>(null);

  const handleHeavyTask = async () => {
    setIsCalculating(true);
    setStatus('Calculating on Worker...');
    
    try {
      const worker = getWorker();
      const result = await worker.generateHeavyMap(5000);
      setStatus(result);
    } catch (err) {
      console.error(err);
      setStatus('Error in Worker');
    } finally {
      setIsCalculating(false);
    }
  };

  const setTone = (tone: string) => {
    window.dispatchEvent(new CustomEvent('PHASER_SET_TONE', { detail: tone }));
  };

  const handleGenerate = async () => {
      if (!prompt) {
          alert('Please enter a narrative prompt.');
          return;
      }

      setIsCalculating(true);
      setStatus('AI Director is thinking...');

      try {
          const response = await fetch('/api/gemini', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ prompt }),
          });

          if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'API request failed');
          }

          const config = await response.json() as MapConfig;
          
          setGeneratedConfig(config);
          setStatus(`Generated: ${config.type} - ${config.description}`);
          
          // Set Tone immediately
          setTone(config.tone);
          
          const worker = getWorker();
          const mapData = await worker.generateMap(config);
          
          window.dispatchEvent(new CustomEvent('PHASER_DRAW_MAP', { detail: mapData }));

      } catch (err) {
          console.error(err);
          const errorMessage = err instanceof Error ? err.message : 'Generation Failed (Check Console)';
          setStatus(errorMessage);
      } finally {
          setIsCalculating(false);
      }
  };

  return (
    <>
      <GameCanvas />
      <div style={{
        position: 'absolute',
        top: 20,
        left: 20,
        padding: '20px',
        background: 'rgba(0,0,0,0.85)',
        color: 'white',
        borderRadius: '8px',
        zIndex: 10,
        maxWidth: '350px',
        fontFamily: 'sans-serif',
        border: '1px solid #444',
        boxShadow: '0 4px 6px rgba(0,0,0,0.3)'
      }}>
        <h2 style={{margin: '0 0 10px 0', color: '#81c784'}}>Neuro-Symbolic Arch</h2>

        {/* Prompt Input */}
        <div style={{marginBottom: '15px'}}>
            <label style={{fontSize: '0.8em', color: '#aaa'}}>Narrative Prompt</label>
            <textarea 
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={4}
                style={{width: '100%', padding: '5px', marginTop: '2px', background: '#333', border: '1px solid #555', color: 'white', resize: 'vertical'}}
            />
        </div>

        <button 
          onClick={handleGenerate} 
          disabled={isCalculating}
          style={{
            padding: '12px 20px',
            background: isCalculating ? '#555' : '#2196F3',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: isCalculating ? 'not-allowed' : 'pointer',
            width: '100%',
            fontWeight: 'bold',
            marginBottom: '15px'
          }}
        >
          {isCalculating ? 'AI Director Working...' : 'GENERATE MAP'}
        </button>

        <p style={{marginBottom: '10px', fontSize: '0.9em'}}>Status: <span style={{color: '#4db6ac'}}>{status}</span></p>

        {/* Config Debug View */}
        {generatedConfig && (
            <div style={{maxHeight: '150px', overflowY: 'auto', background: '#111', padding: '5px', fontSize: '0.7em', marginBottom: '15px'}}>
                <pre>{JSON.stringify(generatedConfig, null, 2)}</pre>
            </div>
        )}

        <div style={{borderTop: '1px solid #444', paddingTop: '10px'}}>
            <h3 style={{margin: '0 0 10px 0', fontSize: '1em'}}>Manual Override</h3>
            <button 
                onClick={handleHeavyTask} 
                disabled={isCalculating}
                style={{
                    padding: '5px 10px',
                    background: '#555',
                    color: '#ccc',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    width: '100%',
                    fontSize: '0.8em',
                    marginBottom: '10px'
                }}
            >
                Test Worker Lag
            </button>
            <div style={{display: 'flex', gap: '5px', flexWrap: 'wrap'}}>
                <button onClick={() => setTone('Normal')} style={{flex: 1, cursor:'pointer'}}>Normal</button>
                <button onClick={() => setTone('Sepia')} style={{flex: 1, cursor:'pointer'}}>Sepia</button>
                <button onClick={() => setTone('Night')} style={{flex: 1, cursor:'pointer'}}>Night</button>
                <button onClick={() => setTone('Toxic')} style={{flex: 1, cursor:'pointer'}}>Toxic</button>
            </div>
        </div>
      </div>
    </>
  );
}

export default App;
