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

        // 2. Tentukan Ukuran Ruangan (Dimensi Baku)
        // Kita tentukan ukuran di awal biar placement gampang
        const roomRects: Rect[] = config.rooms.map(room => {
            const dim = this.getRoomDimensions(room.type, room.name);
            return new Rect(0, 0, dim.w, dim.h, room);
        });

        // 3. Start Node Selection (Hub)
        // Cari Entrance / Foyer / Hallway utama
        let startNode = roomRects.find(r => r.room.type.includes('entrance') || r.room.name.toLowerCase().includes('foyer'));
        if (!startNode) startNode = roomRects.find(r => r.room.type.includes('living') || r.room.type.includes('common'));
        if (!startNode) startNode = roomRects[0];

        // 4. Place First Room in Center
        startNode.x = Math.floor((config.width - startNode.w) / 2);
        startNode.y = Math.floor((config.height - startNode.h) / 2);
        
        // Pindahkan startNode sedikit ke bawah jika dia Entrance (biar dekat pintu masuk map)
        if (startNode.room.type === 'entrance') {
            startNode.y = Math.floor(config.height * 0.7); 
        }

        const placedRooms: Rect[] = [startNode];
        const queue: Rect[] = [startNode];
        const placedIds = new Set<string>([startNode.room.id]);

        // 5. Growth Loop (BFS)
        while (queue.length > 0) {
            const parent = queue.shift()!;
            
            // Cari tetangga yang belum ditempatkan
            const neighborIds = parent.room.connections || [];
            
            for (const nbId of neighborIds) {
                if (placedIds.has(nbId)) continue;

                const child = roomRects.find(r => r.room.id === nbId);
                if (!child) continue;

                // Coba tempelkan child ke parent (4 Sisi)
                const success = this.trySnapRoom(parent, child, placedRooms, config.width, config.height);
                
                if (success) {
                    placedRooms.push(child);
                    queue.push(child);
                    placedIds.add(child.room.id);
                } else {
                    console.warn(`[Architect] Could not fit room ${child.room.name} connected to ${parent.room.name}`);
                    // Fallback: Taruh di queue lagi buat diproses sama parent lain? 
                    // Atau force place di lokasi random terdekat?
                    // Untuk sekarang kita skip biar ga crash/overlap parah.
                }
            }
        }

        // Handle Unplaced Rooms (Disconnected components)
        const unplaced = roomRects.filter(r => !placedIds.has(r.room.id));
        // Simple logic: Tempelkan mereka ke ruangan terakhir yang ditaruh (Growth liar)
        unplaced.forEach(child => {
            for (const parent of placedRooms) {
                if (this.trySnapRoom(parent, child, placedRooms, config.width, config.height)) {
                    placedRooms.push(child);
                    placedIds.add(child.room.id);
                    break;
                }
            }
        });

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
        // Shuffle arah biar gak linear terus
        const directions = ['top', 'bottom', 'left', 'right'].sort(() => Math.random() - 0.5);

        for (const dir of directions) {
            // Set posisi child menempel parent
            if (dir === 'top') {
                child.x = parent.x + Math.floor((parent.w - child.w) / 2); // Center align
                child.y = parent.y - child.h + 1; // +1 OVERLAP (Shared Wall)
            } else if (dir === 'bottom') {
                child.x = parent.x + Math.floor((parent.w - child.w) / 2);
                child.y = parent.y + parent.h - 1; // -1 OVERLAP
            } else if (dir === 'left') {
                child.x = parent.x - child.w + 1; // +1 OVERLAP
                child.y = parent.y + Math.floor((parent.h - child.h) / 2);
            } else if (dir === 'right') {
                child.x = parent.x + parent.w - 1; // -1 OVERLAP
                child.y = parent.y + Math.floor((parent.h - child.h) / 2);
            }

            // Validasi Bounds
            if (child.x < 1 || child.y < 1 || child.right > mapW - 1 || child.bottom > mapH - 1) continue;

            // Validasi Overlap dengan ruangan lain (selain parent)
            // Note: Overlap dengan parent pasti terjadi (1 pixel) dan itu diinginkan.
            // Overlap dengan yang lain tidak boleh > 1 pixel.
            let collision = false;
            for (const other of allRooms) {
                if (other === parent) continue; // Ignore parent overlap (it's intentional)
                if (child.overlaps(other)) {
                    collision = true;
                    break;
                }
            }

            if (!collision) return true; // Success!
        }

        return false; // Gagal di semua sisi
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
        // Cari area overlap (Intersection Rectangle)
        const x1 = Math.max(r1.x, r2.x);
        const y1 = Math.max(r1.y, r2.y);
        const x2 = Math.min(r1.right, r2.right);
        const y2 = Math.min(r1.bottom, r2.bottom);

        // Valid intersection?
        if (x1 < x2 && y1 < y2) {
            // Intersection center
            const cx = Math.floor((x1 + x2) / 2);
            const cy = Math.floor((y1 + y2) / 2);

            // Carve Door (2x2 or 1x2 depending on alignment)
            // Jika intersection wide (horizontal wall share) -> Door vertical
            // Jika intersection tall (vertical wall share) -> Door horizontal
            
            const w = x2 - x1;
            const h = y2 - y1;

            if (w > h) { // Horizontal wall shared
                // Pintu selebar 2 tile
                if (this.isValid(cx, cy, grid)) this.setFloor(cx, cy, grid, mapData);
                if (this.isValid(cx+1, cy, grid)) this.setFloor(cx+1, cy, grid, mapData);
            } else { // Vertical wall shared
                if (this.isValid(cx, cy, grid)) this.setFloor(cx, cy, grid, mapData);
                if (this.isValid(cx, cy+1, grid)) this.setFloor(cx, cy+1, grid, mapData);
            }
        }
    }

    private setFloor(x: number, y: number, grid: number[][], mapData: MapData) {
        if (grid[y][x] === this.WALL) {
            grid[y][x] = this.FLOOR;
            mapData.tiles.push({ x, y, sprite: 'floor_common', layer: 'floor' }); // Pintu biasanya kayu/umum
        }
    }

    // --- Config & Helpers ---

    private getRoomDimensions(type: string, name: string): { w: number, h: number } {
        const t = type.toLowerCase();
        const n = name.toLowerCase();

        // Ukuran PAS (Genap biar gampang center align)
        if (t.includes('hall') || t.includes('corridor')) {
            // Koridor panjang atau hub
            return { w: 14, h: 6 }; // Default horizontal hall
        }
        if (t.includes('living') || t.includes('lounge') || t.includes('common')) return { w: 12, h: 12 };
        if (t.includes('kitchen') || t.includes('dining')) return { w: 10, h: 10 };
        if (t.includes('master') || n.includes('master')) return { w: 10, h: 10 };
        if (t.includes('bed')) return { w: 8, h: 8 }; // Kamar anak standar
        if (t.includes('bath') || t.includes('wc') || t.includes('toilet')) return { w: 6, h: 6 };
        if (t.includes('garage') || t.includes('carport')) return { w: 10, h: 14 }; // Memanjang vertikal buat mobil
        
        return { w: 8, h: 8 }; // Fallback
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