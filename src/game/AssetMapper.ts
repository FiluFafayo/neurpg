export interface SpriteConfig {
    texture: string;
    frame: string;
    tint?: number;
}

export class AssetMapper {
    static getSpriteConfig(key: string): SpriteConfig {
        // Base texture key
        const atlasKey = 'main_atlas';
        const k = key.toLowerCase();

        // 1. FLOORS (High Priority: Check prefixes first)
        // Mencegah "floor_bedroom" terdeteksi sebagai "bed"
        if (k.includes('floor')) {
            if (k.includes('kitchen') || k.includes('dining')) return { texture: atlasKey, frame: 'floor_wood', tint: 0xffddaa }; // Warm
            if (k.includes('bedroom') || k.includes('master')) return { texture: atlasKey, frame: 'floor_wood', tint: 0xaaddff }; // Cool
            if (k.includes('bathroom') || k.includes('toilet') || k.includes('wc')) return { texture: atlasKey, frame: 'floor_stone', tint: 0xeeeeff }; // Clean
            if (k.includes('hall') || k.includes('corridor') || k.includes('passage')) return { texture: atlasKey, frame: 'floor_stone', tint: 0x888888 }; // Darker
            if (k.includes('storage') || k.includes('pantry') || k.includes('crypt')) return { texture: atlasKey, frame: 'floor_wood', tint: 0x8B4513 }; // Dark Brown
            if (k.includes('exterior') || k.includes('garage') || k.includes('terrace')) return { texture: atlasKey, frame: 'floor_stone', tint: 0x999999 }; // Pavement
            if (k.includes('entrance') || k.includes('foyer') || k.includes('lobby')) return { texture: atlasKey, frame: 'floor_wood', tint: 0xccaa88 }; // Welcoming
            if (k.includes('living') || k.includes('common') || k.includes('library') || k.includes('ballroom')) return { texture: atlasKey, frame: 'floor_wood', tint: 0xffeebb };
            
            // Generic Floors Fallback
            if (k.includes('wood')) return { texture: atlasKey, frame: 'floor_wood' };
            if (k.includes('stone') || k.includes('rock')) return { texture: atlasKey, frame: 'floor_stone' };
            return { texture: atlasKey, frame: 'floor_common' }; 
        }

        // 2. WALLS
        if (k.includes('wall')) {
            if (k.includes('kitchen')) return { texture: atlasKey, frame: 'wall_brick', tint: 0xffcccc };
            if (k.includes('bedroom')) return { texture: atlasKey, frame: 'wall_stone', tint: 0xeeddbb };
            if (k.includes('bathroom')) return { texture: atlasKey, frame: 'wall_stone', tint: 0xaaffaa };
            if (k.includes('crypt') || k.includes('dungeon')) return { texture: atlasKey, frame: 'wall_stone', tint: 0x555555 };
            return { texture: atlasKey, frame: 'wall_brick' };
        }

        // 3. DOORS
        if (k.includes('door')) return { texture: atlasKey, frame: 'door_wood' };

        // 4. FURNITURE & OBJECTS (Specific Names)
        if (k === 'bed' || k.includes('bunk') || k.includes('cot') || k.includes('poster bed')) return { texture: atlasKey, frame: 'bed' };
        if (k.includes('chair') || k.includes('sofa') || k.includes('throne') || k.includes('stool') || k.includes('seat')) return { texture: atlasKey, frame: 'chair' };
        if (k.includes('table') || k.includes('desk') || k.includes('counter') || k.includes('bench') || k.includes('sink') || k.includes('stove') || k.includes('piano')) return { texture: atlasKey, frame: 'table' };
        if (k.includes('chest') || k.includes('box') || k.includes('crate') || k.includes('shelf') || k.includes('book') || k.includes('cabinet') || k.includes('wardrobe')) return { texture: atlasKey, frame: 'chest' };
        if (k.includes('rug') || k.includes('carpet')) return { texture: atlasKey, frame: 'floor_wood', tint: 0x992222 };
        if (k.includes('stair') || k.includes('ladder')) return { texture: atlasKey, frame: 'floor_stone', tint: 0x555555 };

        // 5. NATURE
        if (k.includes('tree') || k.includes('plant') || k.includes('bush')) return { texture: atlasKey, frame: 'tree' };
        if (k.includes('water') || k.includes('pond') || k.includes('river') || k.includes('pool')) return { texture: atlasKey, frame: 'water' };
        if (k.includes('sand') || k.includes('desert')) return { texture: atlasKey, frame: 'sand' };
        if (k.includes('grass') || k.includes('lawn')) return { texture: atlasKey, frame: 'grass' };

        // Fallback
        // console.warn(`AssetMapper: Unknown key '${key}', using fallback.`);
        return { texture: atlasKey, frame: 'chest', tint: 0xff00ff }; // Magenta Error Box
    }
}