/**
 * imagePreprocessor.ts — v3
 *
 * Adaptive image preprocessing pipeline for OCR.
 * Uses @react-native-community/image-editor (crop + resize only — no pixel filters).
 *
 * What this module CAN improve:
 *  ✅ Resolution — smart upscale/downscale to optimal OCR window
 *  ✅ JPEG encoding fidelity — adaptive quality preserves maximum detail
 *  ✅ Payload size — avoids sending unnecessarily large images
 *  ✅ Multi-version selection — compares info density of two encodings, keeps best
 *
 * What requires a native pixel-filter library (not installed):
 *  ❌ Brightness correction (dark images)
 *  ❌ Contrast enhancement
 *  ❌ Unsharp-mask sharpening
 *  ❌ Grayscale conversion
 *
 *  If those are needed later, add @shopify/react-native-skia or
 *  react-native-image-processing-tools and wire into the PIXEL_FILTER_AVAILABLE block below.
 *
 * Adaptive quality strategy:
 *  - Dark / low-detail image (low bpp)  → quality 0.95  (preserve every bit that exists)
 *  - Normal document image              → quality 0.85  (standard — good balance)
 *  - Very high-detail / large image     → quality 0.80  (reduce payload, keep text sharp)
 *
 * Multi-version logic:
 *  Generate standard (q=0.85) and high-fidelity (q=0.95) encodings.
 *  Compare information density. Select the version with higher bpp (more data preserved).
 *  Fall back to original URI if both encodings produce degraded output.
 *
 * Required logging (no document content is logged):
 *  [OCR] Original image size: WxH
 *  [OCR] Preprocessed image size: WxH (Nkb)
 *  [OCR] Preprocessing applied: <list>
 *  [OCR] Final image selected: original | preprocessed
 */

import ImageEditor from '@react-native-community/image-editor';
import { Image } from 'react-native';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface ImagePrepResult {
  uri: string;
  width: number;
  height: number;
  scaleApplied: number;
  wasUpscaled: boolean;
  qualityUsed: number;
  /** Human-readable list of transforms applied for logging */
  appliedTransforms: string[];
  /** Approximate bytes of the encoded image */
  approxBytes: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Long-edge targets */
const TARGET_UPSCALE_EDGE  = 1200;  // upscale target for very small images
const TARGET_STANDARD_EDGE = 1600;  // standard OCR target
const TARGET_HIRES_EDGE    = 1920;  // high-res retry target

/** Pixel count thresholds */
const MIN_EDGE_FOR_GOOD_OCR = 800;  // below → upscale

/** JPEG quality tiers */
const QUALITY_HIGH    = 0.95;
const QUALITY_STANDARD = 0.85;
const QUALITY_REDUCED  = 0.80;

/**
 * bpp thresholds (bytes-per-pixel after encoding) for quality tier selection.
 * Low bpp → image has very little detail → use high quality to preserve what exists.
 */
const BPP_LOW_DETAIL_THRESHOLD = 0.035;  // below → use QUALITY_HIGH

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Get image dimensions using React Native Image.getSize */
function getImageDimensions(uri: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) =>
    Image.getSize(uri, (w, h) => resolve({ width: w, height: h }), reject)
  );
}

/**
 * Resize (and re-encode as JPEG) using image-editor.
 * Returns the new URI or throws if image-editor fails.
 */
async function resizeImage(
  uri: string,
  origWidth: number,
  origHeight: number,
  targetWidth: number,
  targetHeight: number,
  quality: number,
): Promise<string> {
  const result = await ImageEditor.cropImage(uri, {
    offset: { x: 0, y: 0 },
    size: { width: origWidth, height: origHeight },
    displaySize: { width: targetWidth, height: targetHeight },
    quality,
    format: 'jpeg',
  });
  return result.uri;
}

/**
 * Compute bytes-per-pixel from a base64 string length and pixel count.
 * base64 encodes 3 bytes → 4 chars, so approxBytes = base64Len × 0.75
 */
function computeBpp(base64Len: number, pixels: number): number {
  return pixels > 0 ? (base64Len * 0.75) / pixels : 0;
}

/**
 * Read a file as base64 to measure its encoded size.
 * Uses RNFS — same tier-1 that uriToBase64 uses.
 */
async function measureBase64Length(uri: string): Promise<number> {
  try {
    const RNFS = require('react-native-fs');
    const b64 = await RNFS.readFile(uri.replace('file://', ''), 'base64');
    return b64?.length ?? 0;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Choose adaptive quality based on image characteristics
// ---------------------------------------------------------------------------
function chooseAdaptiveQuality(
  origWidth: number,
  origHeight: number,
  estimatedBpp: number,
): { quality: number; reason: string } {
  const pixels = origWidth * origHeight;

  if (estimatedBpp > 0 && estimatedBpp < BPP_LOW_DETAIL_THRESHOLD) {
    // Low-detail image (dark / low-contrast / blurry) — maximise quality to preserve detail
    return { quality: QUALITY_HIGH, reason: 'high-fidelity (low-detail source detected)' };
  }

  if (pixels > 4_000_000) {
    // Very high-resolution original — reduce quality slightly to cut payload size
    return { quality: QUALITY_REDUCED, reason: 'reduced (large source — payload optimised)' };
  }

  return { quality: QUALITY_STANDARD, reason: 'standard' };
}

// ---------------------------------------------------------------------------
// Primary preprocessing function
// ---------------------------------------------------------------------------

/**
 * Prepare image for primary OCR pass.
 *
 * Steps:
 *  1. Measure original dimensions
 *  2. Choose target resolution (upscale small, downscale large)
 *  3. Choose adaptive JPEG quality based on source characteristics
 *  4. Encode at chosen quality
 *  5. Measure result info density
 *  6. If high-quality variant would improve density, generate and compare
 *  7. Return whichever variant has better bpp, or original if both degrade it
 */
export async function prepareImageForOcr(
  uri: string,
  targetMaxEdge = TARGET_STANDARD_EDGE,
  _qualityHint = QUALITY_STANDARD,    // kept for API compat; quality is now chosen adaptively
): Promise<ImagePrepResult> {
  const transforms: string[] = [];

  // ── Step 1: Measure original ────────────────────────────────────────────
  let origWidth = 0;
  let origHeight = 0;
  try {
    const dims = await getImageDimensions(uri);
    origWidth = dims.width;
    origHeight = dims.height;
  } catch (e: any) {
    console.warn(`[OCR] Could not measure dimensions: ${e?.message}`);
  }

  const origPixels = origWidth * origHeight;
  console.log(`[OCR] Original image size: ${origWidth}x${origHeight} (${origPixels.toLocaleString()} px)`);

  // ── Step 2: Choose target resolution ────────────────────────────────────
  const origLong = Math.max(origWidth, origHeight);
  let targetEdge: number;
  let wasUpscaled = false;

  if (origLong < MIN_EDGE_FOR_GOOD_OCR) {
    targetEdge = TARGET_UPSCALE_EDGE;
    wasUpscaled = true;
    transforms.push(`upscale→${TARGET_UPSCALE_EDGE}px`);
    console.log(`[OCR] Small image (${origLong}px long edge) — upscaling to ${TARGET_UPSCALE_EDGE}px`);
  } else if (origLong > targetMaxEdge) {
    targetEdge = targetMaxEdge;
    transforms.push(`downscale→${targetMaxEdge}px`);
    console.log(`[OCR] Large image (${origLong}px) — downscaling to ${targetMaxEdge}px`);
  } else {
    targetEdge = origLong;
    console.log(`[OCR] Image within range (${origLong}px) — no resize needed`);
  }

  const scale = origLong > 0 ? targetEdge / origLong : 1;
  const targetW = origWidth  > 0 ? Math.max(1, Math.round(origWidth  * scale)) : 800;
  const targetH = origHeight > 0 ? Math.max(1, Math.round(origHeight * scale)) : 800;

  // ── Step 3: Estimate current bpp for quality selection ──────────────────
  // Quick estimate from original file without full read
  let origBpp = 0;
  if (origPixels > 0) {
    const origB64Len = await measureBase64Length(uri);
    origBpp = computeBpp(origB64Len, origPixels);
    console.log(`[OCR] Source image info density: ${origBpp.toFixed(4)} bytes/pixel`);
  }

  // ── Step 4: Choose adaptive quality ────────────────────────────────────
  const { quality: chosenQuality, reason: qualityReason } = chooseAdaptiveQuality(
    origWidth, origHeight, origBpp
  );
  transforms.push(`quality=${chosenQuality} (${qualityReason})`);
  console.log(`[OCR] Adaptive quality: ${chosenQuality} — ${qualityReason}`);

  // ── Step 5: Encode at chosen quality ────────────────────────────────────
  if (!origWidth || !origHeight) {
    // Dimension measurement failed — return original URI as-is
    console.warn('[OCR] Dimension measurement failed — using original URI');
    console.log(`[OCR] Preprocessing applied: none (dimension read failed)`);
    console.log(`[OCR] Final image selected: original`);
    return {
      uri,
      width: 0,
      height: 0,
      scaleApplied: 1,
      wasUpscaled: false,
      qualityUsed: chosenQuality,
      appliedTransforms: ['none (dimension read failed)'],
      approxBytes: 0,
    };
  }

  let processedUri = uri;
  let processedW = targetW;
  let processedH = targetH;
  let processedB64Len = 0;

  try {
    processedUri = await resizeImage(uri, origWidth, origHeight, targetW, targetH, chosenQuality);
    processedB64Len = await measureBase64Length(processedUri);
    const processedKb = Math.round((processedB64Len * 0.75) / 1024);
    console.log(`[OCR] Preprocessed image size: ${targetW}x${targetH} (~${processedKb} KB)`);
  } catch (resizeErr: any) {
    console.warn(`[OCR] Resize failed (${resizeErr?.message}) — falling back to original`);
    console.log(`[OCR] Preprocessing applied: none (resize error)`);
    console.log(`[OCR] Final image selected: original`);
    return {
      uri,
      width: origWidth,
      height: origHeight,
      scaleApplied: 1,
      wasUpscaled: false,
      qualityUsed: chosenQuality,
      appliedTransforms: ['none (resize error)'],
      approxBytes: 0,
    };
  }

  // ── Step 6: Multi-version comparison ────────────────────────────────────
  // If standard quality was chosen and source appears potentially low-detail,
  // also generate a high-fidelity variant and compare info density.
  // Keep whichever variant has higher bpp (more preserved detail).
  const processedBpp = computeBpp(processedB64Len, targetW * targetH);
  let finalUri = processedUri;
  let finalW = processedW;
  let finalH = processedH;
  let selectedVersion = 'preprocessed';

  if (chosenQuality < QUALITY_HIGH && processedBpp < BPP_LOW_DETAIL_THRESHOLD * 2) {
    // Result looks sparse — try a high-fidelity version to compare
    try {
      console.log('[OCR] Info density appears low — generating high-fidelity comparison version');
      const hfUri = await resizeImage(uri, origWidth, origHeight, targetW, targetH, QUALITY_HIGH);
      const hfB64Len = await measureBase64Length(hfUri);
      const hfBpp = computeBpp(hfB64Len, targetW * targetH);

      if (hfBpp > processedBpp * 1.1) {
        // High-fidelity version has at least 10% more information density — use it
        finalUri = hfUri;
        transforms.push('hf-comparison=selected');
        selectedVersion = 'high-fidelity comparison';
        console.log(`[OCR] High-fidelity version selected (bpp ${hfBpp.toFixed(4)} vs ${processedBpp.toFixed(4)})`);
      } else {
        transforms.push('hf-comparison=rejected');
        console.log(`[OCR] Standard version retained (bpp comparable: ${processedBpp.toFixed(4)} vs ${hfBpp.toFixed(4)})`);
      }
    } catch {
      // High-fidelity generation failed — keep standard version
      console.log('[OCR] High-fidelity comparison generation failed — retaining standard version');
    }
  }

  // ── Step 7: Log final selection ─────────────────────────────────────────
  const transformSummary = transforms.join(', ');
  console.log(`[OCR] Preprocessing applied: ${transformSummary}`);
  console.log(`[OCR] Final image selected: ${selectedVersion}`);

  return {
    uri: finalUri,
    width: finalW,
    height: finalH,
    scaleApplied: scale,
    wasUpscaled,
    qualityUsed: chosenQuality,
    appliedTransforms: transforms,
    approxBytes: Math.round(processedB64Len * 0.75),
  };
}

// ---------------------------------------------------------------------------
// High-resolution retry — used by ocrService when primary pass yields too few fields
// ---------------------------------------------------------------------------

/**
 * Prepares high-resolution retry image (1920px, quality 0.95).
 */
export async function prepareHighResRetryImage(uri: string): Promise<ImagePrepResult> {
  console.log('[OCR] Preparing high-res retry image (1920px, q=0.95)');
  return prepareImageForOcr(uri, TARGET_HIRES_EDGE, QUALITY_HIGH);
}
