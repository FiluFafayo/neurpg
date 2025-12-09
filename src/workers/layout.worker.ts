import * as Comlink from 'comlink';
import { MapConfig } from '../types/MapConfig';
import { MapData } from '../types/MapData';
import { GeneratorFactory } from '../generators/MapGenerators';

export class LayoutWorker {
  // Simulating a heavy calculation
  generateHeavyMap(size: number): string {
    console.log('Worker: Starting heavy calculation...');
    const start = performance.now();
    
    // Simulate CPU blocking work
    const matrix: number[] = [];
    const iterations = size * 10000; 
    
    for (let i = 0; i < iterations; i++) {
        matrix.push(Math.sqrt(Math.random() * i));
    }
    
    const end = performance.now();
    const message = `Worker: Generated ${iterations} items in ${(end - start).toFixed(2)}ms`;
    console.log(message);
    return message;
  }

  // REAL Generation
  generateMap(config: MapConfig): MapData {
    console.log(`Worker: Generating ${config.type} map...`);
    try {
        const generator = GeneratorFactory.getGenerator(config.type);
        const mapData = generator.generate(config);
        return mapData;
    } catch (e) {
        console.error("Worker Generation Error:", e);
        throw e;
    }
  }
}

Comlink.expose(new LayoutWorker());
