// Defines the schema that Gemini must adhere to
export type MapType = 'structured' | 'organic' | 'geometric';
export type ToneType = 'Normal' | 'Sepia' | 'Night' | 'Toxic';

export interface RoomConfig {
  id: string;
  name: string;
  type: string; // 'kitchen', 'bedroom', etc.
  connections: string[]; // IDs of connected rooms
  furniture: string[]; // List of furniture to place
}

export interface MapConfig {
  type: MapType;
  tone: ToneType;
  width: number; // Suggested width in tiles
  height: number; // Suggested height in tiles
  rooms: RoomConfig[];
  description: string; // Narrative description
}

// Default config for testing
export const DEFAULT_MAP_CONFIG: MapConfig = {
  type: 'structured',
  tone: 'Normal',
  width: 20,
  height: 20,
  rooms: [],
  description: 'Empty map'
};
