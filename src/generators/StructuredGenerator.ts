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
    
    get centerX() { return this.x + Math.floor(this.w/2); }
    get centerY() { return this.y + Math.floor(this.h/2); }

    // Cek apakah rect ini menabrak rect lain (Zero Tolerance Policy)
    intersects(other: Rect, padding: number = 0): boolean {
        // Padding positif = butuh jarak extra
        // Padding 0 = bersentuhan diperbolehkan (untuk snap)
        // Padding negatif = HARAM (overlap)
        
        // Gunakan integer math untuk memastikan presisi
        const tLeft = Math.floor(this.left);
        const tRight = Math.floor(this.right);
        const tTop = Math.floor(this.top);
        const tBottom = Math.floor(this.bottom);
        
        const oLeft = Math.floor(other.left);
        const oRight = Math.floor(other.right);
        const oTop = Math.floor(other.top);
        const oBottom = Math.floor(other.bottom);

        return (
            tLeft < oRight + padding &&
            tRight > oLeft - padding &&
            tTop < oBottom + padding &&
            tBottom > oTop - padding
        );
    }
}

export class StructuredGenerator implements IMapGenerator {

    generate(config: MapConfig): MapData {
        console.log(`[StructuredGenerator] Generating Compact Layout on Land...`);
        
        const mapData: MapData = {
            width: config.width,
            height: config.height,
            tiles: [],
            rooms: []
        };

        // 1. Init Grid dengan TERRAIN (Tanah)
        // Kita gunakan ID ruangan negatif (-1) untuk tanah, ID positif untuk index ruangan
        const grid: number[][] = Array(config.height).fill(0).map(() => Array(config.width).fill(TERRAIN));
        const roomGrid: number[][] = Array(config.height).fill(0).map(() => Array(config.width).fill(-1));

        // 2. Siapkan Rects
        const roomRects: Rect[] = config.rooms.map(room => {
            const dim = this.getRoomDimensions(room, config.width, config.height);
            return new Rect(0, 0, dim.w, dim.h, room);
        });

        // 3. Priority Sort (Hub duluan)
        const getPriority = (r: Rect) => {
            let score = r.room.connections.length * 10;
            const t = r.room.type.toLowerCase();
            if (t.includes('living') || t.includes('common')) score += 50;
            if (t.includes('hall') || t.includes('corridor')) score += 30;
            return score;
        };
        roomRects.sort((a, b) => getPriority(b) - getPriority(a));

        // 4. Place First Room (Center)
        const startNode = roomRects[0];
        startNode.x = Math.floor((config.width - startNode.w) / 2);
        startNode.y = Math.floor((config.height - startNode.h) / 2);
        
        const placedRooms: Rect[] = [startNode];
        const placedIds = new Set<string>([startNode.room.id]);

        // 5. Place Sisa Ruangan (Compact Snapping)
        let stuckCount = 0;
        while (placedRooms.length < roomRects.length && stuckCount < 50) {
            let placedSomething = false;
            
            // Cari ruangan yang belum ditempatkan tapi punya koneksi ke yang sudah ada
            const candidates = roomRects.filter(r => !placedIds.has(r.room.id) && 
                r.room.connections.some(connId => placedIds.has(connId))
            );

            // Kalau tidak ada koneksi langsung (islands), ambil sembarang yang belum
            const queue = candidates.length > 0 ? candidates : roomRects.filter(r => !placedIds.has(r.room.id));

            for (const child of queue) {
                // Cari parent terbaik untuk ditempel
                let potentialParents = placedRooms.filter(p => child.room.connections.includes(p.room.id));
                if (potentialParents.length === 0) potentialParents = placedRooms; // Fallback snap to anything

                // ALGORITMA COMPACT SNAPPING
                let bestPos = null;
                let maxContact = -1;

                for (const parent of potentialParents) {
                    const positions = this.getSnapPositions(parent, child, config.width, config.height);
                    
                    for (const pos of positions) {
                        child.x = pos.x;
                        child.y = pos.y;

                        // Cek Tabrakan (Strict)
                        let collision = false;
                        for (const existing of placedRooms) {
                            // Padding 0 = Boleh nempel dinding luar, tapi tidak boleh masuk ke dalam
                            if (child.intersects(existing, 0)) { 
                                collision = true; 
                                break;
                            }
                        }
                        if (collision) continue;

                        // Hitung Contact Score
                        const contact = this.calculateContact(child, placedRooms);
                        if (contact > maxContact) {
                            maxContact = contact;
                            bestPos = pos;
                        }
                    }
                }

                if (bestPos) {
                    child.x = bestPos.x;
                    child.y = bestPos.y;
                    placedRooms.push(child);
                    placedIds.add(child.room.id);
                    placedSomething = true;
                    stuckCount = 0;
                    break; 
                }
            }

            if (!placedSomething) stuckCount++;
        }

        // 6. Write to Grid (Rasterize Floors)
        placedRooms.forEach((r, idx) => {
            // Fill Floor
            for (let y = r.y; y < r.bottom; y++) {
                for (let x = r.x; x < r.right; x++) {
                    if (this.isValid(x, y, grid)) {
                        grid[y][x] = FLOOR;
                        roomGrid[y][x] = idx;
                    }
                }
            }
            
            // Register Metadata
            mapData.rooms.push({
                id: r.room.id,
                name: r.room.name,
                type: r.room.type,
                x: r.x, y: r.y, width: r.w, height: r.h,
                doors: []
            });
        });

        // 7. Generate Walls (The Skinning Phase)
        // Dinding hanya muncul di perbatasan antara FLOOR dan TERRAIN, atau antar Room Index beda (Internal Wall)
        for (let y = 0; y < config.height; y++) {
            for (let x = 0; x < config.width; x++) {
                const current = grid[y][x];
                const currentRoom = roomGrid[y][x];

                if (current === FLOOR) {
                    const dirs = [[0,-1], [0,1], [-1,0], [1,0]];

                    for (const [dx, dy] of dirs) {
                        const nx = x + dx;
                        const ny = y + dy;
                        
                        if (!this.isValid(nx, ny, grid)) {
                            // Pinggir map, biarkan floor
                        } else {
                            const neighbor = grid[ny][nx];
                            const neighborRoom = roomGrid[ny][nx];

                            // External Wall: Lantai ketemu Tanah
                            if (neighbor === TERRAIN) {
                                grid[y][x] = WALL; 
                            } 
                            // Internal Wall: Lantai ketemu Lantai ruangan LAIN
                            else if (neighbor === FLOOR && neighborRoom !== -1 && neighborRoom !== currentRoom) {
                                if (x < nx || y < ny) {
                                    grid[y][x] = WALL;
                                }
                            }
                        }
                    }
                }
            }
        }

        // 8. Generate Doors (Carve Walls)
        placedRooms.forEach(rA => {
            rA.room.connections.forEach(targetId => {
                const rB = placedRooms.find(r => r.room.id === targetId);
                if (rB) this.makeDoor(rA, rB, grid, mapData);
            });
        });

        // 9. Convert Grid to Tiles
        for (let y = 0; y < config.height; y++) {
            for (let x = 0; x < config.width; x++) {
                const val = grid[y][x];
                const roomId = roomGrid[y][x];
                
                // Background Terrain
                mapData.tiles.push({ x, y, sprite: 'grass', layer: 'floor' });

                if (val === WALL) {
                    mapData.tiles.push({ x, y, sprite: 'wall_brick', layer: 'wall' });
                } else if (val === FLOOR || val === DOOR) {
                    let floorSprite = 'floor_common';
                    if (roomId !== -1) {
                        const rType = config.rooms[roomId] ? config.rooms[roomId].type : 'common';
                        floorSprite = this.getFloorSprite(rType);
                    }
                    mapData.tiles.push({ x, y, sprite: floorSprite, layer: 'floor' });
                }
            }
        }

        // 10. Furnish
        this.furnishRooms(mapData, config, grid);

        return mapData;
    }

    // --- Helpers ---

    private getSnapPositions(parent: Rect, child: Rect, _mapW: number, _mapH: number): {x: number, y: number}[] {
        const res: {x: number, y: number}[] = [];
        // Top Edge
        const yTop = parent.y - child.h;
        for (let x = parent.x - child.w + 2; x < parent.right - 1; x++) res.push({x, y: yTop});

        // Bottom Edge
        const yBot = parent.bottom;
        for (let x = parent.x - child.w + 2; x < parent.right - 1; x++) res.push({x, y: yBot});

        // Left Edge
        const xLeft = parent.x - child.w;
        for (let y = parent.y - child.h + 2; y < parent.bottom - 1; y++) res.push({x: xLeft, y});

        // Right Edge
        const xRight = parent.right;
        for (let y = parent.y - child.h + 2; y < parent.bottom - 1; y++) res.push({x: xRight, y});

        return res;
    }

    private calculateContact(rect: Rect, others: Rect[]): number {
        let contactPixels = 0;
        const expanded = new Rect(rect.x - 1, rect.y - 1, rect.w + 2, rect.h + 2, rect.room);
        
        for (const other of others) {
            const ix = Math.max(expanded.x, other.x);
            const iy = Math.max(expanded.y, other.y);
            const iw = Math.min(expanded.right, other.right) - ix;
            const ih = Math.min(expanded.bottom, other.bottom) - iy;
            
            if (iw > 0 && ih > 0) {
                contactPixels += iw * ih;
            }
        }
        return contactPixels;
    }

    private makeDoor(rA: Rect, rB: Rect, grid: number[][], mapData: MapData) {
        const x1 = Math.max(rA.x, rB.x);
        const y1 = Math.max(rA.y, rB.y);
        const x2 = Math.min(rA.right, rB.right);
        const y2 = Math.min(rA.bottom, rB.bottom);

        const cx = Math.floor((x1+x2)/2);
        const cy = Math.floor((y1+y2)/2);
        
        for(let dy=-1; dy<=1; dy++) {
            for(let dx=-1; dx<=1; dx++) {
                const px = cx+dx;
                const py = cy+dy;
                if (this.isValid(px, py, grid) && grid[py][px] === WALL) {
                    grid[py][px] = DOOR;
                    
                    const rDataA = mapData.rooms.find(r => r.id === rA.room.id);
                    const rDataB = mapData.rooms.find(r => r.id === rB.room.id);
                    if(rDataA) rDataA.doors?.push({x: px, y: py});
                    if(rDataB) rDataB.doors?.push({x: px, y: py});
                    
                    return; 
                }
            }
        }
    }

    private furnishRooms(mapData: MapData, config: MapConfig, grid: number[][]) {
        mapData.rooms.forEach(room => {
            const cfg = config.rooms.find(r => r.id === room.id);
            if (cfg) {
                let items = cfg.furniture || [];
                ConstraintSolver.placeItems(room, items, mapData, grid, FLOOR); 
            }
        });
    }

    private getRoomDimensions(config: RoomConfig, _mapW: number, _mapH: number): { w: number, h: number } {
        // 1. Prioritas Utama: Input dari AI (jika valid)
        if (config.width && config.height && config.width > 0 && config.height > 0) {
            return { w: Math.floor(config.width), h: Math.floor(config.height) };
        }

        // 2. Fallback Logic (Jika AI lupa ngasih dimensi)
        const t = config.type.toLowerCase();
        
        if (t.includes('hall') || t.includes('corridor') || t.includes('passage')) {
             return { w: 8, h: 2 }; // Default corridor segment
        }
        if (t.includes('living') || t.includes('ballroom') || t.includes('hall')) return { w: 10, h: 8 };
        if (t.includes('master')) return { w: 8, h: 6 };
        if (t.includes('kitchen') || t.includes('dining')) return { w: 6, h: 6 };
        if (t.includes('bed')) return { w: 5, h: 5 };
        if (t.includes('bath') || t.includes('wc') || t.includes('toilet')) return { w: 3, h: 3 };
        if (t.includes('garage')) return { w: 8, h: 8 };
        
        return { w: 6, h: 6 }; 
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