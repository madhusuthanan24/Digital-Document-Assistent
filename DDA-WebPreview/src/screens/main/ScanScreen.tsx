/**
 * ScanScreen.tsx (DDA-WebPreview)
 *
 * Document scanner screen implementing the end-to-end flow:
 *   Select / Take photo -> Manual Crop Overlay -> finalImageUri -> OCR Extraction -> Field Mapping -> Save
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  Image,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import { MainTabParamList } from '../../navigation/types';
import { theme } from '../../constants/theme';
import { Button } from '../../components/common/Button';
import { Input } from '../../components/common/Input';
import { LoadingIndicator } from '../../components/common/LoadingIndicator';
import { DocumentCategory } from '../../types/document';
import { documentService } from '../../services/document/documentService';
import { extractDocumentDetails } from '../../services/ocr/ocrService';
import { useAuth } from '../../context/AuthContext';
import { DOCUMENT_TEMPLATES, categoryToTemplateKey, templateKeyToCategory } from '../../templates/documentTemplates';
import { ManualCropScreen, ManualCropResult } from './ManualCropScreen';

type Props = BottomTabScreenProps<MainTabParamList, 'ScanTab'>;

const DOCUMENT_TYPES: { type: DocumentCategory; label: string; icon: string }[] = [
  { type: 'Aadhaar', label: 'Aadhaar Card', icon: '🆔' },
  { type: 'PAN', label: 'PAN Card', icon: '💳' },
  { type: 'Passport', label: 'Passport', icon: '✈️' },
  { type: 'DrivingLicence', label: 'Driving Licence', icon: '🚗' },
  { type: 'VehicleRC', label: 'Vehicle RC', icon: '🏎️' },
  { type: 'Insurance', label: 'Insurance Policy', icon: '🛡️' },
  { type: 'EducationalCertificate', label: 'Marksheet / Degree', icon: '🎓' },
  { type: 'Other', label: 'Other Document', icon: '📁' },
];

export const ScanScreen: React.FC<Props> = ({ navigation }) => {
  const { user } = useAuth();

  // Category & form state
  const [selectedType, setSelectedType] = useState<DocumentCategory>('Aadhaar');
  const [documentName, setDocumentName] = useState<string>('Aadhaar Card');
  const [dynamicFields, setDynamicFields] = useState<Record<string, string>>({});
  const [detectedDocumentType, setDetectedDocumentType] = useState<string>('');

  // Image URIs
  const [originalImageUri, setOriginalImageUri] = useState<string>('');
  const [originalImageWidth, setOriginalImageWidth] = useState<number>(0);
  const [originalImageHeight, setOriginalImageHeight] = useState<number>(0);
  const [finalImageUri, setFinalImageUri] = useState<string>('');
  const [fileName, setFileName] = useState<string>('');
  const [mimeType, setMimeType] = useState<string>('');

  // Crop overlay state
  const [showCropScreen, setShowCropScreen] = useState<boolean>(false);

  // OCR state
  const [isExtracting, setIsExtracting] = useState<boolean>(false);
  const [ocrConfidence, setOcrConfidence] = useState<'high' | 'medium' | 'low' | 'none' | null>(null);
  const [ocrFailed, setOcrFailed] = useState<boolean>(false);
  const [ocrFailMessage, setOcrFailMessage] = useState<string>('');
  const [fieldConfidence, setFieldConfidence] = useState<Record<string, 'high' | 'medium' | 'low'>>({});
  const [validatedFields, setValidatedFields] = useState<Record<string, { value: string; confidence: 'HIGH' | 'MEDIUM' | 'LOW'; needsReview: boolean; issue?: string }>>({});
  const [validationIssues, setValidationIssues] = useState<string[]>([]);

  // Image quality state
  const [imageQualityBlocked, setImageQualityBlocked] = useState<boolean>(false);
  const [imageQualityMessage, setImageQualityMessage] = useState<string>('');
  const [imageQualityWarning, setImageQualityWarning] = useState<string>(''); // MEDIUM quality non-blocking

  // Save state
  const [isSaving, setIsSaving] = useState<boolean>(false);

  // Template key resolution
  const effectiveTemplateKey = detectedDocumentType || categoryToTemplateKey(selectedType) || '';
  const currentTemplate = DOCUMENT_TEMPLATES[effectiveTemplateKey];

  // Category selection handler — reset all OCR and quality state on category change
  const handleSelectCategory = (cat: DocumentCategory) => {
    setSelectedType(cat);
    const match = DOCUMENT_TYPES.find(t => t.type === cat);
    if (match) { setDocumentName(match.label); }
    setDetectedDocumentType('');
    setDynamicFields({});
    setFieldConfidence({});
    setValidatedFields({});
    setValidationIssues([]);
    setOcrConfidence(null);
    setOcrFailed(false);
  };

  // Process & apply OCR extraction results
  const applyOcrResult = (result: {
    documentType: string;
    fields: Record<string, string>;
    validatedFields?: Record<string, { value: string; confidence: 'HIGH' | 'MEDIUM' | 'LOW'; needsReview: boolean; issue?: string }>;
    fieldConfidence?: Record<string, 'high' | 'medium' | 'low'>;
    confidence: 'high' | 'medium' | 'low' | 'none' | number;
    validationIssues?: string[];
    missingRequiredFields?: string[];
  }) => {
    const detected = result.documentType;
    setDetectedDocumentType(detected);

    const mappedCategory = templateKeyToCategory(detected);
    if (mappedCategory && mappedCategory !== 'Other') {
      setSelectedType(mappedCategory as DocumentCategory);
    }
    if (detected) { setDocumentName(detected); }

    setDynamicFields(result.fields);
    setValidatedFields(result.validatedFields || {});
    setValidationIssues(result.validationIssues || []);
    setFieldConfidence(result.fieldConfidence || {});

    if (typeof result.confidence === 'string') {
      setOcrConfidence(result.confidence as 'high' | 'medium' | 'low' | 'none');
    } else {
      const fieldCount = Object.keys(result.fields).length;
      setOcrConfidence(fieldCount >= 2 ? 'high' : fieldCount === 1 ? 'low' : 'none');
    }
  };

  // Run OCR pipeline against finalImageUri
  const runOcr = async (uri: string) => {
    if (!uri) {
      console.warn('[OCR] No finalImageUri provided — aborting');
      return;
    }

    console.log('[OCR] Using final edited image');

    setIsExtracting(true);
    setOcrFailed(false);
    setOcrFailMessage('');
    setOcrConfidence(null);

    try {
      const result = await extractDocumentDetails(uri, selectedType);
      applyOcrResult(result);
    } catch (err: any) {
      console.warn(`[OCR] Extraction failed: ${err?.message}`);
      setOcrFailed(true);
      setOcrFailMessage(err?.message || 'Automatic extraction could not read this document clearly.');
      setOcrConfidence('none');
    } finally {
      setIsExtracting(false);
    }
  };

  // Open manual crop overlay
  const openCropScreen = (uri: string, width: number, height: number, name: string, mime: string) => {
    setOriginalImageUri(uri);
    setOriginalImageWidth(width || 1080);
    setOriginalImageHeight(height || 1920);
    setFileName(name);
    setMimeType(mime);
    setFinalImageUri('');
    setOcrConfidence(null);
    setOcrFailed(false);
    setDynamicFields({});
    setDetectedDocumentType('');
    setShowCropScreen(true);
  };

  // Crop overlay callbacks
  const handleCropDone = async (result: ManualCropResult) => {
    setShowCropScreen(false);
    setFinalImageUri(result.uri);
    await runOcr(result.uri);
  };

  const handleCropCancel = () => {
    setShowCropScreen(false);
    if (!finalImageUri) {
      setOriginalImageUri('');
      setFileName('');
      setMimeType('');
    }
  };

  // Re-open manual crop on original image
  const handleCropAgain = () => {
    if (!originalImageUri) {
      Alert.alert('No Image', 'Please capture or select an image first.');
      return;
    }
    setShowCropScreen(true);
  };

  // Open Camera using Expo ImagePicker
  const handleOpenCamera = async () => {
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permission Required', 'Camera access is required to take photos of your document.');
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        quality: 1,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) return;
      const asset = result.assets[0];

      openCropScreen(
        asset.uri,
        asset.width || 1080,
        asset.height || 1920,
        asset.fileName || `capture_${Date.now()}.jpg`,
        asset.mimeType || 'image/jpeg'
      );
    } catch (err: any) {
      Alert.alert('Camera Error', err?.message || 'Could not launch camera.');
    }
  };

  // Pick File using Expo DocumentPicker / ImagePicker
  const handlePickFile = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 1,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) return;
      const asset = result.assets[0];

      openCropScreen(
        asset.uri,
        asset.width || 1080,
        asset.height || 1920,
        asset.fileName || `picked_${Date.now()}.jpg`,
        asset.mimeType || 'image/jpeg'
      );
    } catch (err: any) {
      try {
        const docRes = await DocumentPicker.getDocumentAsync({ type: 'application/pdf' });
        if (!docRes.canceled && docRes.assets && docRes.assets.length > 0) {
          const file = docRes.assets[0];
          setOriginalImageUri(file.uri);
          setFinalImageUri(file.uri);
          setFileName(file.name || 'document.pdf');
          setMimeType(file.mimeType || 'application/pdf');
        }
      } catch (pdfErr: any) {
        Alert.alert('File Picker Error', err?.message || 'Could not pick file.');
      }
    }
  };

  // Save Document to Vault
  const handleSaveDocument = async () => {
    if (!user?.uid) {
      Alert.alert('Error', 'You must be logged in to save documents.');
      return;
    }
    if (!documentName.trim()) {
      Alert.alert('Validation Error', 'Document Name is required.');
      return;
    }

    // Only validate genuinely required fields for the selected document type
    if (currentTemplate) {
      for (const field of currentTemplate.fields) {
        if (field.required && !dynamicFields[field.key]?.trim()) {
          Alert.alert('Required Field Missing', `Please enter a value for "${field.label}" before saving.`);
          return;
        }
      }
    }

    // The cropped image (finalImageUri) is the single canonical document image
    const isPdf = mimeType === 'application/pdf';
    const vaultUri = finalImageUri || (isPdf ? originalImageUri : '');

    if (!vaultUri) {
      Alert.alert('Crop Required', 'Please complete cropping the document before saving to your vault.');
      return;
    }

    setIsSaving(true);
    try {
      const docNumber =
        dynamicFields?.documentNumber ||
        dynamicFields?.aadhaarNumber ||
        dynamicFields?.panNumber ||
        dynamicFields?.passportNumber ||
        dynamicFields?.epicNumber ||
        dynamicFields?.voterIdNumber ||
        dynamicFields?.licenceNumber ||
        dynamicFields?.registrationNumber ||
        dynamicFields?.policyNumber ||
        dynamicFields?.accountNumber ||
        '';

      await documentService.addDocument(user.uid, {
        documentType: selectedType,
        documentName: documentName.trim(),
        documentNumber: docNumber,
        name: dynamicFields?.name || dynamicFields?.fullName,
        fatherName: dynamicFields?.fatherName || dynamicFields?.husbandName,
        gender: dynamicFields?.gender || dynamicFields?.sex,
        address: dynamicFields?.address,
        dateOfBirth: dynamicFields?.dateOfBirth || dynamicFields?.dob,
        issueDate: dynamicFields?.issueDate,
        expiryDate: dynamicFields?.expiryDate,
        fields: dynamicFields,
        localFileUri: vaultUri,
        croppedImagePath: vaultUri,
        fileName: fileName || undefined,
        mimeType: mimeType || undefined,
      });

      Alert.alert('Success', 'Document saved to your personal vault!', [
        {
          text: 'OK',
          onPress: () => {
            setSelectedType('Aadhaar');
            setDocumentName('Aadhaar Card');
            setDynamicFields({});
            setDetectedDocumentType('');
            setOriginalImageUri('');
            setFinalImageUri('');
            setFileName('');
            setMimeType('');
            setOcrConfidence(null);
            setOcrFailed(false);
            navigation.navigate('DocumentsTab');
          },
        },
      ]);
    } catch (err: any) {
      Alert.alert('Save Failed', err?.message || 'Could not save document.');
    } finally {
      setIsSaving(false);
    }
  };

  // OCR confidence badge styles
  const ocrBadgeConfig = ocrConfidence
    ? {
        high:   { icon: '🟢', color: theme.colors.success,  bg: '#F0FDF4', border: '#BBF7D0', text: 'Fields auto-filled with high confidence — please verify' },
        medium: { icon: '🟡', color: theme.colors.warning,  bg: '#FFFBEB', border: '#FDE68A', text: 'Partially extracted — some fields may need editing' },
        low:    { icon: '🟠', color: '#EA580C',             bg: '#FFF7ED', border: '#FED7AA', text: 'Low confidence — please fill fields manually' },
        none:   { icon: '🔴', color: theme.colors.error,   bg: '#FEF2F2', border: '#FECACA', text: 'Extraction failed — see retry options below' },
      }[ocrConfidence]
    : null;

  return (
    <View style={styles.screenWrapper}>
      {/* Crop Screen Overlay */}
      {showCropScreen && originalImageUri ? (
        <ManualCropScreen
          visible={showCropScreen}
          imageUri={originalImageUri}
          imageWidth={originalImageWidth || 1080}
          imageHeight={originalImageHeight || 1920}
          onCrop={handleCropDone}
          onCancel={handleCropCancel}
        />
      ) : null}

      {/* OCR Loading Overlay */}
      {isExtracting && (
        <LoadingIndicator overlay message="🔍 Extracting document fields..." />
      )}

      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Document Scanner & Upload</Text>
          <Text style={styles.subtitle}>
            Select category → capture image → crop → auto-extract fields
          </Text>
        </View>

        {/* Category Selection */}
        <Text style={styles.sectionLabel}>1. Select Document Type</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.typeScroll}>
          {DOCUMENT_TYPES.map(item => {
            const isSelected = selectedType === item.type;
            return (
              <TouchableOpacity
                key={item.type}
                style={[styles.typeCard, isSelected && styles.typeCardSelected]}
                onPress={() => handleSelectCategory(item.type)}
                activeOpacity={0.8}
              >
                <Text style={styles.typeIcon}>{item.icon}</Text>
                <Text style={[styles.typeLabel, isSelected && styles.typeLabelSelected]}>
                  {item.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* AI-detected Document Type Badge */}
        {detectedDocumentType ? (
          <View style={styles.detectedTypeBadge}>
            <Text style={styles.detectedTypeText}>
              🤖 AI detected: <Text style={styles.detectedTypeName}>{detectedDocumentType}</Text>
            </Text>
          </View>
        ) : null}

        {/* Attach Document Buttons */}
        <Text style={styles.sectionLabel}>2. Attach Document Image or PDF</Text>
        <View style={styles.actionRow}>
          <Button
            title="📷 Open Camera"
            onPress={handleOpenCamera}
            variant="primary"
            style={{ flex: 1, marginRight: theme.spacing.xs }}
          />
          <Button
            title="📁 Pick File"
            onPress={handlePickFile}
            variant="outlined"
            style={{ flex: 1, marginLeft: theme.spacing.xs }}
          />
        </View>

        {/* File status banner */}
        {fileName ? (
          <View style={styles.fileInfoCard}>
            <Text style={styles.fileInfoIcon}>📄</Text>
            <View style={styles.fileInfoTextWrapper}>
              <Text style={styles.fileInfoName} numberOfLines={1}>{fileName}</Text>
              <Text style={styles.fileInfoSub}>
                {mimeType ? `${mimeType} • ` : ''}
                {finalImageUri ? 'Cropped & ready' : 'Original selected'}
              </Text>
            </View>
            {originalImageUri && (mimeType?.startsWith('image/') || !mimeType) ? (
              <TouchableOpacity style={styles.cropAgainChip} onPress={handleCropAgain}>
                <Text style={styles.cropAgainChipText}>✂ Re-crop</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              onPress={() => {
                setOriginalImageUri('');
                setFinalImageUri('');
                setFileName('');
                setMimeType('');
                setOcrConfidence(null);
                setOcrFailed(false);
                setDynamicFields({});
                setDetectedDocumentType('');
              }}
            >
              <Text style={styles.removeFileIcon}>✕</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {/* Cropped image preview */}
        {finalImageUri ? (
          <View style={styles.previewCard}>
            <Text style={styles.previewLabel}>📐 Cropped Preview</Text>
            <Image
              source={{ uri: finalImageUri }}
              style={styles.previewImage}
              resizeMode="contain"
            />
          </View>
        ) : null}

        {/* OCR Confidence Badge */}
        {ocrBadgeConfig ? (
          <View style={[
            styles.ocrBadge,
            { backgroundColor: ocrBadgeConfig.bg, borderColor: ocrBadgeConfig.border },
          ]}>
            <Text style={styles.ocrBadgeIcon}>{ocrBadgeConfig.icon}</Text>
            <Text style={[styles.ocrBadgeText, { color: ocrBadgeConfig.color }]}>
              {ocrBadgeConfig.text}
            </Text>
          </View>
        ) : null}

        {/* OCR Failure Card & Action Buttons */}
        {ocrFailed ? (
          <View style={styles.ocrFailCard}>
            <Text style={styles.ocrFailTitle}>
              {ocrFailMessage || 'Some details could not be extracted. Please verify the fields manually or retake the document image.'}
            </Text>
            <View style={styles.ocrFailActions}>
              <TouchableOpacity style={styles.ocrFailBtn} onPress={handleCropAgain}>
                <Text style={styles.ocrFailBtnText}>Crop Again</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.ocrFailBtn}
                onPress={() => finalImageUri && runOcr(finalImageUri)}
              >
                <Text style={styles.ocrFailBtnText}>Retry Extraction</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.ocrFailBtn, styles.ocrFailBtnSecondary]}
                onPress={() => setOcrFailed(false)}
              >
                <Text style={[styles.ocrFailBtnText, styles.ocrFailBtnTextSecondary]}>Enter Manually</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}

        {/* Document Fields Form */}
        <Text style={styles.sectionLabel}>3. Confirm Document Details</Text>
        <View style={styles.formCard}>
          {validationIssues.length > 0 ? (
            <View style={styles.validationNoticeBox}>
              <Text style={styles.validationNoticeTitle}>⚠️ Fields Requiring Verification</Text>
              {validationIssues.slice(0, 3).map((iss, i) => (
                <Text key={i} style={styles.validationNoticeItem}>• {iss}</Text>
              ))}
            </View>
          ) : null}

          <Input
            label="Document Name *"
            value={documentName}
            onChangeText={setDocumentName}
            placeholder="e.g. Aadhaar Card, Passport, Voter ID"
          />

          {currentTemplate ? (
            <>
              {currentTemplate.fields.map(field => {
                const valInfo = validatedFields[field.key];
                const conf = fieldConfidence[field.key];

                return (
                  <View key={field.key} style={styles.fieldWrapper}>
                    <Input
                      label={field.label + (field.required ? ' *' : '')}
                      value={dynamicFields[field.key] || ''}
                      onChangeText={text => {
                        setDynamicFields(prev => ({ ...prev, [field.key]: text }));
                        if (validatedFields[field.key]?.needsReview) {
                          setValidatedFields(prev => ({
                            ...prev,
                            [field.key]: {
                              ...prev[field.key],
                              needsReview: false,
                              issue: undefined,
                              confidence: 'HIGH',
                            },
                          }));
                        }
                      }}
                      placeholder={`Enter ${field.label.toLowerCase()}`}
                      rightLabelElement={
                        conf === 'high' ? (
                          <View style={styles.confidencePillHigh}>
                            <Text style={styles.confidenceTextHigh}>🟢 High confidence</Text>
                          </View>
                        ) : conf === 'medium' ? (
                          <View style={styles.confidencePillMedium}>
                            <Text style={styles.confidenceTextMedium}>🟡 Needs verification</Text>
                          </View>
                        ) : conf === 'low' ? (
                          <View style={styles.confidencePillLow}>
                            <Text style={styles.confidenceTextLow}>🔴 Needs review</Text>
                          </View>
                        ) : null
                      }
                      error={valInfo?.needsReview && valInfo.issue ? valInfo.issue : undefined}
                    />
                  </View>
                );
              })}
            </>
          ) : (
            Object.entries(dynamicFields).length > 0 ? (
              <>
                {Object.entries(dynamicFields).map(([key, value]) => {
                  const valInfo = validatedFields[key];
                  const conf = fieldConfidence[key];
                  const formattedLabel = key
                    .replace(/([A-Z])/g, ' $1')
                    .replace(/_/g, ' ')
                    .replace(/^\w/, c => c.toUpperCase())
                    .trim();

                  return (
                    <View key={key} style={styles.fieldWrapper}>
                      <Input
                        label={formattedLabel}
                        value={value || ''}
                        onChangeText={text => {
                          setDynamicFields(prev => ({ ...prev, [key]: text }));
                          if (validatedFields[key]?.needsReview) {
                            setValidatedFields(prev => ({
                              ...prev,
                              [key]: {
                                ...prev[key],
                                needsReview: false,
                                issue: undefined,
                                confidence: 'HIGH',
                              },
                            }));
                          }
                        }}
                        placeholder={`Enter ${formattedLabel.toLowerCase()}`}
                        rightLabelElement={
                          conf === 'high' ? (
                            <View style={styles.confidencePillHigh}>
                              <Text style={styles.confidenceTextHigh}>🟢 High confidence</Text>
                            </View>
                          ) : conf === 'medium' ? (
                            <View style={styles.confidencePillMedium}>
                              <Text style={styles.confidenceTextMedium}>🟡 Needs verification</Text>
                            </View>
                          ) : conf === 'low' ? (
                            <View style={styles.confidencePillLow}>
                              <Text style={styles.confidenceTextLow}>🔴 Needs review</Text>
                            </View>
                          ) : null
                        }
                        error={valInfo?.needsReview && valInfo.issue ? valInfo.issue : undefined}
                      />
                    </View>
                  );
                })}
              </>
            ) : (
              <View style={styles.noFieldsContainer}>
                <Text style={styles.noFieldsText}>
                  No fields were automatically detected. You can add document details manually above.
                </Text>
              </View>
            )
          )}

          <Button
            title="💾 Save Document to Vault"
            onPress={handleSaveDocument}
            isLoading={isSaving}
            variant="primary"
            style={styles.saveBtn}
          />
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  screenWrapper: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  container: {
    flex: 1,
  },
  content: {
    padding: theme.spacing.md,
    paddingBottom: 40,
  },
  header: {
    marginBottom: theme.spacing.lg,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: theme.colors.textPrimary,
  },
  subtitle: {
    fontSize: 14,
    color: theme.colors.textSecondary,
    marginTop: 4,
  },
  sectionLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: theme.colors.textPrimary,
    marginTop: theme.spacing.md,
    marginBottom: theme.spacing.sm,
  },
  typeScroll: {
    flexDirection: 'row',
    marginBottom: theme.spacing.sm,
  },
  typeCard: {
    width: 100,
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.sm,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surface,
    alignItems: 'center',
    marginRight: theme.spacing.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  typeCardSelected: {
    borderColor: theme.colors.primary,
    backgroundColor: '#EFF6FF',
  },
  typeIcon: {
    fontSize: 26,
    marginBottom: 6,
  },
  typeLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: theme.colors.textSecondary,
    textAlign: 'center',
  },
  typeLabelSelected: {
    color: theme.colors.primary,
    fontWeight: '700',
  },
  detectedTypeBadge: {
    backgroundColor: '#EFF6FF',
    borderColor: '#BFDBFE',
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    marginBottom: theme.spacing.sm,
  },
  detectedTypeText: {
    color: '#1E40AF',
    fontSize: 13,
    fontWeight: '600',
  },
  detectedTypeName: {
    fontWeight: '700',
  },
  actionRow: {
    flexDirection: 'row',
    marginBottom: theme.spacing.md,
  },
  fileInfoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.surface,
    padding: 12,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    marginBottom: theme.spacing.md,
  },
  fileInfoIcon: {
    fontSize: 20,
    marginRight: 10,
  },
  fileInfoTextWrapper: {
    flex: 1,
  },
  fileInfoName: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.colors.textPrimary,
  },
  fileInfoSub: {
    fontSize: 12,
    color: theme.colors.textSecondary,
  },
  cropAgainChip: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
    marginRight: 10,
  },
  cropAgainChipText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '600',
  },
  removeFileIcon: {
    fontSize: 18,
    color: theme.colors.error,
    padding: 4,
  },
  previewCard: {
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.md,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    marginBottom: theme.spacing.md,
    alignItems: 'center',
  },
  previewLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: theme.colors.textSecondary,
    marginBottom: 8,
    alignSelf: 'flex-start',
  },
  previewImage: {
    width: '100%',
    height: 220,
    borderRadius: 8,
  },
  ocrBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: theme.spacing.md,
  },
  ocrBadgeIcon: {
    fontSize: 16,
    marginRight: 8,
  },
  ocrBadgeText: {
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },
  ocrFailCard: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FECACA',
    borderWidth: 1,
    borderRadius: 10,
    padding: 14,
    marginBottom: theme.spacing.md,
  },
  ocrFailTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#991B1B',
    marginBottom: 10,
  },
  ocrFailActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  ocrFailBtn: {
    flex: 1,
    backgroundColor: '#DC2626',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    marginHorizontal: 3,
  },
  ocrFailBtnSecondary: {
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: '#DC2626',
  },
  ocrFailBtnText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: '700',
  },
  ocrFailBtnTextSecondary: {
    color: '#DC2626',
  },
  formCard: {
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.md,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  saveBtn: {
    marginTop: theme.spacing.md,
  },
  // Validation notices
  validationNoticeBox: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FCA5A5',
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  validationNoticeTitle: {
    color: '#991B1B',
    fontWeight: '700',
    fontSize: 13,
    marginBottom: 4,
  },
  validationNoticeItem: {
    color: '#B91C1C',
    fontSize: 12,
    lineHeight: 16,
  },
  fieldWrapper: {
    marginBottom: 8,
  },
  fieldIssueNotice: {
    color: '#DC2626',
    fontSize: 11,
    fontWeight: '500',
    marginTop: -6,
    marginBottom: 8,
    marginLeft: 4,
  },
  // Confidence pills
  confidencePillHigh: {
    backgroundColor: '#DCFCE7',
    borderColor: '#86EFAC',
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
  },
  confidenceTextHigh: {
    color: '#15803D',
    fontSize: 11,
    fontWeight: '700',
  },
  confidencePillMedium: {
    backgroundColor: '#FEF9C3',
    borderColor: '#FDE047',
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
  },
  confidenceTextMedium: {
    color: '#A16207',
    fontSize: 11,
    fontWeight: '700',
  },
  confidencePillLow: {
    backgroundColor: '#FEE2E2',
    borderColor: '#FCA5A5',
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 12,
  },
  confidenceTextLow: {
    color: '#B91C1C',
    fontSize: 11,
    fontWeight: '700',
  },
  noFieldsContainer: {
    padding: 16,
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginBottom: 12,
  },
  noFieldsText: {
    color: '#64748B',
    fontSize: 13,
    textAlign: 'center',
  },
});