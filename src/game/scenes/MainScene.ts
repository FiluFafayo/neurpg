import Phaser from 'phaser';
import { AssetLoader } from '../AssetLoader';
import { AssetMapper } from '../AssetMapper';

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
    this.input.on('pointermove', this.handlePointerMove, this);
    this.input.on('pointerup', this.handleTap, this);
    this.input.on('wheel', this.handleWheel, this);

    // Instructions
    this.add.text(16, 60, 'Controls:\nArrows/Drag to Pan\nScroll/Pinch to Zoom\n[D] Debug Info', {
        fontSize: '14px',
        color: '#aaaaaa'
    });

    // Grid drawing logic moved to renderMap() to persist after regeneration.

    this.add.text(16, 16, 'Phaser Initialized\nNeuro-Symbolic Engine Ready', {
      fontSize: '18px',
      color: '#ffffff'
    });

    // Add a rotating square to prove non-blocking behavior
    const spinner = this.add.rectangle(this.scale.width / 2, this.scale.height / 2, 64, 64, 0x00ff00);
    this.tweens.add({
        targets: spinner,
        angle: 360,
        duration: 2000,
        repeat: -1
    });

    // Listen for Tone Events
    window.addEventListener('PHASER_SET_TONE', ((e: CustomEvent) => {
        // Guard Clause: Don't run if scene is dead
        if (!this.sys || !this.sys.isActive() || !this.cameras || !this.cameras.main) return;

        const tone = e.detail;
        this.cameras.main.resetPostPipeline();
        if (tone === 'Sepia') this.cameras.main.setPostPipeline('SepiaPipeline');
        if (tone === 'Night') this.cameras.main.setPostPipeline('NightPipeline');
        if (tone === 'Toxic') this.cameras.main.setPostPipeline('ToxicPipeline');
    }) as EventListener);

    // Listen for Map Draw Events
    window.addEventListener('PHASER_DRAW_MAP', ((e: CustomEvent) => {
        if (!this.sys || !this.sys.isActive()) return;
        
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
      // Fix: Cast 'list' explicitly to Record to satisfy TS7053
      const textures = this.textures.list as Record<string, Phaser.Textures.Texture>;
      
      for (const key in textures) {
          const texture = textures[key];
          // Fix: Explicit type for 'source' to satisfy TS7006
          texture.source.forEach((source: Phaser.Textures.TextureSource) => {
              totalBytes += source.width * source.height * 4; // Approx 4 bytes per pixel (RGBA)
          });
      }

      const mb = totalBytes / (1024 * 1024);
      return `${mb.toFixed(2)} MB`;
  }

  // Fix: Rename unused 'pointer' to '_pointer' to satisfy TS6133
  private handleWheel(_pointer: Phaser.Input.Pointer, _over: any, _deltaX: number, deltaY: number, _z: number) {
      const zoomSpeed = 0.001;
      const newZoom = this.cameras.main.zoom - deltaY * zoomSpeed;
      this.cameras.main.setZoom(Phaser.Math.Clamp(newZoom, 0.5, 4.0));
  }

  private handlePointerMove(pointer: Phaser.Input.Pointer) {
    // 1. Two-Finger Touch Logic (Pinch & Pan)
    if (this.input.pointer1.isDown && this.input.pointer2.isDown) {
        // Pinch Zoom
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

        // Pan (Midpoint)
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
        return;
    } 
    
    // 2. Single Pointer Drag (Desktop Pan)
    if (pointer.isDown) {
        if (this.panState.active) {
            const dx = pointer.x - this.panState.lastX;
            const dy = pointer.y - this.panState.lastY;
            this.cameras.main.scrollX -= dx / this.cameras.main.zoom;
            this.cameras.main.scrollY -= dy / this.cameras.main.zoom;
        }
        
        this.panState.active = true;
        this.panState.lastX = pointer.x;
        this.panState.lastY = pointer.y;
    } else {
        // Reset states if no fingers/mouse down
        this.pinchState.active = false;
        this.panState.active = false;
    }
  }

  private handleTap(pointer: Phaser.Input.Pointer) {
    // Ignore if it was a drag or pinch
    if (pointer.getDuration() > 300 || pointer.getDistance() > 10) return;

    const worldPoint = pointer.positionToCamera(this.cameras.main) as Phaser.Math.Vector2;
    
    // Fat Finger Logic (Radius Search)
    // Scale radius by zoom level so "40px on screen" is consistent regardless of zoom
    const SCREEN_HIT_RADIUS = 40; 
    const effectiveRadius = SCREEN_HIT_RADIUS / this.cameras.main.zoom;
    
    // Adjust for container position
    const localX = worldPoint.x - this.mapContainer.x;
    const localY = worldPoint.y - this.mapContainer.y;

    let closestChild: any = null;
    let closestDist = effectiveRadius;

    this.mapContainer.list.forEach((child: any) => {
        // Only consider Sprites (ignore Debug Rects/Text)
        if (child.type !== 'Sprite') return;

        // Simple distance check
        const dist = Phaser.Math.Distance.Between(child.x, child.y, localX, localY);
        if (dist < closestDist) {
            closestDist = dist;
            closestChild = child;
        }
    });

    if (closestChild && closestChild.texture) {
        // Debug info on interaction
        console.log(`[Interaction] Tapped: ${closestChild.texture.key} | Frame: ${closestChild.frame.name}`);
        
        // Visual Feedback (Juice)
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

      // Draw Debug Grid (Dynamic based on Map Size)
      const gridGraphics = this.add.graphics();
      gridGraphics.lineStyle(1, 0xff0000, 0.2); // Red, fainter
      
      const mapW = mapData.width * 32;
      const mapH = mapData.height * 32;

      for (let x = 0; x <= mapW; x += 32) {
        gridGraphics.moveTo(x, 0);
        gridGraphics.lineTo(x, mapH);
      }
      for (let y = 0; y <= mapH; y += 32) {
        gridGraphics.moveTo(0, y);
        gridGraphics.lineTo(mapW, y);
      }
      gridGraphics.strokePath();
      this.mapContainer.add(gridGraphics);
      this.mapContainer.sendToBack(gridGraphics);
      
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
          // Resolve Asset Mapping (Semantic Key -> Texture/Frame/Tint)
          const assetConfig = AssetMapper.getSpriteConfig(tile.sprite);

          if (tile.layer === 'floor') {
              // OPTIMIZATION: Use Blitter for static floor
              const bob = this.floorBlitter.create(
                  tile.x * TILE_SIZE + TILE_SIZE/2, 
                  tile.y * TILE_SIZE + TILE_SIZE/2, 
                  assetConfig.frame
              );
              if (assetConfig.tint) {
                  bob.setTint(assetConfig.tint);
              }
          } else {
              // Use Sprites for sortable items (Walls, Furniture)
              const sprite = this.assetLoader.createSprite(
                  tile.x * TILE_SIZE + TILE_SIZE/2, 
                  tile.y * TILE_SIZE + TILE_SIZE/2, 
                  assetConfig.frame
              );
              sprite.setData('layer', tile.layer);
              if (assetConfig.tint) {
                  sprite.setTint(assetConfig.tint);
              }
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
              room.name || room.type, 
              { fontSize: '10px', color: '#fff', backgroundColor: '#000' }
          );
          this.mapContainer.add(text);
      });
      
      console.log(`[MainScene] Rendered ${mapData.tiles.length} tiles.`);
  }
}
