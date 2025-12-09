import Phaser from 'phaser';
import { SepiaPipeline, NightPipeline, ToxicPipeline } from '../pipelines/TonePipelines';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene');
  }

  preload() {
    // Load the JSON Atlas
    this.load.atlas('main_atlas', '/assets/tileset.png', '/assets/tileset.json');
    
    // Create the "Sketch" fallback texture programmatically
    // A white square with a jagged outline to simulate a sketch
    const graphics = this.make.graphics({ x: 0, y: 0 });
    graphics.fillStyle(0xffffff);
    graphics.fillRect(2, 2, 28, 28);
    graphics.lineStyle(2, 0x000000);
    graphics.strokeRect(2, 2, 28, 28);
    graphics.generateTexture('fallback_sketch', 32, 32);
  }

  create() {
    const renderer = this.game.renderer as Phaser.Renderer.WebGL.WebGLRenderer;
    // Register Pipelines
    if (renderer.pipelines) {
        renderer.pipelines.addPostPipeline('SepiaPipeline', SepiaPipeline);
        renderer.pipelines.addPostPipeline('NightPipeline', NightPipeline);
        renderer.pipelines.addPostPipeline('ToxicPipeline', ToxicPipeline);
    }

    this.scene.start('MainScene');
  }
}
