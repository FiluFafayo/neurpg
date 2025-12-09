// File: src/generators/StructuredGenerator.ts
import { MapConfig } from '../types/MapConfig';
import { MapData } from '../types/MapData';
import { IMapGenerator } from './MapGenerators';
import { ConstraintSolver } from './ConstraintSolver';

class Container {
    x: number;
    y: number;
    width: number;
    height: number;
    center: { x: number, y: number };
    room: any | null = null; // Config room assigned here

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
    
    // Configurable constraints
    private minRoomSize = 6; 
    private mapPadding = 2;

    generate(config: MapConfig): MapData {
        console.log(`[StructuredGenerator] Building Layout (BSP Subdivision)...`);
        
        const mapData: MapData = {
            width: config.width,
            height: config.height,
            tiles: [],
            rooms: []
        };

        // 1. Init Grid (1 = Wall/Void)
        const grid: number[][] = Array(config.height).fill(0).map(() => Array(config.width).fill(1));

        // 2. Create Root Container (The "Lot")
        // Use roughly 80% of the map to leave borders
        const rootW = config.width - (this.mapPadding * 2);
        const rootH = config.height - (this.mapPadding * 2);
        const root = new Container(this.mapPadding, this.mapPadding, rootW, rootH);

        // 3. BSP Split until we have enough leaves for the rooms
        const leaves: Container[] = [root];
        const targetRoomCount = config.rooms.length;

        // Safety break
        let iterations = 0;
        while (leaves.length < targetRoomCount && iterations < 1000) {
            iterations++;
            
            // Find a leaf to split (preferably the largest one)
            // Sort by area desc
            leaves.sort((a, b) => (b.width * b.height) - (a.width * a.height));
            
            const candidate = leaves.shift();
            if (!candidate) break;

            // Split it
            const split = this.splitContainer(candidate);
            if (split) {
                leaves.push(split[0], split[1]);
            } else {
                // If cannot split, put it back (it's final)
                leaves.push(candidate);
                // Move it to 'finished' list ideally, but sorting handles priority
                // If the largest cannot split, we might be stuck. 
                // Shuffle slightly to try others? For now, break to avoid inf loop if full.
                if (leaves.every(l => !this.canSplit(l))) break;
            }
        }

        // 4. Assign Rooms to Leaves
        // Strategy: Match room type "Main" or "Living" to largest containers
        leaves.sort((a, b) => (b.width * b.height) - (a.width * a.height)); // Largest first
        
        // Sort config rooms by priority/size heuristic
        const sortedRooms = [...config.rooms].sort((a, b) => {
            const scoreA = this.getRoomScore(a.type);
            const scoreB = this.getRoomScore(b.type);
            return scoreB - scoreA;
        });

        const placedContainers: Container[] = [];

        sortedRooms.forEach((roomConfig, index) => {
            if (index < leaves.length) {
                const container = leaves[index];
                container.room = roomConfig;
                placedContainers.push(container);

                // Register in MapData
                // Shrink slightly to create walls (Padding inside the container)
                const wallThickness = 1; 
                const finalX = container.x + wallThickness;
                const finalY = container.y + wallThickness;
                const finalW = container.width - (wallThickness * 2);
                const finalH = container.height - (wallThickness * 2);

                if (finalW > 2 && finalH > 2) {
                    mapData.rooms.push({
                        id: roomConfig.id,
                        name: roomConfig.name,
                        x: finalX, y: finalY, width: finalW, height: finalH,
                        type: roomConfig.type
                    });

                    // Carve Floor
                    for (let y = finalY; y < finalY + finalH; y++) {
                        for (let x = finalX; x < finalX + finalW; x++) {
                            if (y < config.height && x < config.width) {
                                grid[y][x] = 0; // Floor
                                mapData.tiles.push({
                                    x, y,
                                    sprite: 'floor_common', // Will be refined by AssetMapper
                                    layer: 'floor'
                                });
                            }
                        }
                    }
                }
            }
        });

        // 5. Connect Rooms (Corridors/Doors)
        // Simple MST or just connect centers of siblings
        // For BSP, we can connect leaf to its sibling in the tree. 
        // But since we flattened the list, let's just connect geometrically close rooms.
        // Or connect based on the "connections" in JSON config!
        
        placedContainers.forEach(container => {
            if (!container.room) return;
            const connections = container.room.connections || [];
            
            connections.forEach((targetId: string) => {
                const target = placedContainers.find(c => c.room && c.room.id === targetId);
                if (target) {
                    this.createCorridor(container, target, grid, mapData);
                }
            });
        });

        // 6. Generate Walls
        // Iterate grid, if tile is 1 and neighbor is 0, it's a wall.
        for (let y = 0; y < config.height; y++) {
            for (let x = 0; x < config.width; x++) {
                if (grid[y][x] === 1) { // Potential Wall
                    if (this.hasFloorNeighbor(grid, x, y)) {
                        mapData.tiles.push({
                            x, y,
                            sprite: 'wall_brick',
                            layer: 'wall'
                        });
                    }
                }
            }
        }

        // 7. Place Furniture
        mapData.rooms.forEach(room => {
            const roomConfig = config.rooms.find(c => c.id === room.id);
            let items = roomConfig ? [...roomConfig.furniture] : [];
            if (items.length === 0) items = ['table', 'chair']; // Fallback
            
            ConstraintSolver.placeItems(room, items, mapData, grid, 0);
        });

        return mapData;
    }

    private canSplit(c: Container): boolean {
        return c.width >= this.minRoomSize * 2 || c.height >= this.minRoomSize * 2;
    }

    private splitContainer(c: Container): [Container, Container] | null {
        if (!this.canSplit(c)) return null;

        let splitH = Math.random() > 0.5;
        if (c.width > c.height && c.width / c.height >= 1.25) splitH = false; // Split Vertically if wide
        else if (c.height > c.width && c.height / c.width >= 1.25) splitH = true; // Split Horizontally if tall

        const max = (splitH ? c.height : c.width) - this.minRoomSize;
        if (max < this.minRoomSize) return null; // Cannot split safely

        const splitAt = Math.floor(Math.random() * (max - this.minRoomSize + 1)) + this.minRoomSize;

        if (splitH) {
            // Horizontal Split (Top / Bottom)
            const c1 = new Container(c.x, c.y, c.width, splitAt);
            const c2 = new Container(c.x, c.y + splitAt, c.width, c.height - splitAt);
            return [c1, c2];
        } else {
            // Vertical Split (Left / Right)
            const c1 = new Container(c.x, c.y, splitAt, c.height);
            const c2 = new Container(c.x + splitAt, c.y, c.width - splitAt, c.height);
            return [c1, c2];
        }
    }

    private getRoomScore(type: string): number {
        const t = type.toLowerCase();
        if (t.includes('living') || t.includes('main') || t.includes('hall')) return 10;
        if (t.includes('bed') || t.includes('kitchen') || t.includes('dining')) return 5;
        return 1;
    }

    private createCorridor(c1: Container, c2: Container, grid: number[][], mapData: MapData) {
        // Draw L-shaped path between centers
        let x = c1.center.x;
        let y = c1.center.y;
        const targetX = c2.center.x;
        const targetY = c2.center.y;

        while (x !== targetX) {
            x += (x < targetX) ? 1 : -1;
            this.carveTunnel(x, y, grid, mapData);
        }
        while (y !== targetY) {
            y += (y < targetY) ? 1 : -1;
            this.carveTunnel(x, y, grid, mapData);
        }
    }

    private carveTunnel(x: number, y: number, grid: number[][], mapData: MapData) {
        // Ensure bounds
        if (y >= 0 && y < grid.length && x >= 0 && x < grid[0].length) {
            // If it's already floor, ignore
            // If it's wall, make it floor (door/corridor)
            if (grid[y][x] === 1) {
                grid[y][x] = 0;
                // Add floor tile
                mapData.tiles.push({
                    x, y,
                    sprite: 'floor_common',
                    layer: 'floor'
                });
                
                // If this point was a wall, it becomes a "Door" conceptually
                // We can add a door frame logic later, or just open floor for now.
                // To adhere to "2-tile wide door" request:
                // We could carve neighbors too.
                // Let's carve width 2 for corridors?
                // For simplicity Phase 0: 1 tile wide path is enough to prove structure connectivity.
            }
        }
    }

    private hasFloorNeighbor(grid: number[][], x: number, y: number): boolean {
        const neighbors = [[0,1], [0,-1], [1,0], [-1,0]];
        for (const [dx, dy] of neighbors) {
            const nx = x + dx;
            const ny = y + dy;
            if (ny >= 0 && ny < grid.length && nx >= 0 && nx < grid[0].length) {
                if (grid[ny][nx] === 0) return true;
            }
        }
        return false;
    }
}