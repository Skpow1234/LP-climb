// Minimal ambient types for `gifenc` (no bundled .d.ts upstream).
// Only declares the surface we use in the GIF renderer.
//
// `gifenc` is published as CommonJS, so Node's ESM loader can only expose its
// `module.exports` as a default import. We declare both the default and named
// exports for type-level compatibility; runtime code imports the default.
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

  export type QuantizeOptions = {
    format?: "rgb444" | "rgb565" | "rgba4444";
    oneBitAlpha?: boolean | number;
    clearAlpha?: boolean;
    clearAlphaThreshold?: number;
    clearAlphaColor?: number;
  };

  export function GIFEncoder(): GifEncoderInstance;

  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    opts?: QuantizeOptions
  ): Palette;

  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray,
    palette: Palette,
    format?: "rgb444" | "rgb565" | "rgba4444"
  ): Uint8Array;

  const gifenc: {
    GIFEncoder: typeof GIFEncoder;
    quantize: typeof quantize;
    applyPalette: typeof applyPalette;
  };
  export default gifenc;
}
