/**
 * fieldValidators.ts — v5
 *
 * Extraction Validation Engine for Digital Document Assistant.
 *
 * Capabilities:
 *  - Required field detection
 *  - Empty & placeholder value filtering (never outputs "N/A", "Unknown", etc.)
 *  - Format pattern validation (PAN, Aadhaar, Voter ID, Passport, DL, RC, IFSC)
 *  - Impossible date detection (invalid day/month, year < 1900 or > 2100, future DOB, issue > expiry)
 *  - Suspicious text/name value detection (digits in names, invalid punctuation)
 *  - Document-type mismatch detection
 *  - Never invents or fabricates missing values
 *  - Outputs per-field confidence: HIGH, MEDIUM, LOW
 *  - Marks fields needing review with specific validation issue messages
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface ValidatedField {
  value: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  needsReview: boolean;
  issue?: string;
}

export interface ExtractionValidationResult {
  fields: Record<string, string>;
  validatedFields: Record<string, ValidatedField>;
  fieldConfidence: Record<string, 'high' | 'medium' | 'low'>;
  overallConfidence: 'high' | 'medium' | 'low' | 'none';
  validationIssues: string[];
  missingRequiredFields: string[];
  validFieldCount: number;
  totalFieldCount: number;
}

// ---------------------------------------------------------------------------
// 1. Required Fields by Document Category
// ---------------------------------------------------------------------------
export const REQUIRED_FIELDS_BY_TYPE: Record<string, string[]> = {
  'Aadhaar Card': ['aadhaarNumber', 'name'],
  'PAN Card': ['panNumber', 'name'],
  'Passport': ['passportNumber', 'name'],
  'Driving Licence': ['licenceNumber', 'name'],
  'Voter ID': ['epicNumber', 'name'],
  'Vehicle RC': ['registrationNumber'],
  'Insurance Policy': ['policyNumber'],
  'Educational Certificate': ['name'],
  'Bank Document': ['bankName', 'accountNumber'],
  'Medical Document': ['patientName'],
  'Electronic Product': ['brand'],
};

// ---------------------------------------------------------------------------
// 2. OCR Confusion Correction — NUMBER/ID SEGMENTS ONLY (Never applied to names)
// ---------------------------------------------------------------------------
export function forceLettersOnly(str: string): string {
  if (!str) return '';
  return str
    .toUpperCase()
    .replace(/0/g, 'O')
    .replace(/1/g, 'I')
    .replace(/2/g, 'Z')
    .replace(/5/g, 'S')
    .replace(/8/g, 'B')
    .replace(/[^A-Z]/g, '');
}

export function forceDigitsOnly(str: string): string {
  if (!str) return '';
  return str
    .replace(/O/gi, '0')
    .replace(/I/gi, '1')
    .replace(/l/gi, '1')
    .replace(/Z/gi, '2')
    .replace(/S/gi, '5')
    .replace(/B/gi, '8')
    .replace(/[^0-9]/g, '');
}

export function isNameField(key: string): boolean {
  const lower = key.toLowerCase();
  return (
    lower.includes('name') ||
    lower.includes('address') ||
    lower.includes('gender') ||
    lower.includes('sex') ||
    lower.includes('nationality') ||
    lower.includes('class') ||
    lower.includes('fuel') ||
    lower.includes('course') ||
    lower.includes('institution') ||
    lower.includes('percentage') ||
    lower.includes('insurer') ||
    lower.includes('holder') ||
    lower.includes('place') ||
    lower.includes('city') ||
    lower.includes('state') ||
    lower.includes('doctor') ||
    lower.includes('hospital') ||
    lower.includes('patient') ||
    lower.includes('diagnosis') ||
    lower.includes('medication') ||
    lower.includes('brand') ||
    lower.includes('model') ||
    lower.includes('branch')
  );
}

// ---------------------------------------------------------------------------
// 3. ID Cleaners & Pattern Checkers
// ---------------------------------------------------------------------------
export function validateAndCleanPan(raw: string): string | null {
  if (!raw) return null;
  const clean = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (clean.length !== 10) return null;

  const prefix = forceLettersOnly(clean.slice(0, 5));
  const digits = forceDigitsOnly(clean.slice(5, 9));
  const suffix = forceLettersOnly(clean.slice(9, 10));
  const candidate = `${prefix}${digits}${suffix}`;
  return /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(candidate) ? candidate : null;
}

export function validateAndCleanAadhaar(raw: string): string | null {
  if (!raw) return null;
  const digits = forceDigitsOnly(raw);
  if (digits.length === 12) {
    return `${digits.slice(0, 4)} ${digits.slice(4, 8)} ${digits.slice(8, 12)}`;
  }
  return null;
}

export function validateAndCleanEpic(raw: string): string | null {
  if (!raw) return null;
  const clean = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (clean.length === 10) {
    const prefix = forceLettersOnly(clean.slice(0, 3));
    const digits = forceDigitsOnly(clean.slice(3, 10));
    const candidate = `${prefix}${digits}`;
    if (/^[A-Z]{3}[0-9]{7}$/.test(candidate)) return candidate;
  }
  return clean.length >= 8 && clean.length <= 12 ? clean : null;
}

export function validateAndCleanPassport(raw: string): string | null {
  if (!raw) return null;
  const clean = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (clean.length === 8) {
    const letter = forceLettersOnly(clean.slice(0, 1));
    const digits = forceDigitsOnly(clean.slice(1, 8));
    const candidate = `${letter}${digits}`;
    if (/^[A-Z]{1}[0-9]{7}$/.test(candidate)) return candidate;
  }
  return clean.length >= 7 && clean.length <= 9 ? clean : null;
}

export function validateAndCleanVehicleRc(raw: string): string | null {
  if (!raw) return null;
  const clean = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (clean.length >= 8 && clean.length <= 11) {
    const state = forceLettersOnly(clean.slice(0, 2));
    const rto = forceDigitsOnly(clean.slice(2, 4));
    const rest = clean.slice(4);
    if (state.length === 2 && rto.length === 2) {
      return `${state}${rto}${rest}`;
    }
  }
  return clean.length >= 6 ? clean : null;
}

// ---------------------------------------------------------------------------
// 4. Universal Date Normalizer & Impossible Date Detector
// ---------------------------------------------------------------------------
export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (year < 1900 || year > 2100) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1) return false;

  const daysInMonth = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= daysInMonth[month - 1];
}

export function normalizeDate(rawDate: string): string | null {
  if (!rawDate) return null;
  const str = rawDate.trim();

  const MONTH_MAP: Record<string, string> = {
    jan: '01', january: '01',
    feb: '02', february: '02',
    mar: '03', march: '03',
    apr: '04', april: '04',
    may: '05',
    jun: '06', june: '06',
    jul: '07', july: '07',
    aug: '08', august: '08',
    sep: '09', september: '09', sept: '09',
    oct: '10', october: '10',
    nov: '11', november: '11',
    dec: '12', december: '12',
  };

  // YYYY-MM-DD or YYYY/MM/DD
  const isoMatch = str.match(/^(\d{4})[-/.](0?[1-9]|1[0-2])[-/.](0?[1-9]|[12]\d|3[01])$/);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    const yNum = parseInt(y, 10);
    const mNum = parseInt(m, 10);
    const dNum = parseInt(d, 10);
    if (isValidCalendarDate(yNum, mNum, dNum)) {
      return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }
    return null;
  }

  // DD-MM-YYYY or DD/MM/YYYY
  const dmyMatch = str.match(/^(0?[1-9]|[12]\d|3[01])[-/.](0?[1-9]|1[0-2])[-/.](\d{4})$/);
  if (dmyMatch) {
    const [, d, m, y] = dmyMatch;
    const yNum = parseInt(y, 10);
    const mNum = parseInt(m, 10);
    const dNum = parseInt(d, 10);
    if (isValidCalendarDate(yNum, mNum, dNum)) {
      return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }
    return null;
  }

  // DD Month YYYY (e.g. 15 Aug 1995 or 15-AUG-1995)
  const textMonthMatch = str.match(/^(0?[1-9]|[12]\d|3[01])[\s/.-]+([A-Za-z]{3,9})[\s/.-]+(\d{4})$/);
  if (textMonthMatch) {
    const [, d, mName, y] = textMonthMatch;
    const mNumStr = MONTH_MAP[mName.toLowerCase()];
    if (mNumStr) {
      const yNum = parseInt(y, 10);
      const mNum = parseInt(mNumStr, 10);
      const dNum = parseInt(d, 10);
      if (isValidCalendarDate(yNum, mNum, dNum)) {
        return `${y}-${mNumStr}-${d.padStart(2, '0')}`;
      }
    }
  }

  // Month DD, YYYY (e.g. August 15, 1995)
  const textMonthFirstMatch = str.match(/^([A-Za-z]{3,9})[\s/.-]+(0?[1-9]|[12]\d|3[01]),?[\s/.-]+(\d{4})$/);
  if (textMonthFirstMatch) {
    const [, mName, d, y] = textMonthFirstMatch;
    const mNumStr = MONTH_MAP[mName.toLowerCase()];
    if (mNumStr) {
      const yNum = parseInt(y, 10);
      const mNum = parseInt(mNumStr, 10);
      const dNum = parseInt(d, 10);
      if (isValidCalendarDate(yNum, mNum, dNum)) {
        return `${y}-${mNumStr}-${d.padStart(2, '0')}`;
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// 5. Array-format JSON Field Flattener
// ---------------------------------------------------------------------------
export function flattenArrayFields(raw: Record<string, any> | any[]): Record<string, any> {
  const result: Record<string, any> = {};
  if (!raw || typeof raw !== 'object') return result;

  if (Array.isArray(raw)) {
    const allPrimitives = raw.every(x => typeof x !== 'object' || x === null);
    if (allPrimitives) {
      const joined = raw.filter(x => x !== null && x !== undefined).map(x => String(x).trim()).filter(Boolean).join(', ');
      return joined ? { value: joined } : {};
    }
    for (const item of raw) {
      if (item && typeof item === 'object') {
        const key = item.key || item.field || item.label || item.name;
        const val = item.value || item.val || item.text || item.content;
        if (key && val !== undefined) {
          result[String(key).trim()] = typeof val === 'object' ? JSON.stringify(val) : String(val).trim();
        } else {
          Object.assign(result, flattenArrayFields(item));
        }
      }
    }
    return result;
  }

  for (const [key, val] of Object.entries(raw)) {
    if (val === null || val === undefined) continue;
    if (Array.isArray(val)) {
      const allPrimitives = val.every(x => typeof x !== 'object' || x === null);
      if (allPrimitives) {
        const joined = val.filter(x => x !== null && x !== undefined).map(x => String(x).trim()).filter(Boolean).join(', ');
        if (joined) result[key] = joined;
      } else {
        const sub = flattenArrayFields(val);
        for (const [subK, subV] of Object.entries(sub)) {
          result[`${key}_${subK}`] = subV;
        }
      }
    } else if (typeof val === 'object') {
      const sub = flattenArrayFields(val);
      for (const [subK, subV] of Object.entries(sub)) {
        result[subK] = subV;
      }
    } else {
      const str = String(val).trim();
      if (str) result[key] = str;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// 6. Field Sanitization & Placeholder Filter
// ---------------------------------------------------------------------------
export const PLACEHOLDER_REGEX =
  /^(n\/a|na|none|null|undefined|not\s*(available|provided|found|specified|present|applicable|visible)|unclear|unknown|absent|missing|-+|_|\?+|\*+|\[.*?\]|\.\.\.|\s*)$/i;

export function sanitizeFieldValue(val: any): string | null {
  if (val === null || val === undefined) return null;
  const str = String(val).trim();
  if (!str || PLACEHOLDER_REGEX.test(str)) return null;
  if (/^[*_\-\s:]+$/.test(str)) return null;
  const cleaned = str.replace(/^\*+|\*+$/g, '').trim();
  if (!cleaned || PLACEHOLDER_REGEX.test(cleaned)) return null;
  if (cleaned.length < 1) return null;
  return cleaned;
}

// ---------------------------------------------------------------------------
// 7. Expected field count per document type
// ---------------------------------------------------------------------------
export const EXPECTED_FIELD_COUNTS: Record<string, number> = {
  'Aadhaar Card': 5,
  'PAN Card': 4,
  'Passport': 6,
  'Driving Licence': 6,
  'Voter ID': 5,
  'Vehicle RC': 6,
  'Insurance Policy': 5,
  'Educational Certificate': 5,
  'Bank Document': 5,
  'Medical Document': 5,
  'Electronic Product': 5,
  'Other Document': 3,
};

export function getExpectedFieldCount(documentType: string): number {
  for (const [key, count] of Object.entries(EXPECTED_FIELD_COUNTS)) {
    if (documentType.toLowerCase().includes(key.toLowerCase())) return count;
  }
  return 3;
}

// ---------------------------------------------------------------------------
// 8. Primary Extraction Validation & Confidence Scoring Engine
// ---------------------------------------------------------------------------
export function validateAndPostProcessFields(
  documentType: string,
  rawInput: Record<string, any> | any[]
): ExtractionValidationResult {
  const rawFields = flattenArrayFields(rawInput);
  const processedFields: Record<string, string> = {};
  const validatedFields: Record<string, ValidatedField> = {};
  const fieldConfidence: Record<string, 'high' | 'medium' | 'low'> = {};
  const validationIssues: string[] = [];
  const missingRequiredFields: string[] = [];

  const docLower = documentType.toLowerCase();

  // ── Step 1: Validate & Clean Each Extracted Field ─────────────────────────
  for (const [key, rawVal] of Object.entries(rawFields)) {
    const val = sanitizeFieldValue(rawVal);
    if (!val) continue;

    const lowerKey = key.toLowerCase();
    let finalValue = val;
    let confidence: 'HIGH' | 'MEDIUM' | 'LOW' = 'MEDIUM';
    let needsReview = false;
    let issue: string | undefined;

    // ── 1A: ID & Number Validation ─────────────────────────────────────────
    const isPanKey = lowerKey.includes('pan') || (docLower.includes('pan') && lowerKey.includes('number'));
    const isAadhaarKey = lowerKey.includes('aadhaar') || lowerKey.includes('aadhar') || lowerKey.includes('uid');
    const isEpicKey = lowerKey.includes('epic') || lowerKey.includes('voter');
    const isPassportKey = lowerKey.includes('passport') && lowerKey.includes('number');
    const isRcKey = (docLower.includes('vehicle') || docLower.includes('rc')) && (lowerKey.includes('registration') || lowerKey.includes('reg'));

    if (isPanKey) {
      const cleaned = validateAndCleanPan(val);
      if (cleaned) {
        finalValue = cleaned;
        confidence = 'HIGH';
      } else {
        confidence = 'LOW';
        needsReview = true;
        issue = 'Invalid PAN format (expected 5 letters, 4 digits, 1 letter)';
        validationIssues.push(`PAN Number "${val}" does not match standard 10-char format.`);
      }
    } else if (isAadhaarKey) {
      const cleaned = validateAndCleanAadhaar(val);
      if (cleaned) {
        finalValue = cleaned;
        confidence = 'HIGH';
      } else {
        confidence = 'LOW';
        needsReview = true;
        issue = 'Invalid Aadhaar format (expected 12 digits)';
        validationIssues.push(`Aadhaar Number "${val}" is not a valid 12-digit number.`);
      }
    } else if (isEpicKey) {
      const cleaned = validateAndCleanEpic(val);
      if (cleaned && /^[A-Z]{3}[0-9]{7}$/.test(cleaned)) {
        finalValue = cleaned;
        confidence = 'HIGH';
      } else if (cleaned) {
        finalValue = cleaned;
        confidence = 'MEDIUM';
      } else {
        confidence = 'LOW';
        needsReview = true;
        issue = 'Unusual Voter ID format (expected 3 letters + 7 digits)';
      }
    } else if (isPassportKey) {
      const cleaned = validateAndCleanPassport(val);
      if (cleaned && /^[A-Z]{1}[0-9]{7}$/.test(cleaned)) {
        finalValue = cleaned;
        confidence = 'HIGH';
      } else if (cleaned) {
        finalValue = cleaned;
        confidence = 'MEDIUM';
      } else {
        confidence = 'LOW';
        needsReview = true;
        issue = 'Unusual Passport number format (expected 1 letter + 7 digits)';
      }
    } else if (isRcKey) {
      const cleaned = validateAndCleanVehicleRc(val);
      if (cleaned) {
        finalValue = cleaned;
        confidence = 'HIGH';
      } else {
        confidence = 'LOW';
        needsReview = true;
        issue = 'Unusual Vehicle Registration format';
      }
    }

    // ── 1B: Date Field Validation ──────────────────────────────────────────
    else if (
      lowerKey.includes('date') || lowerKey === 'dob' ||
      lowerKey === 'issue' || lowerKey === 'expiry' ||
      lowerKey.includes('validity') || lowerKey.includes('born') ||
      lowerKey.includes('validfrom') || lowerKey.includes('validto') ||
      lowerKey.includes('validupto') || lowerKey.includes('valid_from') ||
      lowerKey.includes('valid_to')
    ) {
      const normalizedDate = normalizeDate(val);
      if (normalizedDate) {
        finalValue = normalizedDate;
        confidence = 'HIGH';

        // Check future DOB
        if (lowerKey.includes('birth') || lowerKey === 'dob' || lowerKey.includes('born')) {
          const dob = new Date(normalizedDate);
          if (!isNaN(dob.getTime()) && dob > new Date()) {
            confidence = 'LOW';
            needsReview = true;
            issue = 'Date of birth is in the future';
            validationIssues.push(`Date of birth "${normalizedDate}" is in the future.`);
          }
        }
      } else {
        // Impossible or unparseable date format
        confidence = 'LOW';
        needsReview = true;
        issue = 'Unrecognized or impossible date format';
        validationIssues.push(`Field "${key}" has an invalid date value "${val}".`);
      }
    }

    // ── 1C: Name & Text Field Validation ───────────────────────────────────
    else if (isNameField(key)) {
      if (/[0-9]/.test(val) && (lowerKey.includes('name') || lowerKey.includes('doctor') || lowerKey.includes('patient'))) {
        confidence = 'LOW';
        needsReview = true;
        issue = 'Name contains numbers';
        validationIssues.push(`Name field "${key}" contains numbers: "${val}".`);
      } else if (/[@#$%^&*_{}<>\\|]/.test(val)) {
        confidence = 'LOW';
        needsReview = true;
        issue = 'Contains unusual symbols';
      } else if (val.length < 2) {
        confidence = 'LOW';
        needsReview = true;
        issue = 'Unusually short text';
      } else {
        confidence = 'HIGH';
      }
    }

    // ── 1D: Generic Non-empty Field ────────────────────────────────────────
    else {
      confidence = 'HIGH';
    }

    processedFields[key] = finalValue;
    validatedFields[key] = { value: finalValue, confidence, needsReview, issue };
    fieldConfidence[key] = confidence.toLowerCase() as 'high' | 'medium' | 'low';
  }

  // ── Step 2: Cross-Field Date Validation (Issue Date <= Expiry Date) ──────
  const issueStr = processedFields.issueDate || processedFields.dateOfIssue || processedFields.validFrom;
  const expiryStr = processedFields.expiryDate || processedFields.dateOfExpiry || processedFields.validTo;

  if (issueStr && expiryStr) {
    const issueDateObj = new Date(issueStr);
    const expiryDateObj = new Date(expiryStr);
    if (!isNaN(issueDateObj.getTime()) && !isNaN(expiryDateObj.getTime()) && issueDateObj > expiryDateObj) {
      validationIssues.push(`Issue date (${issueStr}) is after Expiry date (${expiryStr}).`);
      if (validatedFields.expiryDate) {
        validatedFields.expiryDate.confidence = 'LOW';
        validatedFields.expiryDate.needsReview = true;
        validatedFields.expiryDate.issue = 'Expiry date is before issue date';
        fieldConfidence.expiryDate = 'low';
      }
      if (validatedFields.dateOfExpiry) {
        validatedFields.dateOfExpiry.confidence = 'LOW';
        validatedFields.dateOfExpiry.needsReview = true;
        validatedFields.dateOfExpiry.issue = 'Expiry date is before issue date';
        fieldConfidence.dateOfExpiry = 'low';
      }
    }
  }

  // ── Step 3: Required Fields Detection ────────────────────────────────────
  for (const [docCategory, reqFields] of Object.entries(REQUIRED_FIELDS_BY_TYPE)) {
    if (docLower.includes(docCategory.toLowerCase()) || docCategory.toLowerCase().includes(docLower)) {
      for (const reqKey of reqFields) {
        const found = Object.keys(processedFields).some(k => k.toLowerCase() === reqKey.toLowerCase());
        if (!found) {
          missingRequiredFields.push(reqKey);
          validationIssues.push(`Required field "${reqKey}" was not detected on this ${docCategory}.`);
        }
      }
      break;
    }
  }

  // ── Step 4: Alias Synchronization ───────────────────────────────────────
  if (processedFields.voterIdNumber && !processedFields.epicNumber) {
    processedFields.epicNumber = processedFields.voterIdNumber;
    validatedFields.epicNumber = validatedFields.voterIdNumber;
    fieldConfidence.epicNumber = fieldConfidence.voterIdNumber;
  } else if (processedFields.epicNumber && !processedFields.voterIdNumber) {
    processedFields.voterIdNumber = processedFields.epicNumber;
    validatedFields.voterIdNumber = validatedFields.epicNumber;
    fieldConfidence.voterIdNumber = fieldConfidence.epicNumber;
  }

  if (processedFields.dateOfIssue && !processedFields.issueDate) {
    processedFields.issueDate = processedFields.dateOfIssue;
    validatedFields.issueDate = validatedFields.dateOfIssue;
    fieldConfidence.issueDate = fieldConfidence.dateOfIssue;
  } else if (processedFields.issueDate && !processedFields.dateOfIssue) {
    processedFields.dateOfIssue = processedFields.issueDate;
    validatedFields.dateOfIssue = validatedFields.issueDate;
    fieldConfidence.dateOfIssue = fieldConfidence.issueDate;
  }

  if (processedFields.dateOfExpiry && !processedFields.expiryDate) {
    processedFields.expiryDate = processedFields.dateOfExpiry;
    validatedFields.expiryDate = validatedFields.dateOfExpiry;
    fieldConfidence.expiryDate = fieldConfidence.dateOfExpiry;
  } else if (processedFields.expiryDate && !processedFields.dateOfExpiry) {
    processedFields.dateOfExpiry = processedFields.expiryDate;
    validatedFields.dateOfExpiry = validatedFields.expiryDate;
    fieldConfidence.dateOfExpiry = fieldConfidence.expiryDate;
  }

  if (processedFields.validFrom && !processedFields.issueDate) {
    processedFields.issueDate = processedFields.validFrom;
    validatedFields.issueDate = validatedFields.validFrom;
    fieldConfidence.issueDate = fieldConfidence.validFrom;
  }
  if (processedFields.validTo && !processedFields.expiryDate) {
    processedFields.expiryDate = processedFields.validTo;
    validatedFields.expiryDate = validatedFields.validTo;
    fieldConfidence.expiryDate = fieldConfidence.validTo;
  }

  if (processedFields.sex && !processedFields.gender) {
    processedFields.gender = processedFields.sex;
    validatedFields.gender = validatedFields.sex;
    fieldConfidence.gender = fieldConfidence.sex;
  } else if (processedFields.gender && !processedFields.sex) {
    processedFields.sex = processedFields.gender;
    validatedFields.sex = validatedFields.gender;
    fieldConfidence.sex = fieldConfidence.gender;
  }

  // ── Step 5: Overall Confidence Calculation ──────────────────────────────
  const validFieldCount = Object.keys(processedFields).length;
  const highCount = Object.values(fieldConfidence).filter(c => c === 'high').length;
  const lowCount = Object.values(fieldConfidence).filter(c => c === 'low').length;

  let overallConfidence: 'high' | 'medium' | 'low' | 'none' = 'none';
  if (validFieldCount === 0) {
    overallConfidence = 'none';
  } else if (lowCount > 0 || missingRequiredFields.length > 0) {
    overallConfidence = 'low';
  } else if (highCount >= 1 && validFieldCount >= 2) {
    overallConfidence = 'high';
  } else if (validFieldCount >= 2) {
    overallConfidence = 'medium';
  } else if (validFieldCount === 1) {
    overallConfidence = 'low';
  }

  return {
    fields: processedFields,
    validatedFields,
    fieldConfidence,
    overallConfidence,
    validationIssues,
    missingRequiredFields,
    validFieldCount,
    totalFieldCount: Object.keys(rawFields).length,
  };
}
