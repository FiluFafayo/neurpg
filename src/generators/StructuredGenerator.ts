import { MapConfig, RoomConfig } from '../types/MapConfig';
import { MapData } from '../types/MapData';
import { IMapGenerator } from './MapGenerators';
import { ConstraintSolver } from './ConstraintSolver';

// Tipe Zona yang lebih kaku
type ZoneType = 'service' | 'public' | 'private' | 'exterior';

// Container dengan linkage parent-child untuk partitioning
class Container {
    x: number;
    y: number;
    width: number;
    height: number;
    room: RoomConfig | null = null;
    type: ZoneType | null = null; // Label zona untuk debugging

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
    
    private readonly WALL = 1;
    private readonly FLOOR = 0;
    private readonly MIN_ROOM_DIM = 4; // Minimal lebar ruangan (tiles)

    generate(config: MapConfig): MapData {
        console.log(`[StructuredGenerator] Starting Phase 3.5: Dictator Architect...`);
        
        const mapData: MapData = {
            width: config.width,
            height: config.height,
            tiles: [],
            rooms: []
        };

        // 1. Init Grid (Full Wall)
        const grid: number[][] = Array(config.height).fill(0).map(() => Array(config.width).fill(this.WALL));

        // 2. Klasifikasi Ruangan (Zoning)
        const zones = this.classifyRooms(config.rooms);

        // 3. Alokasi Lahan (Dictator Partitioning)
        // Kita bagi peta menjadi 3-4 Zona Besar (Container) berdasarkan Template
        const zoneContainers = this.allocateLand(config.width, config.height, config.description);

        // 4. Masukkan Ruangan ke Zona (Filling)
        // Service Rooms -> Service Container, dst.
        const allLeaves: Container[] = [];

        // Proses setiap zona
        this.processZone(zoneContainers.service, zones.service, allLeaves);
        this.processZone(zoneContainers.public, zones.public, allLeaves);
        this.processZone(zoneContainers.private, zones.private, allLeaves);
        
        // Zona Exterior (Garasi) diproses khusus (biasanya tidak di-split, cuma ditempel)
        if (zones.exterior.length > 0 && zoneContainers.exterior) {
            // Exterior biasanya carport, biarkan utuh atau split minimal
            this.processZone(zoneContainers.exterior, zones.exterior, allLeaves);
        }

        // 5. Render Lantai (Anti-Double Wall Logic)
        allLeaves.forEach(leaf => {
            if (!leaf.room) return;

            // Logika Tembok Sharing:
            // Container x=0, w=10 (Area 0-10).
            // Container x=10, w=10 (Area 10-20).
            // Garis 10 adalah perbatasan.
            // Lantai A: 1..9. Lantai B: 11..19.
            // Dinding di 0, 10, 20.
            // Jadi offset lantai adalah x+1 sampai x+w-1.
            
            const startX = leaf.x + 1;
            const startY = leaf.y + 1;
            const endX = leaf.x + leaf.width - 1; // Eksklusif dinding kanan
            const endY = leaf.y + leaf.height - 1; // Eksklusif dinding bawah

            // Register Room
            mapData.rooms.push({
                id: leaf.room.id,
                name: leaf.room.name,
                type: leaf.room.type,
                x: startX, y: startY, width: endX - startX, height: endY - startY
            });

            // Carve Floor
            for (let y = startY; y < endY; y++) {
                for (let x = startX; x < endX; x++) {
                    if (y >= 0 && y < config.height && x >= 0 && x < config.width) {
                        grid[y][x] = this.FLOOR;
                        mapData.tiles.push({
                            x, y,
                            sprite: this.getFloorSprite(leaf.room.type),
                            layer: 'floor'
                        });
                    }
                }
            }
        });

        // 6. Hubungkan Ruangan (Connectivity)
        this.connectRooms(allLeaves, grid, mapData);

        // 7. Generate Dinding Fisik
        this.generateWalls(grid, mapData);

        // 8. Furnishing
        this.furnishRooms(mapData, config, grid);

        return mapData;
    }

    // ==========================================
    // DICTATOR LOGIC: ZONING & ALLOCATION
    // ==========================================

    private classifyRooms(rooms: RoomConfig[]) {
        const buckets = {
            service: [] as RoomConfig[],
            public: [] as RoomConfig[],
            private: [] as RoomConfig[],
            exterior: [] as RoomConfig[]
        };

        rooms.forEach(r => {
            const t = r.type.toLowerCase();
            const n = r.name.toLowerCase();
            
            if (t.includes('garage') || t.includes('carport') || t.includes('garden') || n.includes('terrace')) {
                buckets.exterior.push(r);
            } else if (t.includes('kitchen') || t.includes('bath') && n.includes('shared') || t.includes('utility') || t.includes('laundry')) {
                buckets.service.push(r);
            } else if (t.includes('bed') || t.includes('bath') && n.includes('master') || t.includes('study')) {
                buckets.private.push(r);
            } else {
                // Living, Dining, Foyer, Hall
                buckets.public.push(r);
            }
        });

        return buckets;
    }

    private allocateLand(mapW: number, mapH: number, desc: string) {
        // Tentukan Template Layout berdasarkan deskripsi atau default
        const d = desc.toLowerCase();
        
        // Kita pakai margin agar rumah ada di tengah
        const margin = 2;
        const buildW = mapW - (margin * 2);
        const buildH = mapH - (margin * 2);
        const x0 = margin;
        const y0 = margin;

        // Default: Layout Kotak Terbagi 3
        // [ PRIVATE (Top) ]
        // [ PUBLIC (Mid)  ]
        // [ SERVICE (Bot) ]
        
        // Rasio Dektator
        const hPrivate = Math.floor(buildH * 0.4);
        const hPublic = Math.floor(buildH * 0.35);
        const hService = buildH - hPrivate - hPublic;

        const zones = {
            private: new Container(x0, y0, buildW, hPrivate),
            public: new Container(x0, y0 + hPrivate, buildW, hPublic),
            service: new Container(x0, y0 + hPrivate + hPublic, buildW, hService),
            exterior: null as Container | null
        };
        
        zones.private.type = 'private';
        zones.public.type = 'public';
        zones.service.type = 'service';

        // Override: L-Shape Layout (Jika diminta)
        if (d.includes('l-shape') || d.includes('l shape')) {
            // [ PRIVATE (Left) ] [      VOID      ]
            // [ PRIVATE (Left) ] [ PUBLIC (Right) ]
            // [ SERVICE (Left) ] [ PUBLIC (Right) ]
            
            const wLeft = Math.floor(buildW * 0.5);
            const wRight = buildW - wLeft;
            
            // Private di sayap kiri penuh
            zones.private = new Container(x0, y0, wLeft, Math.floor(buildH * 0.6));
            // Service di bawah Private
            zones.service = new Container(x0, y0 + zones.private.height, wLeft, buildH - zones.private.height);
            // Public di sayap kanan bawah (L-Shape kaki)
            zones.public = new Container(x0 + wLeft, y0 + Math.floor(buildH * 0.4), wRight, Math.floor(buildH * 0.6));
        }

        // Exterior (Garasi) logic: Tempel di sebelah Service atau Public (Bawah/Samping)
        // Kita ambil "cuilan" dari Service atau bikin di luar border kalau muat
        // Sederhananya: Ambil pojok kanan bawah Service Zone buat Garasi
        const garageW = Math.floor(zones.service.width * 0.4);
        const garageH = zones.service.height; // Full height of service strip
        
        // Potong service zone buat exterior
        if (garageW > 4) {
            zones.exterior = new Container(
                zones.service.x + zones.service.width - garageW,
                zones.service.y,
                garageW,
                garageH
            );
            // Shrink service zone
            zones.service.width -= garageW;
        }

        return zones;
    }

    // ==========================================
    // DICTATOR LOGIC: SUBDIVISION (BSP)
    // ==========================================

    private processZone(container: Container, rooms: RoomConfig[], allLeaves: Container[]) {
        if (!container || rooms.length === 0) return;

        // 1. Urutkan ruangan: Penting duluan (Master Bed > Kids Bed)
        // Biar Master Bed dapat potongan pertama (biasanya lebih besar)
        rooms.sort((a, b) => this.getRoomWeight(b.type) - this.getRoomWeight(a.type));

        // 2. Recursive Split
        const leaves: Container[] = [];
        this.bspSplit(container, rooms.length, leaves);

        // 3. Assign
        // Pastikan jumlah leaf >= jumlah room. Kalau kurang, ada room yg gak kebagian (digabung).
        rooms.forEach((room, i) => {
            if (i < leaves.length) {
                leaves[i].room = room;
                allLeaves.push(leaves[i]);
            } else {
                console.warn(`[Architect] Room ${room.name} skipped (No Space)`);
            }
        });
    }

    private bspSplit(c: Container, targetCount: number, results: Container[]) {
        // Basis rekursi: Jika target 1, atau container terlalu kecil
        if (targetCount <= 1 || c.width < this.MIN_ROOM_DIM * 2 || c.height < this.MIN_ROOM_DIM * 2) {
            results.push(c);
            return;
        }

        // Tentukan arah potong
        // Kalau lebar > tinggi, potong vertikal (biar jadi kotak)
        let splitH = c.height > c.width;
        
        // Ratio check: Jangan bikin lorong tikus
        if (c.width / c.height > 1.5) splitH = false; // Wide -> Vertical split
        else if (c.height / c.width > 1.5) splitH = true; // Tall -> Horizontal split

        // Tentukan titik potong (sekitar 40-60%)
        const ratio = 0.4 + (Math.random() * 0.2);
        
        let c1: Container, c2: Container;
        // Distribusi target count ke anak-anaknya
        const halfCount = Math.ceil(targetCount / 2);
        const remCount = targetCount - halfCount;

        if (splitH) {
            const h1 = Math.floor(c.height * ratio);
            // Shared edge: y + h1. Container 1 ends at h1. Container 2 starts at h1.
            c1 = new Container(c.x, c.y, c.width, h1);
            c2 = new Container(c.x, c.y + h1, c.width, c.height - h1);
        } else {
            const w1 = Math.floor(c.width * ratio);
            c1 = new Container(c.x, c.y, w1, c.height);
            c2 = new Container(c.x + w1, c.y, c.width - w1, c.height);
        }

        this.bspSplit(c1, halfCount, results);
        this.bspSplit(c2, remCount, results);
    }

    // ==========================================
    // UTILS & HELPERS
    // ==========================================

    private connectRooms(leaves: Container[], grid: number[][], mapData: MapData) {
        // Hubungkan ruangan sesuai 'connections' di JSON
        // Gunakan Pathfinding sederhana (Manhattan) dengan brush 2-tile
        
        const dig = (x: number, y: number) => {
            for(let dy=0; dy<2; dy++) for(let dx=0; dx<2; dx++) {
                if(y+dy < grid.length && x+dx < grid[0].length) {
                    if(grid[y+dy][x+dx] === this.WALL) {
                        grid[y+dy][x+dx] = this.FLOOR;
                        mapData.tiles.push({ x: x+dx, y: y+dy, sprite: 'floor_common', layer: 'floor' });
                    }
                }
            }
        };

        leaves.forEach(leaf => {
            if (!leaf.room) return;
            leaf.room.connections.forEach(targetId => {
                const target = leaves.find(l => l.room && l.room.id === targetId);
                if (target) {
                    // Jalan dari center ke center
                    let cx = leaf.center.x;
                    let cy = leaf.center.y;
                    const tx = target.center.x;
                    const ty = target.center.y;

                    // L-Shape Path
                    while(cx !== tx) {
                        cx += (cx < tx) ? 1 : -1;
                        dig(cx, cy);
                    }
                    while(cy !== ty) {
                        cy += (cy < ty) ? 1 : -1;
                        dig(cx, cy);
                    }
                }
            });
        });
    }

    private generateWalls(grid: number[][], mapData: MapData) {
        const h = grid.length;
        const w = grid[0].length;
        for(let y=0; y<h; y++) {
            for(let x=0; x<w; x++) {
                if(grid[y][x] === this.WALL) {
                    // Cek 8 arah, kalau ada floor, ini tembok facade
                    let isEdge = false;
                    for(let dy=-1; dy<=1; dy++) {
                        for(let dx=-1; dx<=1; dx++) {
                            if(dy===0 && dx===0) continue;
                            const ny = y+dy;
                            const nx = x+dx;
                            if(ny>=0 && ny<h && nx>=0 && nx<w && grid[ny][nx] === this.FLOOR) {
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

    private getRoomWeight(type: string): number {
        const t = type.toLowerCase();
        if (t.includes('living') || t.includes('lounge')) return 10;
        if (t.includes('master')) return 9;
        if (t.includes('kitchen') || t.includes('dining')) return 8;
        if (t.includes('garage')) return 7;
        return 5;
    }

    private getFloorSprite(type: string): string {
        const t = type.toLowerCase();
        if (t.includes('garage') || t.includes('exterior')) return 'floor_exterior';
        if (t.includes('kitchen')) return 'floor_kitchen';
        if (t.includes('bath') || t.includes('wc')) return 'floor_bathroom';
        if (t.includes('living') || t.includes('dining')) return 'floor_common';
        return 'floor_common';
    }
}