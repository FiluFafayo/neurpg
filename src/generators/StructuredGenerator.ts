import { MapConfig } from '../types/MapConfig';
import { MapData, PlacedRoom } from '../types/MapData';
import { IMapGenerator } from './MapGenerators';
import { ConstraintSolver } from './ConstraintSolver';

export class StructuredGenerator implements IMapGenerator {
    
    generate(config: MapConfig): MapData {
        console.log(`[StructuredGenerator] Building Layout (Growth Algorithm)...`);
        
        const mapData: MapData = {
            width: config.width,
            height: config.height,
            tiles: [],
            rooms: []
        };

        // Initialize Grid (1 = Wall/Void, 0 = Floor)
        const grid: number[][] = Array(config.height).fill(0).map(() => Array(config.width).fill(1));

        const roomsToPlace = [...config.rooms];
        const placedRooms: PlacedRoom[] = [];

        // 1. Place Root Room (Center)
        if (roomsToPlace.length > 0) {
            const root = roomsToPlace.shift()!;
            const w = 6; 
            const h = 6;
            const x = Math.floor(config.width / 2 - w / 2);
            const y = Math.floor(config.height / 2 - h / 2);

            const placedRoot: PlacedRoom = {
                id: root.id,
                x, y, width: w, height: h,
                type: root.type
            };
            placedRooms.push(placedRoot);
            mapData.rooms.push(placedRoot);
        }

        // 2. Grow/Pack remaining rooms
        while (roomsToPlace.length > 0) {
            const currentRoom = roomsToPlace.shift()!;
            const w = 6; 
            const h = 6;

            // Find parent (connected room already placed)
            // If no explicit connection found, just attach to the last placed room (fallback chain)
            let parent = placedRooms.find(p => currentRoom.connections.includes(p.id));
            if (!parent) parent = placedRooms[placedRooms.length - 1]; // Chain fallback

            if (parent) {
                const pos = this.findValidPosition(parent, w, h, placedRooms, config.width, config.height);
                
                if (pos) {
                    const newRoom: PlacedRoom = {
                        id: currentRoom.id,
                        x: pos.x,
                        y: pos.y,
                        width: w,
                        height: h,
                        type: currentRoom.type
                    };
                    placedRooms.push(newRoom);
                    mapData.rooms.push(newRoom);

                    // Add Door at connection point
                    this.addDoor(parent, newRoom, mapData);
                } else {
                    console.warn(`[StructuredGenerator] Could not fit room ${currentRoom.id}`);
                }
            }
        }

        // 3. Rasterize Rooms to Grid
        placedRooms.forEach(room => {
            for (let y = room.y; y < room.y + room.height; y++) {
                for (let x = room.x; x < room.x + room.width; x++) {
                    grid[y][x] = 0; // Floor
                    mapData.tiles.push({
                        x, y,
                        sprite: 'floor_wood', // House aesthetic
                        layer: 'floor'
                    });
                }
            }
        });

        // 4. Place Walls (Perimeter of 0s touching 1s)
        for (let y = 1; y < config.height - 1; y++) {
            for (let x = 1; x < config.width - 1; x++) {
                if (grid[y][x] === 0) {
                    // Check neighbors for void/wall
                    const neighbors = [[0,1], [0,-1], [1,0], [-1,0]];
                    for (const [dx, dy] of neighbors) {
                        if (grid[y+dy][x+dx] === 1) {
                            // It's an edge, place a wall ON the void
                            // Note: In this simple logic, we might overwrite void with wall
                            // But for tile-based, we usually want the wall ON the floor edge or OUTSIDE?
                            // Let's place wall ON the perimeter void
                             const wx = x + dx;
                             const wy = y + dy;
                             
                             // Check if we already placed a wall or door there
                             const existing = mapData.tiles.find(t => t.x === wx && t.y === wy);
                             if (!existing) {
                                 mapData.tiles.push({
                                     x: wx, y: wy,
                                     sprite: 'wall_brick',
                                     layer: 'wall'
                                 });
                             }
                        }
                    }
                }
            }
        }

        // 5. Place Furniture
        placedRooms.forEach(room => {
            const roomConfig = config.rooms.find(c => c.id === room.id);
            let items = roomConfig ? [...roomConfig.furniture] : [];
            if (items.length === 0) items = ['table', 'chair'];
            
            ConstraintSolver.placeItems(room, items, mapData, grid, 0);
        });

        return mapData;
    }

    private findValidPosition(parent: PlacedRoom, w: number, h: number, placedRooms: PlacedRoom[], mapW: number, mapH: number): { x: number, y: number } | null {
        // Try all 4 sides of parent
        // North
        const candidates = [
            { x: parent.x + (parent.width - w) / 2, y: parent.y - h }, // Top (Centered)
            { x: parent.x + (parent.width - w) / 2, y: parent.y + parent.height }, // Bottom
            { x: parent.x - w, y: parent.y + (parent.height - h) / 2 }, // Left
            { x: parent.x + parent.width, y: parent.y + (parent.height - h) / 2 } // Right
        ];

        // Integer snap
        candidates.forEach(c => {
            c.x = Math.floor(c.x);
            c.y = Math.floor(c.y);
        });

        for (const pos of candidates) {
            // Check Map Bounds
            if (pos.x < 2 || pos.y < 2 || pos.x + w >= mapW - 2 || pos.y + h >= mapH - 2) continue;

            // Check Overlap
            let overlap = false;
            for (const other of placedRooms) {
                // AABB Intersection
                if (pos.x < other.x + other.width &&
                    pos.x + w > other.x &&
                    pos.y < other.y + other.height &&
                    pos.y + h > other.y) {
                    overlap = true;
                    break;
                }
            }

            if (!overlap) return pos;
        }

        return null;
    }

    private addDoor(r1: PlacedRoom, r2: PlacedRoom, mapData: MapData) {
        // Find intersection rectangle
        const x1 = Math.max(r1.x, r2.x);
        const y1 = Math.max(r1.y, r2.y);
        const x2 = Math.min(r1.x + r1.width, r2.x + r2.width);
        const y2 = Math.min(r1.y + r1.height, r2.y + r2.height);

        // If touching, the intersection usually has 0 width or 0 height, or just barely overlaps
        // We look for the shared edge.
        
        let doorX = 0;
        let doorY = 0;

        // Vertical Adjacency
        if (x1 < x2) {
            // They share horizontal range
            doorX = Math.floor((x1 + x2) / 2);
            // Determine Y: is r2 below r1 or above?
            if (Math.abs((r1.y + r1.height) - r2.y) < 2) doorY = r2.y - 1; // r2 is below
            else doorY = r1.y - 1; // r2 is above (r1.y approx r2.y + r2.h)
            
            // Refine Y to be exactly on the wall line
            // If r2 is below r1, wall is at r1.y + r1.h (which is same as r2.y)
             // Actually, since we place rooms adjacent, the coordinates touch.
             // r1 y=10, h=6 => y_end=16. r2 y=16.
             // Wall is usually drawn at 16? Or 15?
             // Our wall logic places walls at void neighbors.
             // The door should replace a wall.
             
             // Let's just pick the coordinate that is "between" them.
             if (r1.y < r2.y) doorY = r2.y; // Door at start of bottom room
             else doorY = r1.y;     // Door at start of top room
             
             // Shift slightly to ensure it's on the boundary
             doorY -= 0; // The logic below adds walls at neighbor void.
             // But here the rooms touch, so there is NO void between them.
             // So no wall will be generated between them!
             // So we don't strictly *need* a door to pass, but we want the visual door.
             
             // Wait, if rooms touch (shared wall), my wall generator (step 4) checks for grid=0.
             // Since both are 0, no wall is generated between them.
             // So it's an open archway.
             // User requested: "Doors: Place doors exactly where the walls touch."
             // So we should add a door sprite.
        }
        // Horizontal Adjacency
        else if (y1 < y2) {
             doorY = Math.floor((y1 + y2) / 2);
             if (r1.x < r2.x) doorX = r2.x;
             else doorX = r1.x;
        }
        
        // Add Door Sprite
        // We need to ensure we don't overwrite floor with wall, just place door on top?
        // Usually door replaces wall. But here we have open floor.
        // Let's place a door sprite.
        if (doorX > 0 && doorY > 0) {
            mapData.tiles.push({
                x: doorX, y: doorY,
                sprite: 'door_wood',
                layer: 'wall' // Render on wall layer
            });
        }
    }
}
