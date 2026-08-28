/**
 * documentPrompts.ts — v4
 *
 * Specialized Vision AI prompts for every supported document type.
 * Includes a type-detection layer and strict schema adherence.
 *
 * Strict Extraction Rules:
 *  - Only extract fields that are physically printed and legible.
 *  - If a field is absent/missing, OMIT IT entirely.
 *  - Never return placeholders ('N/A', 'Unknown', 'Not provided', 'Not available', '-', etc.).
 *  - Do NOT guess or hallucinate.
 *  - Preserve exact printed names, text, and numbers without unnecessary modification.
 *  - Support dynamic fields for unknown / other documents.
 */

// ---------------------------------------------------------------------------
// System header shared by all extraction prompts
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// System header shared by all extraction prompts
// ---------------------------------------------------------------------------
export const SYSTEM_PROMPT_HEADER = `You are a precision Vision OCR & Document Extraction AI system.
Your sole job is to analyze document images and output structured JSON data containing exact printed text.

MANDATORY 6-STAGE INTERNAL EXTRACTION PROCESS:
STEP A — DOCUMENT IDENTIFICATION: Visually inspect headers, emblems, logos, and layout to identify the true document type regardless of initial classification hints.
STEP B — LABEL DISCOVERY: Visually inspect top, middle, and bottom of the image to locate all visible field labels and headings.
STEP C — VALUE LOCATION: Spatial-associate each value located directly adjacent to, below, or to the right of its printed label.
STEP D — EXACT CHARACTER READING: Read each character directly from the image itself without completing, expanding, or assuming missing text.
STEP E — VISUAL VERIFICATION: Check every extracted value against the visible image. If a character or field is unreadable or absent, OMIT IT.
STEP F — JSON OUTPUT: Output strictly valid JSON.

STRICT VISUAL EXTRACTION RULES:
1. Output EXACTLY ONE raw JSON object — no markdown code fences (\`\`\`json), no backticks, no explanatory prose before or after.
2. Read characters strictly from the image itself. Do NOT infer or reconstruct text based on typical document patterns.
3. NEVER infer or complete missing names (e.g. if "MADHUSUTHANAN" is printed, do NOT expand to "Madhusuthanan Pathmanaban" unless visible).
4. NEVER infer or invent missing addresses, dates, or ID numbers.
5. NEVER return placeholder values such as "N/A", "NA", "Unknown", "Not provided", "Not available", "None", "-", "?", "...", or "[blank]". If a field is not visibly printed or is unreadable, OMIT THAT KEY COMPLETELY.
6. Spatial Label-Value Association: Distinguish distinct labels (e.g. "NAME" vs "FATHER'S NAME" must remain separate fields and never be merged).
7. Support Multi-line Values: Preserve complete multi-line values (Address, Institution, Employer, Description, Place of Birth) without truncating line 2 or line 3.
8. Dates & ID Numbers: Verify every character visually. All full dates must be formatted as YYYY-MM-DD.
9. Indian / Multilingual Documents: When both English and regional script (Devanagari, Tamil, Telugu, Malayalam, Kannada, Bengali, Marathi, Gujarati, etc.) are present, extract the printed English text. Do NOT translate or transliterate text. If only regional language text exists, extract the printed text as-is.
10. Photo / Emblem / Graphic Confusion: Do NOT interpret photographs, logos, emblems, signatures, watermark text, or QR codes as text fields unless explicitly labeled.
11. Multi-Document Check: If the image contains MORE THAN ONE distinct document (e.g., two cards side-by-side or front+back of two different cards), set "multipleDocumentsDetected": true in the JSON object.`;

// ---------------------------------------------------------------------------
// Pass A: Classification-only prompt
// ---------------------------------------------------------------------------
export const CLASSIFY_ONLY_PROMPT = `You are a precision document classifier. Analyze the image visually and identify the exact type of document.

Respond with ONLY a raw JSON object in this exact format — NO other text:
{"documentType": "<type>", "confidence": "<high|medium|low>", "multipleDocuments": <true|false>}

Use the MOST SPECIFIC document type from this list:
- "Aadhaar Card"           → Indian UIDAI identity card / Aadhaar (12-digit UID)
- "PAN Card"               → Indian Income Tax PAN card / Permanent Account Number (PAN)
- "Passport"               → International travel document (booklet or card)
- "Driving Licence"        → Indian motor vehicle driving licence / Driving License
- "Voter ID"               → Indian Election Commission identity card (EPIC / Voter Card)
- "Vehicle RC"             → Indian vehicle registration certificate / RC book / Smart Card RC
- "Insurance Policy"       → Any insurance document, policy schedule, or certificate
- "Educational Certificate"→ Marksheet, degree certificate, admit card, transcript
- "Bank Document"          → Bank account statement, cheque, bank passbook, bank letter
- "Medical Document"       → Prescription, lab report, hospital record, medical certificate
- "Electronic Product"     → Product box, invoice, spec sheet for electronics/computer hardware
- "Employment Document"    → Offer letter, salary slip, employee ID, experience certificate
- "Other"                  → Recognizable document or paper but none of the standard categories above
- "Unknown Document"       → Cannot identify — image is blank, solid color, noise, or unrecognizable

Rules:
- Income Tax Department / Permanent Account Number (PAN) is ALWAYS "PAN Card".
- If the image contains front and back of two different cards or multiple distinct documents, set "multipleDocuments": true.
- Do NOT guess. If you cannot confidently identify → use "Unknown Document".`;

// ---------------------------------------------------------------------------
// Document-specific extraction prompts
// ---------------------------------------------------------------------------
export const DOCUMENT_TYPE_PROMPTS: Record<string, string> = {

  Aadhaar: `${SYSTEM_PROMPT_HEADER}

Task: Extract all clearly visible printed details from this Aadhaar Card (Indian UIDAI national identity card).
Only include keys for fields that are visibly printed. Omit any key whose field is missing or unreadable.
Extract standard expected fields PLUS any additional clearly visible printed fields on the card.

Schema:
{
  "documentType": "Aadhaar Card",
  "fields": {
    "aadhaarNumber": "XXXX XXXX XXXX",
    "name": "...",
    "fatherName": "...",
    "dateOfBirth": "YYYY-MM-DD",
    "gender": "...",
    "address": "..."
  }
}`,

  PAN: `${SYSTEM_PROMPT_HEADER}

Task: Extract all clearly visible printed details from this Indian PAN Card (Permanent Account Number).
Only include keys for fields that are visibly printed. Omit any key whose field is missing or unreadable.
Preserve exact printed name, father's name, DOB, and 10-character PAN.
Extract standard expected fields PLUS any additional clearly visible printed fields on the card.

Schema:
{
  "documentType": "PAN Card",
  "fields": {
    "panNumber": "ABCDE1234F",
    "name": "...",
    "fatherName": "...",
    "dateOfBirth": "YYYY-MM-DD"
  }
}`,

  Passport: `${SYSTEM_PROMPT_HEADER}

Task: Extract all clearly visible printed details from this Passport data page.
Only include keys for fields that are visibly printed. Omit any key whose field is missing or unreadable.
Extract standard expected fields PLUS any additional clearly visible printed fields.

Schema:
{
  "documentType": "Passport",
  "fields": {
    "passportNumber": "...",
    "name": "...",
    "surname": "...",
    "givenName": "...",
    "nationality": "...",
    "dateOfBirth": "YYYY-MM-DD",
    "sex": "...",
    "dateOfIssue": "YYYY-MM-DD",
    "dateOfExpiry": "YYYY-MM-DD",
    "placeOfBirth": "...",
    "placeOfIssue": "..."
  }
}`,

  DrivingLicence: `${SYSTEM_PROMPT_HEADER}

Task: Extract all clearly visible printed details from this Indian Driving Licence.
Only include keys for fields that are visibly printed. Omit any key whose field is missing or unreadable.
Extract standard expected fields PLUS any additional clearly visible printed fields.

Schema:
{
  "documentType": "Driving Licence",
  "fields": {
    "licenceNumber": "...",
    "name": "...",
    "dateOfBirth": "YYYY-MM-DD",
    "issueDate": "YYYY-MM-DD",
    "validFrom": "YYYY-MM-DD",
    "validTo": "YYYY-MM-DD",
    "expiryDate": "YYYY-MM-DD",
    "address": "...",
    "vehicleClasses": "..."
  }
}`,

  VehicleRC: `${SYSTEM_PROMPT_HEADER}

Task: Extract all clearly visible printed details from this Vehicle Registration Certificate (RC Book / Smart Card RC).
Only include keys for fields that are visibly printed. Omit any key whose field is missing or unreadable.
Extract standard expected fields PLUS any additional clearly visible printed fields.

Schema:
{
  "documentType": "Vehicle RC",
  "fields": {
    "registrationNumber": "...",
    "ownerName": "...",
    "vehicleClass": "...",
    "fuelType": "...",
    "chassisNumber": "...",
    "engineNumber": "...",
    "issueDate": "YYYY-MM-DD",
    "expiryDate": "YYYY-MM-DD"
  }
}`,

  VoterID: `${SYSTEM_PROMPT_HEADER}

Task: Extract all clearly visible printed details from this Indian Voter ID / Election Commission Identity Card (EPIC).
Only include keys for fields that are visibly printed. Omit any key whose field is missing or unreadable.
Extract standard expected fields PLUS any additional clearly visible printed fields.

Schema:
{
  "documentType": "Voter ID",
  "fields": {
    "epicNumber": "...",
    "voterIdNumber": "...",
    "name": "...",
    "fatherName": "...",
    "husbandName": "...",
    "gender": "...",
    "dateOfBirth": "YYYY-MM-DD",
    "age": "...",
    "address": "..."
  }
}`,

  Insurance: `${SYSTEM_PROMPT_HEADER}

Task: Extract all clearly visible printed details from this Insurance Policy / Certificate document.
Only include keys for fields that are visibly printed. Omit any key whose field is missing or unreadable.
Extract standard expected fields PLUS any additional clearly visible printed fields.

Schema:
{
  "documentType": "Insurance Policy",
  "fields": {
    "policyNumber": "...",
    "insurerName": "...",
    "holderName": "...",
    "sumInsured": "...",
    "premiumAmount": "...",
    "issueDate": "YYYY-MM-DD",
    "expiryDate": "YYYY-MM-DD"
  }
}`,

  EducationalCertificate: `${SYSTEM_PROMPT_HEADER}

Task: Extract all clearly visible printed details from this Marksheet / Degree Certificate / Educational Certificate.
Only include keys for fields that are visibly printed. Omit any key whose field is missing or unreadable.
Extract standard expected fields PLUS any additional clearly visible printed fields.

Schema:
{
  "documentType": "Educational Certificate",
  "fields": {
    "name": "...",
    "rollNumber": "...",
    "institution": "...",
    "courseName": "...",
    "issueDate": "...",
    "percentage": "..."
  }
}`,

  BankDocument: `${SYSTEM_PROMPT_HEADER}

Task: Extract all clearly visible printed details from this Bank Document (statement, passbook, cheque, bank letter, etc.).
Only include keys for fields that are visibly printed. Omit any key whose field is missing or unreadable.
Extract standard expected fields PLUS any additional clearly visible printed fields.

Schema:
{
  "documentType": "Bank Document",
  "fields": {
    "bankName": "...",
    "accountHolderName": "...",
    "accountNumber": "...",
    "ifscCode": "...",
    "branchName": "...",
    "statementPeriod": "...",
    "openingBalance": "...",
    "closingBalance": "..."
  }
}`,

  MedicalDocument: `${SYSTEM_PROMPT_HEADER}

Task: Extract all clearly visible printed details from this Medical Document (prescription, lab report, hospital record, medical certificate, etc.).
Only include keys for fields that are visibly printed. Omit any key whose field is missing or unreadable.
Extract standard expected fields PLUS any additional clearly visible printed fields.

Schema:
{
  "documentType": "Medical Document",
  "fields": {
    "patientName": "...",
    "doctorName": "...",
    "hospitalName": "...",
    "documentDate": "YYYY-MM-DD",
    "diagnosis": "...",
    "medications": "...",
    "testName": "...",
    "testResult": "..."
  }
}`,

  ElectronicProduct: `${SYSTEM_PROMPT_HEADER}

Task: Extract all clearly visible printed details from this Electronic / Computer product document (product box, invoice, spec sheet, warranty card, label).
Only include keys for fields that are visibly printed. Omit any key whose field is missing or unreadable.
Extract standard expected fields PLUS any additional clearly visible printed fields.

Schema:
{
  "documentType": "Electronic Product",
  "fields": {
    "brand": "...",
    "model": "...",
    "serialNumber": "...",
    "processor": "...",
    "memory": "...",
    "storage": "...",
    "purchaseDate": "YYYY-MM-DD",
    "warrantyExpiry": "YYYY-MM-DD",
    "price": "..."
  }
}`,

  Other: `${SYSTEM_PROMPT_HEADER}

Task: Visually inspect top, middle, and bottom of the image and extract ALL key printed label-value pairs into structured JSON.
This could be any document type not covered by standard categories.

IMPORTANT:
- DO NOT write prose or descriptions. Extract ONLY specific key-value pairs that are physically printed.
- Use concise, meaningful key names matching what is printed (e.g. "InvoiceNumber", "VendorName", "TotalAmount", "Date").
- If a field is not present or not readable, DO NOT include it.
- NEVER return "N/A", "Unknown", "-", or placeholders.

Schema:
{
  "documentType": "<most specific document type identified from image>",
  "fields": {
    "<printedKey>": "<printedValue>"
  }
}`,
};

// ---------------------------------------------------------------------------
// Type normalization — maps any AI-returned string to a canonical category key
// ---------------------------------------------------------------------------

/**
 * Maps an AI-detected documentType string (which may vary in wording) to our
 * canonical category key used in DOCUMENT_TYPE_PROMPTS.
 * Returns null if no known category matches.
 */
export function normalizeDetectedType(detected: string): string | null {
  if (!detected) return null;
  const d = detected.trim().toLowerCase();

  if (d.includes('aadhaar') || d.includes('aadhar') || d.includes('uid')) return 'Aadhaar';
  if (d.includes('pan') || d.includes('permanent account')) return 'PAN';
  if (d.includes('passport')) return 'Passport';
  if (d.includes('driving') || d.includes('licence') || d.includes('license') || d === 'dl') return 'DrivingLicence';
  if (d.includes('vehicle') || d.includes(' rc') || d === 'rc' || d.includes('registration cert')) return 'VehicleRC';
  if (d.includes('voter') || d.includes('epic') || d.includes('election')) return 'VoterID';
  if (d.includes('insurance') || d.includes('policy')) return 'Insurance';
  if (
    d.includes('certificate') || d.includes('marksheet') ||
    d.includes('degree') || d.includes('transcript') ||
    d.includes('admit card') || d.includes('educational')
  ) return 'EducationalCertificate';
  if (
    d.includes('bank') || d.includes('statement') ||
    d.includes('cheque') || d.includes('passbook')
  ) return 'BankDocument';
  if (
    d.includes('medical') || d.includes('prescription') ||
    d.includes('lab report') || d.includes('discharge') ||
    d.includes('hospital') || d.includes('doctor')
  ) return 'MedicalDocument';
  if (
    d.includes('electronic') || d.includes('computer') ||
    d.includes('hardware') || d.includes('product') ||
    d.includes('laptop') || d.includes('phone') ||
    d.includes('invoice') || d.includes('warranty')
  ) return 'ElectronicProduct';
  if (d.includes('unknown') || d === '') return null;
  if (d.includes('other')) return 'Other';

  return null; // could not normalize → caller decides
}

/**
 * Returns true when the AI's detected type meaningfully conflicts with the user's hint.
 * Conflict = different canonical category, both clearly identified.
 */
export function typesConflict(hintCategory: string, detectedCategory: string | null): boolean {
  if (!detectedCategory) return false;
  if (!hintCategory) return false;
  if (detectedCategory === 'Other') return false;
  if (hintCategory === detectedCategory) return false;
  if (hintCategory === 'Other') return false;
  return true;
}

// ---------------------------------------------------------------------------
// Prompt resolution helpers
// ---------------------------------------------------------------------------

/** Returns the best extraction prompt for a given canonical category key */
export function getPromptForCategory(categoryHint?: string): string {
  if (!categoryHint) return DOCUMENT_TYPE_PROMPTS.Other;

  const clean = categoryHint.trim();
  if (DOCUMENT_TYPE_PROMPTS[clean]) return DOCUMENT_TYPE_PROMPTS[clean];

  // Try normalization for loose strings
  const normalized = normalizeDetectedType(clean);
  if (normalized && DOCUMENT_TYPE_PROMPTS[normalized]) return DOCUMENT_TYPE_PROMPTS[normalized];

  return DOCUMENT_TYPE_PROMPTS.Other;
}

/**
 * Returns the best prompt for a detected documentType string (from AI response or classification).
 */
export function getPromptForDetectedType(detectedType: string): string {
  const normalized = normalizeDetectedType(detectedType);
  if (normalized && DOCUMENT_TYPE_PROMPTS[normalized]) return DOCUMENT_TYPE_PROMPTS[normalized];
  return DOCUMENT_TYPE_PROMPTS.Other;
}

/** Returns true when we should run Pass A classification before extraction */
export function needsClassification(categoryHint?: string): boolean {
  if (!categoryHint) return true;
  const lower = categoryHint.trim().toLowerCase();
  return lower === 'other' || lower === 'other document' || lower === '' || lower === 'unknown';
}
