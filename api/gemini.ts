// api/gemini.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';

// --- Re-defining necessary types here to avoid pathing issues ---
interface MapConfig {
  type: 'structured' | 'organic' | 'geometric';
  tone: 'Normal' | 'Sepia' | 'Night' | 'Toxic';
  width: number;
  height: number;
  rooms: { id: string; name: string; type: string; connections: string[]; furniture: string[]; width?: number; height?: number }[];
  description: string;
}

// --- Logic from GeminiDirector, adapted for serverless environment ---
class ServerlessGeminiDirector {
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
      1. Output MUST be valid JSON only. No markdown.
      2. 'type': 'structured' (buildings), 'organic' (caves/nature), 'geometric' (ships/temples).
      3. 'tone': 'Normal', 'Sepia', 'Night', 'Toxic'.
      4. Architecture Logic:
         - For 'Modern/Minimalist': Use Open Plan. Living Room connects directly to Kitchen/Bedrooms. No long hallways.
         - For 'Mansion/Office': Use Corridors/Foyers.
         - For 'Boarding House/Hotel': Use a central Corridor connecting to many small rooms.
      5. 'width' and 'height': 30-60 (Give enough space).
      
      SCHEMA:
      {
        "type": "structured" | "organic" | "geometric",
        "tone": "Normal" | "Sepia" | "Night" | "Toxic",
        "width": number,
        "height": number,
        "rooms": [
          { 
            "id": "r1", 
            "name": "Foyer", 
            "type": "entrance", 
            "width": 8, 
            "height": 6, 
            "connections": ["r2"], 
            "furniture": ["rug", "plant"] 
          },
          { 
            "id": "r2", 
            "name": "Main Hallway", 
            "type": "corridor", 
            "width": 20, 
            "height": 2, 
            "connections": ["r1", "r3"], 
            "furniture": [] 
          }
        ],
        "description": "Short summary of the map"
      }
      
      ARCHITECTURAL RULES (STRICT):
      1. LAYOUT STRATEGY (CRITICAL):
         - **MANSION/SCHOOL/OFFICE/HOTEL**: You MUST use a **"SPINE"** layout.
           - Create a central room named exactly "Main Corridor" or "Hallway" (Type: 'corridor').
           - This corridor must be LONG (e.g., width 20, height 2).
           - Connect all other rooms to this Corridor.
         - **MODERN HOUSE/APARTMENT**: You MUST use a **"HUB"** layout.
           - Create a central room named "Living Room" or "Lobby" (Type: 'common').
           - Connect Bedroom, Kitchen, etc., directly to this Hub.
         - **CABIN/HUT**: Use "Cluster" layout (one big room + small partitions).
      
      2. DIMENSION RULES:
         - **'width' and 'height' are MANDATORY.**
         - Corridors: Must be long/thin (e.g., 15x2, 20x3).
         - Rooms: Integers only (e.g., 6x6, 8x5).
    `;

    let lastError: any = null;

    for (const model of this.models) {
      try {
        const result = await model.generateContent([systemPrompt, `User Request: "${userPrompt}"`]);
        const response = await result.response;
        const text = response.text();
        const cleanJson = text.replace(/```json/g, '').replace(/```/g, '').trim();
        const config = JSON.parse(cleanJson) as MapConfig;
        
        // --- SANITIZATION & VALIDATION PHASE ---
        // 1. Validate Connections: Remove connections to non-existent IDs
        const roomIds = new Set(config.rooms.map(r => r.id));
        config.rooms.forEach(room => {
            if (!room.connections) room.connections = [];
            room.connections = room.connections.filter(targetId => roomIds.has(targetId));
        });

        // 2. Ensure Connectivity (Graph Repair)
        // If graph is disconnected, force connect orphans to the first room (Hub)
        if (config.rooms.length > 1) {
             const hubId = config.rooms[0].id;
             const visited = new Set<string>();
             const queue = [hubId];
             
             // BFS to find reachable
             while(queue.length > 0) {
                 const curr = queue.shift()!;
                 if(visited.has(curr)) continue;
                 visited.add(curr);
                 
                 const room = config.rooms.find(r => r.id === curr);
                 room?.connections.forEach(n => queue.push(n));
             }

             // Connect orphans
             config.rooms.forEach(room => {
                 if (!visited.has(room.id)) {
                     console.warn(`[GeminiDirector] Orphan room detected: ${room.name}. Auto-connecting to Hub.`);
                     room.connections.push(hubId);
                     const hub = config.rooms.find(r => r.id === hubId);
                     hub?.connections.push(room.id);
                 }
             });
        }

        return config;
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
  } catch (error: any) {
    console.error('Error in Gemini API handler:', error);
    // CRITICAL DEBUG: Expose actual error message to client
    const message = error instanceof Error ? error.message : 'Unknown Error';
    const details = error.response ? JSON.stringify(error.response) : '';
    res.status(500).json({ error: `Gemini API Error: ${message}`, details });
  }
}
