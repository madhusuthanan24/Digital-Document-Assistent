import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  Modal,
  Image,
  Dimensions,
  Platform,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { readAsStringAsync, writeAsStringAsync, EncodingType, cacheDirectory, documentDirectory, downloadAsync, StorageAccessFramework, copyAsync, getInfoAsync } from 'expo-file-system/legacy';
import { theme } from '../../constants/theme';
import { documentService } from '../../services/document/documentService';
import { notificationService } from '../../services/notifications/notificationService';
import { DocumentCategory, DocumentMetadata } from '../../types/document';
import { DOCUMENT_TEMPLATES, categoryToTemplateKey } from '../../templates/documentTemplates';
import { LoadingIndicator } from '../../components/common/LoadingIndicator';
import { EmptyState } from '../../components/common/EmptyState';
import { Button } from '../../components/common/Button';
import { Input } from '../../components/common/Input';
import { useAuth } from '../../context/AuthContext';

const { width } = Dimensions.get('window');

interface EditableFieldItem {
  key: string;
  label: string;
  value: string;
  placeholder?: string;
  required?: boolean;
  isRemovable?: boolean;
  multiline?: boolean;
}

export const DocumentsScreen: React.FC<any> = ({ navigation }) => {
  const { user } = useAuth();
  const [documents, setDocuments] = useState<DocumentMetadata[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Detail & Edit Modal State
  const [selectedDoc, setSelectedDoc] = useState<DocumentMetadata | null>(null);
  const [isEditMode, setIsEditMode] = useState<boolean>(false);
  const [editName, setEditName] = useState<string>('');
  const [editFormValues, setEditFormValues] = useState<Record<string, string>>({});
  const [isAddingField, setIsAddingField] = useState<boolean>(false);
  const [newFieldKey, setNewFieldKey] = useState<string>('');
  const [newFieldValue, setNewFieldValue] = useState<string>('');
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isExporting, setIsExporting] = useState<boolean>(false);

  // Large Image Preview State
  const [previewImageUri, setPreviewImageUri] = useState<string | null>(null);

  const categories = [
    { label: 'All', value: 'ALL' },
    { label: 'Aadhaar', value: 'Aadhaar' },
    { label: 'PAN', value: 'PAN' },
    { label: 'Voter ID', value: 'VoterID' },
    { label: 'Passport', value: 'Passport' },
    { label: 'Licence', value: 'DrivingLicence' },
    { label: 'Vehicle RC', value: 'VehicleRC' },
    { label: 'Insurance', value: 'Insurance' },
    { label: 'Educational', value: 'EducationalCertificate' },
    { label: 'Other', value: 'Other' },
  ];

  const fetchDocs = useCallback(async () => {
    if (!user?.uid) return;
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const data = await documentService.getDocuments(user.uid);
      setDocuments(data);
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to load documents.');
    } finally {
      setIsLoading(false);
    }
  }, [user?.uid]);

  useFocusEffect(
    useCallback(() => {
      fetchDocs();
    }, [fetchDocs])
  );

  const resolveTemplateKey = (category: string, docName?: string): string | undefined => {
    const normalizedCategory = category === 'VoterID' ? 'Voter ID' : category;
    const mapped = categoryToTemplateKey(normalizedCategory);
    if (mapped && DOCUMENT_TEMPLATES[mapped]) return mapped;
    if (DOCUMENT_TEMPLATES[category]) return category;
    if (docName && DOCUMENT_TEMPLATES[docName]) return docName;
    return undefined;
  };

  const buildInitialFormValues = (doc: DocumentMetadata): Record<string, string> => {
    const values: Record<string, string> = {};

    // 1. Populate all saved dynamic fields from doc.fields
    if (doc.fields && typeof doc.fields === 'object') {
      for (const [k, v] of Object.entries(doc.fields)) {
        if (v !== undefined && v !== null && String(v).trim()) {
          values[k] = String(v).trim();
        }
      }
    }

    const templateKey = resolveTemplateKey(doc.documentType, doc.documentName);
    const template = templateKey ? DOCUMENT_TEMPLATES[templateKey] : undefined;

    if (template) {
      // 2. Pre-populate template fields from matching doc attributes if not in fields
      for (const f of template.fields) {
        const existingKey = Object.keys(values).find(k => k.toLowerCase() === f.key.toLowerCase());
        if (!existingKey || !values[existingKey]) {
          let valFromRoot = '';
          const lk = f.key.toLowerCase();
          if (
            lk.includes('number') ||
            lk.includes('epic') ||
            lk.includes('licence') ||
            lk.includes('policy') ||
            lk.includes('registration') ||
            lk.includes('roll') ||
            lk.includes('account')
          ) {
            valFromRoot = doc.documentNumber || '';
          } else if (
            lk === 'name' ||
            lk.includes('holder') ||
            lk.includes('owner') ||
            lk.includes('student') ||
            lk.includes('patient')
          ) {
            valFromRoot = doc.name || '';
          } else if (
            lk.includes('father') ||
            lk.includes('husband') ||
            lk.includes('guardian') ||
            lk.includes('relative')
          ) {
            valFromRoot = doc.fatherName || '';
          } else if (lk === 'gender' || lk === 'sex') {
            valFromRoot = doc.gender || '';
          } else if (lk.includes('birth') || lk === 'dob') {
            valFromRoot = doc.dateOfBirth || '';
          } else if (lk === 'address') {
            valFromRoot = doc.address || '';
          } else if (lk === 'issuedate') {
            valFromRoot = doc.issueDate || '';
          } else if (lk === 'expirydate') {
            valFromRoot = doc.expiryDate || '';
          }
          if (valFromRoot) {
            values[f.key] = valFromRoot;
          }
        }
      }
    } else {
      // 3. For "Other" / Custom documents: ONLY add root properties if they contain non-empty saved data
      if (doc.documentNumber && doc.documentNumber.trim() && !values['documentNumber']) {
        values['documentNumber'] = doc.documentNumber.trim();
      }
      if (doc.name && doc.name.trim() && !values['name']) {
        values['name'] = doc.name.trim();
      }
      if (doc.fatherName && doc.fatherName.trim() && !values['fatherName']) {
        values['fatherName'] = doc.fatherName.trim();
      }
      if (doc.gender && doc.gender.trim() && !values['gender']) {
        values['gender'] = doc.gender.trim();
      }
      if (doc.dateOfBirth && doc.dateOfBirth.trim() && !values['dateOfBirth']) {
        values['dateOfBirth'] = doc.dateOfBirth.trim();
      }
      if (doc.address && doc.address.trim() && !values['address']) {
        values['address'] = doc.address.trim();
      }
      if (doc.issueDate && doc.issueDate.trim() && !values['issueDate']) {
        values['issueDate'] = doc.issueDate.trim();
      }
      if (doc.expiryDate && doc.expiryDate.trim() && !values['expiryDate']) {
        values['expiryDate'] = doc.expiryDate.trim();
      }
    }

    return values;
  };

  const getRenderedFields = (doc: DocumentMetadata, formValues: Record<string, string>): EditableFieldItem[] => {
    const templateKey = resolveTemplateKey(doc.documentType, doc.documentName);
    const template = templateKey ? DOCUMENT_TEMPLATES[templateKey] : undefined;

    const fields: EditableFieldItem[] = [];
    const usedKeys = new Set<string>();

    if (template) {
      // 1. Template fields in defined order
      for (const tf of template.fields) {
        usedKeys.add(tf.key.toLowerCase());
        const matchingKey = Object.keys(formValues).find(k => k.toLowerCase() === tf.key.toLowerCase()) || tf.key;
        const val = formValues[matchingKey] ?? '';

        fields.push({
          key: matchingKey,
          label: tf.label,
          value: val,
          placeholder: `Enter ${tf.label.toLowerCase()}`,
          required: tf.required,
          isRemovable: false,
          multiline: tf.key.toLowerCase().includes('address'),
        });
      }

      // 2. Extra saved dynamic fields outside template
      for (const [k, v] of Object.entries(formValues)) {
        if (!usedKeys.has(k.toLowerCase())) {
          usedKeys.add(k.toLowerCase());
          const formattedLabel = k
            .replace(/([A-Z])/g, ' $1')
            .replace(/_/g, ' ')
            .replace(/^\w/, c => c.toUpperCase())
            .trim();

          fields.push({
            key: k,
            label: formattedLabel,
            value: v || '',
            placeholder: `Enter ${formattedLabel.toLowerCase()}`,
            isRemovable: true,
            multiline: k.toLowerCase().includes('address') || k.toLowerCase().includes('spec') || k.toLowerCase().includes('feature'),
          });
        }
      }
    } else {
      // Custom / "Other" document: ONLY fields that actually exist in doc.fields or non-empty root properties
      const keysOrder: string[] = [];

      // Preserve doc.fields order first
      if (doc.fields) {
        for (const k of Object.keys(doc.fields)) {
          if (!keysOrder.includes(k)) keysOrder.push(k);
        }
      }

      // Include root props if they exist in formValues
      const rootKeys = ['documentNumber', 'name', 'fatherName', 'gender', 'dateOfBirth', 'address', 'issueDate', 'expiryDate'];
      for (const rk of rootKeys) {
        if (formValues[rk] && !keysOrder.includes(rk)) {
          keysOrder.push(rk);
        }
      }

      // Include any other keys in formValues (e.g. newly added custom fields)
      for (const k of Object.keys(formValues)) {
        if (!keysOrder.includes(k)) {
          keysOrder.push(k);
        }
      }

      for (const k of keysOrder) {
        const val = formValues[k] ?? '';
        let label = k;
        if (k === 'documentNumber') label = 'Document Number';
        else if (k === 'name') label = 'Holder / Contact Name';
        else if (k === 'fatherName') label = 'Father / Relative Name';
        else if (k === 'gender') label = 'Gender';
        else if (k === 'dateOfBirth') label = 'Date of Birth';
        else if (k === 'address') label = 'Address';
        else if (k === 'issueDate') label = 'Issue Date';
        else if (k === 'expiryDate') label = 'Expiry Date';
        else {
          label = k
            .replace(/([A-Z])/g, ' $1')
            .replace(/_/g, ' ')
            .replace(/^\w/, c => c.toUpperCase())
            .trim();
        }

        fields.push({
          key: k,
          label,
          value: val,
          placeholder: `Enter ${label.toLowerCase()}`,
          isRemovable: true,
          multiline: k.toLowerCase().includes('address') || k.toLowerCase().includes('spec') || k.toLowerCase().includes('feature'),
        });
      }
    }

    return fields;
  };

  const handleOpenDocDetails = (doc: DocumentMetadata) => {
    setSelectedDoc(doc);
    const initialVals = buildInitialFormValues(doc);
    setEditFormValues(initialVals);
    setEditName(doc.documentName || '');
    setIsAddingField(false);
    setNewFieldKey('');
    setNewFieldValue('');
    setIsEditMode(false);

    const rendered = getRenderedFields(doc, initialVals);
    console.log(`[EDIT_DOC] Document ID: ${doc.id}`);
    console.log(`[EDIT_DOC] Document type: ${doc.documentType}`);
    console.log(`[EDIT_DOC] Saved fields: ${JSON.stringify(Object.keys(doc.fields || {}))}`);
    console.log(`[EDIT_DOC] Fields rendered: ${rendered.map(f => f.key).join(', ')}`);
  };

  const handleCancelEdit = () => {
    if (selectedDoc) {
      setEditName(selectedDoc.documentName || '');
      setEditFormValues(buildInitialFormValues(selectedDoc));
    }
    setIsAddingField(false);
    setNewFieldKey('');
    setNewFieldValue('');
    setIsEditMode(false);
  };

  const handleCloseModal = () => {
    setSelectedDoc(null);
    setIsEditMode(false);
    setIsAddingField(false);
  };

  const handleSaveEdit = async () => {
    if (!selectedDoc || !user?.uid) return;
    if (!editName.trim()) {
      Alert.alert('Validation Error', 'Document Name is required.');
      return;
    }

    // Document-specific validation
    const aadhaarVal = editFormValues['aadhaarNumber'] || editFormValues['aadhaar'];
    if (aadhaarVal && aadhaarVal.trim()) {
      const digitsOnly = aadhaarVal.replace(/\s+/g, '');
      if (!/^\d{12}$/.test(digitsOnly)) {
        Alert.alert('Validation Error', 'Aadhaar Number must be a valid 12-digit number.');
        return;
      }
    }

    const panVal = editFormValues['panNumber'] || editFormValues['pan'];
    if (panVal && panVal.trim()) {
      if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/i.test(panVal.trim())) {
        Alert.alert('Validation Error', 'PAN Number must be in the format ABCDE1234F.');
        return;
      }
    }

    console.log(`[DOCUMENT_EDIT] Save requested: ${selectedDoc.id}`);
    setIsSaving(true);
    try {
      const cleanFields: Record<string, string> = {};
      for (const [k, v] of Object.entries(editFormValues)) {
        const tk = k.trim();
        const tv = typeof v === 'string' ? v.trim() : String(v || '').trim();
        if (tk && tv && !/^[*_\-\s:]+$/.test(tv)) {
          cleanFields[tk] = tv;
        }
      }

      const findFieldVal = (...keys: string[]): string | undefined => {
        for (const k of keys) {
          const matchingKey = Object.keys(cleanFields).find(ck => ck.toLowerCase() === k.toLowerCase());
          if (matchingKey && cleanFields[matchingKey]) {
            return cleanFields[matchingKey];
          }
        }
        return undefined;
      };

      const docNumber = findFieldVal(
        'documentNumber', 'aadhaarNumber', 'panNumber', 'passportNumber',
        'epicNumber', 'voterIdNumber', 'licenceNumber', 'registrationNumber',
        'policyNumber', 'rollNumber', 'accountNumber'
      ) ?? selectedDoc.documentNumber ?? undefined;

      const holderName = findFieldVal(
        'name', 'fullName', 'holderName', 'ownerName', 'studentName', 'patientName', 'accountHolderName'
      ) ?? selectedDoc.name ?? undefined;

      const fatherName = findFieldVal(
        'fatherName', 'husbandName', 'guardianName'
      ) ?? selectedDoc.fatherName ?? undefined;

      const gender = findFieldVal(
        'gender', 'sex'
      ) ?? selectedDoc.gender ?? undefined;

      const dateOfBirth = findFieldVal(
        'dateOfBirth', 'dob'
      ) ?? selectedDoc.dateOfBirth ?? undefined;

      const address = findFieldVal(
        'address'
      ) ?? selectedDoc.address ?? undefined;

      const issueDate = findFieldVal(
        'issueDate'
      ) ?? selectedDoc.issueDate ?? undefined;

      const expiryDate = findFieldVal(
        'expiryDate'
      ) ?? selectedDoc.expiryDate ?? undefined;

      const updatePayload: Partial<DocumentMetadata> = {
        documentName: editName.trim(),
        documentType: selectedDoc.documentType,
        documentNumber: docNumber,
        name: holderName,
        fatherName: fatherName,
        gender: gender,
        address: address,
        dateOfBirth: dateOfBirth,
        issueDate: issueDate,
        expiryDate: expiryDate,
        fields: Object.keys(cleanFields).length > 0 ? cleanFields : undefined,
      };

      await documentService.updateDocument(user.uid, selectedDoc.id, updatePayload);
      notificationService.cancelDocumentNotifications(selectedDoc.id);

      const updatedDoc: DocumentMetadata = {
        ...selectedDoc,
        ...updatePayload,
        fields: cleanFields,
        updatedAt: new Date().toISOString(),
      };
      setSelectedDoc(updatedDoc);

      Alert.alert('Saved', 'Document details updated successfully.');
      setIsEditMode(false);
      fetchDocs();
    } catch (err: any) {
      Alert.alert('Update Failed', err?.message || 'Could not update document.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteDoc = (doc: DocumentMetadata) => {
    Alert.alert(
      'Confirm Delete',
      `Are you sure you want to delete "${doc.documentName}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            if (!user?.uid) return;
            try {
              await documentService.deleteDocument(user.uid, doc.id);
              notificationService.cancelDocumentNotifications(doc.id);
              Alert.alert('Deleted', 'Document deleted successfully.');
              handleCloseModal();
              fetchDocs();
            } catch (err: any) {
              Alert.alert('Delete Failed', err?.message || 'Could not delete document.');
            }
          },
        },
      ]
    );
  };

  // Helper to convert any image source (http/https remote or file://) to a Base64 Data URL for PDF HTML embedding
  const getImageBase64DataUrl = async (imageUri: string): Promise<string | null> => {
    try {
      let localPath = imageUri;

      if (imageUri.startsWith('http://') || imageUri.startsWith('https://')) {
        const tempName = `temp_pdf_${Date.now()}.jpg`;
        const cachePath = `${cacheDirectory}${tempName}`;
        const downloadRes = await downloadAsync(imageUri, cachePath);
        localPath = downloadRes.uri;
      }

      const base64 = await readAsStringAsync(localPath, {
        encoding: EncodingType.Base64,
      });

      return `data:image/jpeg;base64,${base64}`;
    } catch (err) {
      return null;
    }
  };

  // ---------------------------------------------------------------------------
  // PDF Export & Native Sharing Logic
  // ---------------------------------------------------------------------------

  const buildDynamicPdfRows = (doc: DocumentMetadata): string => {
    const rows: { label: string; value: string }[] = [];

    rows.push({ label: 'Document Name', value: doc.documentName });
    rows.push({ label: 'Type', value: doc.documentType });

    if (doc.documentNumber && doc.documentNumber.trim()) {
      rows.push({ label: 'Document Number', value: doc.documentNumber.trim() });
    }
    if (doc.name && doc.name.trim()) {
      rows.push({ label: 'Holder Name', value: doc.name.trim() });
    }
    if (doc.fatherName && doc.fatherName.trim()) {
      rows.push({ label: 'Father / Relative Name', value: doc.fatherName.trim() });
    }
    if (doc.gender && doc.gender.trim()) {
      rows.push({ label: 'Gender', value: doc.gender.trim() });
    }
    if (doc.dateOfBirth && doc.dateOfBirth.trim()) {
      rows.push({ label: 'Date of Birth', value: doc.dateOfBirth.trim() });
    }
    if (doc.address && doc.address.trim()) {
      rows.push({ label: 'Address', value: doc.address.trim() });
    }
    if (doc.issueDate && doc.issueDate.trim()) {
      rows.push({ label: 'Issue Date', value: doc.issueDate.trim() });
    }
    if (doc.expiryDate && doc.expiryDate.trim()) {
      rows.push({ label: 'Expiry Date', value: doc.expiryDate.trim() });
    }

    if (doc.fields && typeof doc.fields === 'object') {
      Object.entries(doc.fields).forEach(([key, val]) => {
        if (val && typeof val === 'string' && val.trim()) {
          const formattedLabel = key
            .replace(/([A-Z])/g, ' $1')
            .replace(/_/g, ' ')
            .replace(/^\w/, c => c.toUpperCase())
            .trim();

          const exists = rows.some(r => r.label.toLowerCase() === formattedLabel.toLowerCase());
          if (!exists) {
            rows.push({ label: formattedLabel, value: val.trim() });
          }
        }
      });
    }

    return rows
      .map(r => `<tr><th>${r.label}</th><td>${r.value}</td></tr>`)
      .join('\n            ');
  };

  interface GeneratedPdfResult {
    rawUri: string;
    localPdfUri: string;
    base64Data: string;
    fileName: string;
  }

  const generatePdfFile = async (doc: DocumentMetadata, fileName: string): Promise<GeneratedPdfResult> => {
    console.log(`[PDF Log 1] Generating PDF for: ${doc.documentName}`);

    // Prioritize cropped image path over original raw image
    const rawImageSource = doc.croppedImagePath || doc.localFileUri || doc.fileUrl;
    console.log(`[PDF Log 1.1] Resolved Cropped Image Source: ${rawImageSource || 'None'}`);

    let base64ImageDataUrl: string | null = null;

    if (rawImageSource) {
      base64ImageDataUrl = await getImageBase64DataUrl(rawImageSource);
      console.log(`[PDF Log 1.2] Base64 image status: ${base64ImageDataUrl ? 'Converted' : 'Failed'}`);
    }

    const dynamicTableRows = buildDynamicPdfRows(doc);

    const htmlContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>${doc.documentName}</title>
          <style>
            body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; margin: 30px; color: #1e293b; }
            .header { border-bottom: 2px solid #1e3a8a; padding-bottom: 12px; margin-bottom: 20px; }
            .title { font-size: 24px; font-weight: bold; color: #1e3a8a; margin: 0; }
            .subtitle { font-size: 14px; color: #64748b; margin-top: 4px; }
            .table { width: 100%; border-collapse: collapse; margin-top: 15px; margin-bottom: 25px; }
            .table th, .table td { text-align: left; padding: 10px 12px; border-bottom: 1px solid #e2e8f0; }
            .table th { background-color: #f8fafc; font-size: 13px; color: #475569; width: 35%; }
            .table td { font-size: 14px; font-weight: 500; }
            .image-container { text-align: center; margin-top: 20px; page-break-inside: avoid; }
            .doc-image { max-width: 100%; max-height: 450px; border-radius: 8px; border: 1px solid #cbd5e1; margin-top: 10px; }
            .footer { margin-top: 30px; font-size: 11px; color: #94a3b8; text-align: center; border-top: 1px solid #e2e8f0; padding-top: 10px; }
          </style>
        </head>
        <body>
          <div class="header">
            <h1 class="title">${doc.documentName}</h1>
            <div class="subtitle">Type: ${doc.documentType} | Digital Document Assistant</div>
          </div>

          <table class="table">
            ${dynamicTableRows}
          </table>

          ${base64ImageDataUrl ? `
            <div class="image-container">
              <h3 style="color: #1e3a8a; font-size: 14px;">CROPPED DOCUMENT IMAGE</h3>
              <img src="${base64ImageDataUrl}" class="doc-image" />
            </div>
          ` : ''}

          <div class="footer">
            Generated securely by Digital Document Assistant • ${new Date().toLocaleDateString()}
          </div>
        </body>
      </html>
    `;

    console.log('[PDF Log 1.3] Calling Print.printToFileAsync for binary PDF');
    const printResult = await Print.printToFileAsync({ html: htmlContent, base64: true });
    const generatedUri = printResult.uri;
    const uriScheme = generatedUri.includes(':') ? generatedUri.split(':')[0] : 'unknown';
    const rawFilename = generatedUri.split('/').pop() || 'unknown';

    console.log(`[PDF_DIAG] generated URI: ${generatedUri}`);
    console.log(`[PDF_DIAG] URI scheme: ${uriScheme}`);
    console.log(`[PDF_DIAG] filename: ${rawFilename}`);

    try {
      const sourceInfo = await getInfoAsync(generatedUri);
      console.log(`[PDF_DIAG] source exists: ${sourceInfo.exists}`);
      console.log(`[PDF_DIAG] source readable: ${sourceInfo.exists ? 'true' : 'false'}`);
      console.log(`[PDF_DIAG] source size: ${sourceInfo.exists ? (sourceInfo as any).size ?? 0 : 0}`);
    } catch (checkErr: any) {
      console.log(`[PDF_DIAG] source exists: false`);
      console.log(`[PDF_DIAG] source readable: false`);
      console.log(`[PDF_DIAG] source size: 0`);
    }

    console.log(`[PDF SHARE] SOURCE_URI: ${generatedUri}`);
    const baseDir = cacheDirectory || documentDirectory;
    const destUri = `${baseDir}${Date.now()}_${fileName}`;
    console.log(`[PDF SHARE] DESTINATION_URI: ${destUri}`);

    const base64Data = printResult.base64 || '';
    if (base64Data) {
      await writeAsStringAsync(destUri, base64Data, { encoding: EncodingType.Base64 });
    } else {
      await copyAsync({ from: generatedUri, to: destUri });
    }

    const info = await getInfoAsync(destUri);
    const exists = info.exists;
    const size = info.exists ? (info as any).size ?? 0 : 0;

    console.log(`[PDF SHARE] DESTINATION_EXISTS: ${exists}`);
    console.log(`[PDF SHARE] DESTINATION_SIZE: ${size}`);

    if (!exists || size === 0) {
      throw new Error(`Copied PDF file is invalid or empty at ${destUri}`);
    }

    return {
      rawUri: generatedUri,
      localPdfUri: destUri,
      base64Data,
      fileName,
    };
  };

  const handleSavePdf = async () => {
    if (!selectedDoc) return;
    console.log(`[PDF Log 2] handleSavePdf triggered for: ${selectedDoc.documentName}`);
    setIsExporting(true);

    try {
      const sanitizedDocNumber = (selectedDoc.documentNumber || 'Document').replace(/[^a-zA-Z0-9_-]/g, '_');
      const sanitizedDocType = selectedDoc.documentType.replace(/[^a-zA-Z0-9_-]/g, '_');
      const fileName = `${sanitizedDocType}_${sanitizedDocNumber}.pdf`;

      const pdfPromise = generatePdfFile(selectedDoc, fileName);
      const timeoutPromise = new Promise<GeneratedPdfResult>((_, reject) =>
        setTimeout(() => reject(new Error('PDF generation timed out after 15 seconds.')), 15000)
      );

      const pdfResult = await Promise.race([pdfPromise, timeoutPromise]);
      console.log(`[PDF Log 2.1] App-readable PDF URI ready for save: ${pdfResult.localPdfUri}`);

      if (Platform.OS === 'android' && StorageAccessFramework) {
        try {
          console.log('[PDF Log 2.2] Requesting StorageAccessFramework directory permissions');
          const saf = StorageAccessFramework;
          const permissions = await saf.requestDirectoryPermissionsAsync();
          if (permissions.granted) {
            console.log('[PDF Log 2.3] Directory permissions granted. Writing file.');
            const newFileUri = await saf.createFileAsync(
              permissions.directoryUri,
              fileName,
              'application/pdf'
            );
            await writeAsStringAsync(newFileUri, pdfResult.base64Data, { encoding: EncodingType.Base64 });
            console.log(`[PDF Log 2.4] PDF saved successfully via SAF: ${newFileUri}`);
            Alert.alert('PDF Saved', `PDF saved successfully as "${fileName}".`);
            return;
          }
        } catch (safErr: any) {
          console.warn(`[PDF Log 2.5] SAF Save fallback: ${safErr?.message}`);
        }
      }

      if (await Sharing.isAvailableAsync()) {
        console.log('[PDF SHARE] SHARE_START: Using Sharing dialog to save PDF');
        await Sharing.shareAsync(pdfResult.localPdfUri, { mimeType: 'application/pdf', dialogTitle: `Save ${fileName}` });
        console.log('[PDF SHARE] SHARE_SUCCESS: PDF saved via Sharing dialog');
        Alert.alert('PDF Saved', 'PDF file ready and saved successfully.');
      } else {
        Alert.alert('PDF Saved', `PDF file generated successfully at ${pdfResult.localPdfUri}`);
      }
    } catch (err: any) {
      console.error('[PDF Log 2.7] handleSavePdf error:', err);
      Alert.alert('Save PDF Failed', err?.message || 'Could not save PDF.');
    } finally {
      setIsExporting(false);
    }
  };

  const handleSharePdf = async () => {
    if (!selectedDoc) return;
    console.log(`[PDF Log 3] handleSharePdf triggered for: ${selectedDoc.documentName}`);
    setIsExporting(true);

    try {
      const sanitizedDocNumber = (selectedDoc.documentNumber || 'Document').replace(/[^a-zA-Z0-9_-]/g, '_');
      const sanitizedDocType = selectedDoc.documentType.replace(/[^a-zA-Z0-9_-]/g, '_');
      const fileName = `${sanitizedDocType}_${sanitizedDocNumber}.pdf`;

      const pdfPromise = generatePdfFile(selectedDoc, fileName);
      const timeoutPromise = new Promise<GeneratedPdfResult>((_, reject) =>
        setTimeout(() => reject(new Error('PDF generation timed out after 15 seconds.')), 15000)
      );

      const pdfResult = await Promise.race([pdfPromise, timeoutPromise]);
      console.log(`[PDF Log 3.1] App-readable PDF URI ready for sharing: ${pdfResult.localPdfUri}`);

      if (await Sharing.isAvailableAsync()) {
        console.log('[PDF SHARE] SHARE_START: Launching native Share sheet with mimeType application/pdf');
        await Sharing.shareAsync(pdfResult.localPdfUri, {
          mimeType: 'application/pdf',
          dialogTitle: `Share ${selectedDoc.documentName} PDF`,
          UTI: 'com.adobe.pdf',
        });
        console.log('[PDF SHARE] SHARE_SUCCESS: Share sheet launched successfully');
      } else {
        Alert.alert('Sharing Unavailable', 'Native sharing is not supported on this device.');
      }
    } catch (err: any) {
      console.error('[PDF Log 3.4] handleSharePdf error:', err);
      if (err?.message !== 'User cancelled') {
        Alert.alert('Unable to Share PDF', err?.message || 'Could not share PDF.');
      }
    } finally {
      setIsExporting(false);
    }
  };

  const handleShareImage = async () => {
    if (!selectedDoc) return;
    const imageSource = selectedDoc.croppedImagePath || selectedDoc.fileUrl || selectedDoc.localFileUri;
    if (!imageSource) {
      Alert.alert('No Image', 'No image file is attached to this document.');
      return;
    }

    try {
      let localPath = imageSource;
      if (imageSource.startsWith('http://') || imageSource.startsWith('https://')) {
        const cachePath = `${cacheDirectory}share_${Date.now()}.jpg`;
        const downloadRes = await downloadAsync(imageSource, cachePath);
        localPath = downloadRes.uri;
      }

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(localPath, {
          mimeType: 'image/jpeg',
          dialogTitle: `Share ${selectedDoc.documentName} Image`,
        });
      } else {
        Alert.alert('Sharing Unavailable', 'Native sharing is not supported on this device.');
      }
    } catch (err: any) {
      Alert.alert('Share Image Failed', err?.message || 'Could not share image.');
    }
  };

  const filteredDocs = documents.filter((doc) => {
    const matchesCategory =
      selectedCategory === 'ALL' || doc.documentType === selectedCategory;
    const matchesSearch =
      doc.documentName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      doc.documentType.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (doc.documentNumber &&
        doc.documentNumber.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesCategory && matchesSearch;
  });

  if (isLoading) {
    return <LoadingIndicator message="Loading personal vault..." />;
  }

  return (
    <View style={styles.container}>
      {/* Search Header */}
      <View style={styles.searchContainer}>
        <Text style={styles.searchIcon}>🔍</Text>
        <TextInput
          style={styles.searchInput}
          placeholder="Search name, type, or number..."
          placeholderTextColor={theme.colors.textMuted}
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery('')}>
            <Text style={styles.clearIcon}>✖</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Category Filter Chips */}
      <View style={styles.chipWrapper}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {categories.map((cat) => {
            const isSelected = selectedCategory === cat.value;
            return (
              <TouchableOpacity
                key={cat.value}
                style={[styles.chip, isSelected && styles.chipSelected]}
                onPress={() => setSelectedCategory(cat.value)}
                activeOpacity={0.8}
              >
                <Text
                  style={[styles.chipText, isSelected && styles.chipTextSelected]}
                >
                  {cat.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* Error state */}
      {errorMessage ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{errorMessage}</Text>
          <TouchableOpacity onPress={fetchDocs} style={styles.retryBtn}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {/* Main List */}
      <ScrollView contentContainerStyle={styles.listContent}>
        {filteredDocs.length === 0 ? (
          <EmptyState
            icon="📂"
            title="No Documents Found"
            description={
              searchQuery
                ? `No documents matching "${searchQuery}"`
                : 'No documents saved under this category yet.'
            }
          />
        ) : (
          filteredDocs.map((doc) => (
            <TouchableOpacity
              key={doc.id}
              style={styles.card}
              activeOpacity={0.8}
              onPress={() => handleOpenDocDetails(doc)}
            >
              <View style={styles.cardHeader}>
                <View style={styles.categoryBadge}>
                  <Text style={styles.categoryText}>{doc.documentType}</Text>
                </View>
                <Text style={styles.dateText}>
                  {doc.issueDate ? `Issued: ${doc.issueDate}` : 'Secured'}
                </Text>
              </View>
              <Text style={styles.cardTitle}>{doc.documentName}</Text>
              <Text style={styles.cardNumber}>
                {doc.documentNumber || (doc.fileName ? `File: ${doc.fileName}` : 'Saved in Vault')}
              </Text>
              {doc.expiryDate ? (
                <Text style={styles.expiryText}>
                  Expires: <Text style={styles.expiryDate}>{doc.expiryDate}</Text>
                </Text>
              ) : null}
            </TouchableOpacity>
          ))
        )}
      </ScrollView>

      {/* Document Details & Edit Modal */}
      <Modal
        visible={!!selectedDoc}
        animationType="slide"
        transparent={true}
        onRequestClose={handleCloseModal}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {isEditMode ? 'Edit Document' : 'Document Details'}
              </Text>
              <TouchableOpacity onPress={handleCloseModal}>
                <Text style={styles.closeBtn}>✕</Text>
              </TouchableOpacity>
            </View>

            {selectedDoc ? (
              <ScrollView style={styles.modalBody}>
                {!isEditMode ? (
                  // Read-Only Detail View
                  <View>
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>Document Name</Text>
                      <Text style={styles.detailValue}>{selectedDoc.documentName}</Text>
                    </View>

                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>Document Type</Text>
                      <Text style={styles.detailValue}>{selectedDoc.documentType}</Text>
                    </View>

                    {selectedDoc.documentNumber ? (
                      <View style={styles.detailRow}>
                        <Text style={styles.detailLabel}>Document Number</Text>
                        <Text style={styles.detailValue}>{selectedDoc.documentNumber}</Text>
                      </View>
                    ) : null}

                    {selectedDoc.name ? (
                      <View style={styles.detailRow}>
                        <Text style={styles.detailLabel}>Holder Name</Text>
                        <Text style={styles.detailValue}>{selectedDoc.name}</Text>
                      </View>
                    ) : null}

                    {selectedDoc.fatherName ? (
                      <View style={styles.detailRow}>
                        <Text style={styles.detailLabel}>Father / Relative Name</Text>
                        <Text style={styles.detailValue}>{selectedDoc.fatherName}</Text>
                      </View>
                    ) : null}

                    {selectedDoc.gender ? (
                      <View style={styles.detailRow}>
                        <Text style={styles.detailLabel}>Gender</Text>
                        <Text style={styles.detailValue}>{selectedDoc.gender}</Text>
                      </View>
                    ) : null}

                    {selectedDoc.dateOfBirth ? (
                      <View style={styles.detailRow}>
                        <Text style={styles.detailLabel}>Date of Birth</Text>
                        <Text style={styles.detailValue}>{selectedDoc.dateOfBirth}</Text>
                      </View>
                    ) : null}

                    {selectedDoc.address ? (
                      <View style={styles.detailRow}>
                        <Text style={styles.detailLabel}>Address</Text>
                        <Text style={styles.detailValue}>{selectedDoc.address}</Text>
                      </View>
                    ) : null}

                    {selectedDoc.issueDate ? (
                      <View style={styles.detailRow}>
                        <Text style={styles.detailLabel}>Issue Date</Text>
                        <Text style={styles.detailValue}>{selectedDoc.issueDate}</Text>
                      </View>
                    ) : null}

                    {selectedDoc.expiryDate ? (
                      <View style={styles.detailRow}>
                        <Text style={styles.detailLabel}>Expiry Date</Text>
                        <Text style={styles.detailValue}>{selectedDoc.expiryDate}</Text>
                      </View>
                    ) : null}

                    {/* Display All Saved Dynamic Fields */}
                    {selectedDoc.fields && Object.keys(selectedDoc.fields).length > 0 ? (
                      <View style={styles.fieldsSection}>
                        <Text style={styles.fieldsSectionTitle}>Extracted Information</Text>
                        {Object.entries(selectedDoc.fields).map(([k, v]) => (
                          <View key={k} style={styles.detailRow}>
                            <Text style={styles.detailLabel}>{k.replace(/_/g, ' ')}</Text>
                            <Text style={styles.detailValue}>{v}</Text>
                          </View>
                        ))}
                      </View>
                    ) : null}

                    {/* Cropped Document Image Preview */}
                    {(selectedDoc.croppedImagePath || selectedDoc.fileUrl || selectedDoc.localFileUri) ? (
                      <View style={styles.imagePreviewSection}>
                        <Text style={styles.fieldsSectionTitle}>Document Image</Text>
                        <TouchableOpacity
                          activeOpacity={0.9}
                          onPress={() => setPreviewImageUri(selectedDoc.croppedImagePath || selectedDoc.fileUrl || selectedDoc.localFileUri || null)}
                        >
                          <Image
                            source={{ uri: selectedDoc.croppedImagePath || selectedDoc.fileUrl || selectedDoc.localFileUri }}
                            style={styles.docPreviewImage}
                            resizeMode="cover"
                          />
                          <Text style={styles.tapToEnlarge}>Tap to view full screen</Text>
                        </TouchableOpacity>
                      </View>
                    ) : null}

                    {/* Actions: Save PDF, Share PDF, Share Image, Edit, Delete */}
                    <View style={styles.modalActionStack}>
                      <View style={styles.buttonRow}>
                        <Button
                          title="📥 Download PDF"
                          onPress={handleSavePdf}
                          isLoading={isExporting}
                          variant="primary"
                          style={{ flex: 1, marginRight: 4 }}
                        />
                        <Button
                          title="📤 Share PDF"
                          onPress={handleSharePdf}
                          isLoading={isExporting}
                          variant="outlined"
                          style={{ flex: 1, marginHorizontal: 4 }}
                        />
                        <Button
                          title="🖼️ Share Image"
                          onPress={handleShareImage}
                          variant="outlined"
                          style={{ flex: 1, marginLeft: 4 }}
                        />
                      </View>

                      <View style={[styles.buttonRow, { marginTop: 10 }]}>
                        <Button
                          title="🤖 Ask AI"
                          onPress={() => {
                            const doc = selectedDoc;
                            setSelectedDoc(null);
                            let fieldsObj = {};
                            if (doc.fields) {
                              try {
                                fieldsObj = typeof doc.fields === 'string' ? JSON.parse(doc.fields) : doc.fields;
                              } catch (e) {
                                fieldsObj = {};
                              }
                            }
                            navigation?.navigate?.('Assistant', {
                              documentId: doc.id,
                              documentType: doc.documentType,
                              documentName: doc.documentName,
                              extractedFields: fieldsObj,
                            });
                          }}
                          variant="primary"
                          style={{ flex: 1, marginRight: 4 }}
                        />
                        <Button
                          title="✏️ Edit"
                          onPress={() => {
                            setIsEditMode(true);
                            if (selectedDoc) {
                              const rendered = getRenderedFields(selectedDoc, editFormValues);
                              console.log(`[EDIT_DOC] Document ID: ${selectedDoc.id}`);
                              console.log(`[EDIT_DOC] Document type: ${selectedDoc.documentType}`);
                              console.log(`[EDIT_DOC] Saved fields: ${JSON.stringify(Object.keys(selectedDoc.fields || {}))}`);
                              console.log(`[EDIT_DOC] Fields rendered: ${rendered.map(f => f.key).join(', ')}`);
                            }
                          }}
                          variant="outlined"
                          style={{ flex: 1, marginHorizontal: 3 }}
                        />
                        <Button
                          title="🗑️ Delete"
                          onPress={() => handleDeleteDoc(selectedDoc)}
                          variant="outlined"
                          style={{ flex: 1, marginLeft: 4 }}
                        />
                      </View>
                    </View>
                  </View>
                ) : (
                  // Edit Form View — Dynamic Document-Specific Fields
                  <View>
                    <Input
                      label="Document Name *"
                      value={editName}
                      onChangeText={setEditName}
                      placeholder="e.g. My Document"
                    />

                    <View style={styles.fieldsSection}>
                      <Text style={styles.fieldsSectionTitle}>
                        {resolveTemplateKey(selectedDoc.documentType, selectedDoc.documentName)
                          ? `${resolveTemplateKey(selectedDoc.documentType, selectedDoc.documentName)} Information`
                          : 'Document Information'}
                      </Text>

                      {getRenderedFields(selectedDoc, editFormValues).map((field) => (
                        <View key={field.key} style={styles.dynamicFieldRow}>
                          <View style={styles.dynamicFieldHeader}>
                            <Text style={styles.dynamicFieldLabel}>
                              {field.label}
                              {field.required ? ' *' : ''}
                            </Text>
                            {field.isRemovable ? (
                              <TouchableOpacity
                                onPress={() => {
                                  setEditFormValues((prev) => {
                                    const copy = { ...prev };
                                    delete copy[field.key];
                                    return copy;
                                  });
                                }}
                              >
                                <Text style={styles.removeFieldText}>✕ Remove</Text>
                              </TouchableOpacity>
                            ) : null}
                          </View>
                          <Input
                            value={field.value}
                            onChangeText={(text) => {
                              setEditFormValues((prev) => ({
                                ...prev,
                                [field.key]: text,
                              }));
                            }}
                            placeholder={field.placeholder || `Enter ${field.label.toLowerCase()}`}
                            multiline={field.multiline}
                          />
                        </View>
                      ))}

                      {getRenderedFields(selectedDoc, editFormValues).length === 0 ? (
                        <Text style={{ fontSize: 13, color: theme.colors.textMuted, marginVertical: 8 }}>
                          No specific fields were saved for this document. You can add details below.
                        </Text>
                      ) : null}

                      {/* Add Custom Field Inline Card */}
                      {isAddingField ? (
                        <View style={styles.addFieldBox}>
                          <Text style={styles.addFieldBoxTitle}>Add Custom Field</Text>
                          <Input
                            label="Field Name"
                            value={newFieldKey}
                            onChangeText={setNewFieldKey}
                            placeholder="e.g. RAM, Storage, Model"
                          />
                          <Input
                            label="Field Value"
                            value={newFieldValue}
                            onChangeText={setNewFieldValue}
                            placeholder="e.g. 16 GB, 512 GB SSD"
                          />
                          <View style={styles.addFieldButtonRow}>
                            <TouchableOpacity
                              style={[styles.addFieldMiniBtn, styles.addFieldMiniBtnCancel]}
                              onPress={() => {
                                setIsAddingField(false);
                                setNewFieldKey('');
                                setNewFieldValue('');
                              }}
                            >
                              <Text style={styles.addFieldMiniBtnCancelText}>Cancel</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              style={[styles.addFieldMiniBtn, styles.addFieldMiniBtnAdd]}
                              onPress={() => {
                                const k = newFieldKey.trim();
                                const v = newFieldValue.trim();
                                if (!k) {
                                  Alert.alert('Validation Error', 'Field name is required.');
                                  return;
                                }
                                setEditFormValues((prev) => ({
                                  ...prev,
                                  [k]: v,
                                }));
                                setNewFieldKey('');
                                setNewFieldValue('');
                                setIsAddingField(false);
                              }}
                            >
                              <Text style={styles.addFieldMiniBtnAddText}>+ Add</Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                      ) : (
                        <TouchableOpacity
                          style={styles.addCustomFieldBtn}
                          onPress={() => setIsAddingField(true)}
                        >
                          <Text style={styles.addCustomFieldBtnText}>+ Add Custom Field</Text>
                        </TouchableOpacity>
                      )}
                    </View>

                    <View style={styles.modalActions}>
                      <Button
                        title="Save Changes"
                        onPress={handleSaveEdit}
                        isLoading={isSaving}
                        variant="primary"
                        style={{ flex: 1, marginRight: 8 }}
                      />
                      <Button
                        title="Cancel"
                        onPress={handleCancelEdit}
                        variant="outlined"
                        style={{ flex: 1, marginLeft: 8 }}
                      />
                    </View>
                  </View>
                )}
              </ScrollView>
            ) : null}
          </View>
        </View>
      </Modal>

      {/* Full Screen Image Preview Modal */}
      <Modal
        visible={!!previewImageUri}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setPreviewImageUri(null)}
      >
        <View style={styles.fullImageOverlay}>
          <TouchableOpacity
            style={styles.closeFullImageBtn}
            onPress={() => setPreviewImageUri(null)}
          >
            <Text style={styles.closeFullImageText}>✕ Close</Text>
          </TouchableOpacity>
          {previewImageUri ? (
            <Image
              source={{ uri: previewImageUri }}
              style={styles.fullScreenImage}
              resizeMode="contain"
            />
          ) : null}
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surface,
    margin: theme.spacing.md,
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  searchIcon: {
    fontSize: 16,
    marginRight: theme.spacing.xs,
  },
  searchInput: {
    flex: 1,
    height: 44,
    fontSize: 14,
    color: theme.colors.textPrimary,
  },
  clearIcon: {
    fontSize: 14,
    color: theme.colors.textMuted,
  },
  chipWrapper: {
    paddingHorizontal: theme.spacing.md,
    marginBottom: theme.spacing.sm,
  },
  chip: {
    backgroundColor: theme.colors.surface,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs + 2,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: theme.colors.border,
    marginRight: theme.spacing.xs,
  },
  chipSelected: {
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary,
  },
  chipText: {
    fontSize: 13,
    color: theme.colors.textSecondary,
    fontWeight: '500',
  },
  chipTextSelected: {
    color: '#FFF',
    fontWeight: '700',
  },
  errorBanner: {
    backgroundColor: '#FEF2F2',
    padding: theme.spacing.sm,
    marginHorizontal: theme.spacing.md,
    borderRadius: theme.radius.sm,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing.sm,
  },
  errorText: {
    color: theme.colors.error,
    fontSize: 13,
  },
  retryBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  retryText: {
    color: theme.colors.primary,
    fontWeight: '700',
  },
  listContent: {
    paddingHorizontal: theme.spacing.md,
    paddingBottom: theme.spacing.xl,
  },
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: theme.spacing.xs,
  },
  categoryBadge: {
    backgroundColor: 'rgba(30, 58, 138, 0.08)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  categoryText: {
    fontSize: 11,
    fontWeight: '700',
    color: theme.colors.primary,
  },
  dateText: {
    fontSize: 11,
    color: theme.colors.textMuted,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: theme.colors.textPrimary,
    marginBottom: 4,
  },
  cardNumber: {
    fontSize: 13,
    color: theme.colors.textSecondary,
  },
  expiryText: {
    fontSize: 12,
    color: theme.colors.textMuted,
    marginTop: 6,
  },
  expiryDate: {
    color: theme.colors.warning,
    fontWeight: '600',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: theme.colors.background,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '90%',
    paddingBottom: theme.spacing.lg,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: theme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: theme.colors.textPrimary,
  },
  closeBtn: {
    fontSize: 20,
    color: theme.colors.textMuted,
    padding: 4,
  },
  modalBody: {
    padding: theme.spacing.md,
  },
  detailRow: {
    marginVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    paddingBottom: 6,
  },
  detailLabel: {
    fontSize: 12,
    color: theme.colors.textSecondary,
    textTransform: 'capitalize',
  },
  detailValue: {
    fontSize: 15,
    fontWeight: '600',
    color: theme.colors.textPrimary,
    marginTop: 2,
  },
  fieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: theme.colors.textPrimary,
    marginBottom: 6,
  },
  fieldsSection: {
    marginTop: theme.spacing.md,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    padding: theme.spacing.sm + 4,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  fieldsSectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: theme.colors.primary,
    marginBottom: theme.spacing.xs,
  },
  imagePreviewSection: {
    marginTop: theme.spacing.md,
    marginBottom: theme.spacing.md,
  },
  docPreviewImage: {
    width: '100%',
    height: 200,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    marginTop: 4,
  },
  tapToEnlarge: {
    fontSize: 11,
    color: theme.colors.primary,
    textAlign: 'center',
    marginTop: 4,
    fontWeight: '600',
  },
  modalActionStack: {
    marginTop: theme.spacing.md,
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  modalActions: {
    flexDirection: 'row',
    marginTop: theme.spacing.md,
  },
  fullImageOverlay: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  closeFullImageBtn: {
    position: 'absolute',
    top: 40,
    right: 20,
    zIndex: 10,
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
  },
  closeFullImageText: {
    color: '#FFF',
    fontWeight: '700',
    fontSize: 14,
  },
  fullScreenImage: {
    width: width,
    height: '80%',
  },
  dynamicFieldRow: {
    marginBottom: theme.spacing.sm,
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.sm,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  dynamicFieldHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  dynamicFieldLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: theme.colors.textPrimary,
    textTransform: 'capitalize',
  },
  removeFieldText: {
    fontSize: 12,
    color: theme.colors.error,
    fontWeight: '600',
    paddingVertical: 2,
    paddingHorizontal: 4,
  },
  addFieldBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: theme.radius.sm,
    padding: theme.spacing.sm,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginTop: theme.spacing.xs,
    marginBottom: theme.spacing.sm,
  },
  addFieldBoxTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: theme.colors.textPrimary,
    marginBottom: theme.spacing.xs,
  },
  addFieldButtonRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: theme.spacing.xs,
    gap: 8,
  },
  addFieldMiniBtn: {
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderRadius: theme.radius.sm,
    alignItems: 'center',
  },
  addFieldMiniBtnCancel: {
    backgroundColor: '#E2E8F0',
  },
  addFieldMiniBtnCancelText: {
    color: theme.colors.textSecondary,
    fontWeight: '600',
    fontSize: 13,
  },
  addFieldMiniBtnAdd: {
    backgroundColor: theme.colors.primary,
  },
  addFieldMiniBtnAddText: {
    color: '#FFF',
    fontWeight: '700',
    fontSize: 13,
  },
  addCustomFieldBtn: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: theme.colors.primary,
    borderRadius: theme.radius.sm,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: theme.spacing.xs,
    marginBottom: theme.spacing.sm,
    backgroundColor: '#F0F9FF',
  },
  addCustomFieldBtnText: {
    color: theme.colors.primary,
    fontWeight: '700',
    fontSize: 13,
  },
});
