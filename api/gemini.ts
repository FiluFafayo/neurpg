import { GoogleGenerativeAI } from "@google/generative-ai";

export const config = {
  runtime: 'edge', // Wajib untuk Vercel Edge Functions
};

export default async function handler(request: Request) {
  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { status: 405 });
  }

  try {
    const { prompt } = await request.json();
    
    // --- INI KUNCINYA: System Instruction Arsitek (Dari GeminiDirector) ---
    const systemPrompt = `
      You are an expert TTRPG Battle Map Architect designed to generate procedural map configurations for a 2D tile-based game (D&D 5e style).
      
      Your Output MUST be a valid JSON object strictly following this schema:
      {
        "type": "structured" | "organic" | "geometric",
        "tone": "Normal" | "Sepia" | "Night" | "Toxic",
        "width": number (integer, min 40, max 60),
        "height": number (integer, min 40, max 60),
        "description": "Short summary of the map layout",
        "rooms": [
          {
            "id": "r1",
            "name": "Room Name",
            "type": "bedroom" | "living" | "kitchen" | "corridor" | "entrance" | "storage" | "bathroom" | "exterior" | "main" | "utility",
            "connections": ["r2", "r3"],
            "furniture": ["bed", "table", "chest"]
          }
        ]
      }

      RULES:
      1. Map Size: MUST be spacious. Minimum 40x40 tiles. DO NOT generate small maps (e.g. 20x20).
      2. Connectivity: Ensure ALL rooms are reachable. Use 'corridor' or 'hallway' as central hubs for 'structured' maps.
      3. Logic: 
         - 'structured': Houses/Buildings. Use logic (Foyer -> Hall -> Bedrooms).
         - 'organic': Caves/Forests. Irregular connections.
         - 'geometric': Towers/Ships. Symmetrical connections.
      4. Furniture: List generic furniture IDs.
      5. Response must be JSON ONLY. No markdown formatting.
    `;

    const fullPrompt = `${systemPrompt}\n\nUser Request: ${prompt}`;

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        return new Response(JSON.stringify({ error: 'Missing API Key' }), { status: 500 });
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    // Generate
    const result = await model.generateContent(fullPrompt);
    const response = await result.response;
    let text = response.text();

    // Sanitasi JSON (Hapus markdown ```json jika ada)
    text = text.replace(/```json/g, '').replace(/```/g, '').trim();

    return new Response(text, {
      headers: { 'Content-Type': 'application/json' },
    });

  } catch (error: any) {
    console.error("Gemini API Error:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}