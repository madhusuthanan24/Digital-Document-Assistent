/**
 * ocrService.ts — v2 (DDA-WebPreview)
 *
 * Production-Grade AI Document Extraction Pipeline for Expo/Web.
 *
 * Pipeline Stages:
 *  1. Image Smart Resize via expo-image-manipulator
 *  2. Base64 Encoding (expo-file-system → fetch+FileReader fallback)
 *  3. Two-Pass: Classify first if category is "Other" / unknown
 *  4. Category-Specific Vision Prompt
 *  5. NVIDIA Vision API with Exponential Backoff (429/500/503)
 *  6. 3-Strategy JSON Parser
 *  7. Field Validation, OCR Correction, Date Normalization
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

function logStage(msg: string) { console.log(`[OCR] ${msg}`); }
function logError(stage: string, msg: string) { console.warn(`[OCR][${stage}] ${msg}`); }

// ---------------------------------------------------------------------------
// Base64 Conversion — 4-Tier Resolution & Sanitization Strategy
// ---------------------------------------------------------------------------
export function sanitizeBase64(rawB64: string): string {
  if (!rawB64) return '';
  let cleaned = rawB64.trim();
  while (cleaned.includes(',')) {
    cleaned = cleaned.split(',').pop()!.trim();
  }
  cleaned = cleaned.replace(/^data:image\/[a-z]+;base64,/i, '');
  return cleaned.trim();
}

async function uriToBase64(uri: string): Promise<string> {
  // Tier 1: Modern Expo SDK 57 File API
  try {
    const ExpoFS = require('expo-file-system');
    if (ExpoFS?.File) {
      const file = new ExpoFS.File(uri);
      const b64 = await file.base64();
      if (b64 && b64.length > 0) return sanitizeBase64(b64);
    }
  } catch { /* continue */ }

  // Tier 2: Expo SDK 57 legacy API
  try {
    const LegacyFS = require('expo-file-system/legacy');
    if (LegacyFS?.readAsStringAsync) {
      const b64 = await LegacyFS.readAsStringAsync(uri, {
        encoding: LegacyFS.EncodingType?.Base64 || 'base64',
      });
      if (b64 && b64.length > 0) return sanitizeBase64(b64);
    }
  } catch { /* continue */ }

  // Tier 3: Classic expo-file-system
  try {
    const ExpoFS = require('expo-file-system');
    if (ExpoFS?.readAsStringAsync) {
      const b64 = await ExpoFS.readAsStringAsync(uri, {
        encoding: ExpoFS.EncodingType?.Base64 || 'base64',
      });
      if (b64 && b64.length > 0) return sanitizeBase64(b64);
    }
  } catch { /* continue */ }

  // Tier 4: Fetch + FileReader (Web / Fallback)
  try {
    const response = await fetch(uri);
    const blob = await response.blob();
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const dataUrl = reader.result as string;
        resolve(sanitizeBase64(dataUrl));
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (err: any) {
    logError('BASE64', `All conversion tiers failed: ${err?.message}`);
    throw new Error(`[BASE64] Cannot convert image: ${err?.message}`);
  }
}

// ---------------------------------------------------------------------------
// Markdown Fence Stripper
// ---------------------------------------------------------------------------
export function stripMarkdownFences(text: string): string {
  if (!text) return '';
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, '');
  cleaned = cleaned.replace(/\n?```\s*$/i, '');
  return cleaned.trim();
}

// ---------------------------------------------------------------------------
// JSON Syntax Repair Utility
// ---------------------------------------------------------------------------
export function repairJsonSyntax(raw: string): string {
  if (!raw) return '';
  let s = raw.trim();
  s = s.replace(/,(\s*[}\]])/g, '$1');
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

  if ((unfenced.startsWith('{') && unfenced.endsWith('}')) || (unfenced.startsWith('[') && unfenced.endsWith(']'))) {
    candidates.push(unfenced);
  }

  const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = codeBlockRegex.exec(text)) !== null) {
    const block = match[1].trim();
    if ((block.startsWith('{') && block.endsWith('}')) || (block.startsWith('[') && block.endsWith(']'))) {
      if (!candidates.includes(block)) candidates.push(block);
    }
  }

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

    if (ch === '{' || ch === '[') {
      if (depth === 0) startIdx = i;
      depth++;
    } else if (ch === '}' || ch === ']') {
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
  if (!parsed || typeof parsed !== 'object') {
    return null;
  }

  if (parsed.multipleDocumentsDetected === true || parsed.multipleDocuments === true) {
    const err = new Error('Multiple documents were detected in one image. Please crop and scan one document at a time.');
    (err as any).isMultiDocError = true;
    throw err;
  }

  if (Array.isArray(parsed)) {
    const flattened = flattenArrayFields(parsed);
    if (Object.keys(flattened).length > 0) {
      return {
        documentType: hintType || 'Other Document',
        fields: flattened,
      };
    }
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
  if (!flattened || typeof flattened !== 'object') {
    return null;
  }

  const sanitized: Record<string, string> = {};
  for (const [k, v] of Object.entries(flattened)) {
    if (v !== null && v !== undefined && typeof v !== 'object') {
      const strVal = String(v).trim();
      if (strVal.length > 0) {
        sanitized[k] = strVal;
      }
    }
  }

  if (Object.keys(sanitized).length === 0 && !docType) {
    return null;
  }

  return {
    documentType: docType || 'Other Document',
    fields: sanitized,
  };
}

// ---------------------------------------------------------------------------
// Plaintext KV Fallback
// ---------------------------------------------------------------------------
function parsePlainTextResponse(content: string, hintType: string): { documentType: string; fields: Record<string, string> } {
  const lines = content.split('\n');
  const rawFields: Record<string, string> = {};
  let detectedType = hintType || 'Other Document';
  let currentHeader = '';

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^(here|note|rules|summary|analysis|json|output|response|below|above|instruction|sure|i\s+have|the\s+document\s+is|please|this\s+is|```)/i.test(trimmed)) {
      continue;
    }

    // Handle Markdown Table Rows: | Key | Value |
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      const cells = trimmed.split('|').map(c => c.trim()).filter(Boolean);
      if (cells.length >= 2) {
        const k = cells[0].replace(/^\*+|\*+$/g, '').trim();
        const v = cells.slice(1).join(' - ').replace(/^\*+|\*+$/g, '').trim();
        if (/^[-:]+$/.test(k) || /^(key|field|specification|spec|attribute|property|label|parameter)$/i.test(k)) {
          continue;
        }
        if (k && v && !/^[-:]+$/.test(v)) {
          rawFields[k] = v;
          continue;
        }
      }
    }

    const docTypeMatch = trimmed.match(/^(?:[*\-\s#]*)(?:document\s*type|type)\s*[:=-]\s*(.+)/i);
    if (docTypeMatch?.[1]) {
      const dt = docTypeMatch[1].replace(/^\*+|\*+$/g, '').trim();
      if (dt) detectedType = dt;
      currentHeader = '';
      continue;
    }

    // Strip bullets, markdown headers (#, ##, ###), and numbered prefixes (1., 2), etc.)
    const cleanLeading = trimmed.replace(/^\s*(?:[-*•#]+|\d+[.)]|\(\d+\))\s*/, '').trim();
    const kvMatch = cleanLeading.match(/^(?:\*{1,2})?([A-Za-z0-9\s'\/().,-]+?)(?:\*{1,2})?\s*[:=-]\s*(.*)$/);

    if (kvMatch) {
      const k = kvMatch[1].replace(/^\*+|\*+$/g, '').trim();
      let v = kvMatch[2].replace(/^\*+|\*+$/g, '').trim();
      if (k.length > 0 && k.length <= 60) {
        if (/^(here|note|rules|summary|analysis|json|output|response|below|above|instruction)/i.test(k)) {
          continue;
        }
        if (v.length > 0 && !/^[*_\-\s:]+$/.test(v)) {
          rawFields[k] = v;
          currentHeader = '';
        } else {
          // Header with no value on the same line (e.g. **Logos:**)
          currentHeader = k;
        }
      }
    } else if (currentHeader && /^\s*[-*•]/.test(trimmed)) {
      // List item belonging to previous header
      const item = trimmed.replace(/^\s*[-*•]\s*/, '').replace(/^\*+|\*+$/g, '').trim();
      if (item && item.length > 0 && !/^[*_\-\s:]+$/.test(item)) {
        if (!rawFields[currentHeader]) {
          rawFields[currentHeader] = item;
        } else {
          rawFields[currentHeader] += ', ' + item;
        }
      }
    }
  }
  return { documentType: detectedType, fields: rawFields };
}

// ---------------------------------------------------------------------------
// AI Response Parser (Multi-Tier Robust Strategy)
// ---------------------------------------------------------------------------
export function parseAiResponse(content: string, hintType: string): { documentType: string; fields: Record<string, any> } | null {
  if (!content || typeof content !== 'string') return null;

  // ── Attempt 1: Direct JSON.parse after stripping markdown fences ──────────
  const cleaned = stripMarkdownFences(content);
  try {
    console.log("[OCR][JSON_PARSE_ATTEMPT]", cleaned);
    const parsed = JSON.parse(cleaned);
    const validated = validateParsedStructure(parsed, hintType);
    if (validated && Object.keys(validated.fields).length > 0) {
      console.log("[OCR][PARSE_ATTEMPT_1]", "Method: stripMarkdownFences + JSON.parse", "Status: SUCCESS", `Fields: ${Object.keys(validated.fields).length}`);
      return validated;
    }
    console.log("[OCR][PARSE_ATTEMPT_1]", "Method: stripMarkdownFences + JSON.parse", "Status: FAILED", "Error: validateParsedStructure returned 0 fields");
  } catch (err: any) {
    console.log("[OCR][JSON_PARSE_ERROR]", err?.message);
    console.log("[OCR][PARSE_ATTEMPT_1]", "Method: stripMarkdownFences + JSON.parse", "Status: FAILED", `Error: ${err?.message}`);
  }

  // ── Attempt 2: Balanced-brace candidate extraction & repair ──────────────
  const candidates = extractJsonCandidates(content);
  let attempt2LastError = candidates.length === 0 ? "No JSON candidates found" : "";

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    try {
      console.log("[OCR][JSON_PARSE_ATTEMPT]", candidate);
      const parsed = JSON.parse(candidate);
      const validated = validateParsedStructure(parsed, hintType);
      if (validated && Object.keys(validated.fields).length > 0) {
        console.log("[OCR][PARSE_ATTEMPT_2]", "Method: extractJsonCandidates (direct)", "Status: SUCCESS", `Candidate ${i}, Fields: ${Object.keys(validated.fields).length}`);
        return validated;
      }
      attempt2LastError = `Candidate ${i} parsed but 0 valid fields`;
    } catch (err: any) {
      console.log("[OCR][JSON_PARSE_ERROR]", `Candidate ${i}: ${err?.message}`);
      attempt2LastError = err?.message;
      try {
        const repaired = repairJsonSyntax(candidate);
        console.log("[OCR][JSON_PARSE_ATTEMPT]", repaired);
        const parsed = JSON.parse(repaired);
        const validated = validateParsedStructure(parsed, hintType);
        if (validated && Object.keys(validated.fields).length > 0) {
          console.log("[OCR][PARSE_ATTEMPT_2]", "Method: extractJsonCandidates + repairJsonSyntax", "Status: SUCCESS", `Candidate ${i}, Fields: ${Object.keys(validated.fields).length}`);
          return validated;
        }
        attempt2LastError = `Candidate ${i} repaired but 0 valid fields`;
      } catch (repErr: any) {
        console.log("[OCR][JSON_PARSE_ERROR]", `Candidate ${i} repair error: ${repErr?.message}`);
        attempt2LastError = repErr?.message;
      }
    }
  }
  console.log("[OCR][PARSE_ATTEMPT_2]", "Method: extractJsonCandidates + repairJsonSyntax", "Status: FAILED", `Error: ${attempt2LastError}`);

  // ── Attempt 3: Plaintext / Markdown Key-Value Fallback ───────────────────
  const fallback = parsePlainTextResponse(content, hintType);
  const fallbackFieldCount = Object.keys(fallback.fields).length;
  if (fallbackFieldCount > 0) {
    console.log("[OCR][PARSE_ATTEMPT_3]", "Method: parsePlainTextResponse", "Status: SUCCESS", `Fields: ${fallbackFieldCount}`);
    return { documentType: fallback.documentType, fields: fallback.fields };
  }
  console.log("[OCR][PARSE_ATTEMPT_3]", "Method: parsePlainTextResponse", "Status: FAILED", "Error: 0 key-value pairs matched");

  console.warn(`[OCR][PARSE_FAIL] Could not parse valid structured JSON from AI response (length: ${content.length})`);
  return null;
}

// ---------------------------------------------------------------------------
// Per-Field Confidence Scoring
// ---------------------------------------------------------------------------
const HIGH_CONFIDENCE_PATTERNS: Record<string, RegExp> = {
  pannumber: /^[A-Z]{5}[0-9]{4}[A-Z]$/,
  aadhaar: /^\d{4}\s\d{4}\s\d{4}$/,
  epic: /^[A-Z]{3}[0-9]{7}$/,
  passport: /^[A-Z][0-9]{7}$/,
  registration: /^[A-Z]{2}[0-9]{2}[A-Z0-9]{4,7}$/,
  date: /^\d{4}-\d{2}-\d{2}$/,
};

function scoreFieldConfidence(key: string, value: string, fromPlaintext: boolean): 'high' | 'medium' | 'low' {
  if (fromPlaintext) return 'low';
  const lk = key.toLowerCase().replace(/[_\s]/g, '');
  for (const [pk, regex] of Object.entries(HIGH_CONFIDENCE_PATTERNS)) {
    if (lk.includes(pk) && regex.test(value)) return 'high';
  }
  if (lk.includes('date') && /^\d{4}-\d{2}-\d{2}$/.test(value)) return 'high';
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
  const cleanB64 = sanitizeBase64(base64Image);
  const body = {
    model: NVIDIA_MODEL,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${cleanB64}` } },
      ],
    }],
    temperature: temperature ?? NVIDIA_CONFIG.temperature,
    max_tokens: NVIDIA_CONFIG.max_tokens,
    stream: NVIDIA_CONFIG.stream,
  };

  let attempt = 0;
  let delayMs = 1000;
  while (attempt < maxRetries) {
    attempt++;
    logStage(`API call attempt ${attempt}/${maxRetries}`);

    let urlHost = '';
    try {
      urlHost = new URL(NVIDIA_ENDPOINT).host;
    } catch {
      urlHost = NVIDIA_ENDPOINT;
    }
    console.log(`[OCR500][REQUEST] URL host: ${urlHost}`);
    console.log(`[OCR500][REQUEST] model: ${NVIDIA_MODEL}`);
    console.log(`[OCR500][REQUEST] image MIME: image/jpeg`);
    console.log(`[OCR500][REQUEST] image/base64 length: ${cleanB64.length}`);
    console.log(`[OCR500][REQUEST] attempt: ${attempt}/${maxRetries}`);

    const startTime = Date.now();
    console.log(`[OCR500][TIMING] request start: ${new Date(startTime).toISOString()}`);

    try {
      console.log(`[OCR_TRACE] STEP 4 API request started: endpoint=${NVIDIA_ENDPOINT}`);
      const response = await fetch(NVIDIA_ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${NVIDIA_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const endTime = Date.now();
      const durationMs = endTime - startTime;
      console.log(`[OCR500][TIMING] response received: ${new Date(endTime).toISOString()}`);
      console.log(`[OCR500][TIMING] duration ms: ${durationMs}`);

      console.log(`[OCR_TRACE] STEP 5 API response received: status=${response.status}`);
      logStage(`HTTP ${response.status}`);

      if (response.ok) {
        const json = JSON.parse(await response.text());
        const content = json.choices?.[0]?.message?.content?.trim() || '';
        console.log(`[OCR_TRACE] STEP 6 raw model response received: ${content.substring(0, 300).replace(/\n/g, ' ')}...`);
        logStage('AI response received');
        return content;
      }

      console.log(`[OCR500][RESPONSE_STATUS] ${response.status}`);
      console.log(`[OCR500][RESPONSE_STATUS_TEXT] ${response.statusText}`);
      const responseText = await response.text().catch(() => '');
      console.log(`[OCR500][RESPONSE_BODY_BEGIN]`);
      console.log(responseText);
      console.log(`[OCR500][RESPONSE_BODY_END]`);

      if ((response.status === 429 || response.status >= 500) && attempt < maxRetries) {
        console.warn(`[OCR][API] HTTP ${response.status} — retrying in ${delayMs}ms`);
        await new Promise<void>((r) => { setTimeout(() => r(), delayMs); });
        delayMs *= 2;
        continue;
      }
      throw new Error(`[API_${response.status}] ${responseText.slice(0, 200)}`);
    } catch (err: any) {
      if (attempt >= maxRetries) throw err;
      console.warn(`[OCR][API] Exception attempt ${attempt}: ${err?.message}`);
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
// Main Export
// ---------------------------------------------------------------------------
export async function extractDocumentDetails(
  finalImageUri: string,
  documentTypeHint: string = ''
): Promise<OCRResult> {
  logStage('=== Extraction pipeline start ===');
  if (!finalImageUri) throw new Error('No image URI provided for extraction');
  console.log(`[OCR_TRACE] STEP 1 image URI: ${finalImageUri}`);

  const prep = await prepareImageForOcr(finalImageUri, 1600, 0.85);
  console.log(`[OCR_TRACE] STEP 2 prepared image: ${prep.width}x${prep.height}, transforms=[${prep.appliedTransforms.join(', ')}]`);
  logStage(
    `Prep complete: ${prep.width}x${prep.height}` +
    `${prep.wasUpscaled ? ' [UPSCALED]' : ''}` +
    ` q=${prep.qualityUsed}` +
    ` transforms=[${prep.appliedTransforms.join(', ')}]`
  );

  const rawBase64 = await uriToBase64(prep.uri);
  const base64Image = sanitizeBase64(rawBase64);
  const base64Prefix = base64Image.substring(0, 30);
  console.log(`[OCR_TRACE] STEP 3 base64 length: ${base64Image.length}, prefix: ${base64Prefix}`);
  logStage(`Base64 ready (length=${base64Image.length.toLocaleString()}, prefix="${base64Prefix}")`);
  console.log(`[OCR][IMAGE] URI: ${prep.uri}`);
  console.log(`[OCR][IMAGE] MIME TYPE: image/jpeg`);
  console.log(`[OCR][IMAGE] BASE64 LENGTH: ${base64Image.length}`);
  console.log(`[OCR][IMAGE] BASE64 PREFIX: ${base64Prefix}`);
  console.log(`[OCR][IMAGE] FILE SIZE: ~${Math.round(base64Image.length * 0.75 / 1024)} KB`);
  console.log(`[OCR][IMAGE] DIMENSIONS: ${prep.width}x${prep.height}`);

  // ── Stage 2.5: Image Quality Analysis ────────────────────────────────────
  const imageQuality = analyzeImageQuality(
    prep.width,
    prep.height,
    base64Image.length,
    prep.wasUpscaled
  );

  if (!imageQuality.usable) {
    const userMsg = getQualityUserMessage(imageQuality) ||
      'Image quality is too low. Please capture the document again with better lighting and focus.';
    logError('QUALITY', `Blocked: score=${imageQuality.score} issues=${imageQuality.issues.join('; ')}`);
    const err = new Error(userMsg);
    (err as any).isQualityBlock = true;
    (err as any).qualityResult = imageQuality;
    throw err;
  }

  logStage(`Image quality: ${imageQuality.quality} (score=${imageQuality.score})`);

  // ── Stage 3: Document Type Detection (Pass A) ────────────────────────────
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
  logStage(`Prompt resolved for: "${resolvedCategory}"`);

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
  let directives: string[] = [];

  if (reasons.jsonFailed) {
    directives.push(
      'CRITICAL: Previous attempt failed to produce valid JSON. Output ONLY a raw JSON object matching the schema. Do NOT output conversational text or markdown fences.'
    );
  }

  if (reasons.typeUnclear) {
    directives.push(
      'CRITICAL: Previous attempt could not reliably identify the document type. Visually inspect the header, emblem, logo, watermark, and title. Identify the exact document category and extract only clearly visible fields.'
    );
  }

  if (reasons.missingRequired.length > 0) {
    directives.push(
      `MISSING FIELDS RE-EXAMINATION: The following required fields were missing in Attempt 1: [${reasons.missingRequired.join(
        ', '
      )}]. Visually inspect top, middle, and bottom of the image character-by-character. Locate and extract these exact printed fields without guessing.`
    );
  }

  if (reasons.validationIssues.length > 0) {
    directives.push(
      `VALIDATION ISSUES RE-EXAMINATION: The following fields contained format or logic issues: [${reasons.validationIssues
        .slice(0, 3)
        .join('; ')}]. Re-examine these specific fields character-by-character from the image. Read exact printed characters. Do not invent missing information.`
    );
  }

  if (directives.length === 0) {
    directives.push(
      'Previous extraction was incomplete. Inspect the image character-by-character again. Do not guess. Extract only clearly visible fields.'
    );
  }

  return `CORRECTIVE INSTRUCTIONS FOR ATTEMPT 2:\n${directives.join('\n\n')}\n\n${basePrompt}`;
}

  // ── Stage 5: Attempt 1 — Normal Extraction ───────────────────────────────
  logStage('Attempt 1: Running normal document extraction');
  let aiContent = '';
  let parseResult: { documentType: string; fields: Record<string, any> } | null = null;
  let usedPlaintext = false;

  try {
    const rawResponse = await callNvidiaApiWithBackoff(base64Image, prompt, 2);

    console.log("===== OCR RAW RESPONSE START =====");
    console.log(typeof rawResponse);
    if (typeof rawResponse === 'object' && rawResponse !== null) {
      console.log(JSON.stringify(rawResponse, null, 2));
    } else {
      console.log(rawResponse);
    }
    console.log("===== OCR RAW RESPONSE END =====");
    console.log("[OCR][RESPONSE_LENGTH]", rawResponse?.length);

    const parserInput = rawResponse;
    console.log("===== OCR PARSER INPUT START =====");
    console.log(parserInput);
    console.log("===== OCR PARSER INPUT END =====");

    aiContent = rawResponse;
    parseResult = parseAiResponse(parserInput, resolvedCategory);
    if (parseResult && !extractJsonFromText(aiContent)) usedPlaintext = true;
    console.log(`[OCR_TRACE] STEP 7 parsed JSON: ${JSON.stringify(parseResult)}, usedPlaintext=${usedPlaintext}`);
  } catch (err: any) {
    logError('ATTEMPT_1', err?.message);
    console.log(`[OCR_TRACE] STEP 7 parsed JSON: null, usedPlaintext=false`);
  }

  let finalType = isUnknown
    ? 'Unknown Document'
    : (parseResult?.documentType || rawDetectedType || resolvedCategory || 'Other Document');

  let validation = parseResult
    ? validateAndPostProcessFields(finalType, parseResult.fields)
    : null;
  console.log(`[OCR_TRACE] STEP 8 validated fields: count=${validation?.validFieldCount || 0}, fields=${JSON.stringify(validation?.fields || {})}`);

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
      const hrPrep = await prepareHighResRetryImage(finalImageUri);
      const hrB64 = await uriToBase64(hrPrep.uri);
      const rawResponse = await callNvidiaApiWithBackoff(hrB64, correctivePrompt, 2, 0);

      console.log("===== OCR RAW RESPONSE START =====");
      console.log(typeof rawResponse);
      if (typeof rawResponse === 'object' && rawResponse !== null) {
        console.log(JSON.stringify(rawResponse, null, 2));
      } else {
        console.log(rawResponse);
      }
      console.log("===== OCR RAW RESPONSE END =====");
      console.log("[OCR][RESPONSE_LENGTH]", rawResponse?.length);

      const parserInput = rawResponse;
      console.log("===== OCR PARSER INPUT START =====");
      console.log(parserInput);
      console.log("===== OCR PARSER INPUT END =====");

      const rc = rawResponse;
      const rr = parseAiResponse(parserInput, resolvedCategory);

      if (rr && Object.keys(rr.fields).length > 0) {
        const retryType = isUnknown && rr.documentType && rr.documentType !== 'Unknown Document'
          ? rr.documentType
          : finalType;
        const retryValidation = validateAndPostProcessFields(retryType, rr.fields);

        const attempt1Score = validation ? validation.validFieldCount * 10 - validation.validationIssues.length * 5 : -100;
        const attempt2Score = retryValidation.validFieldCount * 10 - retryValidation.validationIssues.length * 5;

        if (attempt2Score >= attempt1Score || !validation) {
          logStage(`Attempt 2 adopted: ${retryValidation.validFieldCount} valid fields (confidence: ${retryValidation.overallConfidence})`);
          parseResult = rr;
          validation = retryValidation;
          aiContent = rc;
          finalType = retryType;
          usedPlaintext = false;
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

  if (usedPlaintext) {
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