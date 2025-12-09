export interface SpriteConfig {
    texture: string;
    frame: string;
    tint?: number;
}

export class AssetMapper {
    static getSpriteConfig(key: string): SpriteConfig {
        // Base texture key (assuming we use 'main_atlas' for everything)
        const atlasKey = 'main_atlas';
        const k = key.toLowerCase();

        // --- Furniture & Objects (Fuzzy Match) ---
        if (k.includes('bed') || k.includes('cot') || k.includes('hammock')) return { texture: atlasKey, frame: 'bed' };
        if (k.includes('table') || k.includes('desk') || k.includes('counter') || k.includes('bench')) return { texture: atlasKey, frame: 'table' };
        if (k.includes('chair') || k.includes('stool') || k.includes('seat') || k.includes('throne') || k.includes('sofa')) return { texture: atlasKey, frame: 'chair' };
        if (k.includes('chest') || k.includes('box') || k.includes('crate') || k.includes('trunk')) return { texture: atlasKey, frame: 'chest' };
        
        // --- Nature ---
        if (k.includes('tree') || k.includes('bush') || k.includes('shrub') || k.includes('plant')) return { texture: atlasKey, frame: 'tree' };
        if (k.includes('grass') || k.includes('lawn') || k.includes('field')) return { texture: atlasKey, frame: 'grass' };
        if (k.includes('water') || k.includes('lake') || k.includes('pond') || k.includes('river')) return { texture: atlasKey, frame: 'water' };
        if (k.includes('sand') || k.includes('beach') || k.includes('desert')) return { texture: atlasKey, frame: 'sand' };

        // --- Semantic Floors ---
        // Specific Room Types (from StructuredGenerator)
        if (k.includes('floor_kitchen') || k.includes('floor_dining')) return { texture: atlasKey, frame: 'floor_wood', tint: 0xffddaa }; // Warm wood
        if (k.includes('floor_bedroom')) return { texture: atlasKey, frame: 'floor_wood', tint: 0xaaddff }; // Cool wood
        if (k.includes('floor_bathroom') || k.includes('floor_toilet')) return { texture: atlasKey, frame: 'floor_stone', tint: 0xeeeeff }; // Clean stone
        if (k.includes('floor_hallway') || k.includes('floor_corridor')) return { texture: atlasKey, frame: 'floor_stone', tint: 0x888888 }; // Dark Grey
        if (k.includes('floor_storage') || k.includes('floor_pantry')) return { texture: atlasKey, frame: 'floor_wood', tint: 0x8B4513 }; // Dark Brown
        
        // --- Fase 1: Fix Missing Keys ---
        if (k.includes('floor_exterior') || k.includes('carport') || k.includes('terrace')) return { texture: atlasKey, frame: 'floor_stone', tint: 0x999999 }; // Pavement Grey
        if (k.includes('floor_entrance') || k.includes('foyer')) return { texture: atlasKey, frame: 'floor_wood', tint: 0xccaa88 }; // Welcoming Wood
        if (k.includes('floor_common') || k.includes('living')) return { texture: atlasKey, frame: 'floor_wood', tint: 0xffeebb }; // Cozy Warm
        if (k.includes('floor_utility') || k.includes('laundry')) return { texture: atlasKey, frame: 'floor_stone', tint: 0xcccccc }; // Cool Stone

        // Generic Floors
        if (k.includes('floor_wood') || k.includes('wood_floor')) return { texture: atlasKey, frame: 'floor_wood' };
        if (k.includes('floor_stone') || k.includes('stone_floor')) return { texture: atlasKey, frame: 'floor_stone' };
        
        // Fallbacks for Decor
        if (k.includes('rug') || k.includes('carpet')) return { texture: atlasKey, frame: 'floor_wood', tint: 0x992222 }; // Reddish tint
        if (k.includes('stair') || k.includes('ladder')) return { texture: atlasKey, frame: 'floor_stone', tint: 0x555555 }; // Dark tint

        // --- Semantic Walls ---
        if (k.includes('wall')) {
            if (k.includes('kitchen')) return { texture: atlasKey, frame: 'wall_brick', tint: 0xffcccc };
            if (k.includes('bedroom')) return { texture: atlasKey, frame: 'wall_stone', tint: 0xeeddbb };
            if (k.includes('bathroom')) return { texture: atlasKey, frame: 'wall_stone', tint: 0xaaffaa };
            if (k.includes('stone')) return { texture: atlasKey, frame: 'wall_stone' };
            return { texture: atlasKey, frame: 'wall_brick' }; // Default
        }

        // --- Exact Frame Match (Final Check) ---
        // This catches things like 'door_wood' if not caught above
        if (k === 'door_wood') return { texture: atlasKey, frame: 'door_wood' };
        if (k === 'floor_wood') return { texture: atlasKey, frame: 'floor_wood' };
        if (k === 'floor_stone') return { texture: atlasKey, frame: 'floor_stone' };

        // --- Default Fallback ---
        console.warn(`AssetMapper: Unknown key '${key}', using fallback.`);
        return { texture: atlasKey, frame: 'floor_wood', tint: 0xff00ff }; // Magenta Error
    }
}
