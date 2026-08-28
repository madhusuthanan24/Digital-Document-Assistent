/**
 * ocrService.ts — v2 (Production-Grade AI Document Extraction Pipeline)
 *
 * Pipeline Stages:
 *  1. Image Smart Resize (upscale small / downscale large) via imagePreprocessor
 *  2. Base64 Encoding (3-tier: RNFS → fetch+FileReader fallback)
 *  2.5 [NEW] Image Quality Check — blocks unusable images before API call
 *  3. Two-Pass: Classify first if category is "Other" / unknown
 *  4. Category-Specific Vision Prompt (documentPrompts)
 *  5. NVIDIA Vision API with Exponential Backoff (429/500/503)
 *  6. 3-Strategy JSON Parser (direct parse → brace-AST → plaintext KV)
 *  7. Field Validation, OCR Correction, Date Normalization (fieldValidators)
 *  8. Per-Field Confidence Scoring
 *  9. Partial-Quality Retry (< 50% expected fields → high-res re-call at temp=0)
 * 10. JSON-parse-fail retry with explicit JSON-only re-prompt
 */

import {
  NVIDIA_API_KEY,
  NVIDIA_ENDPOINT,
  NVIDIA_MODEL,
  NVIDIA_CONFIG,
} from '../../config/nvidia';
import { prepareImageForOcr, prepareHighResRetryImage } from './imagePreprocessor';
import {
  getPromptForCategory,
  needsClassification,
  CLASSIFY_ONLY_PROMPT,
  normalizeDetectedType,
  DOCUMENT_TYPE_PROMPTS,
} from './documentPrompts';
import {
  validateAndPostProcessFields,
  getExpectedFieldCount,
  flattenArrayFields,
} from './fieldValidators';
import { analyzeImageQuality, getQualityUserMessage, QualityResult } from './imageQualityAnalyzer';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface ValidatedField {
  value: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  needsReview: boolean;
  issue?: string;
}

export interface OCRResult {
  documentType: string;
  fields: Record<string, string>;
  validatedFields: Record<string, ValidatedField>;
  fieldConfidence: Record<string, 'high' | 'medium' | 'low'>;
  confidence: 'high' | 'medium' | 'low' | 'none';
  rawText: string;
  imageQuality: QualityResult;
  validationIssues: string[];
  missingRequiredFields: string[];
}

// ---------------------------------------------------------------------------
// Logging helpers
// ---------------------------------------------------------------------------
function logStage(msg: string) {
  console.log(`[OCR] ${msg}`);
}
function logError(stage: string, msg: string) {
  console.warn(`[OCR][${stage}] ${msg}`);
}

// ---------------------------------------------------------------------------
// Base64 Conversion — 3-tier fallback
// ---------------------------------------------------------------------------
async function uriToBase64(uri: string): Promise<string> {
  // Tier 1: react-native-fs (most reliable on Android physical device)
  try {
    const RNFS = require('react-native-fs');
    const cleanPath = uri.replace('file://', '');
    const b64 = await RNFS.readFile(cleanPath, 'base64');
    if (b64 && b64.length > 0) return b64;
  } catch { /* continue */ }

  // Tier 2: expo-file-system (legacy)
  try {
    const ExpoFS = require('expo-file-system/legacy');
    if (ExpoFS?.readAsStringAsync) {
      const b64 = await ExpoFS.readAsStringAsync(uri, {
        encoding: ExpoFS.EncodingType?.Base64 || 'base64',
      });
      if (b64 && b64.length > 0) return b64;
    }
  } catch { /* continue */ }

  // Tier 3: fetch + FileReader (web fallback)
  try {
    const response = await fetch(uri);
    const blob = await response.blob();
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const dataUrl = reader.result as string;
        const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
        resolve(base64);
      };
      reader.onerror = (e) => reject(e);
      reader.readAsDataURL(blob);
    });
  } catch (err: any) {
    logError('BASE64', `All conversion tiers failed: ${err?.message}`);
    throw new Error(`[BASE64] Cannot convert image to base64: ${err?.message}`);
  }
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Markdown Fence Stripper
// ---------------------------------------------------------------------------
export function stripMarkdownFences(text: string): string {
  if (!text) return '';
  let cleaned = text.trim();
  // Strip leading ```json or ```
  cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, '');
  // Strip trailing ```
  cleaned = cleaned.replace(/\n?```\s*$/i, '');
  return cleaned.trim();
}

// ---------------------------------------------------------------------------
// JSON Syntax Repair Utility
// ---------------------------------------------------------------------------
export function repairJsonSyntax(raw: string): string {
  if (!raw) return '';
  let s = raw.trim();

  // 1. Remove trailing commas before closing braces/brackets
  s = s.replace(/,(\s*[}\]])/g, '$1');

  // 2. Fix unescaped control chars if any
  s = s.replace(/[\u0000-\u001F]+/g, (match) => {
    if (match === '\n' || match === '\r' || match === '\t') return match;
    return '';
  });

  return s;
}

// ---------------------------------------------------------------------------
// Robust Multi-Candidate Balanced-Brace JSON Extractor
// ---------------------------------------------------------------------------
export function extractJsonCandidates(text: string): string[] {
  if (!text) return [];

  const candidates: string[] = [];
  const unfenced = stripMarkdownFences(text);

  // If the unfenced text starts with '{' and ends with '}', add as first candidate
  if (unfenced.startsWith('{') && unfenced.endsWith('}')) {
    candidates.push(unfenced);
  }

  // Also check if text has explicit ```json ... ``` blocks
  const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = codeBlockRegex.exec(text)) !== null) {
    const block = match[1].trim();
    if (block.startsWith('{') && block.endsWith('}')) {
      if (!candidates.includes(block)) candidates.push(block);
    }
  }

  // Scan text for all balanced top-level and nested '{' ... '}' blocks
  let depth = 0;
  let startIdx = -1;
  let inString = false;
  let escape = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;

    if (ch === '{') {
      if (depth === 0) startIdx = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && startIdx !== -1) {
        const candidate = text.substring(startIdx, i + 1).trim();
        if (!candidates.includes(candidate)) {
          candidates.push(candidate);
        }
        startIdx = -1;
      }
    }
  }

  return candidates;
}

// Backward-compatible export
export function extractJsonFromText(text: string): string | null {
  const candidates = extractJsonCandidates(text);
  for (const cand of candidates) {
    try {
      JSON.parse(cand);
      return cand;
    } catch {
      try {
        const rep = repairJsonSyntax(cand);
        JSON.parse(rep);
        return rep;
      } catch { /* continue */ }
    }
  }
  return candidates.length > 0 ? candidates[0] : null;
}

// ---------------------------------------------------------------------------
// Structure Validator & Sanitizer
// ---------------------------------------------------------------------------
function validateParsedStructure(
  parsed: any,
  hintType: string
): { documentType: string; fields: Record<string, string> } | null {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }

  const docType = String(parsed.documentType || parsed.type || parsed.docType || hintType || 'Other Document').trim();
  let rawFieldsObj: any = null;

  if (parsed.fields && typeof parsed.fields === 'object') {
    rawFieldsObj = parsed.fields;
  } else if (parsed.data && typeof parsed.data === 'object') {
    rawFieldsObj = parsed.data;
  } else if (parsed.extracted_fields && typeof parsed.extracted_fields === 'object') {
    rawFieldsObj = parsed.extracted_fields;
  } else {
    // Top-level keys treated as fields (excluding metadata keys)
    const filtered: Record<string, any> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (!/^(documentType|type|docType|confidence|status|message|success)$/i.test(k)) {
        filtered[k] = v;
      }
    }
    if (Object.keys(filtered).length > 0) {
      rawFieldsObj = filtered;
    }
  }

  if (!rawFieldsObj) return null;

  const flattened = flattenArrayFields(rawFieldsObj);
  if (!flattened || typeof flattened !== 'object' || Array.isArray(flattened)) {
    return null;
  }

  // Ensure field values are valid scalars/strings and not empty or nested arrays
  const sanitized: Record<string, string> = {};
  for (const [k, v] of Object.entries(flattened)) {
    if (v !== null && v !== undefined && typeof v !== 'object') {
      const strVal = String(v).trim();
      if (strVal.length > 0) {
        sanitized[k] = strVal;
      }
    }
  }

  // Must have at least 1 field or a valid documentType with recognized content
  if (Object.keys(sanitized).length === 0 && !docType) {
    return null;
  }

  return {
    documentType: docType || 'Other Document',
    fields: sanitized,
  };
}

// ---------------------------------------------------------------------------
// Plaintext KV Fallback Parser (Guarded against conversational prose)
// ---------------------------------------------------------------------------
function parsePlainTextResponse(
  content: string,
  hintType: string
): { documentType: string; fields: Record<string, string> } {
  const lines = content.split('\n');
  const rawFields: Record<string, string> = {};
  let detectedType = hintType || 'Other Document';

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Ignore conversational English lines or markdown block delimiters
    if (/^(here|note|rules|summary|analysis|json|output|response|below|above|instruction|sure|i\s+have|the\s+document\s+is|please|this\s+is)/i.test(trimmed)) {
      continue;
    }

    const docTypeMatch = trimmed.match(/^(?:document\s*type|type)\s*[:=-]\s*(.+)/i);
    if (docTypeMatch?.[1]) {
      detectedType = docTypeMatch[1].trim();
      continue;
    }

    // Require strict "Key: Value" formatting with colon or equals
    const kvMatch = trimmed.match(/^(?:[*\-\s]*)([A-Za-z0-9\s'\/().,-]+?)\s*[:=]\s*(.+)$/);
    if (kvMatch) {
      const k = kvMatch[1].trim();
      const v = kvMatch[2].trim();
      if (k.length > 0 && k.length <= 60 && v.length > 0) {
        if (!/^(here|note|rules|summary|analysis|json|output|response|below|above|instruction)/i.test(k)) {
          rawFields[k] = v;
        }
      }
    }
  }
  return { documentType: detectedType, fields: rawFields };
}

// ---------------------------------------------------------------------------
// AI Response Parser (Multi-Tier Robust Strategy)
// ---------------------------------------------------------------------------
export function parseAiResponse(
  content: string,
  hintType: string
): { documentType: string; fields: Record<string, any> } | null {
  if (!content || typeof content !== 'string') return null;

  // Strategy 1: Direct JSON parse on cleaned content
  const cleaned = stripMarkdownFences(content);
  try {
    const parsed = JSON.parse(cleaned);
    const validated = validateParsedStructure(parsed, hintType);
    if (validated && Object.keys(validated.fields).length > 0) {
      return validated;
    }
  } catch { /* continue to next strategy */ }

  // Strategy 2: Embedded JSON extraction with syntax repair across all candidates
  const candidates = extractJsonCandidates(content);
  for (const candidate of candidates) {
    // 2a: Direct parse candidate
    try {
      const parsed = JSON.parse(candidate);
      const validated = validateParsedStructure(parsed, hintType);
      if (validated && Object.keys(validated.fields).length > 0) {
        return validated;
      }
    } catch {
      // 2b: Repaired parse candidate
      try {
        const repaired = repairJsonSyntax(candidate);
        const parsed = JSON.parse(repaired);
        const validated = validateParsedStructure(parsed, hintType);
        if (validated && Object.keys(validated.fields).length > 0) {
          return validated;
        }
      } catch { /* continue */ }
    }
  }

  // Strategy 3: Guarded plaintext KV fallback (only if non-empty key-values extracted)
  const fallback = parsePlainTextResponse(content, hintType);
  if (Object.keys(fallback.fields).length > 0) {
    return { documentType: fallback.documentType, fields: fallback.fields };
  }

  // Log failure without revealing sensitive data
  console.warn(`[OCR][PARSE_FAIL] Could not parse valid structured JSON from AI response (length: ${content.length})`);
  return null;
}

// ---------------------------------------------------------------------------
// Per-Field Confidence Scoring
// ---------------------------------------------------------------------------
const HIGH_CONFIDENCE_KEYS: Record<string, RegExp> = {
  panNumber: /^[A-Z]{5}[0-9]{4}[A-Z]$/,
  aadhaarNumber: /^\d{4}\s\d{4}\s\d{4}$/,
  epicNumber: /^[A-Z]{3}[0-9]{7}$/,
  passportNumber: /^[A-Z][0-9]{7}$/,
  registrationNumber: /^[A-Z]{2}[0-9]{2}[A-Z0-9]{4,7}$/,
  dateOfBirth: /^\d{4}-\d{2}-\d{2}$/,
  issueDate: /^\d{4}-\d{2}-\d{2}$/,
  expiryDate: /^\d{4}-\d{2}-\d{2}$/,
};

function scoreFieldConfidence(
  key: string,
  value: string,
  fromPlaintextFallback: boolean
): 'high' | 'medium' | 'low' {
  if (fromPlaintextFallback) return 'low';
  const lk = key.toLowerCase().replace(/[_\s]/g, '');
  for (const [patternKey, regex] of Object.entries(HIGH_CONFIDENCE_KEYS)) {
    if (lk.includes(patternKey.toLowerCase()) && regex.test(value)) return 'high';
  }
  return 'medium';
}

// ---------------------------------------------------------------------------
// NVIDIA API Call with Exponential Backoff
// ---------------------------------------------------------------------------
async function callNvidiaApiWithBackoff(
  base64Image: string,
  prompt: string,
  maxRetries = 3,
  temperature?: number
): Promise<string> {
  const body = {
    model: NVIDIA_MODEL,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64Image}` } },
        ],
      },
    ],
    temperature: temperature ?? NVIDIA_CONFIG.temperature,
    max_tokens: NVIDIA_CONFIG.max_tokens,
    stream: NVIDIA_CONFIG.stream,
  };

  let attempt = 0;
  let delayMs = 1000;

  while (attempt < maxRetries) {
    attempt++;
    logStage(`API call attempt ${attempt}/${maxRetries}`);

    try {
      const response = await fetch(NVIDIA_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${NVIDIA_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      logStage(`HTTP ${response.status}`);

      if (response.ok) {
        const text = await response.text();
        const json = JSON.parse(text);
        const content = json.choices?.[0]?.message?.content?.trim() || '';
        logStage('AI response received');
        return content;
      }

      if ((response.status === 429 || response.status >= 500) && attempt < maxRetries) {
        console.warn(`[OCR][API] HTTP ${response.status} — retrying in ${delayMs}ms`);
        await new Promise<void>((r) => { setTimeout(() => r(), delayMs); });
        delayMs *= 2;
        continue;
      }

      const errBody = await response.text().catch(() => '');
      throw new Error(`[API_${response.status}] ${errBody.slice(0, 200)}`);
    } catch (err: any) {
      if (attempt >= maxRetries) throw err;
      console.warn(`[OCR][API] Exception on attempt ${attempt}: ${err?.message}`);
      await new Promise<void>((r) => { setTimeout(() => r(), delayMs); });
      delayMs *= 2;
    }
  }

  throw new Error('[API_FAIL] NVIDIA Vision API unreachable after all retries.');
}

// ---------------------------------------------------------------------------
// Pass A: Document Type Detection
// ---------------------------------------------------------------------------
async function classifyDocument(
  base64Image: string,
  userHint: string = ''
): Promise<{ detectedType: string; confidence: string }> {
  logStage(`Running document type detection pass (UI hint: "${userHint || 'none'}")`);
  try {
    const content = await callNvidiaApiWithBackoff(base64Image, CLASSIFY_ONLY_PROMPT, 2, 0);
    let rawType = '';
    let confidence = 'medium';

    try {
      const parsed = JSON.parse(content.trim());
      if (parsed && typeof parsed === 'object') {
        rawType = parsed.documentType || parsed.type || '';
        confidence = parsed.confidence || 'medium';
      }
    } catch {
      const jsonStr = extractJsonFromText(content);
      if (jsonStr) {
        try {
          const parsed = JSON.parse(jsonStr);
          if (parsed && typeof parsed === 'object') {
            rawType = parsed.documentType || parsed.type || '';
            confidence = parsed.confidence || 'medium';
          }
        } catch { /* continue */ }
      }
    }

    if (rawType) {
      logStage(`Classification result: "${rawType}" (confidence: ${confidence})`);
      return { detectedType: rawType, confidence };
    }
  } catch (err: any) {
    console.warn(`[OCR][CLASSIFY] Classification pass failed: ${err?.message}`);
  }

  return { detectedType: userHint || 'Unknown Document', confidence: 'low' };
}

// ---------------------------------------------------------------------------
// Main Exported Function
// ---------------------------------------------------------------------------
export async function extractDocumentDetails(
  finalImageUri: string,
  documentTypeHint: string = ''
): Promise<OCRResult> {
  logStage('=== Extraction pipeline start ===');

  if (!finalImageUri) {
    logError('START', 'No image URI provided');
    throw new Error('No image URI provided for extraction');
  }
  logStage('Image URI valid');

  // ── Stage 1: Adaptive preprocessing ─────────────────────────────────────
  // prepareImageForOcr v3 handles: smart resize, adaptive quality, multi-version comparison.
  // All OCR logging ([OCR] Original / Preprocessed / Preprocessing applied / Final selected)
  // is emitted inside prepareImageForOcr itself.
  const prep = await prepareImageForOcr(finalImageUri, 1600, 0.85);
  logStage(
    `Prep complete: ${prep.width}x${prep.height}` +
    `${prep.wasUpscaled ? ' [UPSCALED]' : ''}` +
    ` q=${prep.qualityUsed}` +
    ` transforms=[${prep.appliedTransforms.join(', ')}]`
  );

  // ── Stage 2: Base64 ──────────────────────────────────────────────────────
  const base64Image = await uriToBase64(prep.uri);
  logStage(`Base64 ready (length=${base64Image.length.toLocaleString()})`);

  // ── Stage 2.5: Image Quality Analysis ────────────────────────────────────
  // Runs synchronously on already-computed values — no extra API call.
  const imageQuality = analyzeImageQuality(
    prep.width,
    prep.height,
    base64Image.length,
    prep.wasUpscaled
  );

  if (!imageQuality.usable) {
    // Image is genuinely unusable — throw before spending API quota
    const userMsg = getQualityUserMessage(imageQuality) ||
      'Image quality is too low. Please capture the document again with better lighting and focus.';
    logError('QUALITY', `Blocked: score=${imageQuality.score} issues=${imageQuality.issues.join('; ')}`);
    const err = new Error(userMsg);
    (err as any).isQualityBlock = true;
    (err as any).qualityResult = imageQuality;
    throw err;
  }

  if (imageQuality.quality === 'MEDIUM') {
    logStage(`Image quality is MEDIUM (score=${imageQuality.score}) — proceeding with caution`);
  } else {
    logStage(`Image quality: ${imageQuality.quality} (score=${imageQuality.score})`);
  }

  // ── Stage 3: Document Type Detection (Pass A) ────────────────────────────
  // UI selection is a HINT, not absolute truth.
  // We run Document Type Detection to identify the true document type dynamically.
  const classification = await classifyDocument(base64Image, documentTypeHint);
  const rawDetectedType = classification.detectedType;

  const canonical = normalizeDetectedType(rawDetectedType);
  const isUnknown =
    !rawDetectedType ||
    rawDetectedType.toLowerCase().includes('unknown') ||
    rawDetectedType.toLowerCase().includes('blank') ||
    rawDetectedType.toLowerCase().includes('solid') ||
    rawDetectedType.toLowerCase().includes('noise') ||
    rawDetectedType === 'Other Document' ||
    (!canonical && rawDetectedType.toLowerCase() !== 'other');

  let resolvedCategory = rawDetectedType;
  if (isUnknown) {
    resolvedCategory = 'Unknown Document';
    logStage(`[OCR] Document type: "Unknown Document" (could not identify reliably as a known document)`);
  } else if (canonical) {
    resolvedCategory = canonical;
    logStage(`[OCR] Document type detected: "${rawDetectedType}" (mapped to "${canonical}", UI hint was: "${documentTypeHint || 'none'}")`);
  } else {
    logStage(`[OCR] Document type detected: "${rawDetectedType}" (UI hint was: "${documentTypeHint || 'none'}")`);
  }

  // ── Stage 4: Document-Specific Extraction Prompt (Pass B) ────────────────
  const prompt = isUnknown
    ? DOCUMENT_TYPE_PROMPTS.Other
    : getPromptForCategory(resolvedCategory);
  logStage(`Extraction prompt resolved for: "${resolvedCategory}"`);

// ---------------------------------------------------------------------------
// Helper: Corrective Prompt Builder for Attempt 2
// ---------------------------------------------------------------------------
function buildCorrectivePrompt(
  basePrompt: string,
  reasons: {
    jsonFailed: boolean;
    typeUnclear: boolean;
    missingRequired: string[];
    validationIssues: string[];
  }
): string {
  let directive = '';
  if (reasons.jsonFailed) {
    directive =
      'Previous attempt failed to produce valid JSON. Output ONLY a valid JSON object matching the requested schema. No conversational prose, no markdown code fences.';
  } else if (reasons.typeUnclear) {
    directive =
      'Previous attempt could not reliably identify the document type. Carefully inspect the header, emblem, logo, and title on this document image. Identify the document type and extract only clearly visible fields without guessing.';
  } else if (reasons.missingRequired.length > 0) {
    directive = `Previous extraction was incomplete. The following important fields were missing: ${reasons.missingRequired.join(
      ', '
    )}. Carefully inspect the image again. Do not guess. Extract only clearly visible fields.`;
  } else if (reasons.validationIssues.length > 0) {
    directive = `Previous extraction contained issues: ${reasons.validationIssues
      .slice(0, 2)
      .join('; ')}. Carefully re-inspect the printed text in the image. Preserve exactly what is printed. Do not invent missing information.`;
  } else {
    directive =
      'Previous extraction was incomplete. Carefully inspect the image again. Do not guess. Extract only clearly visible fields.';
  }

  return `CORRECTIVE INSTRUCTION:\n${directive}\n\n${basePrompt}`;
}

  // ── Stage 5: Attempt 1 — Normal Extraction ───────────────────────────────
  logStage('Attempt 1: Running normal document extraction');
  let aiContent = '';
  let parseResult: { documentType: string; fields: Record<string, any> } | null = null;
  let usedPlaintextFallback = false;

  try {
    aiContent = await callNvidiaApiWithBackoff(base64Image, prompt, 2);
    parseResult = parseAiResponse(aiContent, resolvedCategory);
    const hasJsonObject = extractJsonFromText(aiContent) !== null;
    if (parseResult && !hasJsonObject) usedPlaintextFallback = true;
  } catch (err: any) {
    logError('ATTEMPT_1', err?.message);
  }

  let finalType = isUnknown
    ? 'Unknown Document'
    : (parseResult?.documentType || rawDetectedType || resolvedCategory || 'Other Document');

  let validation = parseResult
    ? validateAndPostProcessFields(finalType, parseResult.fields)
    : null;

  // ── Stage 6: Determine if Controlled Retry (Attempt 2) is needed ──────────
  const jsonFailed = !parseResult || Object.keys(parseResult.fields).length === 0;
  const typeUnclear = isUnknown;
  const missingImportant = (validation?.missingRequiredFields.length || 0) > 0;
  const suspiciousOutput = (validation?.validationIssues.length || 0) > 0;
  const lowConfidence = !validation || validation.overallConfidence === 'low' || validation.overallConfidence === 'none';

  const shouldRetry = jsonFailed || typeUnclear || missingImportant || suspiciousOutput || lowConfidence;

  if (!shouldRetry && validation && validation.validFieldCount >= 2) {
    logStage('Attempt 1 succeeded with high quality — skipping retry');
  } else {
    // ── Stage 7: Attempt 2 — Stronger Corrective Extraction (Max 2 Attempts) ─
    const retryReason = jsonFailed
      ? 'JSON parsing failed'
      : typeUnclear
      ? 'Document type unclear'
      : missingImportant
      ? `Missing required fields (${validation?.missingRequiredFields.join(', ')})`
      : suspiciousOutput
      ? `Suspicious output (${validation?.validationIssues.slice(0, 1).join(', ')})`
      : 'Low extraction confidence';

    logStage(`Attempt 2: Triggering corrective retry (Reason: ${retryReason})`);

    const correctivePrompt = buildCorrectivePrompt(prompt, {
      jsonFailed,
      typeUnclear,
      missingRequired: validation?.missingRequiredFields || [],
      validationIssues: validation?.validationIssues || [],
    });

    try {
      const highResPrep = await prepareHighResRetryImage(finalImageUri);
      const highResB64 = await uriToBase64(highResPrep.uri);
      const retryContent = await callNvidiaApiWithBackoff(highResB64, correctivePrompt, 2, 0);
      const retryParsed = parseAiResponse(retryContent, resolvedCategory);

      if (retryParsed && Object.keys(retryParsed.fields).length > 0) {
        const retryType = isUnknown && retryParsed.documentType && retryParsed.documentType !== 'Unknown Document'
          ? retryParsed.documentType
          : finalType;
        const retryValidation = validateAndPostProcessFields(retryType, retryParsed.fields);

        // Evaluate whether Attempt 2 is better than Attempt 1
        const attempt1Score = validation ? validation.validFieldCount * 10 - validation.validationIssues.length * 5 : -100;
        const attempt2Score = retryValidation.validFieldCount * 10 - retryValidation.validationIssues.length * 5;

        if (attempt2Score >= attempt1Score || !validation) {
          logStage(`Attempt 2 adopted: ${retryValidation.validFieldCount} valid fields (confidence: ${retryValidation.overallConfidence})`);
          parseResult = retryParsed;
          validation = retryValidation;
          aiContent = retryContent;
          finalType = retryType;
          usedPlaintextFallback = false;
        } else {
          logStage('Attempt 2 did not improve over Attempt 1 — keeping Attempt 1 result');
        }
      }
    } catch (err: any) {
      logError('ATTEMPT_2', err?.message);
    }
  }

  // ── Stage 8: Safe Extraction Failure Check ────────────────────────────────
  if (!validation || validation.validFieldCount === 0) {
    logError('RESULT', 'Both extraction attempts failed to produce valid fields');
    throw new Error('Some details could not be extracted. Please verify the fields manually or retake the document image.');
  }

  // Downgrade any 'HIGH' confidence to 'MEDIUM' if plaintext fallback was used
  if (usedPlaintextFallback) {
    for (const [k, v] of Object.entries(validation.validatedFields)) {
      if (v.confidence === 'HIGH') {
        v.confidence = 'MEDIUM';
        validation.fieldConfidence[k] = 'medium';
      }
    }
  }

  logStage(`=== Extraction Complete: type="${finalType}" validFields=${validation.validFieldCount} confidence=${validation.overallConfidence} ===`);

  return {
    documentType: finalType,
    fields: validation.fields,
    validatedFields: validation.validatedFields,
    fieldConfidence: validation.fieldConfidence,
    confidence: validation.overallConfidence,
    rawText: aiContent,
    imageQuality,
    validationIssues: validation.validationIssues,
    missingRequiredFields: validation.missingRequiredFields,
  };
}