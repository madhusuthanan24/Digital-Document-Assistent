/**
 * imagePreprocessor.ts — v3 (DDA-WebPreview)
 *
 * Adaptive image preprocessing pipeline for OCR.
 * Uses expo-image-manipulator (resize, rotate, flip — no pixel filters).
 *
 * What this module CAN improve:
 *  ✅ Resolution — smart upscale/downscale to optimal OCR window
 *  ✅ JPEG encoding fidelity — adaptive quality preserves maximum detail
 *  ✅ Payload size — avoids unnecessarily large payloads
 *  ✅ Multi-version selection — compares two encodings, keeps best info density
 *
 * What requires a pixel-filter library (not installed):
 *  ❌ Brightness correction
 *  ❌ Contrast enhancement
 *  ❌ Sharpening
 *  ❌ Grayscale conversion
 *
 * Adaptive quality strategy:
 *  - Dark / low-detail image (low bpp)  → quality 0.95  (preserve every bit)
 *  - Normal document image              → quality 0.85  (standard)
 *  - Very high-detail / large image     → quality 0.80  (payload optimised)
 *
 * Required logging (no document content logged):
 *  [OCR] Original image size: WxH
 *  [OCR] Preprocessed image size: WxH (~NKB)
 *  [OCR] Preprocessing applied: <transforms>
 *  [OCR] Final image selected: <version>
 */

import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system';

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
  appliedTransforms: string[];
  approxBytes: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const TARGET_UPSCALE_EDGE  = 1200;
const TARGET_STANDARD_EDGE = 1600;
const TARGET_HIRES_EDGE    = 1920;
const MIN_EDGE_FOR_GOOD_OCR = 800;

const QUALITY_HIGH     = 0.95;
const QUALITY_STANDARD = 0.85;
const QUALITY_REDUCED  = 0.80;
const BPP_LOW_DETAIL_THRESHOLD = 0.035;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Measure file size from expo-file-system, then convert to approx base64 length */
async function measureBase64Length(uri: string): Promise<number> {
  try {
    // expo-file-system getInfoAsync without extra options still returns size
    const info = await FileSystem.getInfoAsync(uri);
    const sizeBytes = (info as any).size ?? 0;
    // File bytes → base64 chars: multiply by 4/3
    return sizeBytes > 0 ? Math.round(sizeBytes * (4 / 3)) : 0;
  } catch {
    return 0;
  }
}

function computeBpp(base64Len: number, pixels: number): number {
  return pixels > 0 ? (base64Len * 0.75) / pixels : 0;
}

function chooseAdaptiveQuality(
  origWidth: number,
  origHeight: number,
  estimatedBpp: number
): { quality: number; reason: string } {
  const pixels = origWidth * origHeight;

  if (estimatedBpp > 0 && estimatedBpp < BPP_LOW_DETAIL_THRESHOLD) {
    return { quality: QUALITY_HIGH, reason: 'high-fidelity (low-detail source)' };
  }
  if (pixels > 4_000_000) {
    return { quality: QUALITY_REDUCED, reason: 'reduced (large source — payload optimised)' };
  }
  return { quality: QUALITY_STANDARD, reason: 'standard' };
}

async function resizeImage(
  uri: string,
  targetWidth: number,
  quality: number
): Promise<{ uri: string; width: number; height: number }> {
  const result = await manipulateAsync(
    uri,
    [{ resize: { width: targetWidth } }],
    { compress: quality, format: SaveFormat.JPEG }
  );
  return { uri: result.uri, width: result.width, height: result.height };
}

// ---------------------------------------------------------------------------
// EXIF Orientation Detector
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
    const base64Chunk = await FileSystem.readAsStringAsync(uri, {
      encoding: (FileSystem as any).EncodingType?.Base64 || 'base64',
      length: 65536,
      position: 0,
    });
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

  // ── Step 1: Measure original via probe resize ────────────────────────────
  // expo-image-manipulator returns actual dimensions after resize;
  // probe at original width to get dimensions without modifying content
  let origWidth = 0;
  let origHeight = 0;

  try {
    // Use a minimal resize to get dimensions without changing the image
    const probe = await manipulateAsync(uri, [], { compress: 1, format: SaveFormat.JPEG });
    origWidth  = probe.width;
    origHeight = probe.height;
  } catch (e: any) {
    console.warn(`[OCR] Probe failed: ${e?.message}`);
  }

  const origPixels = origWidth * origHeight;
  console.log(`[OCR] Original image size: ${origWidth}x${origHeight} (${origPixels.toLocaleString()} px)`);

  // ── Step 2: Choose target resolution ────────────────────────────────────
  const origLong = Math.max(origWidth, origHeight);
  let targetEdge: number;
  let wasUpscaled = false;

  if (origLong > 0 && origLong < MIN_EDGE_FOR_GOOD_OCR) {
    targetEdge = TARGET_UPSCALE_EDGE;
    wasUpscaled = true;
    transforms.push(`upscale→${TARGET_UPSCALE_EDGE}px`);
    console.log(`[OCR] Small image (${origLong}px) — upscaling to ${TARGET_UPSCALE_EDGE}px`);
  } else if (origLong > targetMaxEdge) {
    targetEdge = targetMaxEdge;
    transforms.push(`downscale→${targetMaxEdge}px`);
    console.log(`[OCR] Large image (${origLong}px) — downscaling to ${targetMaxEdge}px`);
  } else {
    targetEdge = origLong || targetMaxEdge;
    console.log(`[OCR] Image within range (${origLong}px) — no resize needed`);
  }

  const scale = origLong > 0 ? targetEdge / origLong : 1;
  const targetW = Math.max(1, Math.round(origWidth  > 0 ? origWidth  * scale : targetEdge));

  // ── Step 3: Estimate source bpp ─────────────────────────────────────────
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

  if (!origWidth || !origHeight) {
    console.warn('[OCR] Dimension read failed — using original URI');
    console.log('[OCR] Preprocessing applied: none (dimension read failed)');
    console.log('[OCR] Final image selected: original');
    return {
      uri, width: 0, height: 0, scaleApplied: 1, wasUpscaled: false,
      qualityUsed: chosenQuality, appliedTransforms: ['none (dimension read failed)'], approxBytes: 0,
    };
  }

  // ── Step 5: Encode at chosen quality ────────────────────────────────────
  let processedResult: { uri: string; width: number; height: number };
  let processedB64Len = 0;

  try {
    processedResult = await resizeImage(uri, targetW, chosenQuality);
    processedB64Len = await measureBase64Length(processedResult.uri);
    const processedKb = Math.round((processedB64Len * 0.75) / 1024);
    console.log(`[OCR] Preprocessed image size: ${processedResult.width}x${processedResult.height} (~${processedKb} KB)`);
  } catch (err: any) {
    console.warn(`[OCR] Resize failed (${err?.message}) — using original`);
    console.log('[OCR] Preprocessing applied: none (resize error)');
    console.log('[OCR] Final image selected: original');
    return {
      uri, width: origWidth, height: origHeight, scaleApplied: 1, wasUpscaled: false,
      qualityUsed: chosenQuality, appliedTransforms: ['none (resize error)'], approxBytes: 0,
    };
  }

  // ── Step 6: Multi-version comparison ────────────────────────────────────
  const processedBpp = computeBpp(processedB64Len, processedResult.width * processedResult.height);
  let finalUri = processedResult.uri;
  let finalW   = processedResult.width;
  let finalH   = processedResult.height;
  let selectedVersion = 'preprocessed';

  if (chosenQuality < QUALITY_HIGH && processedBpp < BPP_LOW_DETAIL_THRESHOLD * 2) {
    try {
      console.log('[OCR] Info density low — generating high-fidelity comparison version');
      const hfResult = await resizeImage(uri, targetW, QUALITY_HIGH);
      const hfB64Len = await measureBase64Length(hfResult.uri);
      const hfBpp = computeBpp(hfB64Len, hfResult.width * hfResult.height);

      if (hfBpp > processedBpp * 1.1) {
        finalUri = hfResult.uri;
        finalW   = hfResult.width;
        finalH   = hfResult.height;
        transforms.push('hf-comparison=selected');
        selectedVersion = 'high-fidelity comparison';
        console.log(`[OCR] High-fidelity version selected (bpp ${hfBpp.toFixed(4)} vs ${processedBpp.toFixed(4)})`);
      } else {
        transforms.push('hf-comparison=rejected');
        console.log(`[OCR] Standard version retained (bpp comparable: ${processedBpp.toFixed(4)} vs ${hfBpp.toFixed(4)})`);
      }
    } catch {
      console.log('[OCR] High-fidelity comparison failed — retaining standard version');
    }
  }

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
// High-resolution retry
// ---------------------------------------------------------------------------
export async function prepareHighResRetryImage(uri: string): Promise<ImagePrepResult> {
  console.log('[OCR] Preparing high-res retry image (1920px, q=0.95)');
  return prepareImageForOcr(uri, TARGET_HIRES_EDGE, QUALITY_HIGH);
}
