// api/gemini.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';

// --- Re-defining necessary types here to avoid pathing issues ---
interface MapConfig {
  type: 'structured' | 'organic' | 'geometric';
  tone: 'Normal' | 'Sepia' | 'Night' | 'Toxic';
  width: number;
  height: number;
  rooms: { id: string; name: string; type: string; connections: string[]; furniture: string[] }[];
  description: string;
}

// --- Logic from GeminiDirector, adapted for serverless environment ---
class ServerlessGeminiDirector {
  private genAI: GoogleGenerativeAI;
  private models: GenerativeModel[];
  private modelNames: string[] = [
    'gemini-1.5-flash-latest',
    'gemini-pro',
  ];

  constructor(apiKey: string) {
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.models = this.modelNames.map(modelName => this.genAI.getGenerativeModel({ model: modelName }));
  }

  async generateMapConfig(userPrompt: string): Promise<MapConfig> {
    const systemPrompt = `
      You are an AI Dungeon Master Architect. 
      Your goal is to generate a JSON configuration for a battle map based on the user's description.
      CRITICAL RULES:
      1. Output MUST be valid JSON only. No markdown, no explanations.
      2. 'type' must be one of: 'structured' (houses, buildings), 'organic' (caves, forests), 'geometric' (ships, towers).
      3. 'tone' must be one of: 'Normal', 'Sepia' (flashback/old), 'Night', 'Toxic' (dangerous/alien).
      4. 'rooms' is a list of nodes. Connect them logically.
      5. 'width' and 'height' should be between 20 and 50.
      SCHEMA: { "type": "structured", "tone": "Normal", "width": 40, "height": 40, "rooms": [], "description": "..." }
    `;

    let lastError: any = null;

    for (const model of this.models) {
      try {
        const result = await model.generateContent([systemPrompt, `User Request: "${userPrompt}"`]);
        const response = await result.response;
        const text = response.text();
        const cleanJson = text.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(cleanJson) as MapConfig;
      } catch (error) {
        console.warn(`A model failed. Trying next model.`, error);
        lastError = error;
      }
    }

    console.error("Gemini Generation Failed for all models:", lastError);
    throw new Error("Failed to generate map configuration with any available model.");
  }
}

// --- Vercel Serverless Function Handler ---
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { prompt } = req.body;
  const apiKey = process.env.VITE_GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({ error: 'API key not configured on server' });
  }

  if (!prompt) {
    return res.status(400).json({ error: 'Prompt is required' });
  }

  try {
    const director = new ServerlessGeminiDirector(apiKey);
    const config = await director.generateMapConfig(prompt);
    res.status(200).json(config);
  } catch (error) {
    console.error('Error in Gemini API handler:', error);
    res.status(500).json({ error: 'Failed to generate map configuration' });
  }
}
