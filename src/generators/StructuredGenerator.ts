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
    constructor(public x: number, public y: number, public w: number, public h: number, public room: RoomConfig) {}
    
    get left() { return this.x; }
    get right() { return this.x + this.w; }
    get top() { return this.y; }
    get bottom() { return this.y + this.h; }
    
    // Titik pusat (Integer)
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
        console.log(`[StructuredGenerator] Analyzing Architecture Type...`);
        
        const mapData: MapData = {
            width: config.width,
            height: config.height,
            tiles: [],
            rooms: []
        };

        // 1. Init Grid
        const grid: number[][] = Array(config.height).fill(0).map(() => Array(config.width).fill(TERRAIN));
        const roomGrid: number[][] = Array(config.height).fill(0).map(() => Array(config.width).fill(-1));

        // 2. Prepare Rects
        const allRects: Rect[] = config.rooms.map(room => {
            const dim = this.getRoomDimensions(room);
            return new Rect(0, 0, dim.w, dim.h, room);
        });

        // 3. Smart Strategy Selector
        // - Strategy A (Spine): Ada ruangan tipe "Corridor/Hallway"
        // - Strategy B (Hub): Ada ruangan tipe "Living/Lobby/Foyer" yang koneksinya banyak (>2)
        // - Strategy C (Cluster): Sisanya (Gubuk, Barak, Pos Jaga)
        
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

    // STRATEGY A: THE SPINE (Mansion, School, Hotel)
    // Fokus: Koridor lurus, ruangan nempel di kiri/kanan/atas/bawah koridor.
    private buildSpineLayout(spine: Rect, allRects: Rect[], mapW: number, mapH: number): Rect[] {
        const placed: Rect[] = [];
        const placedIds = new Set<string>();

        // Center Spine
        spine.x = Math.floor((mapW - spine.w) / 2);
        spine.y = Math.floor((mapH - spine.h) / 2);
        placed.push(spine);
        placedIds.add(spine.room.id);

        // Determine Spine Axis (Horizontal vs Vertical)
        const isHorizontal = spine.w >= spine.h;
        
        // Children connected to Spine
        const children = allRects.filter(r => !placedIds.has(r.room.id) && spine.room.connections.includes(r.room.id));
        
        // Sort children by size for better packing
        children.sort((a, b) => b.w * b.h - a.w * a.h);

        let cursorTop = spine.x;
        let cursorBottom = spine.x;
        let cursorLeft = spine.y;
        let cursorRight = spine.y;

        children.forEach((child, i) => {
            let px = 0, py = 0;
            if (isHorizontal) {
                // Alternate Top/Bottom
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
                // Alternate Left/Right
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
            
            child.x = px;
            child.y = py;
            
            if (!this.checkCollision(child, placed)) {
                placed.push(child);
                placedIds.add(child.room.id);
            }
        });

        // Handle leftovers (Grandchildren)
        this.placeLeftovers(allRects, placed, placedIds);
        return placed;
    }

    // STRATEGY B: THE HUB (Modern House, Apartment)
    // Fokus: Ruang tengah besar (Living Room), ruangan lain nempel memutar.
    private buildHubLayout(hub: Rect, allRects: Rect[], mapW: number, mapH: number): Rect[] {
        const placed: Rect[] = [];
        const placedIds = new Set<string>();

        // Center Hub
        hub.x = Math.floor((mapW - hub.w) / 2);
        hub.y = Math.floor((mapH - hub.h) / 2);
        placed.push(hub);
        placedIds.add(hub.room.id);

        const children = allRects.filter(r => !placedIds.has(r.room.id) && hub.room.connections.includes(r.room.id));
        
        // Place tightly around Hub
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

    // STRATEGY C: THE CLUSTER (Cabin, Witch Hut, Barracks)
    // Fokus: Organic Blob. Cari ruangan terbesar (sebagai anchor) tapi tempelnya serampangan/padat.
    private buildClusterLayout(allRects: Rect[], mapW: number, mapH: number): Rect[] {
        if (allRects.length === 0) return [];

        const placed: Rect[] = [];
        const placedIds = new Set<string>();

        // 1. Pick Anchor (Largest Room usually)
        allRects.sort((a, b) => (b.w * b.h) - (a.w * a.h));
        const anchor = allRects[0];
        
        anchor.x = Math.floor((mapW - anchor.w) / 2);
        anchor.y = Math.floor((mapH - anchor.h) / 2);
        placed.push(anchor);
        placedIds.add(anchor.room.id);

        // 2. Linear/Blob Chain
        // Berbeda dengan Hub yg radial, Cluster ini mencoba menempel ke ruangan TERAKHIR yg dipasang (Chain)
        // atau ke ruangan mana saja yang dekat (Blob), menciptakan bentuk yang lebih tidak beraturan.
        
        const queue = allRects.filter(r => !placedIds.has(r.room.id));
        
        for (const child of queue) {
            // Coba tempel ke Anchor dulu, kalau penuh tempel ke yang lain (Blob growth)
            // Kita acak target parent dari yang sudah placed untuk efek organik
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
            
            if (!placedChild) {
                console.warn(`[Cluster] Skipped orphaned room: ${child.room.name}`);
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
                // Try to connect to valid parent
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
        // Urutan prioritas posisi tempel:
        // 1. Tengah Sisi (Centered)
        // 2. Pojok Sisi (Corner alignment)
        
        const candidates = [
            // Centered Sides
            { x: parent.centerX - Math.floor(child.w/2), y: parent.y - child.h }, // Top
            { x: parent.centerX - Math.floor(child.w/2), y: parent.bottom },      // Bottom
            { x: parent.x - child.w, y: parent.centerY - Math.floor(child.h/2) }, // Left
            { x: parent.right, y: parent.centerY - Math.floor(child.h/2) },       // Right
            
            // Corner Alignments (Top-Left, Top-Right, etc)
            { x: parent.x, y: parent.y - child.h }, // Top-Align Left
            { x: parent.right - child.w, y: parent.y - child.h }, // Top-Align Right
            { x: parent.x, y: parent.bottom }, // Bottom-Align Left
            { x: parent.right - child.w, y: parent.bottom } // Bottom-Align Right
        ];

        for (const pos of candidates) {
            child.x = pos.x;
            child.y = pos.y;
            if (!this.checkCollision(child, obstacles)) return pos;
        }
        return null;
    }

    private checkCollision(rect: Rect, others: Rect[]): boolean {
        for (const other of others) {
            if (rect.room.id === other.room.id) continue;
            // Strict 0-padding intersection check
            if (rect.intersects(other, 0)) return true;
        }
        return false;
    }

    private getRoomDimensions(config: RoomConfig): { w: number, h: number } {
        // Priority: AI Config
        if (config.width && config.height) return { w: Math.floor(config.width), h: Math.floor(config.height) };
        
        const t = config.type.toLowerCase();
        if (/corridor|hall|passage/.test(t)) return { w: 10, h: 2 };
        if (/living|ballroom|common/.test(t)) return { w: 10, h: 8 };
        if (/master/.test(t)) return { w: 8, h: 6 };
        if (/kitchen|dining/.test(t)) return { w: 6, h: 6 };
        if (/bath|wc|toilet/.test(t)) return { w: 3, h: 3 };
        return { w: 5, h: 5 };
    }

    private generateWalls(grid: number[][], roomGrid: number[][], config: MapConfig) {
        for (let y = 0; y < config.height; y++) {
            for (let x = 0; x < config.width; x++) {
                if (grid[y][x] === FLOOR) {
                    const dirs = [[0,-1], [0,1], [-1,0], [1,0]];
                    for (const [dx, dy] of dirs) {
                        const nx = x + dx;
                        const ny = y + dy;
                        if (nx < 0 || ny < 0 || nx >= config.width || ny >= config.height) continue;
                        
                        // Wall jika tetangga adalah Terrain (Void)
                        if (grid[ny][nx] === TERRAIN) grid[y][x] = WALL;
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
        // Find Overlap Range
        const intersectX_Start = Math.max(rA.x, rB.x);
        const intersectX_End = Math.min(rA.right, rB.right);
        const intersectY_Start = Math.max(rA.y, rB.y);
        const intersectY_End = Math.min(rA.bottom, rB.bottom);

        // Logic: Pintu dibuat di tengah area yang bersentuhan
        // Vertical touch (Atas/Bawah)
        if (intersectX_End - intersectX_Start >= 2 && (rA.bottom === rB.y || rA.y === rB.bottom)) {
            const dx = Math.floor((intersectX_Start + intersectX_End) / 2) - 1; // Center - 1
            const dy = (rA.bottom === rB.y) ? rA.bottom - 1 : rA.y; // The wall line
            
            // Buka 2 tile (Door & Door+1)
            this.setDoor(dx, dy, grid);
            this.setDoor(dx+1, dy, grid);
            
            // Metadata
            this.addDoorMeta(mapData, rA.room.id, dx, dy);
        }
        
        // Horizontal touch (Kiri/Kanan)
        if (intersectY_End - intersectY_Start >= 2 && (rA.right === rB.x || rA.x === rB.right)) {
            const dy = Math.floor((intersectY_Start + intersectY_End) / 2) - 1;
            const dx = (rA.right === rB.x) ? rA.right - 1 : rA.x;
            
            this.setDoor(dx, dy, grid);
            this.setDoor(dx, dy+1, grid);

            this.addDoorMeta(mapData, rA.room.id, dx, dy);
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
            r.doors.push({x, y});
        }
    }

    private generateTiles(grid: number[][], roomGrid: number[][], mapData: MapData, config: MapConfig) {
        for (let y = 0; y < config.height; y++) {
            for (let x = 0; x < config.width; x++) {
                const val = grid[y][x];
                const rIdx = roomGrid[y][x];
                
                // Base
                mapData.tiles.push({ x, y, sprite: 'grass', layer: 'floor' });

                if (val === WALL) {
                    mapData.tiles.push({ x, y, sprite: 'wall_brick', layer: 'wall' });
                } else if (val === FLOOR || val === DOOR) {
                    let sprite = 'floor_common';
                    if (rIdx !== -1) {
                        sprite = this.getFloorSprite(config.rooms[rIdx].type);
                    }
                    mapData.tiles.push({ x, y, sprite, layer: 'floor' });
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