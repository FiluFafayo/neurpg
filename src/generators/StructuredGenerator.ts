import { MapConfig } from '../types/MapConfig';
import { MapData, PlacedRoom } from '../types/MapData';
import { IMapGenerator } from './MapGenerators';
import { ConstraintSolver } from './ConstraintSolver';

export class StructuredGenerator implements IMapGenerator {
    
    private getRoomDimensions(type: string): { width: number, height: number } {
        // Normalize type
        const t = type.toLowerCase();
        
        if (t.includes('corridor') || t.includes('hallway')) return { width: 2, height: 8 };
        if (t.includes('hall') || t.includes('living') || t.includes('foyer') || t.includes('ballroom')) return { width: 8, height: 8 };
        if (t.includes('bedroom') || t.includes('kitchen') || t.includes('dining')) return { width: 5, height: 5 };
        if (t.includes('toilet') || t.includes('storage') || t.includes('pantry')) return { width: 3, height: 3 };
        
        // Default
        return { width: 6, height: 6 };
    }

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
            const dims = this.getRoomDimensions(root.type);
            const x = Math.floor(config.width / 2 - dims.width / 2);
            const y = Math.floor(config.height / 2 - dims.height / 2);

            const placedRoot: PlacedRoom = {
                id: root.id,
                name: root.name,
                x, y, width: dims.width, height: dims.height,
                type: root.type
            };
            placedRooms.push(placedRoot);
            mapData.rooms.push(placedRoot);
        }

        // 2. Grow/Pack remaining rooms
        while (roomsToPlace.length > 0) {
            const currentRoom = roomsToPlace.shift()!;
            const dims = this.getRoomDimensions(currentRoom.type);
            
            // Randomly rotate rectangular rooms (50% chance)
            if (dims.width !== dims.height && Math.random() > 0.5) {
                [dims.width, dims.height] = [dims.height, dims.width];
            }

            // Find parent (connected room already placed)
            // If no explicit connection found, just attach to the last placed room (fallback chain)
            let parent = placedRooms.find(p => currentRoom.connections.includes(p.id));
            if (!parent) parent = placedRooms[placedRooms.length - 1]; // Chain fallback

            if (parent) {
                const pos = this.findValidPosition(parent, dims.width, dims.height, placedRooms, config.width, config.height);
                
                if (pos) {
                    const newRoom: PlacedRoom = {
                        id: currentRoom.id,
                        name: currentRoom.name,
                        x: pos.x,
                        y: pos.y,
                        width: dims.width,
                        height: dims.height,
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
                        sprite: 'floor_' + room.type, // Semantic Key for AssetMapper
                        layer: 'floor'
                    });
                }
            }
        });

        // 4. Place Walls (2-Pass Bitmasking)
        const wallGrid = Array(config.height).fill(false).map(() => Array(config.width).fill(false));

        // Pass 1: Identify Wall Locations (Void touching Floor)
        for (let y = 1; y < config.height - 1; y++) {
            for (let x = 1; x < config.width - 1; x++) {
                if (grid[y][x] === 0) {
                    const neighbors = [[0,1], [0,-1], [1,0], [-1,0]];
                    for (const [dx, dy] of neighbors) {
                        if (grid[y+dy][x+dx] === 1) {
                            wallGrid[y+dy][x+dx] = true;
                        }
                    }
                }
            }
        }

        // Pass 2: Place Wall Tiles with Bitmasking
        for (let y = 0; y < config.height; y++) {
            for (let x = 0; x < config.width; x++) {
                if (wallGrid[y][x]) {
                    // Check neighbors (Boundaries count as empty/non-wall for now)
                    const n = (y > 0 && wallGrid[y-1][x]) ? 1 : 0;
                    const w = (x > 0 && wallGrid[y][x-1]) ? 1 : 0;
                    const e = (x < config.width - 1 && wallGrid[y][x+1]) ? 1 : 0;
                    const s = (y < config.height - 1 && wallGrid[y+1][x]) ? 1 : 0;
                    
                    // Bitmask: N=1, W=2, E=4, S=8
                    const mask = (n * 1) + (w * 2) + (e * 4) + (s * 8);
                    
                    // Check if door already exists here
                    const existing = mapData.tiles.find(t => t.x === x && t.y === y);
                    if (!existing) {
                         // Future-proofing: We can map mask to specific frames
                         // e.g. sprite: `wall_brick_${mask}`
                         
                         mapData.tiles.push({
                             x, y,
                             sprite: 'wall_brick', 
                             layer: 'wall'
                         });
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
        const candidates: {x: number, y: number, dist: number}[] = [];
        const sides = ['top', 'bottom', 'left', 'right'];
        
        // Shuffle sides for randomness
        for (let i = sides.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [sides[i], sides[j]] = [sides[j], sides[i]];
        }

        for (const side of sides) {
            let startX = 0, endX = 0, startY = 0, endY = 0;
            let fixedX = -1, fixedY = -1;
            let isHorizontal = false;

            if (side === 'top') {
                // Room is ABOVE parent
                fixedY = parent.y - h;
                // Sliding range for X:
                // Rightmost pixel of Room (x+w) must be > Parent Left (parent.x)
                // Leftmost pixel of Room (x) must be < Parent Right (parent.x + parent.width)
                // Range: [parent.x - w + 1, parent.x + parent.width - 1]
                startX = parent.x - w + 1;
                endX = parent.x + parent.width - 1;
                isHorizontal = true;
            } else if (side === 'bottom') {
                // Room is BELOW parent
                fixedY = parent.y + parent.height;
                startX = parent.x - w + 1;
                endX = parent.x + parent.width - 1;
                isHorizontal = true;
            } else if (side === 'left') {
                // Room is LEFT of parent
                fixedX = parent.x - w;
                startY = parent.y - h + 1;
                endY = parent.y + parent.height - 1;
                isHorizontal = false;
            } else if (side === 'right') {
                // Room is RIGHT of parent
                fixedX = parent.x + parent.width;
                startY = parent.y - h + 1;
                endY = parent.y + parent.height - 1;
                isHorizontal = false;
            }

            // Iterate along the edge
            if (isHorizontal) {
                for (let x = startX; x <= endX; x++) {
                    candidates.push({ x, y: fixedY, dist: Math.abs(x - (parent.x + parent.width/2 - w/2)) });
                }
            } else {
                for (let y = startY; y <= endY; y++) {
                    candidates.push({ x: fixedX, y, dist: Math.abs(y - (parent.y + parent.height/2 - h/2)) });
                }
            }
        }

        // Sort by distance to center of parent side (to keep it compact-ish) but add some noise
        // actually, let's just shuffle them to be "organic" as requested before, 
        // OR prioritize "fit". The user said "Slide... until it finds a valid gap."
        // Let's stick to the previous "randomized candidates" approach but now we have MANY more candidates.
        
        // Filter invalid bounds immediately
        const validBoundsCandidates = candidates.filter(c => 
            c.x >= 2 && c.y >= 2 && c.x + w < mapW - 2 && c.y + h < mapH - 2
        );

        // Shuffle
        for (let i = validBoundsCandidates.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [validBoundsCandidates[i], validBoundsCandidates[j]] = [validBoundsCandidates[j], validBoundsCandidates[i]];
        }

        for (const pos of validBoundsCandidates) {
            // Check Overlap
            let overlap = false;
            for (const other of placedRooms) {
                // Strict AABB (no overlap allowed)
                if (pos.x < other.x + other.width &&
                    pos.x + w > other.x &&
                    pos.y < other.y + other.height &&
                    pos.y + h > other.y) {
                    overlap = true;
                    break;
                }
            }
            if (!overlap) return { x: pos.x, y: pos.y };
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
