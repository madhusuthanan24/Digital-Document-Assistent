/**
 * imageQualityAnalyzer.ts
 *
 * Analyzes image quality BEFORE sending to the Vision AI API.
 * Uses image dimensions and JPEG compression-ratio heuristics to detect:
 *
 *  1. Very low resolution  — width × height below usable threshold
 *  2. Excessive blur       — low-detail images compress very efficiently → low bytes/pixel
 *  3. Very dark image      — near-uniform dark images compress extremely small
 *  4. Overexposed image    — near-uniform bright images also compress very small
 *  5. Potentially unusable — combined score below threshold
 *
 * Detection method:
 *   After JPEG encoding at quality 0.85, the base64 string length encodes the
 *   information density of the image:
 *     approxBytes = base64Length × 0.75
 *     bytesPerPixel = approxBytes / (width × height)
 *
 *   High-detail images (good documents) → high bytes/pixel (0.08–0.3+)
 *   Blurry / dark / overexposed images  → low bytes/pixel (< 0.02)
 *
 * IMPORTANT: Thresholds are deliberately conservative to avoid
 * rejecting legitimate documents. Only genuinely unusable images are blocked.
 *
 * NOTE: Document-in-frame ratio and rotation detection require pixel-level
 * access not available in standard React Native — these are handled at the
 * crop stage by the user instead.
 */

export type QualityTier = 'HIGH' | 'MEDIUM' | 'LOW';

export interface QualityResult {
  /** True if the image is good enough to send to AI extraction */
  usable: boolean;
  /** Overall quality tier */
  quality: QualityTier;
  /** Human-readable issues detected (empty array when quality is HIGH) */
  issues: string[];
  /** Score 0–100 for debugging/logging */
  score: number;
  /** Diagnostics for logging only — not shown to users */
  diagnostics: {
    widthPx: number;
    heightPx: number;
    totalPixels: number;
    approxBytes: number;
    bytesPerPixel: number;
    wasUpscaled: boolean;
  };
}

// ---------------------------------------------------------------------------
// Thresholds — tuned conservatively to avoid false positives
// ---------------------------------------------------------------------------

/** Minimum acceptable pixel count (width × height after resize) */
const MIN_PIXELS_HARD = 40_000;   // ~200×200px — genuinely unusable
const MIN_PIXELS_WARN = 120_000;  // ~346×346px — may be low quality

/**
 * Bytes-per-pixel thresholds after JPEG q=0.85 encoding.
 * Below HARD → very likely dark/blank/extremely blurry → block
 * Below WARN → may be blurry or low contrast → warn but allow
 *
 * Calibration:
 *   Good document at 1600×1200, JPEG q=0.85 ≈ 150–500 KB → 0.08–0.26 B/px
 *   Severely blurry/dark at same resolution ≈ 3–15 KB  → 0.0016–0.008 B/px
 */
const BPP_HARD_LOW = 0.010;  // below this → almost certainly unusable
const BPP_WARN_LOW = 0.035;  // below this → warn, may struggle with extraction

// Minimum base64 length sanity guard (encoding failure / empty image)
const MIN_BASE64_LENGTH = 500;

// ---------------------------------------------------------------------------
// Main analysis function
// ---------------------------------------------------------------------------

/**
 * Analyzes image quality from the prepared image dimensions and its base64 string.
 *
 * @param width         Width in pixels of the prepared (resized) image
 * @param height        Height in pixels of the prepared (resized) image
 * @param base64Length  Length of the base64-encoded JPEG string
 * @param wasUpscaled   True if the image was upscaled from a very small original
 */
export function analyzeImageQuality(
  width: number,
  height: number,
  base64Length: number,
  wasUpscaled: boolean
): QualityResult {
  const issues: string[] = [];
  let score = 100;

  const totalPixels = width * height;
  // base64 encodes 3 binary bytes → 4 ASCII chars, so binary bytes ≈ base64Length × 0.75
  const approxBytes = Math.round(base64Length * 0.75);
  const bytesPerPixel = totalPixels > 0 ? approxBytes / totalPixels : 0;

  // ── Check 1: Base64 sanity (encoding/conversion failure) ─────────────────
  if (base64Length < MIN_BASE64_LENGTH) {
    issues.push('Image could not be read correctly — please try again.');
    score -= 60;
  }

  // ── Check 2: Resolution ───────────────────────────────────────────────────
  if (totalPixels < MIN_PIXELS_HARD) {
    issues.push('Image resolution is too low for reliable text extraction.');
    score -= 45;
  } else if (totalPixels < MIN_PIXELS_WARN) {
    issues.push('Image resolution is low — some fields may not extract correctly.');
    score -= 20;
  }

  // ── Check 3: Was upscaled (original was tiny) ─────────────────────────────
  if (wasUpscaled && totalPixels < MIN_PIXELS_WARN) {
    // Only penalise if still small after upscale — extreme case
    if (!issues.find(i => i.includes('resolution'))) {
      issues.push('Original image was very small — text may be pixelated.');
    }
    score -= 10;
  }

  // ── Check 4: Information density (blur / darkness / overexposure) ─────────
  // Only run density check when we have enough pixels to make it meaningful
  if (totalPixels >= MIN_PIXELS_WARN && base64Length >= MIN_BASE64_LENGTH) {
    if (bytesPerPixel < BPP_HARD_LOW) {
      issues.push(
        'Image appears too dark, overexposed, or severely blurry. ' +
        'Please capture with better lighting and focus.'
      );
      score -= 55;
    } else if (bytesPerPixel < BPP_WARN_LOW) {
      issues.push(
        'Image may be blurry or have poor contrast. ' +
        'Extraction may be incomplete — consider recapturing.'
      );
      score -= 25;
    }
  }

  // Clamp score
  score = Math.max(0, Math.min(100, score));

  // ── Quality tier ──────────────────────────────────────────────────────────
  const quality: QualityTier =
    score >= 70 ? 'HIGH' :
    score >= 40 ? 'MEDIUM' :
    'LOW';

  // ── Usability gate ────────────────────────────────────────────────────────
  // Only block extraction when score is genuinely critical (< 25).
  // This is intentionally lenient — extraction + retry handles edge cases.
  const usable = score >= 25;

  const result: QualityResult = {
    usable,
    quality,
    issues,
    score,
    diagnostics: {
      widthPx: width,
      heightPx: height,
      totalPixels,
      approxBytes,
      bytesPerPixel: Math.round(bytesPerPixel * 10000) / 10000,
      wasUpscaled,
    },
  };

  console.log(
    `[OCR Quality] score=${score} quality=${quality} usable=${usable} ` +
    `bpp=${result.diagnostics.bytesPerPixel} px=${totalPixels} ` +
    `issues=${issues.length > 0 ? issues.join('; ') : 'none'}`
  );

  return result;
}

/**
 * Returns a single user-facing message from a QualityResult.
 * Returns null when image is fully acceptable (HIGH + no issues).
 */
export function getQualityUserMessage(result: QualityResult): string | null {
  if (result.quality === 'HIGH' && result.issues.length === 0) return null;

  if (!result.usable) {
    return (
      'Image quality is too low to extract text reliably.\n\n' +
      result.issues.join('\n') +
      '\n\nPlease capture the document again with better lighting and focus, ' +
      'and ensure the document fills most of the frame.'
    );
  }

  if (result.quality === 'MEDIUM') {
    return (
      'Image quality is acceptable but may limit extraction accuracy.\n' +
      result.issues.join('\n')
    );
  }

  return null;
}
