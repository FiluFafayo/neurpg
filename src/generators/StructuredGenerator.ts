import { MapConfig, RoomConfig } from '../types/MapConfig';
import { MapData } from '../types/MapData';
import { IMapGenerator } from './MapGenerators';
import { forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide, SimulationNodeDatum, SimulationLinkDatum } from 'd3-force';
import { js as EasyStar } from 'easystarjs';
import { ConstraintSolver } from './ConstraintSolver';

// Extend D3 Node to include our Room data
interface RoomNode extends SimulationNodeDatum, RoomConfig {
    width: number; // calculated width in pixels (or grid units * scale)
    height: number;
}

export class StructuredGenerator implements IMapGenerator {
    
    generate(config: MapConfig): MapData {
        console.log(`[StructuredGenerator] Building Graph Layout...`);

        // 1. Prepare Nodes
        const nodes: RoomNode[] = config.rooms.map(room => ({
            ...room,
            width: 6, // Default room size 6x6 tiles
            height: 6,
            x: config.width / 2, // Start at center
            y: config.height / 2
        }));

        // 2. Prepare Links (Edges)
        const links: SimulationLinkDatum<RoomNode>[] = [];
        nodes.forEach((sourceNode) => {
            sourceNode.connections.forEach(targetId => {
                const targetNode = nodes.find(n => n.id === targetId);
                if (targetNode) {
                    links.push({ source: sourceNode, target: targetNode });
                }
            });
        });

        // 3. Run Force Simulation (Synchronously for now, but should be in Worker)
        // We run the simulation "warm" for N ticks to stabilize layout
        const simulation = forceSimulation(nodes)
            .force("link", forceLink(links).id((d: any) => d.id).distance(8)) // Distance between room centers
            .force("charge", forceManyBody().strength(-50)) // Repel rooms so they don't overlap too much
            .force("center", forceCenter(config.width / 2, config.height / 2))
            .force("collide", forceCollide().radius(5).iterations(2)) // Simple collision
            .stop();

        // Run 300 ticks
        for (let i = 0; i < 300; ++i) simulation.tick();

        // 4. Rasterize: Convert Nodes to Grid Tiles
        const mapData: MapData = {
            width: config.width,
            height: config.height,
            tiles: [],
            rooms: []
        };

        // Create a 2D grid for collision checking/pathfinding
        const grid: number[][] = Array(config.height).fill(0).map(() => Array(config.width).fill(1)); // 1 = Wall, 0 = Walkable

        nodes.forEach(node => {
            // Snap to Grid
            const gx = Math.floor(node.x!);
            const gy = Math.floor(node.y!);
            const w = Math.floor(node.width);
            const h = Math.floor(node.height);

            // Bounds Check
            if (gx < 0 || gy < 0 || gx + w >= config.width || gy + h >= config.height) return;

            mapData.rooms.push({
                id: node.id,
                x: gx,
                y: gy,
                width: w,
                height: h,
                type: node.type
            });

            // Carve Room
            for (let y = gy; y < gy + h; y++) {
                for (let x = gx; x < gx + w; x++) {
                    grid[y][x] = 0; // Walkable
                    mapData.tiles.push({
                        x, y,
                        sprite: 'floor_stone',
                        layer: 'floor'
                    });
                }
            }
        });

        // 5. Connect Rooms with Corridors (A*)
        const easystar = new EasyStar();
        easystar.setGrid(grid);
        easystar.setAcceptableTiles([0, 1]); // Can walk on Floor(0) and Wall(1) - we carve walls into floors
        // Actually we want to path through walls to create corridors.
        // So we allow walking on everything.
        // But we prefer existing floors?
        // EasyStar supports tile costs. 
        // 0 (Floor) cost = 1
        // 1 (Wall) cost = 2 (prefer existing corridors)
        easystar.setTileCost(0, 1);
        easystar.setTileCost(1, 2);
        easystar.enableSync();

        links.forEach((link: any) => {
            const source = link.source as RoomNode;
            const target = link.target as RoomNode;
            
            this.createCorridor(
                Math.floor(source.x!), Math.floor(source.y!),
                Math.floor(target.x!), Math.floor(target.y!),
                mapData,
                grid,
                easystar
            );
        });
        
        // 6. Generate Walls
        this.placeWalls(mapData, grid);

        // 7. Place Furniture (Constraint Solver)
        this.placeFurniture(mapData, grid, config.rooms);

        return mapData;
    }

    private placeWalls(mapData: MapData, grid: number[][]) {
        const height = grid.length;
        const width = grid[0].length;
        
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                // If this is a Wall (1)
                if (grid[y][x] === 1) {
                    // Check 8 neighbors for Floor (0)
                    let hasFloorNeighbor = false;
                    for (let dy = -1; dy <= 1; dy++) {
                        for (let dx = -1; dx <= 1; dx++) {
                            if (dx === 0 && dy === 0) continue;
                            const ny = y + dy;
                            const nx = x + dx;
                            if (ny >= 0 && ny < height && nx >= 0 && nx < width) {
                                if (grid[ny][nx] === 0) {
                                    hasFloorNeighbor = true;
                                    break;
                                }
                            }
                        }
                        if (hasFloorNeighbor) break;
                    }

                    if (hasFloorNeighbor) {
                        mapData.tiles.push({
                            x, y,
                            sprite: 'wall_brick', 
                            layer: 'wall'
                        });
                    }
                }
            }
        }
    }

    private placeFurniture(mapData: MapData, grid: number[][], roomConfigs: RoomConfig[]) {
        mapData.rooms.forEach(room => {
            // Find config for this room to get furniture list
            const config = roomConfigs.find(c => c.id === room.id);
            let items: string[] = config ? config.furniture : [];

            // Fallback if list is empty
            if (items.length === 0) {
                if (room.type.includes('bedroom')) items = ['bed', 'chest', 'rug'];
                else if (room.type.includes('kitchen')) items = ['table', 'chair', 'chair'];
                else if (room.type.includes('throne')) items = ['throne', 'rug', 'chest', 'chest'];
                else if (room.type.includes('library')) items = ['bookshelf', 'bookshelf', 'table', 'chair'];
                else items = ['chest']; // Default
            }
            
            // Use Solver
            // Floor value is 0
            ConstraintSolver.placeItems(room, items, mapData, grid, 0);
        });
    }

    private createCorridor(x1: number, y1: number, x2: number, y2: number, mapData: MapData, grid: number[][], easystar: any) {
        // Clamp coordinates to grid bounds to prevent EasyStar crash
        const h = grid.length;
        const w = grid[0].length;
        
        x1 = Math.max(0, Math.min(x1, w - 1));
        y1 = Math.max(0, Math.min(y1, h - 1));
        x2 = Math.max(0, Math.min(x2, w - 1));
        y2 = Math.max(0, Math.min(y2, h - 1));

        easystar.findPath(x1, y1, x2, y2, (path: {x: number, y: number}[]) => {
            if (path === null) {
                console.warn("Path was not found.");
            } else {
                path.forEach((pos) => {
                    // Carve 2-wide corridor
                    this.carveTile(pos.x, pos.y, mapData, grid);
                    this.carveTile(pos.x + 1, pos.y, mapData, grid);
                    this.carveTile(pos.x, pos.y + 1, mapData, grid);
                    this.carveTile(pos.x + 1, pos.y + 1, mapData, grid);
                });
            }
        });
        easystar.calculate();
    }

    private carveTile(x: number, y: number, mapData: MapData, grid: number[][]) {
        if (y < 0 || y >= grid.length || x < 0 || x >= grid[0].length) return;
        if (grid[y][x] === 0) return; // Already floor

        grid[y][x] = 0;
        mapData.tiles.push({
            x, y,
            sprite: 'floor_stone',
            layer: 'floor'
        });
    }
}
