export type DocumentCategory =
  | 'Aadhaar'
  | 'PAN'
  | 'Passport'
  | 'DrivingLicence'
  | 'VehicleRC'
  | 'Insurance'
  | 'EducationalCertificate'
  | 'Other';

export interface DocumentMetadata {
  id: string;
  userId: string;
  documentType: DocumentCategory;
  documentName: string;
  documentNumber: string;
  issueDate?: string;
  expiryDate?: string;
  localFileUri?: string;
  fileName?: string;
  mimeType?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ExpiryReminder {
  id: string;
  documentId: string;
  documentName: string;
  documentType: DocumentCategory;
  documentNumber?: string;
  expiryDate: string;
  daysRemaining: number;
  status: 'EXPIRED' | 'EXPIRING_SOON' | 'VALID';
}

/** Result returned by ocrService.extractFromImage() */
export interface OcrExtractionResult {
  /** Extracted document / ID number (Aadhaar, PAN, passport no., etc.) */
  documentNumber?: string;
  /** Issue date normalised to YYYY-MM-DD, if found */
  issueDate?: string;
  /** Expiry / validity date normalised to YYYY-MM-DD, if found */
  expiryDate?: string;
  /**
   * Confidence of the extraction:
   *  high   — 2+ fields extracted
   *  medium — 1 field extracted
   *  low    — OCR ran but no fields parsed
   *  none   — OCR failed entirely
   */
  confidence: 'high' | 'medium' | 'low' | 'none';
}
