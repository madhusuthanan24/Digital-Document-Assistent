/**
 * ocrService.ts — Hardened OCR Pipeline
 *
 * Stages (logged clearly with safe messages):
 *  1. [OCR] Starting extraction
 *  2. [OCR] Image URI valid
 *  3. [OCR] Image prepared
 *  4. [OCR] Base64 conversion successful
 *  5. [OCR] Request started
 *  6. [OCR] HTTP status: 200
 *  7. [OCR] AI response received
 *  8. [OCR] JSON parsed
 *  9. [OCR] Fields normalized
 * 10. [OCR] Extraction completed
 *
 * Failure logging uses [OCR][STAGE] format with error specifics.
 * No sensitive document data or base64 strings are logged.
 */

import ImageEditor from '@react-native-community/image-editor';
import { Image } from 'react-native';
import {
  NVIDIA_API_KEY,
  NVIDIA_ENDPOINT,
  NVIDIA_MODEL,
  NVIDIA_CONFIG,
} from '../../config/nvidia';

export interface OCRResult {
  documentType: string;
  fields: Record<string, string>;
  confidence: number;
  rawText: string;
}

// ---------------------------------------------------------------------------
// Stage Logger (Safe — no sensitive data)
// ---------------------------------------------------------------------------
function logStage(msg: string) {
  console.log(`[OCR] ${msg}`);
}

function logError(stage: string, msg: string) {
  console.warn(`[OCR][${stage}] failed: ${msg}`);
}

// ---------------------------------------------------------------------------
// STAGE 1: Image preparation (resize & compress for OCR)
// ---------------------------------------------------------------------------
async function prepareOcrImage(uri: string): Promise<string> {
  try {
    // Measure the original image so we can compute a proportional resize target.
    const { width: origW, height: origH } = await new Promise<{ width: number; height: number }>(
      (resolve, reject) => Image.getSize(uri, (w, h) => resolve({ width: w, height: h }), reject)
    );

    // Resize to at most 1280px on the long edge, keeping aspect ratio.
    const TARGET = 1280;
    const scale = Math.min(1, TARGET / Math.max(origW, origH));
    const targetW = Math.round(origW * scale);
    const targetH = Math.round(origH * scale);

    const result = await ImageEditor.cropImage(uri, {
      offset: { x: 0, y: 0 },
      size: { width: origW, height: origH },
      displaySize: { width: targetW, height: targetH },
      quality: 0.75,
      format: 'jpeg',
    });
    console.log('[OCR][IMAGE_PREP] success');
    logStage('Image prepared');
    return result.uri;
  } catch (err: any) {
    console.warn(`[OCR][IMAGE_PREP] skipped (${err?.message || 'using original'})`);
    logStage('Image prepared');
    return uri;
  }
}

// ---------------------------------------------------------------------------
// STAGE 2: URI → Base64
// ---------------------------------------------------------------------------
async function uriToBase64(uri: string): Promise<string> {
  // 1. Try expo-file-system/legacy
  try {
    const FileSystem = require('expo-file-system/legacy');
    if (FileSystem && FileSystem.readAsStringAsync) {
      const b64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      console.log('[OCR][BASE64] success');
      logStage('Base64 conversion successful');
      return b64;
    }
  } catch { /* continue to fallback */ }

  // 2. Try fetch blob -> FileReader
  try {
    const response = await fetch(uri);
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const dataUrl = reader.result as string;
        const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
        console.log('[OCR][BASE64] success');
        logStage('Base64 conversion successful');
        resolve(base64);
      };
      reader.onerror = (e) => reject(e);
      reader.readAsDataURL(blob);
    });
  } catch { /* continue to RNFS fallback */ }

  // 3. Fallback: react-native-fs
  try {
    const RNFS = require('react-native-fs');
    const cleanPath = uri.replace('file://', '');
    const b64 = await RNFS.readFile(cleanPath, 'base64');
    console.log('[OCR][BASE64] success');
    logStage('Base64 conversion successful');
    return b64;
  } catch (err: any) {
    logError('BASE64', err?.message || 'Conversion error');
    throw new Error(`[BASE64] Failed to convert image: ${err?.message}`);
  }
}

// ---------------------------------------------------------------------------
// STAGE 5: Balanced-brace JSON extraction
// ---------------------------------------------------------------------------
export function extractJsonFromText(text: string): string | null {
  if (!text) return null;

  // Try markdown code fence ```json ... ``` first
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch && fenceMatch[1]) {
    const trimmed = fenceMatch[1].trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      return trimmed;
    }
  }

  // Balanced brace extraction: find first '{', track depth to matching '}'
  let depth = 0;
  let startIndex = -1;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '{') {
      if (depth === 0) {
        startIndex = i;
      }
      depth++;
    } else if (char === '}') {
      depth--;
      if (depth === 0 && startIndex !== -1) {
        return text.substring(startIndex, i + 1);
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Fallback Plain Text Parser
// ---------------------------------------------------------------------------
function parsePlainTextResponse(content: string, hintType: string): { documentType: string; fields: Record<string, string> } {
  console.log('[OCR][FALLBACK] attempted');
  const lines = content.split('\n');
  const rawFields: Record<string, string> = {};
  let detectedType = hintType;

  const lowerContent = content.toLowerCase();
  if (lowerContent.includes('voter') || lowerContent.includes('epic') || lowerContent.includes('election')) detectedType = 'Voter ID';
  else if (lowerContent.includes('aadhaar') || lowerContent.includes('uid')) detectedType = 'Aadhaar Card';
  else if (lowerContent.includes('pan') || lowerContent.includes('permanent account number')) detectedType = 'PAN Card';
  else if (lowerContent.includes('passport')) detectedType = 'Passport';
  else if (lowerContent.includes('driving licence') || lowerContent.includes('driving license') || lowerContent.includes('dl')) detectedType = 'Driving Licence';
  else if (lowerContent.includes('vehicle') || lowerContent.includes('registration certificate') || lowerContent.includes('rc')) detectedType = 'Vehicle RC';
  else if (lowerContent.includes('insurance')) detectedType = 'Insurance Policy';
  else if (lowerContent.includes('certificate') || lowerContent.includes('marksheet')) detectedType = 'Educational Certificate';

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const docTypeMatch = trimmed.match(/^(?:document\s*type|type)\s*[:=-]\s*(.+)/i);
    if (docTypeMatch && docTypeMatch[1]) {
      detectedType = docTypeMatch[1].trim();
      continue;
    }

    const kvMatch = trimmed.match(/^(?:[*-\s]*)([A-Za-z0-9\s'\/()-]+?)\s*[:=-]\s*(.+)$/);
    if (kvMatch) {
      const k = kvMatch[1].trim();
      const v = kvMatch[2].trim();
      if (k.length > 0 && k.length < 40 && v.length > 0) {
        if (!/^(here|note|rules|summary|analysis)/i.test(k)) {
          rawFields[k] = v;
        }
      }
    }
  }

  return {
    documentType: detectedType,
    fields: rawFields,
  };
}

// ---------------------------------------------------------------------------
// Field & Document Type Normalization
// ---------------------------------------------------------------------------
const FIELD_ALIASES: Record<string, string> = {
  // Name
  'name': 'name',
  'full name': 'name',
  'holder name': 'name',
  'voter name': 'name',
  "cardholder's name": 'name',

  // EPIC / Voter ID
  'epic no': 'epicNumber',
  'epic no.': 'epicNumber',
  'epic number': 'epicNumber',
  'voter id number': 'epicNumber',
  'voter id no': 'epicNumber',
  'voter id no.': 'epicNumber',
  'voter id': 'epicNumber',
  'electoral photo identity card number': 'epicNumber',
  'epic': 'epicNumber',

  // Aadhaar
  'aadhaar no': 'aadhaarNumber',
  'aadhaar no.': 'aadhaarNumber',
  'aadhaar number': 'aadhaarNumber',
  'aadhaar': 'aadhaarNumber',
  'uid': 'aadhaarNumber',
  'uid number': 'aadhaarNumber',

  // PAN
  'pan no': 'panNumber',
  'pan no.': 'panNumber',
  'pan number': 'panNumber',
  'pan': 'panNumber',
  'permanent account number': 'panNumber',

  // Father / Husband / Guardian
  "father's name": 'fatherName',
  'father name': 'fatherName',
  'father': 'fatherName',
  's/o': 'fatherName',
  's/o:': 'fatherName',

  "husband's name": 'husbandName',
  'husband name': 'husbandName',
  'w/o': 'husbandName',
  'w/o:': 'husbandName',

  "guardian's name": 'guardianName',
  'c/o': 'guardianName',
  'c/o:': 'guardianName',

  // DOB
  'dob': 'dateOfBirth',
  'date of birth': 'dateOfBirth',
  'd.o.b': 'dateOfBirth',
  'd.o.b.': 'dateOfBirth',
  'birth date': 'dateOfBirth',
  'age': 'dateOfBirth',

  // Gender
  'sex': 'gender',
  'gender': 'gender',

  // Address
  'address': 'address',

  // Passport
  'passport no': 'passportNumber',
  'passport no.': 'passportNumber',
  'passport number': 'passportNumber',

  // Driving Licence
  'dl no': 'licenceNumber',
  'dl no.': 'licenceNumber',
  'dl number': 'licenceNumber',
  'driving licence no': 'licenceNumber',
  'driving license number': 'licenceNumber',
  'licence no': 'licenceNumber',

  // Vehicle RC
  'registration no': 'registrationNumber',
  'vehicle registration number': 'registrationNumber',
  'reg no': 'registrationNumber',

  // Dates
  'issue date': 'issueDate',
  'date of issue': 'issueDate',
  'valid from': 'issueDate',
  'expiry date': 'expiryDate',
  'date of expiry': 'expiryDate',
  'valid upto': 'expiryDate',
  'valid till': 'expiryDate',
};

const DOC_TYPE_ALIASES: Record<string, string> = {
  'voter id': 'Voter ID',
  'voter id card': 'Voter ID',
  'epic': 'Voter ID',
  'epic card': 'Voter ID',
  'election commission': 'Voter ID',
  'election commission of india': 'Voter ID',
  'electoral card': 'Voter ID',

  'aadhaar': 'Aadhaar Card',
  'aadhar': 'Aadhaar Card',
  'aadhaar card': 'Aadhaar Card',
  'aadhar card': 'Aadhaar Card',
  'uidai': 'Aadhaar Card',

  'pan': 'PAN Card',
  'pan card': 'PAN Card',
  'permanent account number': 'PAN Card',

  'passport': 'Passport',

  'driving licence': 'Driving Licence',
  "driver's license": 'Driving Licence',
  'driving license': 'Driving Licence',
  'dl': 'Driving Licence',

  'vehicle rc': 'Vehicle RC',
  'rc': 'Vehicle RC',
  'registration certificate': 'Vehicle RC',

  'insurance': 'Insurance Policy',
  'insurance policy': 'Insurance Policy',

  'marksheet': 'Educational Certificate',
  'degree certificate': 'Educational Certificate',
  'educational certificate': 'Educational Certificate',
};

export function normalizeDocumentType(raw: string): string {
  if (!raw) return 'Other Document';
  const clean = raw.trim().toLowerCase();
  if (clean === 'other' || clean === 'other document') return 'Other Document';

  for (const [alias, canonical] of Object.entries(DOC_TYPE_ALIASES)) {
    if (clean.includes(alias)) return canonical;
  }
  return raw.trim();
}

function normalizeFields(raw: Record<string, any>): Record<string, string> {
  const result: Record<string, string> = {};
  const PLACEHOLDER_REGEX = /^(n\/a|na|none|null|undefined|not\s*(available|provided|found)|-)$/i;

  for (const [key, val] of Object.entries(raw)) {
    if (val === null || val === undefined) continue;
    const strVal = String(val).trim();
    if (!strVal || PLACEHOLDER_REGEX.test(strVal)) continue;

    const lowerKey = key.toLowerCase().trim().replace(/[^a-z0-9\s'/.-]/g, '');
    const canonicalKey = FIELD_ALIASES[lowerKey] || FIELD_ALIASES[key.toLowerCase().trim()] || key.trim();
    result[canonicalKey] = strVal;
  }
  return result;
}

// ---------------------------------------------------------------------------
// STAGE 3-4: NVIDIA API Call
// ---------------------------------------------------------------------------
const PROMPT_INITIAL = `You are an expert OCR document analyzer.
Analyze this document image carefully.

Rules:
1. Identify the exact document type (e.g. "Voter ID", "Aadhaar Card", "PAN Card", "Passport", "Driving Licence", "Vehicle RC", "Insurance Policy", "Educational Certificate").
2. Extract ALL clearly visible fields. For Indian IDs, include name, epicNumber/document number, fatherName/husbandName, dateOfBirth, gender, address.
3. Return ONLY one valid JSON object. Do not add explanation or markdown code fences.

Required JSON shape:
{
  "documentType": "<exact document type>",
  "fields": {
    "<fieldName>": "<value as printed>"
  }
}`;

const PROMPT_RETRY = `Extract only visible text and document fields from this image.
Return one JSON object.
Do not explain.
Do not guess missing fields.

Required JSON shape:
{
  "documentType": "<document type>",
  "fields": {
    "<fieldName>": "<value as printed>"
  }
}`;

async function callNvidiaApi(base64Image: string, prompt: string): Promise<string> {
  logStage('Request started');

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
    temperature: NVIDIA_CONFIG.temperature,
    max_tokens: NVIDIA_CONFIG.max_tokens,
    stream: NVIDIA_CONFIG.stream,
  };

  const response = await fetch(NVIDIA_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${NVIDIA_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  logStage(`HTTP status: ${response.status}`);
  console.log(`[OCR][API] success ${response.status}`);

  const responseText = await response.text();

  if (!response.ok) {
    let errMsg = `HTTP ${response.status}`;
    try {
      const errJson = JSON.parse(responseText);
      errMsg = errJson?.error?.message || errMsg;
    } catch { /* ignore */ }
    console.warn(`[OCR][API] failed: ${response.status} ${errMsg}`);
    throw new Error(`[API_${response.status}] ${errMsg}`);
  }

  let jsonObj: any;
  try {
    jsonObj = JSON.parse(responseText);
  } catch {
    console.warn('[OCR][API] failed: Invalid JSON response envelope');
    throw new Error('[API_PARSE_FAIL] Could not parse API response envelope');
  }

  const content = jsonObj.choices?.[0]?.message?.content?.trim() || '';
  logStage('AI response received');
  return content;
}

// ---------------------------------------------------------------------------
// AI Response Parser
// ---------------------------------------------------------------------------
function parseAiResponse(content: string, hintType: string): { documentType: string; fields: Record<string, string> } | null {
  // 1. Direct JSON.parse
  try {
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed === 'object') {
      const docType = parsed.documentType || parsed.type || hintType;
      const rawFields = parsed.fields || parsed.data || parsed;
      if (typeof rawFields === 'object') {
        logStage('JSON parsed');
        return { documentType: String(docType), fields: rawFields };
      }
    }
  } catch { /* continue to balanced brace */ }

  // 2. Balanced-brace JSON extraction
  const jsonStr = extractJsonFromText(content);
  if (jsonStr) {
    try {
      const parsed = JSON.parse(jsonStr);
      if (parsed && typeof parsed === 'object') {
        const docType = parsed.documentType || parsed.type || hintType;
        const rawFields = parsed.fields || parsed.data || parsed;
        if (typeof rawFields === 'object') {
          logStage('JSON parsed');
          return { documentType: String(docType), fields: rawFields };
        }
      }
    } catch {
      console.warn('[OCR][PARSE] failed: JSON.parse on extracted substring failed');
    }
  }

  // 3. Plain text fallback parser
  console.warn('[OCR][PARSE] failed: no JSON object — attempting fallback text parse');
  const fallback = parsePlainTextResponse(content, hintType);
  if (Object.keys(fallback.fields).length > 0) {
    logStage('JSON parsed');
    return fallback;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Main Exported OCR Function
// ---------------------------------------------------------------------------
export async function extractDocumentDetails(
  finalImageUri: string,
  documentTypeHint: string = ''
): Promise<OCRResult> {
  logStage('Starting extraction');

  if (!finalImageUri) {
    logError('START', 'finalImageUri is empty');
    throw new Error('No image URI provided for extraction');
  }
  logStage('Image URI valid');

  // Stage 1: Image preparation
  const ocrImageUri = await prepareOcrImage(finalImageUri);

  // Stage 2: Convert to base64
  let base64Image: string;
  try {
    base64Image = await uriToBase64(ocrImageUri);
  } catch (err: any) {
    logError('BASE64', err?.message || 'Conversion failed');
    throw new Error(`[BASE64] Base64 conversion failed: ${err?.message}`);
  }

  // Stage 3-4: NVIDIA API Call (Attempt 1)
  let aiContent: string = '';
  let parseResult: { documentType: string; fields: Record<string, string> } | null = null;

  try {
    aiContent = await callNvidiaApi(base64Image, PROMPT_INITIAL);
    parseResult = parseAiResponse(aiContent, documentTypeHint);
  } catch (err: any) {
    console.warn(`[OCR][ATTEMPT_1] failed: ${err?.message}`);
  }

  // Controlled Retry (Attempt 2) if Attempt 1 failed or returned 0 fields
  const hasFields = parseResult && Object.keys(parseResult.fields).length > 0;
  if (!parseResult || !hasFields) {
    console.log('[OCR][RETRY] Attempt 1 produced no usable fields — executing 1 controlled retry with strict prompt');
    try {
      const retryContent = await callNvidiaApi(base64Image, PROMPT_RETRY);
      parseResult = parseAiResponse(retryContent, documentTypeHint);
    } catch (retryErr: any) {
      logError('RETRY', retryErr?.message || 'Retry failed');
    }
  }

  if (!parseResult) {
    console.warn('[OCR][RESULT] no usable fields');
    throw new Error('[EXTRACTION_FAILED] Automatic extraction could not read this document clearly.');
  }

  // Stage 6: Field Normalization
  const normalizedDocType = normalizeDocumentType(parseResult.documentType);
  const normalizedFields = normalizeFields(parseResult.fields);

  logStage('Fields normalized');
  logStage('Extraction completed');

  const fieldCount = Object.keys(normalizedFields).length;
  console.log(`[OCR][RESULT] success: documentType="${normalizedDocType}", fieldsExtracted=${fieldCount}`);

  return {
    documentType: normalizedDocType,
    fields: normalizedFields,
    confidence: fieldCount > 0 ? 1 : 0,
    rawText: aiContent,
  };
}