import Phaser from 'phaser';
import { AssetLoader } from '../AssetLoader';

import { MapData } from '../../types/MapData';

export class MainScene extends Phaser.Scene {
  private assetLoader!: AssetLoader;
  private mapContainer!: Phaser.GameObjects.Container;
  private floorBlitter!: Phaser.GameObjects.Blitter;
  private controls!: Phaser.Cameras.Controls.SmoothedKeyControl;

  // Touch State
  private pinchState = {
      active: false,
      initialDistance: 0,
      initialZoom: 1
  };
  private panState = {
      active: false,
      lastX: 0,
      lastY: 0
  };

  constructor() {
    super('MainScene');
  }

  create() {
    this.assetLoader = new AssetLoader(this);
    
    // Rendering Layers
    this.floorBlitter = this.add.blitter(0, 0, 'main_atlas');
    this.mapContainer = this.add.container(0, 0);

    // Input - Enable Multi-touch
    this.input.addPointer(1); // Ensure at least 2 pointers (0 and 1)

    // Camera Controls (Keyboard)
    const cursors = this.input.keyboard!.createCursorKeys();
    const controlConfig = {
        camera: this.cameras.main,
        left: cursors.left,
        right: cursors.right,
        up: cursors.up,
        down: cursors.down,
        zoomIn: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.Q),
        zoomOut: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.E),
        acceleration: 0.06,
        drag: 0.0005,
        maxSpeed: 1.0
    };
    this.controls = new Phaser.Cameras.Controls.SmoothedKeyControl(controlConfig);

    // Touch Controls
    this.input.on('pointermove', this.handleTouchMove, this);
    this.input.on('pointerup', this.handleTap, this);
    
    // Mouse Wheel Zoom
    this.input.on('wheel', (_pointer: Phaser.Input.Pointer, _gameObjects: any, _deltaX: number, deltaY: number, _deltaZ: number) => {
        const zoom = this.cameras.main.zoom;
        const newZoom = deltaY > 0 ? zoom * 0.9 : zoom * 1.1;
        this.cameras.main.setZoom(Phaser.Math.Clamp(newZoom, 0.5, 4.0));
    });

    // Instructions
    this.add.text(16, 60, 'Controls:\nArrows/Drag to Pan\nQ/E/Wheel to Zoom\n[D] Debug Info', {
        fontSize: '14px',
        color: '#aaaaaa'
    });

    // ... (Keep existing grid drawing)
    // Draw a grid to verify Phaser is running
    const graphics = this.add.graphics();
    graphics.lineStyle(1, 0x00ff00, 0.3);
    
    // Draw 32x32 grid
    const width = this.scale.width;
    const height = this.scale.height;

    for (let x = 0; x < width; x += 32) {
      graphics.moveTo(x, 0);
      graphics.lineTo(x, height);
    }
    for (let y = 0; y < height; y += 32) {
      graphics.moveTo(0, y);
      graphics.lineTo(width, y);
    }
    graphics.strokePath();

    this.add.text(16, 16, 'Phaser Initialized\nNeuro-Symbolic Engine Ready', {
      fontSize: '18px',
      color: '#ffffff'
    });

    // Add a rotating square to prove non-blocking behavior
    const spinner = this.add.rectangle(width / 2, height / 2, 64, 64, 0x00ff00);
    this.tweens.add({
        targets: spinner,
        angle: 360,
        duration: 2000,
        repeat: -1
    });

    // Listen for Tone Events
    window.addEventListener('PHASER_SET_TONE', ((e: CustomEvent) => {
        const tone = e.detail;
        this.cameras.main.resetPostPipeline();
        if (tone === 'Sepia') this.cameras.main.setPostPipeline('SepiaPipeline');
        if (tone === 'Night') this.cameras.main.setPostPipeline('NightPipeline');
        if (tone === 'Toxic') this.cameras.main.setPostPipeline('ToxicPipeline');
    }) as EventListener);

    // Listen for Map Draw Events
    window.addEventListener('PHASER_DRAW_MAP', ((e: CustomEvent) => {
        const mapData = e.detail as MapData;
        this.renderMap(mapData);
    }) as EventListener);

    // Debug Stats
    this.input.keyboard!.on('keydown-D', () => {
        this.debugVisible = !this.debugVisible;
        this.debugText.setVisible(this.debugVisible);
    });
    
    this.debugText = this.add.text(16, 150, '', {
        fontSize: '12px',
        color: '#00ff00',
        backgroundColor: '#00000088'
    });
    this.debugText.setVisible(false);
    this.debugText.setScrollFactor(0); // Fix to screen
  }

  private debugVisible = false;
  private debugText!: Phaser.GameObjects.Text;

  update(_time: number, delta: number) {
      if (this.controls) {
          this.controls.update(delta);
      }

      if (this.debugVisible) {
          const fps = this.game.loop.actualFps.toFixed(1);
          const sprites = this.mapContainer.list.length;
          const blitterItems = this.floorBlitter.children.length;
          const camX = this.cameras.main.scrollX.toFixed(0);
          const camY = this.cameras.main.scrollY.toFixed(0);
          const zoom = this.cameras.main.zoom.toFixed(2);
          
          // Texture Memory Audit
          const textureMem = this.getTextureMemoryUsage();

          this.debugText.setText(
              `FPS: ${fps}\nSprites: ${sprites}\nBlitter Objs: ${blitterItems}\nTex Mem: ${textureMem}\nCam: ${camX}, ${camY} (x${zoom})`
          );
      }
  }

  private getTextureMemoryUsage(): string {
      let totalBytes = 0;
      const textures = this.textures.list;
      
      for (const key in textures) {
          const texture = textures[key];
          texture.source.forEach(source => {
              totalBytes += source.width * source.height * 4; // Approx 4 bytes per pixel (RGBA)
          });
      }

      const mb = totalBytes / (1024 * 1024);
      return `${mb.toFixed(2)} MB`;
  }

  private handleTouchMove(pointer: Phaser.Input.Pointer) {
    // 1. Dual Touch (Pinch/Pan)
    if (this.input.pointer1.isDown && this.input.pointer2.isDown) {
        // ... (Existing Dual Touch Logic) ...
        const dist = Phaser.Math.Distance.Between(
            this.input.pointer1.x, this.input.pointer1.y,
            this.input.pointer2.x, this.input.pointer2.y
        );

        if (!this.pinchState.active) {
            this.pinchState.active = true;
            this.pinchState.initialDistance = dist;
            this.pinchState.initialZoom = this.cameras.main.zoom;
        } else {
            const scale = dist / this.pinchState.initialDistance;
            this.cameras.main.setZoom(Phaser.Math.Clamp(this.pinchState.initialZoom * scale, 0.5, 4.0));
        }

        const midX = (this.input.pointer1.x + this.input.pointer2.x) / 2;
        const midY = (this.input.pointer1.y + this.input.pointer2.y) / 2;

        if (this.panState.active) {
            const dx = midX - this.panState.lastX;
            const dy = midY - this.panState.lastY;
            this.cameras.main.scrollX -= dx / this.cameras.main.zoom;
            this.cameras.main.scrollY -= dy / this.cameras.main.zoom;
        }

        this.panState.active = true;
        this.panState.lastX = midX;
        this.panState.lastY = midY;

    } 
    // 2. Single Pointer (Mouse/Touch Drag)
    else if (pointer.isDown) {
        if (this.panState.active) {
            const dx = pointer.x - this.panState.lastX;
            const dy = pointer.y - this.panState.lastY;
            this.cameras.main.scrollX -= dx / this.cameras.main.zoom;
            this.cameras.main.scrollY -= dy / this.cameras.main.zoom;
        }
        
        this.panState.active = true;
        this.panState.lastX = pointer.x;
        this.panState.lastY = pointer.y;
    }
    else {
        // Reset states if fingers lifted
        this.pinchState.active = false;
        this.panState.active = false;
    }
  }

  private handleTap(pointer: Phaser.Input.Pointer) {
    // Ignore if it was a drag or pinch
    if (pointer.getDuration() > 300 || pointer.getDistance() > 10) return;

    const worldPoint = pointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
    
    // Fat Finger Logic (Radius Search)
    const SEARCH_RADIUS = 40; 
    
    // Adjust for container position
    const localX = worldPoint.x - this.mapContainer.x;
    const localY = worldPoint.y - this.mapContainer.y;

    let closestChild: any = null;
    let closestDist = SEARCH_RADIUS;

    this.mapContainer.list.forEach((child: any) => {
        // Simple distance check
        const dist = Phaser.Math.Distance.Between(child.x, child.y, localX, localY);
        if (dist < closestDist) {
            closestDist = dist;
            closestChild = child;
        }
    });

    if (closestChild) {
        console.log(`[Interaction] Tapped ${closestChild.texture.key}`);
        // Feedback
        this.tweens.add({
            targets: closestChild,
            scaleX: 1.2, scaleY: 1.2,
            duration: 100,
            yoyo: true
        });
    }
  }

  private renderMap(mapData: MapData) {
      // Clear previous map
      this.mapContainer.removeAll(true);
      this.floorBlitter.clear();
      
      const TILE_SIZE = 32;

      // Center the map
      const mapPixelWidth = mapData.width * TILE_SIZE;
      const mapPixelHeight = mapData.height * TILE_SIZE;
      
      const offsetX = (this.scale.width - mapPixelWidth) / 2;
      const offsetY = (this.scale.height - mapPixelHeight) / 2;

      this.mapContainer.setPosition(offsetX, offsetY);
      this.floorBlitter.setPosition(offsetX, offsetY);

      console.log(`[MainScene] Rendering Map with Blitter (Floor) + Sprites (Walls/Items)...`);

      // Render Tiles
      mapData.tiles.forEach(tile => {
          if (tile.layer === 'floor') {
              // OPTIMIZATION: Use Blitter for static floor
              this.floorBlitter.create(
                  tile.x * TILE_SIZE + TILE_SIZE/2, 
                  tile.y * TILE_SIZE + TILE_SIZE/2, 
                  tile.sprite
              );
          } else {
              // Use Sprites for sortable items (Walls, Furniture)
              const sprite = this.assetLoader.createSprite(
                  tile.x * TILE_SIZE + TILE_SIZE/2, 
                  tile.y * TILE_SIZE + TILE_SIZE/2, 
                  tile.sprite
              );
              sprite.setData('layer', tile.layer);
              this.mapContainer.add(sprite);
          }
      });

      // Depth Sort (Only needed for Sprites)
      this.mapContainer.sort('y', (a: any, b: any) => {
          // Sort by Y position for 2.5D effect
          return a.y - b.y;
      });

      // Render Rooms Debug (Optional)
      mapData.rooms.forEach(room => {
          const rect = this.add.rectangle(
              room.x * TILE_SIZE + (room.width * TILE_SIZE) / 2,
              room.y * TILE_SIZE + (room.height * TILE_SIZE) / 2,
              room.width * TILE_SIZE,
              room.height * TILE_SIZE
          );
          rect.setStrokeStyle(2, 0xff0000);
          this.mapContainer.add(rect);
          
          const text = this.add.text(
              room.x * TILE_SIZE, 
              room.y * TILE_SIZE, 
              room.type, 
              { fontSize: '10px', color: '#fff', backgroundColor: '#000' }
          );
          this.mapContainer.add(text);
      });
      
      console.log(`[MainScene] Rendered ${mapData.tiles.length} tiles.`);
  }
}
