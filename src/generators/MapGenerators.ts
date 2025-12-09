import { MapConfig } from '../types/MapConfig';
import { MapData } from '../types/MapData';
import { StructuredGenerator } from './StructuredGenerator';
import { OrganicGenerator } from './OrganicGenerator';
import { GeometricGenerator } from './GeometricGenerator';

export interface IMapGenerator {
  generate(config: MapConfig): MapData;
}

export class GeneratorFactory {
  static getGenerator(type: string): IMapGenerator {
    switch (type) {
      case 'structured': return new StructuredGenerator();
      case 'organic': return new OrganicGenerator();
      case 'geometric': return new GeometricGenerator();
      default: return new StructuredGenerator();
    }
  }
}
