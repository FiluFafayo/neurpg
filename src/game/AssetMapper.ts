export interface SpriteConfig {
    texture: string;
    frame: string;
    tint?: number;
}

export class AssetMapper {
    static getSpriteConfig(key: string): SpriteConfig {
        // Base texture key (assuming we use 'main_atlas' for everything)
        const atlasKey = 'main_atlas';

        switch (key) {
            // --- Semantic Floors ---
            case 'floor_kitchen':
                return { texture: atlasKey, frame: 'floor_wood', tint: 0xffddaa }; // Warm wood
            case 'floor_bedroom':
                return { texture: atlasKey, frame: 'floor_wood', tint: 0xaaddff }; // Cool wood
            case 'floor_bathroom':
                return { texture: atlasKey, frame: 'floor_stone', tint: 0xeeeeff }; // Clean stone
            case 'floor_living':
                return { texture: atlasKey, frame: 'floor_wood', tint: 0xffffff }; // Default wood
            case 'floor_hall':
                return { texture: atlasKey, frame: 'floor_stone', tint: 0xcccccc }; // Grey stone

            // --- Semantic Walls ---
            case 'wall_kitchen':
                return { texture: atlasKey, frame: 'wall_brick', tint: 0xffcccc }; // Reddish brick
            case 'wall_bedroom':
                return { texture: atlasKey, frame: 'wall_stone', tint: 0xeeddbb }; // Beige stone
            case 'wall_bathroom':
                return { texture: atlasKey, frame: 'wall_stone', tint: 0xaaffaa }; // Greenish stone
            case 'wall_living':
                return { texture: atlasKey, frame: 'wall_brick', tint: 0xffffff }; // Default brick

            // --- Direct Mappings (if the key matches the frame name) ---
            case 'grass':
            case 'water':
            case 'sand':
            case 'tree':
            case 'bed':
            case 'table':
            case 'chair':
            case 'chest':
            case 'floor_stone':
            case 'floor_wood':
            case 'wall_brick':
            case 'wall_stone':
            case 'door_wood':
                return { texture: atlasKey, frame: key };

            // --- Fallbacks ---
            default:
                console.warn(`AssetMapper: Unknown key '${key}', using fallback.`);
                return { texture: 'fallback_sketch', frame: '' };
        }
    }
}
