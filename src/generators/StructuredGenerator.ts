import { MapConfig, RoomConfig } from '../types/MapConfig';
import { MapData } from '../types/MapData';
import { IMapGenerator } from './MapGenerators';
import { ConstraintSolver } from './ConstraintSolver';

// --- Tipe Data Internal ---

type ZoneType = 'service' | 'public' | 'private' | 'exterior';

interface Zone {
    id: string;
    type: ZoneType;
    rooms: RoomConfig[];
    x: number;
    y: number;
    width: number;
    height: number;
    connections: string[]; // ID Zone lain yang terhubung
    placed: boolean;
}

class Container {
    x: number;
    y: number;
    width: number;
    height: number;
    room: RoomConfig | null = null;

    constructor(x: number, y: number, w: number, h: number) {
        this.x = x;
        this.y = y;
        this.width = w;
        this.height = h;
    }

    get center() {
        return {
            x: Math.floor(this.x + this.width / 2),
            y: Math.floor(this.y + this.height / 2)
        };
    }
}

export class StructuredGenerator implements IMapGenerator {
    
    // --- Konfigurasi Arsitek ---
    private readonly MIN_ROOM_SIZE = 5; 
    private readonly ZONE_PADDING = 2; // Jarak antar zona (bisa jadi koridor)
    private readonly WALL_THICKNESS = 1;

    generate(config: MapConfig): MapData {
        console.log(`[StructuredGenerator] Starting Phase 3: Hierarchical Architect...`);
        
        const mapData: MapData = {
            width: config.width,
            height: config.height,
            tiles: [],
            rooms: []
        };

        // 1. Zoning (Clustering)
        // Kelompokkan ruangan menjadi Zona (Bubble Diagram)
        const zones = this.createZoning(config.rooms);
        console.log(`[Architect] Created ${zones.length} zones.`);

        // 2. Block Planning (Meta-Layout)
        // Susun kotak-kotak Zona di atas peta (membentuk L/U/T-Shape secara natural)
        this.arrangeZones(zones, config.width, config.height);

        // Grid global untuk tracking dinding & lantai
        // 1 = Wall/Void, 0 = Floor
        const grid: number[][] = Array(config.height).fill(0).map(() => Array(config.width).fill(1));

        // 3. Detailing (Local BSP & Rasterization)
        // Bedah setiap zona untuk menempatkan ruangan di dalamnya
        zones.forEach(zone => {
            if (!zone.placed) return;
            this.processZoneInternals(zone, mapData, grid);
        });

        // 4. Global Connectivity (Inter-Zone Corridors)
        // Hubungkan antar-zona yang bersebelahan/terhubung
        this.connectZones(zones, mapData, grid);

        // 5. Wall Generation (Smart Bitmasking)
        this.generateSmartWalls(mapData, grid, config.width, config.height);

        // 6. Interior Design (Furniture Placement)
        this.furnishRooms(mapData, config, grid);

        return mapData;
    }

    // ==========================================
    // TAHAP 1: ZONING (The Brain)
    // ==========================================

    private createZoning(rooms: RoomConfig[]): Zone[] {
        const zones: Record<string, Zone> = {};

        // Helper untuk inisialisasi zona
        const getOrAddZone = (type: ZoneType): Zone => {
            if (!zones[type]) {
                zones[type] = {
                    id: type,
                    type: type,
                    rooms: [],
                    x: 0, y: 0, width: 0, height: 0, // Dimensi dinamis nanti
                    connections: [],
                    placed: false
                };
            }
            return zones[type];
        };

        // Klasifikasi Ruangan
        rooms.forEach(room => {
            const t = room.type.toLowerCase();
            const n = room.name.toLowerCase();
            let targetZone: ZoneType = 'public'; // Default

            if (t.includes('garage') || t.includes('carport') || n.includes('shed')) targetZone = 'exterior';
            else if (t.includes('kitchen') || t.includes('laundry') || t.includes('utility') || t.includes('pantry') || t.includes('storage')) targetZone = 'service';
            else if (t.includes('bed') || t.includes('bath') || t.includes('wardrobe') || t.includes('study') || n.includes('private')) targetZone = 'private';
            else if (t.includes('living') || t.includes('dining') || t.includes('foyer') || t.includes('hall') || t.includes('lounge') || t.includes('entrance')) targetZone = 'public';

            const zone = getOrAddZone(targetZone);
            zone.rooms.push(room);
        });

        // Hitung estimasi ukuran zona (Meta-Size)
        // Kita asumsikan setiap ruangan butuh minimal 6x6 area + padding
        Object.values(zones).forEach(zone => {
            const areaPerRoom = 40; // Est area tiles
            const totalArea = zone.rooms.length * areaPerRoom;
            // Bikin kotak yang agak persegi
            const side = Math.ceil(Math.sqrt(totalArea));
            // Tambahkan variasi biar gak kotak banget, misal service memanjang
            if (zone.type === 'service') {
                zone.width = Math.ceil(side * 0.7);
                zone.height = Math.ceil(side * 1.4);
            } else if (zone.type === 'private') {
                zone.width = Math.ceil(side * 1.2);
                zone.height = Math.ceil(side * 0.8);
            } else {
                zone.width = side;
                zone.height = side;
            }
            
            // Minimal size guard
            zone.width = Math.max(zone.width, 8);
            zone.height = Math.max(zone.height, 8);
        });

        // Bangun koneksi antar zona berdasarkan koneksi ruangan di dalamnya
        const zoneList = Object.values(zones);
        zoneList.forEach(zoneA => {
            zoneA.rooms.forEach(room => {
                room.connections.forEach(targetRoomId => {
                    // Cari room ini ada di zona mana
                    const targetZone = zoneList.find(z => z.rooms.some(r => r.id === targetRoomId));
                    if (targetZone && targetZone.id !== zoneA.id) {
                        if (!zoneA.connections.includes(targetZone.id)) {
                            zoneA.connections.push(targetZone.id);
                        }
                    }
                });
            });
        });

        return zoneList;
    }

    // ==========================================
    // TAHAP 2: BLOCK PLANNING (The Layout)
    // ==========================================

    private arrangeZones(zones: Zone[], mapW: number, mapH: number) {
        const gridStep = 2; // Snap to grid (unused error fix)
        const centerX = Math.floor(mapW / 2);
        const centerY = Math.floor(mapH / 2);
        const pad = this.ZONE_PADDING; // Jarak antar zona (unused error fix)

        const priorityOrder = ['exterior', 'public', 'service', 'private'];
        zones.sort((a, b) => priorityOrder.indexOf(a.type) - priorityOrder.indexOf(b.type));

        const placedZones: Zone[] = [];

        for (const zone of zones) {
            let bestX = 0, bestY = 0;
            let bestScore = -Infinity;
            let placed = false;

            if (placedZones.length === 0) {
                // Zona Pertama: Snap to Grid
                bestX = Math.floor((centerX - zone.width / 2) / gridStep) * gridStep;
                bestY = Math.floor((mapH - zone.height - 4) / gridStep) * gridStep;
                placed = true;
            } else {
                const candidates: {x: number, y: number}[] = [];
                
                placedZones.forEach(pZ => {
                    // Gunakan PADDING saat menempelkan zona
                    candidates.push({ x: pZ.x + pZ.width + pad, y: pZ.y }); // Kanan
                    candidates.push({ x: pZ.x - zone.width - pad, y: pZ.y }); // Kiri
                    candidates.push({ x: pZ.x, y: pZ.y - zone.height - pad }); // Atas
                    candidates.push({ x: pZ.x, y: pZ.y + pZ.height + pad }); // Bawah
                });

                for (const pos of candidates) {
                    // Snap candidate to grid
                    const snappedX = Math.round(pos.x / gridStep) * gridStep;
                    const snappedY = Math.round(pos.y / gridStep) * gridStep;

                    if (snappedX < 2 || snappedY < 2 || snappedX + zone.width > mapW - 2 || snappedY + zone.height > mapH - 2) continue;

                    const overlap = placedZones.some(pz => 
                        snappedX < pz.x + pz.width &&
                        snappedX + zone.width > pz.x &&
                        snappedY < pz.y + pz.height &&
                        snappedY + zone.height > pz.y
                    );
                    if (overlap) continue;

                    let score = 0;
                    zone.connections.forEach(connId => {
                        const target = placedZones.find(z => z.id === connId);
                        if (target) {
                            const dist = Math.abs(snappedX - target.x) + Math.abs(snappedY - target.y);
                            score -= dist; 
                        }
                    });

                    const distToCenter = Math.abs(snappedX - centerX) + Math.abs(snappedY - centerY);
                    score -= distToCenter * 0.5;

                    if (zone.type === 'private') score -= snappedY;

                    if (score > bestScore) {
                        bestScore = score;
                        bestX = snappedX;
                        bestY = snappedY;
                        placed = true;
                    }
                }
            }

            if (placed) {
                zone.x = bestX;
                zone.y = bestY;
                zone.placed = true;
                placedZones.push(zone);
                console.log(`[Architect] Placed Zone ${zone.type} at ${zone.x},${zone.y}`);
            }
        }
    }

    // ==========================================
    // TAHAP 3: DETAILING (Local BSP)
    // ==========================================

    private processZoneInternals(zone: Zone, mapData: MapData, grid: number[][]) {
        // Konsep: Kita punya "Tanah Kavling" (Zone). Sekarang kita potong-potong buat ruangan.
        
        // 1. Root Container untuk Zona ini
        // Kita beri padding 1 tile di dalam zona agar ada tembok luar zona
        const cX = zone.x + 1;
        const cY = zone.y + 1;
        const cW = zone.width - 2;
        const cH = zone.height - 2;

        if (cW < this.MIN_ROOM_SIZE || cH < this.MIN_ROOM_SIZE) return; // Zona terlalu kecil

        const root = new Container(cX, cY, cW, cH);
        const leaves: Container[] = [root];

        // 2. BSP Split Loop
        // Kita butuh sejumlah leaf sesuai jumlah ruangan di zona ini
        const targetCount = zone.rooms.length;
        let loops = 0;

        while (leaves.length < targetCount && loops < 100) {
            loops++;
            // Split container terbesar
            leaves.sort((a, b) => (b.width * b.height) - (a.width * a.height));
            const candidate = leaves.shift();
            if (!candidate) break;

            const split = this.split(candidate);
            if (split) {
                leaves.push(split[0], split[1]);
            } else {
                leaves.push(candidate); // Balikin kalau gak bisa split
                // Cek apa masih ada yang bisa displit?
                if (leaves.every(l => !this.canSplit(l))) break; 
            }
        }

        // 3. Assign Rooms to Leaves
        // Sort rooms by importance/size requirement
        // Master bed > Kids bed, Living > Foyer
        const sortedRooms = [...zone.rooms].sort((a, b) => this.getRoomWeight(b.type) - this.getRoomWeight(a.type));
        // Sort leaves by size
        leaves.sort((a, b) => (b.width * b.height) - (a.width * a.height));

        sortedRooms.forEach((room, i) => {
            if (i < leaves.length) {
                const leaf = leaves[i];
                leaf.room = room;

                // Gunakan WALL_THICKNESS yang sebelumnya unused
                const wall = this.WALL_THICKNESS;
                
                // Hitung koordinat lantai dalam (Inner Room)
                const rX = leaf.x + wall; 
                const rY = leaf.y + wall;
                const rW = leaf.width - (wall * 2);
                const rH = leaf.height - (wall * 2);

                // Gunakan rW/rH untuk validasi ukuran
                if (rW >= 2 && rH >= 2) {
                    mapData.rooms.push({
                        id: room.id,
                        name: room.name,
                        type: room.type,
                        x: leaf.x, y: leaf.y, width: leaf.width, height: leaf.height 
                    });

                    // Render Floor: GUNAKAN rX, rY, rW, rH (Variable yang tadi error)
                    // Bukan leaf.x lagi!
                    for (let y = rY; y < rY + rH; y++) {
                        for (let x = rX; x < rX + rW; x++) {
                            if (this.isValid(x, y, grid)) {
                                grid[y][x] = 0; // Floor
                                mapData.tiles.push({
                                    x, y,
                                    sprite: this.getFloorSprite(room.type),
                                    layer: 'floor'
                                });
                            }
                        }
                    }
                }
            }
        });

        // 5. Connect Rooms Internally (Dalam Zona yang sama)
        this.connectInternalRooms(leaves, grid, mapData);
    }

    private split(c: Container): [Container, Container] | null {
        // Cek rasio aspek agar ruangan tidak gepeng
        if (c.width < this.MIN_ROOM_SIZE * 2 && c.height < this.MIN_ROOM_SIZE * 2) return null;

        let splitH = Math.random() > 0.5;
        if (c.width / c.height >= 1.5) splitH = false; // Terlalu lebar -> Potong vertikal
        else if (c.height / c.width >= 1.5) splitH = true; // Terlalu tinggi -> Potong horizontal

        if (splitH) { // Horizontal Split (Atas/Bawah)
            const splitSize = Math.floor(Math.random() * (c.height - 2 * this.MIN_ROOM_SIZE)) + this.MIN_ROOM_SIZE;
            if (splitSize < this.MIN_ROOM_SIZE || (c.height - splitSize) < this.MIN_ROOM_SIZE) return null;
            
            return [
                new Container(c.x, c.y, c.width, splitSize),
                new Container(c.x, c.y + splitSize, c.width, c.height - splitSize)
            ];
        } else { // Vertical Split (Kiri/Kanan)
            const splitSize = Math.floor(Math.random() * (c.width - 2 * this.MIN_ROOM_SIZE)) + this.MIN_ROOM_SIZE;
            if (splitSize < this.MIN_ROOM_SIZE || (c.width - splitSize) < this.MIN_ROOM_SIZE) return null;

            return [
                new Container(c.x, c.y, splitSize, c.height),
                new Container(c.x + splitSize, c.y, c.width - splitSize, c.height)
            ];
        }
    }

    private canSplit(c: Container): boolean {
        return c.width >= this.MIN_ROOM_SIZE * 2 || c.height >= this.MIN_ROOM_SIZE * 2;
    }

    // ==========================================
    // TAHAP 4: CONNECTIVITY
    // ==========================================

    private connectInternalRooms(leaves: Container[], grid: number[][], mapData: MapData) {
        // Hubungkan semua leaf yang punya room ke leaf terdekat di zona yang sama
        // Simple MST atau Chain
        const rooms = leaves.filter(l => l.room);
        for (let i = 0; i < rooms.length - 1; i++) {
            this.createCorridor(rooms[i], rooms[i+1], grid, mapData);
        }
    }

    private connectZones(zones: Zone[], mapData: MapData, grid: number[][]) {
        // Hubungkan zona berdasarkan adjacency
        zones.forEach(zone => {
            zone.connections.forEach(targetId => {
                const target = zones.find(z => z.id === targetId);
                if (target && target.placed && zone.placed) {
                    // Buat koridor antar titik tengah zona
                    const start = { x: zone.x + Math.floor(zone.width/2), y: zone.y + Math.floor(zone.height/2) };
                    const end = { x: target.x + Math.floor(target.width/2), y: target.y + Math.floor(target.height/2) };
                    
                    this.carvePath(start.x, start.y, end.x, end.y, grid, mapData);
                }
            });
        });
    }

    private createCorridor(c1: Container, c2: Container, grid: number[][], mapData: MapData) {
        this.carvePath(c1.center.x, c1.center.y, c2.center.x, c2.center.y, grid, mapData);
    }

    private carvePath(x1: number, y1: number, x2: number, y2: number, grid: number[][], mapData: MapData) {
        let x = x1;
        let y = y1;
        
        // 2-Tile Wide Brush
        const dig = () => {
            for(let dy=0; dy<2; dy++) {
                for(let dx=0; dx<2; dx++) {
                    const nx = x + dx;
                    const ny = y + dy;
                    if (this.isValid(nx, ny, grid)) {
                        if (grid[ny][nx] !== 0) { // Jika bukan floor, jadikan floor
                            grid[ny][nx] = 0;
                            mapData.tiles.push({
                                x: nx, y: ny, sprite: 'floor_common', layer: 'floor'
                            });
                        }
                    }
                }
            }
        };

        // L-Shape Path
        while(x !== x2) {
            x += (x < x2) ? 1 : -1;
            dig();
        }
        while(y !== y2) {
            y += (y < y2) ? 1 : -1;
            dig();
        }
    }

    // ==========================================
    // TAHAP 5 & 6: WALLS & FURNITURE
    // ==========================================

    private generateSmartWalls(mapData: MapData, grid: number[][], w: number, h: number) {
        for(let y=0; y<h; y++) {
            for(let x=0; x<w; x++) {
                if (grid[y][x] !== 0) { // Potential Wall
                    // Cek tetangga, jika ada floor (0), maka ini tembok
                    let isEdge = false;
                    const nbs = [[0,1], [0,-1], [1,0], [-1,0], [1,1], [1,-1], [-1,1], [-1,-1]];
                    for(const [dx, dy] of nbs) {
                        const nx = x+dx;
                        const ny = y+dy;
                        if (this.isValid(nx, ny, grid) && grid[ny][nx] === 0) {
                            isEdge = true;
                            break;
                        }
                    }

                    if (isEdge) {
                        mapData.tiles.push({ x, y, sprite: 'wall_brick', layer: 'wall' });
                    }
                }
            }
        }
    }

    private furnishRooms(mapData: MapData, config: MapConfig, grid: number[][]) {
        // Reuse constraint solver
        mapData.rooms.forEach(room => {
            // Find real dimensions based on mapData tiles? 
            // Or use the registered room rect (which might be slightly off due to corridors).
            // Let's rely on the Solver scanning the grid area.
            
            // Map room id back to config to get furniture list
            const cfg = config.rooms.find(r => r.id === room.id);
            if (cfg) {
                let items = cfg.furniture || [];
                if (items.length === 0) items = ['table'];
                
                // Pass room bounds we saved earlier
                ConstraintSolver.placeItems(room, items, mapData, grid, 0);
            }
        });
    }

    // --- Helpers ---

    private isValid(x: number, y: number, grid: number[][]) {
        return y >= 0 && y < grid.length && x >= 0 && x < grid[0].length;
    }

    private getRoomWeight(type: string): number {
        const t = type.toLowerCase();
        if (t.includes('living') || t.includes('hall')) return 10;
        if (t.includes('master') || t.includes('garage') || t.includes('kitchen')) return 8;
        return 5;
    }

    private getFloorSprite(type: string): string {
        const t = type.toLowerCase();
        if (t.includes('garage') || t.includes('exterior')) return 'floor_exterior';
        if (t.includes('kitchen')) return 'floor_kitchen';
        if (t.includes('bath')) return 'floor_bathroom';
        return 'floor_common';
    }
}