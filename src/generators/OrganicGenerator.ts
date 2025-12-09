import { MapConfig } from '../types/MapConfig';
import { MapData } from '../types/MapData';
import { IMapGenerator } from './MapGenerators';
import { ConstraintSolver } from './ConstraintSolver';

export class OrganicGenerator implements IMapGenerator {
    generate(config: MapConfig): MapData {
        console.log(`[OrganicGenerator] Growing Cellular Automata...`);
        
        const width = config.width;
        const height = config.height;
        const mapData: MapData = {
            width,
            height,
            tiles: [],
            rooms: []
        };

        // 1. Initialize Random Grid (45% alive)
        let grid: number[][] = Array(height).fill(0).map(() => Array(width).fill(0).map(() => Math.random() < 0.45 ? 1 : 0));

        // 2. Simulation Step (Smooth)
        const iterations = 4;
        for (let i = 0; i < iterations; i++) {
            grid = this.doSimulationStep(grid);
        }

        // 2.5 Carve Defined Rooms (Ensure Symbolic requirements are met)
        config.rooms.forEach(room => {
             // Random position (padding of 4)
             const rw = 8;
             const rh = 8;
             const rx = Math.floor(Math.random() * (width - rw - 8)) + 4;
             const ry = Math.floor(Math.random() * (height - rh - 8)) + 4;
             
             for(let y = ry; y < ry + rh; y++) {
                 for(let x = rx; x < rx + rw; x++) {
                     if (y < height && x < width) {
                        grid[y][x] = 1;
                     }
                 }
             }
             
             // Register room for debug/gameplay
             mapData.rooms.push({
                 id: room.id,
                 x: rx, y: ry, width: rw, height: rh, type: room.type
             });
        });

        // 3. Apply Perlin Noise for Biomes
        const noiseGrid = this.generateNoiseGrid(width, height);

        // 4. Convert to MapData
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                if (grid[y][x] === 1) { // 1 = Floor (Cave)
                    // Use noise to decide biome
                    const noiseVal = noiseGrid[y][x];
                    const sprite = noiseVal > 0.5 ? 'floor_grass' : 'floor_mud';
                    
                     mapData.tiles.push({
                        x, y,
                        sprite,
                        layer: 'floor'
                    });

                    // Decoration (Mushrooms/Rocks) - Random scatter
                    if (Math.random() < 0.05) {
                        mapData.tiles.push({
                            x, y,
                            sprite: 'mushroom',
                            layer: 'furniture'
                        });
                    }
                } else {
                     // 0 = Wall (Empty/Solid)
                     if (this.hasFloorNeighbor(grid, x, y)) {
                         mapData.tiles.push({
                             x, y,
                             sprite: 'wall_rock', 
                             layer: 'wall'
                         });
                     }
                }
            }
        }

        // 5. Place Logic Furniture in Rooms
        mapData.rooms.forEach(room => {
             const roomConfig = config.rooms.find(c => c.id === room.id);
             let items: string[] = roomConfig ? roomConfig.furniture : [];

             // Fallback
             if (items.length === 0) {
                 if (room.type.includes('lair')) items = ['chest', 'chest', 'gold'];
                 else if (room.type.includes('camp')) items = ['bed', 'bed', 'fire'];
                 else items = ['chest']; 
             }

             ConstraintSolver.placeItems(room, items, mapData, grid, 1);
        });

        return mapData;
    }

    private hasFloorNeighbor(grid: number[][], x: number, y: number): boolean {
        const height = grid.length;
        const width = grid[0].length;
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                if (dx === 0 && dy === 0) continue;
                const ny = y + dy;
                const nx = x + dx;
                if (ny >= 0 && ny < height && nx >= 0 && nx < width) {
                    if (grid[ny][nx] === 1) return true;
                }
            }
        }
        return false;
    }

    private generateNoiseGrid(width: number, height: number): number[][] {
        // Simple value noise or smoothed noise
        const grid = Array(height).fill(0).map(() => Array(width).fill(0));
        // Seed
        const seed = Math.random() * 100;
        
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                // Simple pseudo-noise: sin(x * freq) * cos(y * freq) + random
                // This is a placeholder for real Perlin noise, but effective for biomes
                // We'll use a smoother function
                const nx = x / width - 0.5;
                const ny = y / height - 0.5;
                // A simple radial gradient mixed with noise
                const dist = Math.sqrt(nx*nx + ny*ny);
                const noise = (Math.sin((x + seed) * 0.1) + Math.cos((y + seed) * 0.1)) * 0.5 + 0.5;
                // Mix distance to make edges darker/different if needed, or just use noise
                grid[y][x] = noise * (1 - dist * 0.5); // Slight radial bias
            }
        }
        return grid;
    }

    private doSimulationStep(oldGrid: number[][]): number[][] {
        const height = oldGrid.length;
        const width = oldGrid[0].length;
        const newGrid = Array(height).fill(0).map(() => Array(width).fill(0));

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const nbs = this.countAliveNeighbors(oldGrid, x, y);
                // Game of Life Logic (Cave variation)
                if (oldGrid[y][x] === 1) {
                    newGrid[y][x] = nbs < 4 ? 0 : 1;
                } else {
                    newGrid[y][x] = nbs > 4 ? 1 : 0;
                }
            }
        }
        return newGrid;
    }

    private countAliveNeighbors(grid: number[][], x: number, y: number): number {
        let count = 0;
        for (let i = -1; i < 2; i++) {
            for (let j = -1; j < 2; j++) {
                const nb_x = x + j;
                const nb_y = y + i;
                if (i === 0 && j === 0) continue;
                if (nb_x < 0 || nb_y < 0 || nb_x >= grid[0].length || nb_y >= grid.length) {
                    count++; // Borders are walls (or empty space depending on logic)
                } else if (grid[nb_y][nb_x] === 1) {
                    count++;
                }
            }
        }
        return count;
    }
}
