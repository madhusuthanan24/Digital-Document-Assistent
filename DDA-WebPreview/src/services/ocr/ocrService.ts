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
  getUnifiedExtractionPrompt,
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
  maxRetries = 2,
  temperature?: number,
  timeoutMs = 40000,
  requestId = 'req'
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
    logStage(`[${requestId}] API call attempt ${attempt}/${maxRetries}`);

    const startTime = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(NVIDIA_ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Bearer ${NVIDIA_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const durationMs = Date.now() - startTime;
      console.log(`[OCR_TIMING][${requestId}] api_duration_ms=${durationMs} http_status=${response.status} attempt=${attempt}`);
      logStage(`[${requestId}] HTTP ${response.status} in ${durationMs}ms`);

      if (response.ok) {
        const json = JSON.parse(await response.text());
        const content = json.choices?.[0]?.message?.content?.trim() || '';
        logStage(`[${requestId}] AI response received`);
        return content;
      }

      const responseText = await response.text().catch(() => '');
      console.warn(`[OCR][${requestId}] HTTP ${response.status}: ${responseText.slice(0, 150)}`);

      if ((response.status === 429 || response.status >= 500) && attempt < maxRetries) {
        console.warn(`[OCR][${requestId}] HTTP ${response.status} — retrying in ${delayMs}ms`);
        await new Promise<void>((r) => { setTimeout(() => r(), delayMs); });
        delayMs *= 2;
        continue;
      }
      throw new Error(`[API_${response.status}] ${responseText.slice(0, 150)}`);
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        throw new Error('NVIDIA Vision AI request timed out. Please check your internet connection and try again.');
      }
      if (attempt >= maxRetries) throw err;
      console.warn(`[OCR][${requestId}] Exception attempt ${attempt}: ${err?.message}`);
      await new Promise<void>((r) => { setTimeout(() => r(), delayMs); });
      delayMs *= 2;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error('NVIDIA Vision AI service is temporarily unreachable after retries.');
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
// ---------------------------------------------------------------------------
// Helper: Corrective Prompt Builder for Fallback
// ---------------------------------------------------------------------------
export function buildCorrectivePrompt(
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
      'CRITICAL: Visually inspect headers, emblems, logos, and layout to identify the exact document category and extract only clearly visible fields.'
    );
  }

  if (reasons.missingRequired.length > 0) {
    directives.push(
      `MISSING FIELDS RE-EXAMINATION: Check image for fields [${reasons.missingRequired.join(
        ', '
      )}]. Locate and extract these exact printed fields without guessing.`
    );
  }

  if (directives.length === 0) {
    directives.push(
      'Extract only clearly visible printed fields into strictly valid JSON. Do not guess.'
    );
  }

  return `CORRECTIVE INSTRUCTIONS:\n${directives.join('\n\n')}\n\n${basePrompt}`;
}

export async function extractDocumentDetails(
  finalImageUri: string,
  documentTypeHint: string = '',
  onProgress?: (stage: string) => void
): Promise<OCRResult> {
  const totalStartTime = Date.now();
  const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  logStage(`=== Extraction pipeline start [${requestId}] ===`);

  if (!finalImageUri) throw new Error('No image URI provided for extraction');
  console.log(`[OCR_TRACE] STEP 1 image URI: ${finalImageUri}`);

  // ── Stage 1: Preprocessing & Base64 Encoding ────────────────────────────
  onProgress?.('Optimizing document image...');
  const prepStart = Date.now();
  const prep = await prepareImageForOcr(finalImageUri, 1280, 0.75);
  const prepDuration = Date.now() - prepStart;

  const b64Start = Date.now();
  const rawBase64 = await uriToBase64(prep.uri);
  const base64Image = sanitizeBase64(rawBase64);
  const b64Duration = Date.now() - b64Start;

  const payloadKb = Math.round(base64Image.length * 0.75 / 1024);
  console.log(`[OCR_TIMING][${requestId}] prep_ms=${prepDuration} b64_ms=${b64Duration} payload_kb=${payloadKb} dim=${prep.width}x${prep.height}`);

  // ── Stage 1.5: Image Quality Analysis ───────────────────────────────────
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

  logStage(`[${requestId}] Image quality: ${imageQuality.quality} (score=${imageQuality.score})`);

  // ── Stage 2: Single-Pass Unified Vision Extraction ───────────────────────
  onProgress?.('Scanning text with NVIDIA Vision AI...');
  const prompt = getUnifiedExtractionPrompt(documentTypeHint);
  logStage(`[${requestId}] Prompt resolved for Single-Pass Extraction (Hint: "${documentTypeHint || 'none'}")`);

  let aiContent = '';
  let parseResult: { documentType: string; fields: Record<string, any> } | null = null;
  let usedPlaintext = false;

  try {
    const rawResponse = await callNvidiaApiWithBackoff(
      base64Image,
      prompt,
      2,
      NVIDIA_CONFIG.temperature,
      40000,
      requestId
    );
    aiContent = rawResponse;

    const parseStart = Date.now();
    parseResult = parseAiResponse(rawResponse, documentTypeHint);
    const parseDuration = Date.now() - parseStart;
    console.log(`[OCR_TIMING][${requestId}] parse_ms=${parseDuration} initial_fields=${Object.keys(parseResult?.fields || {}).length}`);

    if (parseResult && !extractJsonFromText(aiContent)) {
      usedPlaintext = true;
    }
  } catch (err: any) {
    logError('SINGLE_PASS', err?.message);
    throw err;
  }

  // ── Stage 2.5: Fast JSON Recovery (Only if 0 fields parsed) ──────────────
  if (!parseResult || Object.keys(parseResult.fields).length === 0) {
    logStage(`[${requestId}] Initial attempt parsed 0 fields — executing fast fallback re-call`);
    onProgress?.('Re-examining document fields...');
    const fallbackPrompt = `CRITICAL: Previous attempt produced no fields. Output ONLY a valid JSON object matching this schema without markdown or text:
{"documentType": "${documentTypeHint || 'Document'}", "fields": {"<key>": "<value>"}}`;
    try {
      const fbResponse = await callNvidiaApiWithBackoff(
        base64Image,
        fallbackPrompt,
        1,
        0,
        30000,
        `${requestId}_fb`
      );
      const fbResult = parseAiResponse(fbResponse, documentTypeHint);
      if (fbResult && Object.keys(fbResult.fields).length > 0) {
        parseResult = fbResult;
        aiContent = fbResponse;
        usedPlaintext = false;
      }
    } catch (fbErr: any) {
      logError('FALLBACK', fbErr?.message);
    }
  }

  // ── Stage 3: Field Validation, Normalization & Confidence ────────────────
  onProgress?.('Analyzing and structuring fields...');
  const validationStart = Date.now();

  const finalType = normalizeDetectedType(parseResult?.documentType || '') ||
    parseResult?.documentType ||
    documentTypeHint ||
    'Other Document';

  const validation = parseResult
    ? validateAndPostProcessFields(finalType, parseResult.fields)
    : null;

  const validationDuration = Date.now() - validationStart;
  const totalDuration = Date.now() - totalStartTime;

  console.log(`[OCR_TIMING][${requestId}] validation_ms=${validationDuration} valid_fields=${validation?.validFieldCount || 0}`);
  console.log(`[OCR_TIMING][${requestId}] total_duration_ms=${totalDuration} type="${finalType}"`);

  // ── Stage 4: Safe Extraction Failure Check ────────────────────────────────
  if (!validation || validation.validFieldCount === 0) {
    logError('RESULT', 'No valid text fields could be extracted from image');
    throw new Error('Some details could not be extracted. Please verify lighting and crop, or enter details manually.');
  }

  if (usedPlaintext) {
    for (const [k, v] of Object.entries(validation.validatedFields)) {
      if (v.confidence === 'HIGH') {
        v.confidence = 'MEDIUM';
        validation.fieldConfidence[k] = 'medium';
      }
    }
  }

  logStage(`=== Extraction Complete [${requestId}]: type="${finalType}" validFields=${validation.validFieldCount} confidence=${validation.overallConfidence} totalDuration=${totalDuration}ms ===`);

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