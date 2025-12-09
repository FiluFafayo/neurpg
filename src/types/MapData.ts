// Defines the output format that the Renderer consumes
export interface TileData {
    x: number;
    y: number;
    sprite: string;
    rotation?: number;
    layer: 'floor' | 'wall' | 'furniture';
}

export type ZoneType = 'wall' | 'center' | 'doorway';

export interface RoomData {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    type: string;
    zones?: { x: number, y: number, type: ZoneType }[];
}

export interface MapData {
    width: number;
    height: number;
    tiles: TileData[];
    rooms: RoomData[];
}
