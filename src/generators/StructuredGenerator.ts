import { MapConfig, RoomConfig } from '../types/MapConfig';
import { MapData } from '../types/MapData';
import { IMapGenerator } from './MapGenerators';
import { ConstraintSolver } from './ConstraintSolver';

// Container untuk BSP
class Container {
    x: number;
    y: number;
    width: number;
    height: number;
    center: { x: number, y: number };
    room: RoomConfig | null = null;
    isVoid: boolean = false; // Jika true, area ini dilarang dibangun (untuk L-Shape dll)

    constructor(x: number, y: number, w: number, h: number) {
        this.x = x;
        this.y = y;
        this.width = w;
        this.height = h;
        this.center = {
            x: Math.floor(x + w / 2),
            y: Math.floor(y + h / 2)
        };
    }
}

export class StructuredGenerator implements IMapGenerator {
    
    private minRoomSize = 5; 
    private mapPadding = 4; // Padding lebih besar biar rumah di tengah

    generate(config: MapConfig): MapData {
        console.log(`[StructuredGenerator] Building Layout (Smart Graph BSP)...`);
        
        const mapData: MapData = {
            width: config.width,
            height: config.height,
            tiles: [],
            rooms: []
        };

        // 1. Init Grid (1 = Wall/Void, 0 = Floor, 9 = BANNED ZONE)
        const grid: number[][] = Array(config.height).fill(0).map(() => Array(config.width).fill(1));

        // 2. Hull Masking (Membentuk L-Shape, U-Shape, dll)
        this.applyHullMask(grid, config);

        // 3. Create Root Container
        const rootW = config.width - (this.mapPadding * 2);
        const rootH = config.height - (this.mapPadding * 2);
        const root = new Container(this.mapPadding, this.mapPadding, rootW, rootH);

        // 4. BSP Split (With Overlap for Shared Walls)
        const leaves: Container[] = [root];
        const targetRoomCount = config.rooms.length + 2; // Extra leaves for flexibility
        let iterations = 0;

        while (leaves.length < targetRoomCount && iterations < 1000) {
            iterations++;
            // Split yang paling besar dulu
            leaves.sort((a, b) => (b.width * b.height) - (a.width * a.height));
            const candidate = leaves.shift();
            if (!candidate) break;

            const split = this.splitContainer(candidate);
            if (split) {
                leaves.push(split[0], split[1]);
            } else {
                leaves.push(candidate); // Gagal split, kembalikan
                // Kalau semua daun sudah mentok, berhenti
                if (leaves.every(l => !this.canSplit(l))) break;
            }
        }

        // Filter daun yang kena area BANNED (Masking)
        const validLeaves = leaves.filter(leaf => {
            // Cek titik tengah leaf, apakah kena BANNED ZONE (9)
            if (leaf.center.y < grid.length && leaf.center.x < grid[0].length) {
                return grid[leaf.center.y][leaf.center.x] !== 9;
            }
            return false;
        });

        // 5. Smart Room Assignment (Graph-Based BFS)
        this.assignRoomsToLeaves(config.rooms, validLeaves, config.width, config.height);

        // 6. Rasterize Rooms (Render ke Grid)
        const placedContainers = validLeaves.filter(c => c.room !== null);
        
        placedContainers.forEach(container => {
            if (!container.room) return;

            // Shrink sedikit untuk tembok
            // KUNCI FIX SHARED WALL: Kita overlap container 1 tile, tapi shrink floor 1 tile.
            // Hasilnya tembok setebal 1 tile pas di perbatasan.
            const startX = container.x + 1;
            const startY = container.y + 1;
            const endX = container.x + container.width - 1;
            const endY = container.y + container.height - 1;

            if (endX - startX > 1 && endY - startY > 1) {
                // Register Room
                mapData.rooms.push({
                    id: container.room.id,
                    name: container.room.name,
                    x: startX, y: startY, 
                    width: endX - startX, 
                    height: endY - startY,
                    type: container.room.type
                });

                // Carve Floor
                for (let y = startY; y < endY; y++) {
                    for (let x = startX; x < endX; x++) {
                        if (y < config.height && x < config.width) {
                            grid[y][x] = 0; // Floor
                            mapData.tiles.push({
                                x, y,
                                sprite: this.getFloorSprite(container.room.type),
                                layer: 'floor'
                            });
                        }
                    }
                }
            }
        });

        // 7. Connect Rooms (Corridors - 2 Tile Wide)
        const corridorWidth = 2;
        const dig = (px: number, py: number) => {
            for (let dy = 0; dy < corridorWidth; dy++) {
                for (let dx = 0; dx < corridorWidth; dx++) {
                    const nx = px + dx;
                    const ny = py + dy;
                    if (ny >= 0 && ny < grid.length && nx >= 0 && nx < grid[0].length) {
                        if (grid[ny][nx] !== 0) { // Only carve if not already floor
                            grid[ny][nx] = 0;
                            mapData.tiles.push({ x: nx, y: ny, sprite: 'floor_common', layer: 'floor' });
                        }
                    }
                }
            }
        };

        // Hubungkan berdasarkan Graph Connections asli
        placedContainers.forEach(container => {
            if (!container.room) return;
            const connections = container.room.connections || [];
            
            connections.forEach((targetId: string) => {
                const target = placedContainers.find(c => c.room && c.room.id === targetId);
                if (target) {
                    // Jalan L-Shape dari Center ke Center
                    let x = container.center.x;
                    let y = container.center.y;
                    const tx = target.center.x;
                    const ty = target.center.y;
                    
                    // Simple pathfinding: X dulu lalu Y (atau sebaliknya random biar variatif)
                    if (Math.random() > 0.5) {
                        while (x !== tx) { x += (x < tx) ? 1 : -1; dig(x, y); }
                        while (y !== ty) { y += (y < ty) ? 1 : -1; dig(x, y); }
                    } else {
                        while (y !== ty) { y += (y < ty) ? 1 : -1; dig(x, y); }
                        while (x !== tx) { x += (x < tx) ? 1 : -1; dig(x, y); }
                    }
                }
            });
        });

        // 8. Generate Walls (Smart Bitmask Logic)
        for (let y = 0; y < config.height; y++) {
            for (let x = 0; x < config.width; x++) {
                // Render wall jika grid[y][x] adalah Wall/Void (1 atau 9) 
                // TAPI bersebelahan dengan Floor (0)
                if (grid[y][x] !== 0) { 
                    let isEdge = false;
                    const neighbors = [[0,1], [0,-1], [1,0], [-1,0]];
                    for (const [dx, dy] of neighbors) {
                        const nx = x + dx; const ny = y + dy;
                        if (nx >= 0 && nx < config.width && ny >= 0 && ny < config.height) {
                            if (grid[ny][nx] === 0) { isEdge = true; break; }
                        }
                    }
                    if (isEdge) {
                        mapData.tiles.push({ x, y, sprite: 'wall_brick', layer: 'wall' });
                    }
                }
            }
        }

        // 9. Place Furniture
        mapData.rooms.forEach(room => {
            const roomConfig = config.rooms.find(c => c.id === room.id);
            let items = roomConfig ? [...roomConfig.furniture] : [];
            if (items.length === 0) items = ['table', 'chair'];
            ConstraintSolver.placeItems(room, items, mapData, grid, 0);
        });

        return mapData;
    }

    // --- LOGIC BARU: Shape Masking ---
    private applyHullMask(grid: number[][], config: MapConfig) {
        const desc = config.description.toLowerCase();
        const h = grid.length;
        const w = grid[0].length;

        // Reset all to 1 (Wall)
        for(let y=0; y<h; y++) for(let x=0; x<w; x++) grid[y][x] = 1;

        // Default: Kotak penuh (No Mask)
        
        // Logika L-Shape: Potong Kuadran Kanan Atas (atau acak)
        if (desc.includes('l-shape') || desc.includes('l shape')) {
            console.log("Applying L-Shape Mask");
            // Cut out top-right quadrant (make it 9)
            const halfW = Math.floor(w/2);
            const halfH = Math.floor(h/2);
            for (let y = 0; y < halfH; y++) {
                for (let x = halfW; x < w; x++) {
                    grid[y][x] = 9; // BANNED
                }
            }
        }
        
        // Logika U-Shape: Potong Tengah Atas
        if (desc.includes('u-shape') || desc.includes('courtyard')) {
            console.log("Applying U-Shape Mask");
            const thirdW = Math.floor(w/3);
            const halfH = Math.floor(h/2);
            for (let y = 0; y < halfH; y++) {
                for (let x = thirdW; x < w - thirdW; x++) {
                    grid[y][x] = 9; // BANNED
                }
            }
        }
    }

    // --- LOGIC BARU: Graph-Based Assignment ---
    private assignRoomsToLeaves(rooms: RoomConfig[], leaves: Container[], mapW: number, mapH: number) {
        // 1. Identifikasi Ruang Utama (Entrance/Foyer/Living)
        // Cari yang namanya 'entrance', 'foyer', atau 'carport'
        let startNode = rooms.find(r => r.type.includes('entrance') || r.name.toLowerCase().includes('foyer'));
        if (!startNode) startNode = rooms[0];

        const placedRoomIds = new Set<string>();
        const queue: RoomConfig[] = [startNode];
        placedRoomIds.add(startNode.id);

        // Map Room -> Leaf
        // Strategy: 
        // - Entrance/Carport wajib di pinggir (Constraint)
        // - Ruang lain nempel ke parentnya

        while (queue.length > 0) {
            const currentRoom = queue.shift()!;
            
            // Cari leaf terbaik buat room ini
            let bestLeafIndex = -1;
            let bestScore = -999999;

            // Constraint: Carport/Garage harus di tepi bawah/samping
            const isExterior = currentRoom.type.includes('garage') || currentRoom.type.includes('carport') || currentRoom.type.includes('entrance');

            for (let i = 0; i < leaves.length; i++) {
                const leaf = leaves[i];
                if (leaf.room) continue; // Sudah terpakai

                let score = 0;

                // 1. Preferensi Ukuran
                const roomSize = this.getRoomScore(currentRoom.type);
                const leafSize = (leaf.width * leaf.height) / 10; // Normalize
                // Match size: small room to small leaf
                score -= Math.abs(roomSize - leafSize);

                // 2. Constraint Exterior
                if (isExterior) {
                    const distToEdge = Math.min(leaf.x, leaf.y, mapW - (leaf.x + leaf.width), mapH - (leaf.y + leaf.height));
                    score -= distToEdge * 10; // Semakin dekat tepi, semakin bagus
                }

                // 3. Proximity to Connections (GRAVITASI)
                // Cari tetangga yang SUDAH ditempatkan
                const neighbors = currentRoom.connections || [];
                let hasPlacedNeighbor = false;
                for (const nbId of neighbors) {
                    const nbLeaf = leaves.find(l => l.room && l.room.id === nbId);
                    if (nbLeaf) {
                        hasPlacedNeighbor = true;
                        const dist = Math.abs(leaf.center.x - nbLeaf.center.x) + Math.abs(leaf.center.y - nbLeaf.center.y);
                        score -= dist * 2; // Tarik mendekat
                    }
                }

                // Jika ini bukan node pertama dan punya tetangga, tapi tetangganya belum ada yang ditempatkan?
                // (Kasus queue awal). Tidak masalah, nanti akan ditarik oleh yang lain.
                
                if (score > bestScore) {
                    bestScore = score;
                    bestLeafIndex = i;
                }
            }

            if (bestLeafIndex !== -1) {
                leaves[bestLeafIndex].room = currentRoom;
                
                // Add unvisited neighbors to queue
                const neighbors = currentRoom.connections || [];
                for (const nbId of neighbors) {
                    if (!placedRoomIds.has(nbId)) {
                        const nbRoom = rooms.find(r => r.id === nbId);
                        if (nbRoom) {
                            placedRoomIds.add(nbId);
                            queue.push(nbRoom);
                        }
                    }
                }
            }
        }

        // Fallback: Jika ada room yang terputus dari graph / belum ditempatkan
        const unplaced = rooms.filter(r => !placedRoomIds.has(r.id));
        unplaced.forEach(r => {
            const emptyLeaf = leaves.find(l => !l.room);
            if (emptyLeaf) emptyLeaf.room = r;
        });
    }

    private canSplit(c: Container): boolean {
        return c.width >= this.minRoomSize * 2 || c.height >= this.minRoomSize * 2;
    }

    private splitContainer(c: Container): [Container, Container] | null {
        if (!this.canSplit(c)) return null;
        let splitH = Math.random() > 0.5;
        if (c.width > c.height && c.width / c.height >= 1.25) splitH = false;
        else if (c.height > c.width && c.height / c.width >= 1.25) splitH = true;

        const max = (splitH ? c.height : c.width) - this.minRoomSize;
        if (max < this.minRoomSize) return null;

        const splitAt = Math.floor(Math.random() * (max - this.minRoomSize + 1)) + this.minRoomSize;

        // OVERLAP FIX: Container kedua mundur 1 langkah (overlap border)
        // Container 1: 0 sampai splitAt
        // Container 2: splitAt - 1 sampai end
        // Hasilnya garis splitAt menjadi milik bersama
        
        if (splitH) {
            return [
                new Container(c.x, c.y, c.width, splitAt), 
                new Container(c.x, c.y + splitAt - 1, c.width, c.height - splitAt + 1)
            ];
        } else {
            return [
                new Container(c.x, c.y, splitAt, c.height), 
                new Container(c.x + splitAt - 1, c.y, c.width - splitAt + 1, c.height)
            ];
        }
    }

    private getRoomScore(type: string): number {
        const t = type.toLowerCase();
        if (t.includes('living') || t.includes('main') || t.includes('hall')) return 120; // Big
        if (t.includes('bed') || t.includes('kitchen') || t.includes('dining') || t.includes('garage')) return 80; // Medium
        return 30; // Small (Bath/Pantry)
    }

    private getFloorSprite(type: string): string {
        const t = type.toLowerCase();
        if (t.includes('exterior') || t.includes('carport') || t.includes('courtyard')) return 'floor_exterior';
        if (t.includes('bath') || t.includes('wc')) return 'floor_bathroom';
        if (t.includes('kitchen')) return 'floor_kitchen';
        return 'floor_common';
    }
}