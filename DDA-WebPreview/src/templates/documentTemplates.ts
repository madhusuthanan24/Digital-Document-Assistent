/**
 * documentTemplates.ts
 * Maps known AI-detected documentType strings → structured field definitions.
 * Keys MUST match the normalized documentType strings returned by ocrService.
 */
export const DOCUMENT_TEMPLATES: Record<
  string,
  { fields: { key: string; label: string; required?: boolean }[] }
> = {
  'Aadhaar Card': {
    fields: [
      { key: 'name', label: 'Full Name', required: true },
      { key: 'aadhaarNumber', label: 'Aadhaar Number', required: true },
      { key: 'dateOfBirth', label: 'Date of Birth' },
      { key: 'gender', label: 'Gender' },
      { key: 'address', label: 'Address' },
    ],
  },

  'PAN Card': {
    fields: [
      { key: 'name', label: 'Full Name', required: true },
      { key: 'panNumber', label: 'PAN Number', required: true },
      { key: 'fatherName', label: 'Father Name' },
      { key: 'dateOfBirth', label: 'Date of Birth' },
    ],
  },

  Passport: {
    fields: [
      { key: 'passportNumber', label: 'Passport Number', required: true },
      { key: 'name', label: 'Full Name', required: true },
      { key: 'nationality', label: 'Nationality' },
      { key: 'dateOfBirth', label: 'Date of Birth' },
      { key: 'issueDate', label: 'Issue Date' },
      { key: 'expiryDate', label: 'Expiry Date' },
    ],
  },

  'Driving Licence': {
    fields: [
      { key: 'licenceNumber', label: 'Licence Number', required: true },
      { key: 'name', label: 'Full Name', required: true },
      { key: 'dateOfBirth', label: 'Date of Birth' },
      { key: 'issueDate', label: 'Issue Date' },
      { key: 'expiryDate', label: 'Expiry Date' },
      { key: 'address', label: 'Address' },
    ],
  },

  'Voter ID': {
    fields: [
      { key: 'name', label: 'Full Name', required: true },
      { key: 'epicNumber', label: 'EPIC Number', required: true },
      { key: 'fatherName', label: "Father's Name" },
      { key: 'husbandName', label: "Husband's Name" },
      { key: 'guardianName', label: "Guardian's Name" },
      { key: 'dateOfBirth', label: 'Date of Birth / Age' },
      { key: 'gender', label: 'Gender' },
      { key: 'address', label: 'Address' },
    ],
  },

  'Vehicle RC': {
    fields: [
      { key: 'registrationNumber', label: 'Registration Number', required: true },
      { key: 'ownerName', label: 'Owner Name' },
      { key: 'vehicleClass', label: 'Vehicle Class' },
      { key: 'fuelType', label: 'Fuel Type' },
      { key: 'chassisNumber', label: 'Chassis Number' },
      { key: 'engineNumber', label: 'Engine Number' },
      { key: 'issueDate', label: 'Registration Date' },
      { key: 'expiryDate', label: 'Valid Upto' },
    ],
  },

  'Insurance Policy': {
    fields: [
      { key: 'policyNumber', label: 'Policy Number', required: true },
      { key: 'holderName', label: 'Policy Holder Name' },
      { key: 'insurerName', label: 'Insurer Name' },
      { key: 'issueDate', label: 'Issue Date' },
      { key: 'expiryDate', label: 'Expiry Date' },
      { key: 'sumInsured', label: 'Sum Insured' },
    ],
  },

  'Educational Certificate': {
    fields: [
      { key: 'name', label: 'Student Name', required: true },
      { key: 'rollNumber', label: 'Roll Number' },
      { key: 'courseName', label: 'Course / Degree' },
      { key: 'institution', label: 'Institution' },
      { key: 'issueDate', label: 'Year of Passing' },
      { key: 'percentage', label: 'Percentage / CGPA' },
    ],
  },
};

/**
 * Maps a DocumentCategory enum value to the template key used above.
 * Returns undefined if no template exists (→ dynamic form).
 */
export function categoryToTemplateKey(category: string): string | undefined {
  const map: Record<string, string> = {
    Aadhaar: 'Aadhaar Card',
    PAN: 'PAN Card',
    Passport: 'Passport',
    DrivingLicence: 'Driving Licence',
    VehicleRC: 'Vehicle RC',
    Insurance: 'Insurance Policy',
    EducationalCertificate: 'Educational Certificate',
    'Voter ID': 'Voter ID',
  };
  return map[category];
}

/**
 * Reverse-maps an AI-detected documentType to a DocumentCategory.
 * Returns undefined if unknown (keep as "Other").
 */
export function templateKeyToCategory(documentType: string): string | undefined {
  const map: Record<string, string> = {
    'Aadhaar Card': 'Aadhaar',
    'PAN Card': 'PAN',
    Passport: 'Passport',
    'Driving Licence': 'DrivingLicence',
    'Voter ID': 'Other', // Voter ID maps to category "Other" in enum, but shows Voter ID template
    'Vehicle RC': 'VehicleRC',
    'Insurance Policy': 'Insurance',
    'Educational Certificate': 'EducationalCertificate',
  };
  return map[documentType];
}
