import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import { MapConfig } from '../types/MapConfig';

export class GeminiDirector {
  private genAI: GoogleGenerativeAI;
  private models: GenerativeModel[];
  private modelNames: string[] = [
    'gemini-2.5-flash',
    'gemini-flash-latest',
    'gemini-flash-lite-latest',
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
      4. 'rooms' is a list of nodes. Connect them logically (e.g., Bedroom connects to Hallway, not Kitchen).
      5. 'width' and 'height' should be between 20 and 50.
      
      SCHEMA:
      {
        "type": "structured" | "organic" | "geometric",
        "tone": "Normal" | "Sepia" | "Night" | "Toxic",
        "width": number,
        "height": number,
        "rooms": [
          { "id": "r1", "name": "Foyer", "type": "entrance", "connections": ["r2"], "furniture": ["rug", "plant"] },
          { "id": "r2", "name": "Hallway", "type": "corridor", "connections": ["r1", "r3"], "furniture": [] }
        ],
        "description": "Short summary of the map"
      }
    `;

    let lastError: any = null;

    for (const model of this.models) {
      try {
        const result = await model.generateContent([
          systemPrompt,
          `User Request: "${userPrompt}"`
        ]);
        const response = await result.response;
        const text = response.text();
        
        // Clean up potential markdown code blocks
        const cleanJson = text.replace(/```json/g, '').replace(/```/g, '').trim();
        
        return JSON.parse(cleanJson) as MapConfig;
      } catch (error) {
        // We can get the model name from the model object, but it's not easily accessible.
        // `model.model` is not a public property.
        console.warn(`A model failed. Trying next model.`, error);
        lastError = error;
      }
    }

    console.error("Gemini Generation Failed for all models:", lastError);
    throw new Error("Failed to generate map configuration with any available model.");
  }
}
