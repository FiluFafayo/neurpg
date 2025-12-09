import { MapData, RoomData, ZoneType } from '../types/MapData';

interface FurnitureRule {
    width: number;
    height: number;
    preferredZones: ZoneType[];
    blocksDoor?: boolean; // If true, cannot be placed on a door vector
    faces?: string; // The type of furniture this item must face (e.g., 'TV' faces 'sofa')
}

interface PlacedItem {
    type: string;
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number; // 0, 90, 180, 270 (degrees)
}

export class ConstraintSolver {
    private static rules: Record<string, FurnitureRule> = {
        'bed': { width: 1, height: 2, preferredZones: ['wall'], blocksDoor: true },
        'chest': { width: 1, height: 1, preferredZones: ['wall', 'center'] },
        'table': { width: 2, height: 2, preferredZones: ['center'] },
        'chair': { width: 1, height: 1, preferredZones: ['center'] },
        'rug': { width: 2, height: 2, preferredZones: ['center'] },
        'sofa': { width: 2, height: 1, preferredZones: ['center', 'wall'] },
        'tv': { width: 1, height: 1, preferredZones: ['wall'], faces: 'sofa' },
        'throne': { width: 2, height: 2, preferredZones: ['wall'], blocksDoor: true },
        'bookshelf': { width: 2, height: 1, preferredZones: ['wall'] },
        'gold': { width: 1, height: 1, preferredZones: ['center'] },
        'fire': { width: 1, height: 1, preferredZones: ['center'] }
    };

    /**
     * Calculates zones (Wall, Center) for a room and stores them in room.zones.
     */
    static calculateZones(room: RoomData, grid: number[][], floorValue: number): void {
        room.zones = [];
        
        for (let y = room.y; y < room.y + room.height; y++) {
            for (let x = room.x; x < room.x + room.width; x++) {
                // Ensure we are inside grid bounds
                if (y < 0 || y >= grid.length || x < 0 || x >= grid[0].length) continue;
                
                // Only consider floor tiles of this room
                if (grid[y][x] !== floorValue) continue; // Should match floorValue (0 or 1)

                let isWall = false;
                
                // Check 4 neighbors to see if any is NOT floorValue (meaning it's a wall or outside)
                // Actually, for a rectangular room, the boundary is simply x==room.x or x==room.x+w-1...
                // But rooms might be irregular (organic).
                // So checking neighbors is safer.
                const neighbors = [
                    { dx: 0, dy: -1 }, { dx: 1, dy: 0 }, { dx: 0, dy: 1 }, { dx: -1, dy: 0 }
                ];

                for (const n of neighbors) {
                    const nx = x + n.dx;
                    const ny = y + n.dy;
                    if (nx < 0 || ny < 0 || nx >= grid[0].length || ny >= grid.length || grid[ny][nx] !== floorValue) {
                        isWall = true;
                        break;
                    }
                }

                room.zones.push({
                    x, y,
                    type: isWall ? 'wall' : 'center'
                });
            }
        }
    }

    static placeItems(room: RoomData, items: string[], mapData: MapData, grid: number[][], floorValue: number): void {
        if (!room.zones || room.zones.length === 0) {
            this.calculateZones(room, grid, floorValue);
        }

        // Use Explicit Door Metadata if available, otherwise fallback (which shouldn't happen after refactor)
        const doorVectors = room.doors || [];
        const placedItems: PlacedItem[] = [];

        // 1. Sort items. 
        // 'sofa' must be placed before 'tv' because TV depends on Sofa.
        // Larger items generally first.
        const sortedItems = [...items].sort((a, b) => {
            const ruleA = this.rules[a] || { width: 1, height: 1 };
            const ruleB = this.rules[b] || { width: 1, height: 1 };
            
            // Priority override
            if (a === 'sofa' && b === 'tv') return -1;
            if (a === 'tv' && b === 'sofa') return 1;

            // Area sort (descending)
            const areaA = ruleA.width * ruleA.height;
            const areaB = ruleB.width * ruleB.height;
            return areaB - areaA;
        });

        for (const itemType of sortedItems) {
            const rule = this.rules[itemType];
            if (!rule) continue;

            let placed = false;
            
            // Try preferred zones first, then fallback
            const zonesToTry = rule.preferredZones && rule.preferredZones.length > 0 
                ? rule.preferredZones 
                : ['wall', 'center'] as ZoneType[]; // Default fallback
            
            // Add fallback to all zones if not strictly limited
            if (!zonesToTry.includes('wall')) zonesToTry.push('wall');
            if (!zonesToTry.includes('center')) zonesToTry.push('center');

            // Iterate candidates
            // We shuffle room zones to avoid always placing in top-left
            const shuffledZones = [...(room.zones || [])].sort(() => Math.random() - 0.5);

            for (const zoneType of zonesToTry) {
                if (placed) break;

                const candidates = shuffledZones.filter(z => z.type === zoneType);
                
                for (const candidate of candidates) {
                    if (placed) break;

                    // Try rotations: 0, 90, 180, 270
                    const rotations = [0, 90, 180, 270];
                    // Optimization: if item is square (1x1 or 2x2), rotation 90/270 same as 0/180? 
                    // But 'facing' matters even for squares.
                    
                    for (const rot of rotations) {
                        // Calculate dimensions based on rotation
                        const w = (rot === 0 || rot === 180) ? rule.width : rule.height;
                        const h = (rot === 0 || rot === 180) ? rule.height : rule.width;

                        // Define footprint
                        // We assume anchor is top-left (candidate.x, candidate.y)
                        // Verify bounds
                        if (!this.checkBounds(candidate.x, candidate.y, w, h, room, grid, floorValue)) continue;

                        // Check Collision with existing items
                        if (this.checkCollision(candidate.x, candidate.y, w, h, placedItems)) continue;

                        // Check Door Blocking
                        if (rule.blocksDoor && this.checkDoorBlocking(candidate.x, candidate.y, w, h, doorVectors)) continue;

                        // Check Facing Rule
                        if (rule.faces) {
                            // Find the target
                            const target = placedItems.find(p => p.type === rule.faces);
                            if (target) {
                                if (!this.checkFacing(candidate.x, candidate.y, w, h, rot, target)) continue;
                            } else {
                                // Target not placed yet? We can't satisfy rule.
                                // If strict, we skip. If loose, we place anyway?
                                // Let's skip for now, implying dependency sort failed or target missing.
                                // Actually, if we just sorted, target *should* be there.
                                // If not, maybe we skip placing this item or ignore rule.
                                // Let's ignore rule if target missing (fallback).
                            }
                        }

                        // Valid! Place it.
                        placedItems.push({
                            type: itemType,
                            x: candidate.x,
                            y: candidate.y,
                            width: w,
                            height: h,
                            rotation: rot
                        });

                        // Add to MapData
                        // We fill the tiles. 
                        // Note: If item > 1x1, we might want to place multiple tiles or one large sprite?
                        // Renderer expects tiles. 
                        // We will mark the anchor tile with the sprite and rotation.
                        // We should probably mark occupied tiles in a "furniture" layer or similar.
                        // For now, let's just place the sprite at the anchor.
                        // But we need to ensure we don't draw floor over it? No, layers handle that.
                        
                        mapData.tiles.push({
                            x: candidate.x,
                            y: candidate.y,
                            sprite: itemType, // e.g., 'bed', 'sofa'
                            rotation: rot,
                            layer: 'furniture'
                        });

                        placed = true;
                        break; // Stop rotation loop
                    }
                }
            }
        }
    }

    private static checkBounds(x: number, y: number, w: number, h: number, _room: RoomData, grid: number[][], floorValue: number): boolean {
        // Check if all tiles in footprint are valid floor tiles within the room
        for (let dy = 0; dy < h; dy++) {
            for (let dx = 0; dx < w; dx++) {
                const nx = x + dx;
                const ny = y + dy;
                if (nx < 0 || ny < 0 || nx >= grid[0].length || ny >= grid.length) return false;
                if (grid[ny][nx] !== floorValue) return false; // Must be on floor
                // Also, strictly speaking, should be in 'room.zones' list? 
                // Since we filtered candidates from room.zones, the anchor is in room.
                // But the extension (w, h) might go out.
                // So checking grid === floorValue is good proxy, assuming rooms are isolated by walls.
            }
        }
        return true;
    }

    private static checkCollision(x: number, y: number, w: number, h: number, placedItems: PlacedItem[]): boolean {
        // Simple AABB collision
        for (const item of placedItems) {
            if (x < item.x + item.width &&
                x + w > item.x &&
                y < item.y + item.height &&
                y + h > item.y) {
                return true;
            }
        }
        return false;
    }

    private static checkDoorBlocking(x: number, y: number, w: number, h: number, doors: {x: number, y: number}[]): boolean {
        // Check if any part of the furniture overlaps with a door vector
        for (const door of doors) {
            if (x <= door.x && x + w > door.x &&
                y <= door.y && y + h > door.y) {
                return true;
            }
        }
        return false;
    }

    private static checkFacing(x: number, y: number, w: number, h: number, rot: number, target: PlacedItem): boolean {
        // Center of current item
        const cx = x + w / 2;
        const cy = y + h / 2;
        
        // Center of target item
        const tx = target.x + target.width / 2;
        const ty = target.y + target.height / 2;

        // Vector to target
        const dx = tx - cx;
        const dy = ty - cy;

        // Facing direction based on rotation
        // Assuming sprite faces "UP" (negative Y) at 0 rotation?
        // Or "RIGHT" (positive X)?
        // Let's assume standard Phaser/Game convention: 0 degrees = Right, 90 = Down, 180 = Left, 270 = Up?
        // OR 0 = Up. 
        // Let's assume 0 = UP (0, -1).
        
        let fx = 0, fy = 0;
        if (rot === 0) { fx = 0; fy = -1; }      // Up
        else if (rot === 90) { fx = 1; fy = 0; } // Right
        else if (rot === 180) { fx = 0; fy = 1; }// Down
        else if (rot === 270) { fx = -1; fy = 0; }// Left
        
        // Dot product to check alignment
        // We want the facing vector to point roughly towards the target.
        // Normalize vector to target
        const dist = Math.sqrt(dx*dx + dy*dy);
        if (dist === 0) return true; // On top of each other?
        
        const ndx = dx / dist;
        const ndy = dy / dist;

        const dot = fx * ndx + fy * ndy;
        
        // If dot > 0.5 (approx 60 degrees cone), we consider it facing
        return dot > 0.5;
    }
}
