// Minimal ambient types for `gifenc` (no bundled .d.ts upstream).
// Only declares the surface we use in the GIF renderer.
declare module "gifenc" {
  export type Palette = number[][];

  export interface GifEncoderFrameOptions {
    palette?: Palette;
    delay?: number;
    transparent?: boolean;
    transparentIndex?: number;
    dispose?: number;
    first?: boolean;
    repeat?: number;
  }

  export interface GifEncoderInstance {
    writeFrame(
      index: Uint8Array | Uint8ClampedArray,
      width: number,
      height: number,
      opts?: GifEncoderFrameOptions
    ): void;
    finish(): void;
    bytes(): Uint8Array;
    reset(): void;
  }

  export function GIFEncoder(): GifEncoderInstance;

  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    opts?: { format?: "rgb444" | "rgb565" | "rgba4444"; oneBitAlpha?: boolean | number; clearAlpha?: boolean; clearAlphaThreshold?: number; clearAlphaColor?: number }
  ): Palette;

  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray,
    palette: Palette,
    format?: "rgb444" | "rgb565" | "rgba4444"
  ): Uint8Array;
}
