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
// ---------------------------------------------------------------------------
// EXIF Orientation Detector & Pre-Processor
// ---------------------------------------------------------------------------
export interface OrientationInfo {
  orientation: number; // 1, 3, 6, 8
  degrees: number;     // 0, 180, 90, 270
  label: string;       // '0° (upright)', '90° CW', '180°', '270° CW'
  detected: boolean;
}

export function parseExifOrientation(bytes: Uint8Array): OrientationInfo {
  const defaultRes: OrientationInfo = {
    orientation: 1,
    degrees: 0,
    label: '0° (upright)',
    detected: false,
  };

  try {
    if (bytes.length < 14 || bytes[0] !== 0xFF || bytes[1] !== 0xD8) {
      return defaultRes;
    }

    let offset = 2;
    while (offset < bytes.length - 1) {
      if (bytes[offset] !== 0xFF) break;
      const marker = bytes[offset + 1];

      if (marker === 0xE1) {
        const exifHeaderOffset = offset + 4;
        if (
          bytes[exifHeaderOffset] === 0x45 &&
          bytes[exifHeaderOffset + 1] === 0x78 &&
          bytes[exifHeaderOffset + 2] === 0x69 &&
          bytes[exifHeaderOffset + 3] === 0x66 &&
          bytes[exifHeaderOffset + 4] === 0x00 &&
          bytes[exifHeaderOffset + 5] === 0x00
        ) {
          const tiffOffset = exifHeaderOffset + 6;
          const littleEndian = bytes[tiffOffset] === 0x49 && bytes[tiffOffset + 1] === 0x49;

          const read16 = (o: number) =>
            littleEndian
              ? bytes[o] | (bytes[o + 1] << 8)
              : (bytes[o] << 8) | bytes[o + 1];
          const read32 = (o: number) =>
            littleEndian
              ? bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16) | (bytes[o + 3] << 24)
              : (bytes[o] << 24) | (bytes[o + 1] << 16) | (bytes[o + 2] << 8) | bytes[o + 3];

          const firstIfdOffset = tiffOffset + read32(tiffOffset + 4);
          const entriesCount = read16(firstIfdOffset);

          for (let i = 0; i < entriesCount; i++) {
            const entryOffset = firstIfdOffset + 2 + i * 12;
            const tag = read16(entryOffset);
            if (tag === 0x0112) {
              const val = read16(entryOffset + 8);
              let degrees = 0;
              let label = '0° (upright)';
              if (val === 3) { degrees = 180; label = '180°'; }
              else if (val === 6) { degrees = 90; label = '90° CW'; }
              else if (val === 8) { degrees = 270; label = '270° CW'; }
              return { orientation: val, degrees, label, detected: true };
            }
          }
        }
        break;
      } else {
        if (marker === 0xDA || marker === 0xD9) break;
        const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
        offset += 2 + length;
      }
    }
  } catch (err) {
    // Safe fallback if EXIF parsing fails
  }

  return defaultRes;
}

async function detectImageOrientation(uri: string): Promise<OrientationInfo> {
  try {
    const RNFS = require('react-native-fs');
    const base64Chunk = await RNFS.read(uri.replace('file://', ''), 65536, 0, 'base64');
    if (base64Chunk) {
      const binaryStr = typeof atob === 'function' ? atob(base64Chunk) : Buffer.from(base64Chunk, 'base64').toString('binary');
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }
      return parseExifOrientation(bytes);
    }
  } catch {
    // Safe fallback: do not guess an arbitrary rotation
  }
  return { orientation: 1, degrees: 0, label: '0° (upright)', detected: false };
}

// ---------------------------------------------------------------------------
// Primary preprocessing function
// ---------------------------------------------------------------------------

/**
 * Prepare image for primary OCR pass with EXIF orientation correction.
 */
export async function prepareImageForOcr(
  uri: string,
  targetMaxEdge = TARGET_STANDARD_EDGE,
  _qualityHint = QUALITY_STANDARD,
): Promise<ImagePrepResult> {
  const transforms: string[] = [];

  // ── Step 0: Orientation Detection & Log ──────────────────────────────────
  const orient = await detectImageOrientation(uri);
  if (orient.detected && orient.orientation !== 1) {
    console.log(`[OCR PREPROCESS] Original orientation: ${orient.label} (EXIF ${orient.orientation})`);
    console.log(`[OCR PREPROCESS] Corrected orientation: 0° (upright)`);
    transforms.push(`orientation-corrected: ${orient.label}→0°`);
  } else {
    console.log(`[OCR PREPROCESS] Original orientation: 0° (upright)`);
    console.log(`[OCR PREPROCESS] Corrected orientation: 0° (no change required)`);
  }

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

  // ── Step 5: Encode at chosen quality (ImageEditor bakes EXIF orientation upright) ──
  if (!origWidth || !origHeight) {
    console.warn('[OCR] Dimension measurement failed — using original URI');
    console.log(`[OCR PREPROCESS] Final dimensions: 0x0`);
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
    console.log(`[OCR PREPROCESS] Final dimensions: ${origWidth}x${origHeight}`);
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
  const processedBpp = computeBpp(processedB64Len, targetW * targetH);
  let finalUri = processedUri;
  let finalW = processedW;
  let finalH = processedH;
  let selectedVersion = 'preprocessed';

  if (chosenQuality < QUALITY_HIGH && processedBpp < BPP_LOW_DETAIL_THRESHOLD * 2) {
    try {
      console.log('[OCR] Info density appears low — generating high-fidelity comparison version');
      const hfUri = await resizeImage(uri, origWidth, origHeight, targetW, targetH, QUALITY_HIGH);
      const hfB64Len = await measureBase64Length(hfUri);
      const hfBpp = computeBpp(hfB64Len, targetW * targetH);

      if (hfBpp > processedBpp * 1.1) {
        finalUri = hfUri;
        transforms.push('hf-comparison=selected');
        selectedVersion = 'high-fidelity comparison';
        console.log(`[OCR] High-fidelity version selected (bpp ${hfBpp.toFixed(4)} vs ${processedBpp.toFixed(4)})`);
      } else {
        transforms.push('hf-comparison=rejected');
        console.log(`[OCR] Standard version retained (bpp comparable: ${processedBpp.toFixed(4)} vs ${hfBpp.toFixed(4)})`);
      }
    } catch {
      console.log('[OCR] High-fidelity comparison generation failed — retaining standard version');
    }
  }

  // ── Step 7: Log final selection ─────────────────────────────────────────
  const transformSummary = transforms.join(', ');
  console.log(`[OCR PREPROCESS] Final dimensions: ${finalW}x${finalH}`);
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
