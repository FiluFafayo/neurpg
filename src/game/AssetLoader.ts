import Phaser from 'phaser';

export class AssetLoader {
  private scene: Phaser.Scene;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  /**
   * Safe Sprite Creator
   * Tries to load the frame from the atlas.
   * If missing, uses the 'fallback_sketch' texture and applies a wobble effect.
   */
  createSprite(x: number, y: number, frameName: string): Phaser.GameObjects.Sprite {
    const textureManager = this.scene.textures;
    let textureKey = 'main_atlas';
    let finalFrame = frameName;

    // Check if the frame exists in the atlas
    if (!textureManager.get(textureKey).has(frameName)) {
      console.warn(`AssetLoader: Missing frame '${frameName}'. Using fallback.`);
      textureKey = 'fallback_sketch';
      finalFrame = ''; // Single image texture, no frame
    }

    const sprite = this.scene.add.sprite(x, y, textureKey, finalFrame);

    // Apply "Sketch" effect if it's a fallback
    if (textureKey === 'fallback_sketch') {
      // Add a wobble tween to emphasize it's a placeholder/sketch
      this.scene.tweens.add({
        targets: sprite,
        angle: { from: -5, to: 5 },
        duration: 200,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut'
      });
      sprite.setTint(0xcccccc); // Light grey tint
    }

    return sprite;
  }
}
