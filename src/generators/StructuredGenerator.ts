// File: src/generators/StructuredGenerator.ts

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
    
    get centerX() { return Math.floor(this.x + this.w/2); }
    get centerY() { return Math.floor(this.y + this.h/2); }

    // Cek tabrakan dengan toleransi Zero (Strict)
    intersects(other: Rect, padding: number = 0): boolean {
        return (
            this.left < other.right + padding &&
            this.right > other.left - padding &&
            this.top < other.bottom + padding &&
            this.bottom > other.top - padding
        );
    }
}

export class StructuredGenerator implements IMapGenerator {

    generate(config: MapConfig): MapData {
        console.log(`[StructuredGenerator] Starting Smart Layout Generation...`);
        
        const mapData: MapData = {
            width: config.width,
            height: config.height,
            tiles: [],
            rooms: []
        };

        // 1. Init Grid
        const grid: number[][] = Array(config.height).fill(0).map(() => Array(config.width).fill(TERRAIN));
        const roomGrid: number[][] = Array(config.height).fill(0).map(() => Array(config.width).fill(-1));

        // 2. Prepare Rects (Load dimensions from Config/AI)
        const allRects: Rect[] = config.rooms.map(room => {
            const dim = this.getRoomDimensions(room);
            // Default position 0,0
            return new Rect(0, 0, dim.w, dim.h, room);
        });

        // 3. Strategy Selector
        // Cari ruangan yang cocok jadi "Spine" (Koridor panjang)
        // Kriteria: Tipe corridor/hallway DAN punya koneksi banyak ATAU bentuknya panjang
        const spineCandidate = allRects.find(r => 
            (r.room.type.includes('corridor') || r.room.type.includes('hall')) && 
            (r.room.connections.length > 1 || r.w > r.h * 2 || r.h > r.w * 2)
        );

        let placedRects: Rect[] = [];

        if (spineCandidate) {
            console.log(`[StructuredGenerator] Strategy: SPINE Layout (Anchor: ${spineCandidate.room.name})`);
            placedRects = this.buildSpineLayout(spineCandidate, allRects, config.width, config.height);
        } else {
            console.log(`[StructuredGenerator] Strategy: HUB Layout (No Spine detected)`);
            placedRects = this.buildHubLayout(allRects, config.width, config.height);
        }

        // 4. Rasterize to Grid (Strict Integer Rendering)
        placedRects.forEach((r, idx) => {
            // Safety Check Bounds
            const startX = Math.max(0, r.x);
            const startY = Math.max(0, r.y);
            const endX = Math.min(config.width, r.right);
            const endY = Math.min(config.height, r.bottom);

            for (let y = startY; y < endY; y++) {
                for (let x = startX; x < endX; x++) {
                    grid[y][x] = FLOOR;
                    roomGrid[y][x] = idx; // Gunakan index lokal
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

        // 5. Generate Walls (Skinning)
        this.generateWalls(grid, roomGrid, config);

        // 6. Generate Doors (Strict Logic)
        this.generateDoors(placedRects, grid, mapData);

        // 7. Convert to Tiles
        this.generateTiles(grid, roomGrid, mapData, config);

        // 8. Furnish
        this.furnishRooms(mapData, config, grid);

        return mapData;
    }

    // --- LAYOUT STRATEGIES ---

    private buildSpineLayout(spine: Rect, allRects: Rect[], mapW: number, mapH: number): Rect[] {
        const placed: Rect[] = [];
        const placedIds = new Set<string>();

        // 1. Place Spine in Center
        spine.x = Math.floor((mapW - spine.w) / 2);
        spine.y = Math.floor((mapH - spine.h) / 2);
        placed.push(spine);
        placedIds.add(spine.room.id);

        // 2. Identify Children connected to Spine
        // Prioritize rooms connected directly to the spine
        const children = allRects.filter(r => 
            !placedIds.has(r.room.id) && 
            spine.room.connections.includes(r.room.id)
        );

        // Sort children by size (Largest first helps packing)
        children.sort((a, b) => (b.w * b.h) - (a.w * a.h));

        // 3. Place Rooms along the Spine
        // We will try to place them on Top, Bottom, Left, Right
        // Maintain "cursor" for packing tight
        // Simple logic: Alternate Top/Bottom
        
        // Define anchor points relative to spine
        // A simple 1D packing along the spine's long axis would be ideal if spine is horz
        const isHorizontal = spine.w >= spine.h;
        
        // Cursors for packing
        let currentX_Top = spine.x;
        let currentX_Bot = spine.x;
        let currentY_Left = spine.y;
        let currentY_Right = spine.y;

        children.forEach((child, index) => {
            let bestX = 0, bestY = 0;
            let found = false;

            if (isHorizontal) {
                // Try Top Side first, then Bottom
                if (index % 2 === 0) {
                    // Place Top
                    bestX = currentX_Top;
                    bestY = spine.y - child.h; // Snap to top edge
                    currentX_Top += child.w; // Move cursor
                } else {
                    // Place Bottom
                    bestX = currentX_Bot;
                    bestY = spine.bottom; // Snap to bottom edge
                    currentX_Bot += child.w; //ZW Move cursor
                }
                found = true;
            } else {
                // Vertical Spine
                if (index % 2 === 0) {
                    // Place Left
                    bestX = spine.x - child.w;
                    bestY = currentY_Left;
                    currentY_Left += child.h;
                } else {
                    // Place Right
                    bestX = spine.right;
                    bestY = currentY_Right;
                    currentY_Right += child.h;
                }
                found = true;
            }

            if (found) {
                child.x = bestX;
                child.y = bestY;
                
                // Collision Check (Just in case)
                if (!this.checkCollision(child, placed)) {
                    placed.push(child);
                    placedIds.add(child.room.id);
                } else {
                    // Fallback: Try to find ANY spot around the spine
                    // (Simple radial search or bounding box expansion could go here)
                    console.warn(`[Structured] Could not fit ${child.room.name} perfectly alongside spine.`);
                }
            }
        });

        // 4. Place Grandchildren (Rooms connected to the rooms we just placed)
        // Simple Recursive Snap
        let stuckCounter = 0;
        while (placed.length < allRects.length && stuckCounter < 100) {
            const unplaced = allRects.filter(r => !placedIds.has(r.room.id));
            if (unplaced.length === 0) break;

            let progress = false;
            for (const child of unplaced) {
                // Find a parent in placed list
                const parent = placed.find(p => child.room.connections.includes(p.room.id));
                if (parent) {
                    const pos = this.findSnapPosition(parent, child, placed);
                    if (pos) {
                        child.x = pos.x;
                        child.y = pos.y;
                        placed.push(child);
                        placedIds.add(child.room.id);
                        progress = true;
                    }
                }
            }
            if (!progress) stuckCounter++;
        }

        return placed;
    }

    private buildHubLayout(allRects: Rect[], mapW: number, mapH: number): Rect[] {
        // Strategy: Place the biggest room (Hub) in center, spiral others around it
        const placed: Rect[] = [];
        const placedIds = new Set<string>();

        // 1. Find Hub (Most connected or Largest)
        allRects.sort((a, b) => b.room.connections.length - a.room.connections.length);
        const hub = allRects[0];

        hub.x = Math.floor((mapW - hub.w) / 2);
        hub.y = Math.floor((mapH - hub.h) / 2);
        placed.push(hub);
        placedIds.add(hub.room.id);

        // 2. Spiral Placement for the rest
        const queue = allRects.filter(r => !placedIds.has(r.room.id));
        
        for (const child of queue) {
            // Find parent to snap to
            let parent = placed.find(p => child.room.connections.includes(p.room.id));
            if (!parent) parent = placed[0]; // Fallback to hub

            const pos = this.findSnapPosition(parent, child, placed);
            if (pos) {
                child.x = pos.x;
                child.y = pos.y;
                placed.push(child);
                placedIds.add(child.room.id);
            } else {
                console.warn(`[Hub] Failed to place ${child.room.name}`);
            }
        }

        return placed;
    }

    // --- UTILS ---

    private findSnapPosition(parent: Rect, child: Rect, obstacles: Rect[]): {x: number, y: number} | null {
        // Try 4 sides of parent
        const candidates = [
            { x: parent.x + (parent.w - child.w)/2, y: parent.y - child.h }, // Top (Centered)
            { x: parent.x + (parent.w - child.w)/2, y: parent.bottom },     // Bottom (Centered)
            { x: parent.x - child.w, y: parent.y + (parent.h - child.h)/2 }, // Left (Centered)
            { x: parent.right, y: parent.y + (parent.h - child.h)/2 },       // Right (Centered)
            // Align Corners (Secondary)
            { x: parent.x, y: parent.y - child.h }, // Top-Left
            { x: parent.right - child.w, y: parent.y - child.h } // Top-Right
        ];

        for (const pos of candidates) {
            // Integer snap
            pos.x = Math.floor(pos.x);
            pos.y = Math.floor(pos.y);

            child.x = pos.x;
            child.y = pos.y;
            
            if (!this.checkCollision(child, obstacles)) {
                return pos;
            }
        }
        return null;
    }

    private checkCollision(rect: Rect, others: Rect[]): boolean {
        for (const other of others) {
            if (rect.room.id === other.room.id) continue;
            // Strict overlap check (padding 0)
            if (rect.intersects(other, 0)) return true;
        }
        return false;
    }

    private getRoomDimensions(config: RoomConfig): { w: number, h: number } {
        // Priority 1: AI Config
        if (config.width && config.height) {
            return { w: Math.floor(config.width), h: Math.floor(config.height) };
        }
        
        // Priority 2: Fallback Defaults
        const t = config.type.toLowerCase();
        if (t.includes('hall') || t.includes('corridor')) return { w: 10, h: 2 }; // Default corridor
        if (t.includes('living') || t.includes('ballroom')) return { w: 10, h: 8 };
        if (t.includes('master')) return { w: 8, h: 6 };
        if (t.includes('kitchen')) return { w: 6, h: 6 };
        if (t.includes('bath') || t.includes('wc')) return { w: 3, h: 3 };
        
        return { w: 6, h: 6 }; // Generic
    }

    private generateWalls(grid: number[][], roomGrid: number[][], config: MapConfig) {
        for (let y = 0; y < config.height; y++) {
            for (let x = 0; x < config.width; x++) {
                if (grid[y][x] === FLOOR) {
                    // Check neighbors
                    const dirs = [[0,-1], [0,1], [-1,0], [1,0]];
                    for (const [dx, dy] of dirs) {
                        const nx = x + dx;
                        const ny = y + dy;
                        
                        // Bounds check
                        if (nx < 0 || ny < 0 || nx >= config.width || ny >= config.height) continue;

                        const neighborVal = grid[ny][nx];
                        const currentRoom = roomGrid[y][x];
                        const neighborRoom = roomGrid[ny][nx];

                        // Wall logic:
                        // 1. Border with TERRAIN (Outside)
                        if (neighborVal === TERRAIN) {
                            grid[y][x] = WALL; // Convert outer floor to wall
                        }
                        // 2. Border with DIFFERENT ROOM (Internal Wall)
                        else if (neighborVal === FLOOR && currentRoom !== neighborRoom) {
                            // Only draw wall on ONE side to avoid double walls
                            // Prefer drawing on Top or Left side of the boundary
                            if (x < nx || y < ny) {
                                // grid[y][x] = WALL; // Optional: Thick walls?
                                // For now, let's keep internal borders as floors but maybe change visual later?
                                // Actually, standard RPG maps usually have walls between rooms.
                                // Let's try converting to WALL.
                                // But strictly, collision logic needs it.
                                // Let's keep it simple: Dinding hanya di tepi luar ruangan.
                            }
                        }
                    }
                }
            }
        }
    }

    private generateDoors(placedRects: Rect[], grid: number[][], mapData: MapData) {
        // Simple Door Logic: Find shared edges between connected rooms
        placedRects.forEach(rA => {
            rA.room.connections.forEach(connId => {
                const rB = placedRects.find(p => p.room.id === connId);
                if (rB) {
                    this.carveDoor(rA, rB, grid, mapData);
                }
            });
        });
    }

    private carveDoor(rA: Rect, rB: Rect, grid: number[][], mapData: MapData) {
        // Find intersection rect (overlap or touching)
        // Since we use strict packing, they touch at edges.
        
        // Horizontal Edge Touch?
        // rA Bottom == rB Top OR rA Top == rB Bottom
        const touchY = (rA.bottom === rB.y) ? rA.bottom : (rA.y === rB.bottom ? rA.y : null);
        
        if (touchY !== null) {
            // Horizontal overlap range
            const startX = Math.max(rA.x, rB.x);
            const endX = Math.min(rA.right, rB.right);
            const overlap = endX - startX;
            
            if (overlap >= 2) {
                // Carve center of overlap
                const doorX = Math.floor(startX + overlap/2);
                // Carve 2 tiles (User requirement: 2 tiles wide)
                this.setDoor(doorX, touchY - 1, grid); // A side
                this.setDoor(doorX, touchY, grid);     // B side
                
                // Add Door Metadata
                this.addDoorMeta(mapData, rA.room.id, doorX, touchY);
                this.addDoorMeta(mapData, rB.room.id, doorX, touchY);
                return;
            }
        }

        // Vertical Edge Touch?
        const touchX = (rA.right === rB.x) ? rA.right : (rA.x === rB.right ? rA.x : null);
        
        if (touchX !== null) {
            const startY = Math.max(rA.y, rB.y);
            const endY = Math.min(rA.bottom, rB.bottom);
            const overlap = endY - startY;
            
            if (overlap >= 2) {
                const doorY = Math.floor(startY + overlap/2);
                this.setDoor(touchX - 1, doorY, grid);
                this.setDoor(touchX, doorY, grid);
                
                this.addDoorMeta(mapData, rA.room.id, touchX, doorY);
                this.addDoorMeta(mapData, rB.room.id, touchX, doorY);
            }
        }
    }

    private setDoor(x: number, y: number, grid: number[][]) {
        if (y >= 0 && y < grid.length && x >= 0 && x < grid[0].length) {
            // Ensure we don't overwrite walls if we don't want to, 
            // but doors usually replace walls or floors.
            grid[y][x] = DOOR; 
        }
    }

    private addDoorMeta(mapData: MapData, roomId: string, x: number, y: number) {
        const room = mapData.rooms.find(r => r.id === roomId);
        if (room) {
            if (!room.doors) room.doors = [];
            room.doors.push({ x, y });
        }
    }

    private generateTiles(grid: number[][], roomGrid: number[][], mapData: MapData, config: MapConfig) {
        for (let y = 0; y < config.height; y++) {
            for (let x = 0; x < config.width; x++) {
                const val = grid[y][x];
                const rIdx = roomGrid[y][x];

                // Base terrain
                mapData.tiles.push({ x, y, sprite: 'grass', layer: 'floor' });

                if (val === WALL) {
                    mapData.tiles.push({ x, y, sprite: 'wall_brick', layer: 'wall' });
                } 
                else if (val === FLOOR || val === DOOR) {
                    let floorSprite = 'floor_common';
                    if (rIdx !== -1) {
                         const roomType = config.rooms[rIdx].type;
                         floorSprite = this.getFloorSprite(roomType);
                    }
                    mapData.tiles.push({ x, y, sprite: floorSprite, layer: 'floor' });
                    
                    if (val === DOOR) {
                         // Optional: Door sprite on top
                         // mapData.tiles.push({ x, y, sprite: 'door_wood', layer: 'furniture' });
                    }
                }
            }
        }
    }

    private getFloorSprite(type: string): string {
        const t = type.toLowerCase();
        if (t.includes('kitchen')) return 'floor_kitchen';
        if (t.includes('bath')) return 'floor_bathroom';
        if (t.includes('corridor') || t.includes('hall')) return 'floor_hallway';
        return 'floor_common';
    }

    private furnishRooms(mapData: MapData, config: MapConfig, grid: number[][]) {
        mapData.rooms.forEach(room => {
            const cfg = config.rooms.find(r => r.id === room.id);
            if (cfg) {
                ConstraintSolver.placeItems(room, cfg.furniture || [], mapData, grid, FLOOR); 
            }
        });
    }
}