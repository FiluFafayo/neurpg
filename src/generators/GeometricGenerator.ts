import { MapConfig } from '../types/MapConfig';
import { MapData } from '../types/MapData';
import { IMapGenerator } from './MapGenerators';
import { ConstraintSolver } from './ConstraintSolver';

export class GeometricGenerator implements IMapGenerator {
    generate(config: MapConfig): MapData {
        console.log(`[GeometricGenerator] Calculating Shape Constraints...`);
        
        const mapData: MapData = {
            width: config.width,
            height: config.height,
            tiles: [],
            rooms: []
        };

        const cx = Math.floor(config.width / 2);
        const cy = Math.floor(config.height / 2);
        
        // Example: Ellipse (Ship Hull / Wizard Tower)
        const rx = Math.floor(config.width / 2) - 2;
        const ry = Math.floor(config.height / 2) - 4;

        // Create Grid for Solver (1=Wall, 0=Floor)
        const grid: number[][] = Array(config.height).fill(0).map(() => Array(config.width).fill(1));

        // 1. Draw Hull Floor and Walls
        for (let y = 0; y < config.height; y++) {
            for (let x = 0; x < config.width; x++) {
                // Ellipse Equation: (x-h)^2/a^2 + (y-k)^2/b^2 <= 1
                const val = (Math.pow(x - cx, 2) / Math.pow(rx, 2)) + (Math.pow(y - cy, 2) / Math.pow(ry, 2));
                
                if (val <= 1.0) {
                    grid[y][x] = 0; // Floor
                     mapData.tiles.push({
                        x, y,
                        sprite: 'floor_stone',
                        layer: 'floor'
                    });
                } else {
                    // Check if close to border (simple wall placement)
                    // If val is just slightly above 1, it's a wall.
                    // Or check 4 neighbors.
                    let isWall = false;
                    const neighbors = [[0,1], [0,-1], [1,0], [-1,0]];
                    for (const [dx, dy] of neighbors) {
                        const nx = x + dx;
                        const ny = y + dy;
                        const nVal = (Math.pow(nx - cx, 2) / Math.pow(rx, 2)) + (Math.pow(ny - cy, 2) / Math.pow(ry, 2));
                        if (nVal <= 1.0) {
                            isWall = true;
                            break;
                        }
                    }
                    
                    if (isWall) {
                        mapData.tiles.push({
                            x, y,
                            sprite: 'wall_brick',
                            layer: 'wall'
                        });
                    }
                }
            }
        }

        // 2. Place Rooms Symmetrically (Cathedral/Ship Logic)
        const roomsToPlace = [...config.rooms];
        
        // Place first room at Center (Bridge/Altar)
        if (roomsToPlace.length > 0) {
            const centerRoom = roomsToPlace.shift()!;
            const w = 8;
            const h = 8;
            const rx_center = cx - w/2;
            const ry_center = cy - h/2;
            mapData.rooms.push({
                id: centerRoom.id,
                x: rx_center,
                y: ry_center,
                width: w,
                height: h,
                type: centerRoom.type
            });
        }

        // Place remaining rooms in mirrored pairs
        // Start from top, but ensure we don't overlap the center room if it's wide/tall
        // For simplicity, we'll place them in columns on left/right
        let currentY = 4; 
        const xOffset = 12; // Increased offset to clear the center room
        
        while (roomsToPlace.length > 0) {
            const leftRoom = roomsToPlace.shift();
            if (!leftRoom) break;

            // Left Side
            const w = 6;
            const h = 6;
            const lx = cx - xOffset - w;
            const ly = currentY;

            mapData.rooms.push({
                id: leftRoom.id,
                x: lx,
                y: ly,
                width: w,
                height: h,
                type: leftRoom.type
            });

            // Mirror (Right Side) - ONLY for secondary rooms
            const rx_pos = cx + xOffset;
            mapData.rooms.push({
                id: `${leftRoom.id}_mirror`,
                x: rx_pos,
                y: ly,
                width: w,
                height: h,
                type: leftRoom.type
            });
            
            currentY += h + 2;
        }

        // 3. Place Furniture (Constraint Solver)
        mapData.rooms.forEach(room => {
            // Check if it's a mirror
            const isMirror = room.id.endsWith('_mirror');
            const originalId = isMirror ? room.id.replace('_mirror', '') : room.id;
            const roomConfig = config.rooms.find(c => c.id === originalId);
            
            let items = roomConfig ? [...roomConfig.furniture] : [];
            
            // Fallback
            if (items.length === 0) {
                 if (room.type.includes('bridge') || room.type.includes('altar')) items = ['throne', 'rug'];
                 else if (room.type.includes('quarters')) items = ['bed', 'chest'];
                 else items = ['chair', 'table'];
            }
            
            ConstraintSolver.placeItems(room, items, mapData, grid, 0);
        });

        return mapData;
    }
}
