import { MapConfig, RoomConfig } from '../types/MapConfig';
import { MapData } from '../types/MapData';
import { IMapGenerator } from './MapGenerators';
import { ConstraintSolver } from './ConstraintSolver';

// Tipe Grid
const TERRAIN = 0;
const FLOOR = 1;
const WALL = 2;
const DOOR = 3;

class Rect {
    public x: number;
    public y: number;
    public w: number;
    public h: number;

    constructor(x: number, y: number, w: number, h: number, public room: RoomConfig) {
        // STRICT INTEGER ENFORCEMENT
        this.x = Math.floor(x);
        this.y = Math.floor(y);
        this.w = Math.floor(w);
        this.h = Math.floor(h);
    }
    
    get left() { return this.x; }
    get right() { return this.x + this.w; }
    get top() { return this.y; }
    get bottom() { return this.y + this.h; }
    
    get centerX() { return Math.floor(this.x + this.w/2); }
    get centerY() { return Math.floor(this.y + this.h/2); }

    // Strict Intersection (Padding 0 = Touch is OK, Overlap is NO)
    intersects(other: Rect, padding: number = 0): boolean {
        return (
            this.left < other.right + padding &&
            this.right > other.left - padding &&
            this.top < other.bottom + padding &&
            this.bottom > other.top - padding
        );
    }
}

export class StructuredGenerator implements IMapGenerator {

    generate(config: MapConfig): MapData {
        console.log(`[StructuredGenerator] Phase 2: Physics & Strict Grid...`);
        
        const mapData: MapData = {
            width: config.width,
            height: config.height,
            tiles: [],
            rooms: []
        };

        // 1. Init Grid
        const grid: number[][] = Array(config.height).fill(0).map(() => Array(config.width).fill(TERRAIN));
        // roomGrid menyimpan ID ruangan (index array) di setiap sel untuk deteksi dinding internal
        const roomGrid: number[][] = Array(config.height).fill(0).map(() => Array(config.width).fill(-1));

        // 2. Prepare Rects (Strict Integer)
        const allRects: Rect[] = config.rooms.map(room => {
            const dim = this.getRoomDimensions(room);
            return new Rect(0, 0, dim.w, dim.h, room);
        });

        // 3. Strategy Selector
        const spineRoom = allRects.find(r => 
            /corridor|hall|passage|gallery/i.test(r.room.type) || 
            /corridor|hall|passage/i.test(r.room.name)
        );

        const hubRoom = allRects.find(r => 
            (/living|common|lobby|foyer|main/i.test(r.room.type) || /living|common|lobby/i.test(r.room.name)) &&
            r.room.connections.length >= 2
        );

        let placedRects: Rect[] = [];

        if (spineRoom) {
            console.log(`[Gen] Strategy A: SPINE (Anchor: ${spineRoom.room.name})`);
            placedRects = this.buildSpineLayout(spineRoom, allRects, config.width, config.height);
        } 
        else if (hubRoom) {
            console.log(`[Gen] Strategy B: HUB (Anchor: ${hubRoom.room.name})`);
            placedRects = this.buildHubLayout(hubRoom, allRects, config.width, config.height);
        } 
        else {
            console.log(`[Gen] Strategy C: CLUSTER (Organic Packing)`);
            placedRects = this.buildClusterLayout(allRects, config.width, config.height);
        }

        // 4. Rasterize to Grid
        placedRects.forEach((r, idx) => {
            const startX = Math.max(0, r.x);
            const startY = Math.max(0, r.y);
            const endX = Math.min(config.width, r.right);
            const endY = Math.min(config.height, r.bottom);

            for (let y = startY; y < endY; y++) {
                for (let x = startX; x < endX; x++) {
                    grid[y][x] = FLOOR;
                    roomGrid[y][x] = idx;
                }
            }
            
            mapData.rooms.push({
                id: r.room.id,
                name: r.room.name,
                type: r.room.type,
                x: r.x, y: r.y, width: r.w, height: r.h,
                doors: []
            });
        });

        // 5. Walls & Doors
        this.generateWalls(grid, roomGrid, config);
        this.generateDoors(placedRects, grid, mapData);

        // 6. Tiles & Furniture
        this.generateTiles(grid, roomGrid, mapData, config);
        this.furnishRooms(mapData, config, grid);

        return mapData;
    }

    // ================= STRATEGIES =================

    private buildSpineLayout(spine: Rect, allRects: Rect[], mapW: number, mapH: number): Rect[] {
        const placed: Rect[] = [];
        const placedIds = new Set<string>();

        // Center Spine
        spine.x = Math.floor((mapW - spine.w) / 2);
        spine.y = Math.floor((mapH - spine.h) / 2);
        placed.push(spine);
        placedIds.add(spine.room.id);

        const isHorizontal = spine.w >= spine.h;
        const children = allRects.filter(r => !placedIds.has(r.room.id) && spine.room.connections.includes(r.room.id));
        children.sort((a, b) => b.w * b.h - a.w * a.h);

        let cursorTop = spine.x;
        let cursorBottom = spine.x;
        let cursorLeft = spine.y;
        let cursorRight = spine.y;

        children.forEach((child, i) => {
            let px = 0, py = 0;
            if (isHorizontal) {
                if (i % 2 === 0) { // Top
                    px = cursorTop;
                    py = spine.y - child.h;
                    cursorTop += child.w;
                } else { // Bottom
                    px = cursorBottom;
                    py = spine.bottom;
                    cursorBottom += child.w;
                }
            } else {
                if (i % 2 === 0) { // Left
                    px = spine.x - child.w;
                    py = cursorLeft;
                    cursorLeft += child.h;
                } else { // Right
                    px = spine.right;
                    py = cursorRight;
                    cursorRight += child.h;
                }
            }
            
            child.x = Math.floor(px);
            child.y = Math.floor(py);
            
            if (!this.checkCollision(child, placed)) {
                placed.push(child);
                placedIds.add(child.room.id);
            }
        });

        this.placeLeftovers(allRects, placed, placedIds);
        return placed;
    }

    private buildHubLayout(hub: Rect, allRects: Rect[], mapW: number, mapH: number): Rect[] {
        const placed: Rect[] = [];
        const placedIds = new Set<string>();

        hub.x = Math.floor((mapW - hub.w) / 2);
        hub.y = Math.floor((mapH - hub.h) / 2);
        placed.push(hub);
        placedIds.add(hub.room.id);

        const children = allRects.filter(r => !placedIds.has(r.room.id) && hub.room.connections.includes(r.room.id));
        
        for (const child of children) {
            const pos = this.findTightSnapPosition(hub, child, placed);
            if (pos) {
                child.x = pos.x;
                child.y = pos.y;
                placed.push(child);
                placedIds.add(child.room.id);
            }
        }

        this.placeLeftovers(allRects, placed, placedIds);
        return placed;
    }

    private buildClusterLayout(allRects: Rect[], mapW: number, mapH: number): Rect[] {
        if (allRects.length === 0) return [];

        const placed: Rect[] = [];
        const placedIds = new Set<string>();

        allRects.sort((a, b) => (b.w * b.h) - (a.w * a.h));
        const anchor = allRects[0];
        
        anchor.x = Math.floor((mapW - anchor.w) / 2);
        anchor.y = Math.floor((mapH - anchor.h) / 2);
        placed.push(anchor);
        placedIds.add(anchor.room.id);

        const queue = allRects.filter(r => !placedIds.has(r.room.id));
        
        for (const child of queue) {
            const possibleParents = [...placed].sort(() => Math.random() - 0.5);
            let placedChild = false;
            for (const parent of possibleParents) {
                const pos = this.findTightSnapPosition(parent, child, placed);
                if (pos) {
                    child.x = pos.x;
                    child.y = pos.y;
                    placed.push(child);
                    placedIds.add(child.room.id);
                    placedChild = true;
                    break;
                }
            }
        }

        return placed;
    }

    // ================= HELPERS =================

    private placeLeftovers(allRects: Rect[], placed: Rect[], placedIds: Set<string>) {
        let stuck = 0;
        while (placed.length < allRects.length && stuck < 50) {
            const unplaced = allRects.filter(r => !placedIds.has(r.room.id));
            if (unplaced.length === 0) break;
            
            let progress = false;
            for (const child of unplaced) {
                const parent = placed.find(p => child.room.connections.includes(p.room.id));
                if (parent) {
                    const pos = this.findTightSnapPosition(parent, child, placed);
                    if (pos) {
                        child.x = pos.x;
                        child.y = pos.y;
                        placed.push(child);
                        placedIds.add(child.room.id);
                        progress = true;
                    }
                }
            }
            if (!progress) stuck++;
        }
    }

    private findTightSnapPosition(parent: Rect, child: Rect, obstacles: Rect[]): {x: number, y: number} | null {
        const candidates = [
            { x: parent.centerX - Math.floor(child.w/2), y: parent.y - child.h }, // Top
            { x: parent.centerX - Math.floor(child.w/2), y: parent.bottom },      // Bottom
            { x: parent.x - child.w, y: parent.centerY - Math.floor(child.h/2) }, // Left
            { x: parent.right, y: parent.centerY - Math.floor(child.h/2) },       // Right
            { x: parent.x, y: parent.y - child.h }, // Top-Left
            { x: parent.right - child.w, y: parent.y - child.h }, // Top-Right
            { x: parent.x, y: parent.bottom }, // Bottom-Left
            { x: parent.right - child.w, y: parent.bottom } // Bottom-Right
        ];

        for (const pos of candidates) {
            child.x = Math.floor(pos.x);
            child.y = Math.floor(pos.y);
            if (!this.checkCollision(child, obstacles)) return pos;
        }
        return null;
    }

    private checkCollision(rect: Rect, others: Rect[]): boolean {
        for (const other of others) {
            if (rect.room.id === other.room.id) continue;
            // Strict 0-padding: No overlap allowed.
            if (rect.intersects(other, 0)) return true;
        }
        return false;
    }

    private getRoomDimensions(config: RoomConfig): { w: number, h: number } {
        if (config.width && config.height) return { w: Math.floor(config.width), h: Math.floor(config.height) };
        
        const t = config.type.toLowerCase();
        if (/corridor|hall|passage/.test(t)) return { w: 10, h: 2 };
        if (/living|ballroom|common/.test(t)) return { w: 10, h: 8 };
        if (/master/.test(t)) return { w: 8, h: 6 };
        if (/kitchen|dining/.test(t)) return { w: 6, h: 6 };
        if (/bath|wc|toilet/.test(t)) return { w: 3, h: 3 };
        return { w: 5, h: 5 };
    }

    // INTERNAL WALLS & DOORS LOGIC
    private generateWalls(grid: number[][], roomGrid: number[][], config: MapConfig) {
        for (let y = 0; y < config.height; y++) {
            for (let x = 0; x < config.width; x++) {
                if (grid[y][x] === FLOOR) {
                    const currentRoom = roomGrid[y][x];
                    const dirs = [[0,-1], [0,1], [-1,0], [1,0]];
                    
                    for (const [dx, dy] of dirs) {
                        const nx = x + dx;
                        const ny = y + dy;
                        
                        // Border Map Check
                        if (nx < 0 || ny < 0 || nx >= config.width || ny >= config.height) continue;
                        
                        const neighborVal = grid[ny][nx];
                        const neighborRoom = roomGrid[ny][nx];

                        // Wall Condition 1: Edge of Void (Terrain)
                        if (neighborVal === TERRAIN) {
                            grid[y][x] = WALL;
                        }
                        // Wall Condition 2: Internal Rooms Separation
                        // Jika tetangga adalah Floor TAPI beda Room ID, buat dinding.
                        else if (neighborVal === FLOOR && neighborRoom !== -1 && neighborRoom !== currentRoom) {
                            // Agar tidak double-wall, kita prioritaskan arah tertentu (misal Top/Left)
                            // ATAU, jadikan WALL dua-duanya agar tebal?
                            // Untuk amannya di grid kecil, kita convert sisi "ini" jadi wall.
                            // Hasilnya tembok 2 lapis (satu milik A, satu milik B).
                            grid[y][x] = WALL;
                        }
                    }
                }
            }
        }
    }

    private generateDoors(placedRects: Rect[], grid: number[][], mapData: MapData) {
        placedRects.forEach(rA => {
            rA.room.connections.forEach(connId => {
                const rB = placedRects.find(p => p.room.id === connId);
                if (rB) this.carveDoor(rA, rB, grid, mapData);
            });
        });
    }

    private carveDoor(rA: Rect, rB: Rect, grid: number[][], mapData: MapData) {
        // Find Overlap Range (Strict Touching)
        const intersectX_Start = Math.max(rA.x, rB.x);
        const intersectX_End = Math.min(rA.right, rB.right);
        const intersectY_Start = Math.max(rA.y, rB.y);
        const intersectY_End = Math.min(rA.bottom, rB.bottom);

        // Vertical Connection (Atas/Bawah)
        if (intersectX_End - intersectX_Start >= 2 && (rA.bottom === rB.y || rA.y === rB.bottom)) {
            const dx = Math.floor((intersectX_Start + intersectX_End) / 2) - 1;
            // Pilih Y di perbatasan. Karena kita pakai internal walls (2 lapis), 
            // kita harus jebol DUA-DUANYA.
            
            // Misal A di atas (y=0..5), B di bawah (y=5..10).
            // A bottom=5. B top=5.
            // Wall A ada di y=4. Wall B ada di y=5.
            // Kita harus setDOOR di y=4 dan y=5.
            
            const wallAY = (rA.bottom === rB.y) ? rA.bottom - 1 : rA.y;
            const wallBY = (rA.bottom === rB.y) ? rB.y : rB.bottom - 1;

            // Buka Pintu 2 Tile Lebar, menembus 2 layer Wall (Total 4 titik grid kalau wall tebal)
            // Tapi sederhananya: SetDoor di perbatasan
            const boundaryY = (rA.bottom === rB.y) ? rA.bottom : rA.y;
            
            // Kita jebol boundaryY dan boundaryY-1 untuk aman
            this.setDoor(dx, boundaryY, grid);
            this.setDoor(dx, boundaryY-1, grid);
            this.setDoor(dx+1, boundaryY, grid);
            this.setDoor(dx+1, boundaryY-1, grid);

            // Metadata: Register KEDUA tile pintu agar tidak diblokir furnitur
            // Gunakan salah satu Y yang valid sebagai "Center Door"
            this.addDoorMeta(mapData, rA.room.id, dx, boundaryY-1);
            this.addDoorMeta(mapData, rA.room.id, dx+1, boundaryY-1);
            
            this.addDoorMeta(mapData, rB.room.id, dx, boundaryY);
            this.addDoorMeta(mapData, rB.room.id, dx+1, boundaryY);
        }
        
        // Horizontal Connection (Kiri/Kanan)
        if (intersectY_End - intersectY_Start >= 2 && (rA.right === rB.x || rA.x === rB.right)) {
            const dy = Math.floor((intersectY_Start + intersectY_End) / 2) - 1;
            const boundaryX = (rA.right === rB.x) ? rA.right : rA.x;

            // Jebol X dan X-1
            this.setDoor(boundaryX, dy, grid);
            this.setDoor(boundaryX-1, dy, grid);
            this.setDoor(boundaryX, dy+1, grid);
            this.setDoor(boundaryX-1, dy+1, grid);

            this.addDoorMeta(mapData, rA.room.id, boundaryX-1, dy);
            this.addDoorMeta(mapData, rA.room.id, boundaryX-1, dy+1);

            this.addDoorMeta(mapData, rB.room.id, boundaryX, dy);
            this.addDoorMeta(mapData, rB.room.id, boundaryX, dy+1);
        }
    }

    private setDoor(x: number, y: number, grid: number[][]) {
        if (y >= 0 && y < grid.length && x >= 0 && x < grid[0].length) {
            grid[y][x] = DOOR;
        }
    }

    private addDoorMeta(mapData: MapData, roomId: string, x: number, y: number) {
        const r = mapData.rooms.find(rm => rm.id === roomId);
        if (r) {
            if(!r.doors) r.doors = [];
            // Cek duplikat biar rapi
            if (!r.doors.some(d => d.x === x && d.y === y)) {
                r.doors.push({x, y});
            }
        }
    }

    private generateTiles(grid: number[][], roomGrid: number[][], mapData: MapData, config: MapConfig) {
        for (let y = 0; y < config.height; y++) {
            for (let x = 0; x < config.width; x++) {
                const val = grid[y][x];
                const rIdx = roomGrid[y][x];
                
                mapData.tiles.push({ x, y, sprite: 'grass', layer: 'floor' });

                if (val === WALL) {
                    mapData.tiles.push({ x, y, sprite: 'wall_brick', layer: 'wall' });
                } 
                else if (val === FLOOR || val === DOOR) {
                    let sprite = 'floor_common';
                    if (rIdx !== -1 && config.rooms[rIdx]) {
                        sprite = this.getFloorSprite(config.rooms[rIdx].type);
                    }
                    mapData.tiles.push({ x, y, sprite, layer: 'floor' });
                    
                    if (val === DOOR) {
                        // VISUAL DOOR FIX: Render pintu di layer furniture
                        mapData.tiles.push({ x, y, sprite: 'door_wood', layer: 'furniture' });
                    }
                }
            }
        }
    }

    private getFloorSprite(type: string): string {
        const t = type.toLowerCase();
        if (/kitchen/.test(t)) return 'floor_kitchen';
        if (/bath|toilet/.test(t)) return 'floor_bathroom';
        if (/corridor|hall/.test(t)) return 'floor_hallway';
        return 'floor_common';
    }

    private furnishRooms(mapData: MapData, config: MapConfig, grid: number[][]) {
        mapData.rooms.forEach(room => {
            const cfg = config.rooms.find(r => r.id === room.id);
            if (cfg && cfg.furniture) {
                ConstraintSolver.placeItems(room, cfg.furniture, mapData, grid, FLOOR);
            }
        });
    }
}