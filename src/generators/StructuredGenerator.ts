import { MapConfig, RoomConfig } from '../types/MapConfig';
import { MapData } from '../types/MapData';
import { IMapGenerator } from './MapGenerators';
import { ConstraintSolver } from './ConstraintSolver';

// Rectangle helper untuk collision detection
class Rect {
    constructor(public x: number, public y: number, public w: number, public h: number, public room: RoomConfig) {}

    get left() { return this.x; }
    get right() { return this.x + this.w; }
    get top() { return this.y; }
    get bottom() { return this.y + this.h; }

    // Overlap test (memperbolehkan overlap 1 pixel untuk shared wall)
    overlaps(other: Rect): boolean {
        // Kita kurangi 1 pixel dari size saat cek overlap agar dinding bisa sharing
        // Area Floor efektif: x+1 hingga x+w-1
        const thisInnerL = this.x + 1;
        const thisInnerR = this.x + this.w - 1;
        const thisInnerT = this.y + 1;
        const thisInnerB = this.y + this.h - 1;

        const otherInnerL = other.x + 1;
        const otherInnerR = other.x + other.w - 1;
        const otherInnerT = other.y + 1;
        const otherInnerB = other.y + other.h - 1;

        return (
            thisInnerL < otherInnerR &&
            thisInnerR > otherInnerL &&
            thisInnerT < otherInnerB &&
            thisInnerB > otherInnerT
        );
    }
}

export class StructuredGenerator implements IMapGenerator {
    
    private readonly WALL = 1;
    private readonly FLOOR = 0;

    generate(config: MapConfig): MapData {
        console.log(`[StructuredGenerator] Starting Phase 4: Graph Growth (No BSP)...`);
        
        const mapData: MapData = {
            width: config.width,
            height: config.height,
            tiles: [],
            rooms: []
        };

        // 1. Setup Grid
        const grid: number[][] = Array(config.height).fill(0).map(() => Array(config.width).fill(this.WALL));

        // 2. Tentukan Ukuran Ruangan (Dimensi Dinamis)
        const roomRects: Rect[] = config.rooms.map(room => {
            const connCount = room.connections ? room.connections.length : 0;
            const dim = this.getRoomDimensions(room.type, room.name, config.width, config.height, connCount);
            return new Rect(0, 0, dim.w, dim.h, room);
        });

        // 3. Start Node Selection (Connectivity is King)
        // The room with the most connections is the Hub, regardless of its name.
        const priorityScore = (r: Rect) => {
            const connectionCount = r.room.connections.length;
            
            // Boost entrance slightly so it's not buried deep inside
            const isEntrance = r.room.type.includes('entrance') || r.room.name.toLowerCase().includes('foyer');
            
            // Formula: Connectivity * 10 + (Entrance Bonus)
            return (connectionCount * 10) + (isEntrance ? 5 : 0);
        };
        
        roomRects.sort((a, b) => priorityScore(b) - priorityScore(a));
        
        const startNode = roomRects[0];

        // 4. Place First Room (Center of Grid)
        startNode.x = Math.floor((config.width - startNode.w) / 2);
        startNode.y = Math.floor((config.height - startNode.h) / 2);
        
        const placedRooms: Rect[] = [startNode];
        const placedIds = new Set<string>([startNode.room.id]);
        
        // 5. Growth Loop (Iterative Fitting)
        // We iterate through unplaced rooms and try to attach them to ANY already placed room
        // that they are connected to.
        let hasPlacement = true;
        
        while (hasPlacement) {
            hasPlacement = false;
            const unplaced = roomRects.filter(r => !placedIds.has(r.room.id));
            
            for (const child of unplaced) {
                // Find potential parents (placed rooms that are connected to this child)
                const potentialParents = placedRooms.filter(p => 
                    p.room.connections.includes(child.room.id) || 
                    child.room.connections.includes(p.room.id)
                );
                
                if (potentialParents.length === 0) continue; // No anchor yet
                
                // Try to snap to ANY parent (Closest/Best fit)
                // We shuffle parents to avoid biasing growth direction
                potentialParents.sort(() => Math.random() - 0.5);

                for (const parent of potentialParents) {
                    if (this.trySnapRoom(parent, child, placedRooms, config.width, config.height)) {
                        placedRooms.push(child);
                        placedIds.add(child.room.id);
                        hasPlacement = true;
                        break; 
                    }
                }
                
                if (hasPlacement) break; // Restart loop to prioritize connectivity from new growth
            }
        }

        // 6. Rasterize (Render ke Grid)
        placedRooms.forEach(r => {
            // Register
            mapData.rooms.push({
                id: r.room.id,
                name: r.room.name,
                type: r.room.type,
                x: r.x + 1, // +1 karena x adalah dinding luar
                y: r.y + 1,
                width: r.w - 2, // -2 dinding
                height: r.h - 2
            });

            // Fill Floor
            // Kita isi dari x+1 sampai x+w-1. 
            // Dinding ada di x dan x+w-1.
            // Shared wall logic: 
            // Room A (0-10). Wall di 0 & 9. Floor 1-8.
            // Room B (9-19). Wall di 9 & 18. Floor 10-17.
            // Grid[9] adalah Wall milik A dan Wall milik B -> Tetap Wall.
            
            for (let y = r.y + 1; y < r.y + r.h - 1; y++) {
                for (let x = r.x + 1; x < r.x + r.w - 1; x++) {
                    if (y >= 0 && y < config.height && x >= 0 && x < config.width) {
                        grid[y][x] = this.FLOOR;
                        mapData.tiles.push({
                            x, y,
                            sprite: this.getFloorSprite(r.room.type),
                            layer: 'floor'
                        });
                    }
                }
            }
        });

        // 7. Generate Doors (Strictly on Connections)
        this.generateDoors(placedRooms, grid, mapData);

        // 8. Generate Walls Visuals
        this.generateWalls(grid, mapData);

        // 9. Furnishing
        this.furnishRooms(mapData, config, grid);

        return mapData;
    }

    // --- Core Placement Logic ---

    private trySnapRoom(parent: Rect, child: Rect, allRooms: Rect[], mapW: number, mapH: number): boolean {
        // PERIMETER SCANNING
        // Instead of checking just 4 cardinal centers, we scan the entire edge of the parent
        // to find a valid slot. This ensures we don't fail just because the center is blocked.

        const candidates: {x: number, y: number}[] = [];
        
        // 1. Generate Candidates along Parent's Perimeter
        // Top & Bottom Edges
        for (let bx = parent.left - child.w + 2; bx < parent.right - 1; bx++) {
             // Top
             candidates.push({ x: bx, y: parent.top - child.h + 1 }); // +1 Overlap
             // Bottom
             candidates.push({ x: bx, y: parent.bottom - 1 }); // -1 Overlap
        }
        // Left & Right Edges
        for (let by = parent.top - child.h + 2; by < parent.bottom - 1; by++) {
             // Left
             candidates.push({ x: parent.left - child.w + 1, y: by }); // +1 Overlap
             // Right
             candidates.push({ x: parent.right - 1, y: by }); // -1 Overlap
        }

        // Shuffle to avoid pattern bias
        candidates.sort(() => Math.random() - 0.5);

        for (const pos of candidates) {
            child.x = pos.x;
            child.y = pos.y;
            
            // 1. Boundary Check
            if (child.x < 1 || child.y < 1 || child.right > mapW - 1 || child.bottom > mapH - 1) continue;
            
            // 2. Collision Check (Strict)
            // Must NOT overlap significantly with any other room (except parent shared wall)
            let collision = false;
            for (const other of allRooms) {
                if (child.overlaps(other)) {
                    collision = true;
                    break;
                }
            }

            if (!collision) return true; // Valid placement found!
        }

        return false;
    }

    private generateDoors(rooms: Rect[], grid: number[][], mapData: MapData) {
        // Cari perbatasan antar room yang terhubung, lalu lubangi
        rooms.forEach(roomA => {
            const connections = roomA.room.connections || [];
            connections.forEach(targetId => {
                const roomB = rooms.find(r => r.room.id === targetId);
                if (roomB) {
                    this.carveDoor(roomA, roomB, grid, mapData);
                }
            });
        });
    }

    private carveDoor(r1: Rect, r2: Rect, grid: number[][], mapData: MapData) {
        const x1 = Math.max(r1.x, r2.x);
        const y1 = Math.max(r1.y, r2.y);
        const x2 = Math.min(r1.right, r2.right);
        const y2 = Math.min(r1.bottom, r2.bottom);

        if (x1 < x2 && y1 < y2) {
            const cx = Math.floor((x1 + x2) / 2);
            const cy = Math.floor((y1 + y2) / 2);
            const w = x2 - x1;
            const h = y2 - y1;

            const doorPixels: {x:number, y:number}[] = [];

            if (w > h) { // Horizontal wall shared
                doorPixels.push({x: cx, y: cy}, {x: cx+1, y: cy});
            } else { // Vertical wall shared
                doorPixels.push({x: cx, y: cy}, {x: cx, y: cy+1});
            }

            // Register & Carve
            doorPixels.forEach(p => {
                if (this.isValid(p.x, p.y, grid)) {
                    this.setFloor(p.x, p.y, grid, mapData);
                    
                    // Add to Room Metadata for Solver
                    const room1Data = mapData.rooms.find(r => r.id === r1.room.id);
                    const room2Data = mapData.rooms.find(r => r.id === r2.room.id);
                    
                    if (room1Data) {
                        if (!room1Data.doors) room1Data.doors = [];
                        room1Data.doors.push({x: p.x, y: p.y});
                    }
                    if (room2Data) {
                        if (!room2Data.doors) room2Data.doors = [];
                        room2Data.doors.push({x: p.x, y: p.y});
                    }
                }
            });
        }
    }

    private setFloor(x: number, y: number, grid: number[][], mapData: MapData) {
        if (grid[y][x] === this.WALL) {
            grid[y][x] = this.FLOOR;
            mapData.tiles.push({ x, y, sprite: 'floor_common', layer: 'floor' }); // Pintu biasanya kayu/umum
        }
    }

    // --- Config & Helpers ---

    // Helper to find connections count (quick & dirty fix passing connections count)
    private getRoomDimensions(type: string, name: string, mapW: number, mapH: number, connectionsCount: number = 2): { w: number, h: number } {
        const t = type.toLowerCase();
        
        // Base Unit
        const U = 2; // 1 meter = 2 tiles

        if (t.includes('hall') || t.includes('corridor')) {
             // Panjang lorong menyesuaikan jumlah koneksi. 
             // Minimal 10 tile, Maksimal 80% map.
             let length = Math.max(10, connectionsCount * 4);
             if (length > mapW - 4) length = mapW - 6;
             return { w: length, h: 2 * U }; 
        }
        if (t.includes('living') || t.includes('common')) {
             return { w: 12, h: 10 }; // 6m x 5m
        }
        if (t.includes('master')) {
             return { w: 10, h: 8 }; // 5m x 4m
        }
        if (t.includes('kitchen') || t.includes('dining')) {
             return { w: 8, h: 8 }; // 4m x 4m
        }
        if (t.includes('bed')) { // Standard bedroom (Boarding House)
             return { w: 6, h: 6 }; // 3m x 3m
        }
        if (t.includes('bath') || t.includes('wc')) {
             return { w: 4, h: 4 }; // 2m x 2m
        }
        if (t.includes('garage')) {
             return { w: 10, h: 12 };
        }
        
        return { w: 6, h: 6 }; 
    }

    private generateWalls(grid: number[][], mapData: MapData) {
        const h = grid.length;
        const w = grid[0].length;
        for(let y=0; y<h; y++) {
            for(let x=0; x<w; x++) {
                if(grid[y][x] === this.WALL) {
                    // Render wall only if adjacent to floor (Facade)
                    let isEdge = false;
                    for(let dy=-1; dy<=1; dy++) {
                        for(let dx=-1; dx<=1; dx++) {
                            if(dy===0 && dx===0) continue;
                            const ny = y+dy;
                            const nx = x+dx;
                            if(this.isValid(nx, ny, grid) && grid[ny][nx] === this.FLOOR) {
                                isEdge = true;
                            }
                        }
                    }
                    if(isEdge) {
                        mapData.tiles.push({ x, y, sprite: 'wall_brick', layer: 'wall' });
                    }
                }
            }
        }
    }

    private furnishRooms(mapData: MapData, config: MapConfig, grid: number[][]) {
        mapData.rooms.forEach(room => {
            const cfg = config.rooms.find(r => r.id === room.id);
            if (cfg) {
                let items = cfg.furniture || [];
                if (items.length === 0) items = ['table'];
                ConstraintSolver.placeItems(room, items, mapData, grid, this.FLOOR);
            }
        });
    }

    private isValid(x: number, y: number, grid: number[][]) {
        return y >= 0 && y < grid.length && x >= 0 && x < grid[0].length;
    }

    private getFloorSprite(type: string): string {
        const t = type.toLowerCase();
        if (t.includes('garage') || t.includes('exterior')) return 'floor_exterior';
        if (t.includes('kitchen')) return 'floor_kitchen';
        if (t.includes('bath')) return 'floor_bathroom';
        return 'floor_common';
    }
}