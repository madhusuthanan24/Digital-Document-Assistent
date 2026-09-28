/**
 * ScanScreen.tsx
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
  PermissionsAndroid,
  Platform,
  Image,
} from 'react-native';
import { pick, errorCodes, isErrorWithCode, types } from '@react-native-documents/picker';
import { launchCamera, launchImageLibrary } from 'react-native-image-picker';
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
  const [isAddingField, setIsAddingField] = useState<boolean>(false);
  const [newFieldKey, setNewFieldKey] = useState<string>('');
  const [newFieldValue, setNewFieldValue] = useState<string>('');

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
    setImageQualityBlocked(false);
    setImageQualityMessage('');
    setImageQualityWarning('');
    setIsAddingField(false);
    setNewFieldKey('');
    setNewFieldValue('');
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
    console.log(`[OCR_TRACE] STEP 9 final fields sent to UI: count=${Object.keys(result.fields || {}).length}, fields=${JSON.stringify(result.fields || {})}`);
    const detected = result.documentType;
    setDetectedDocumentType(detected);

    // Document Type auto-detection
    const mappedCategory = templateKeyToCategory(detected);
    if (mappedCategory && mappedCategory !== 'Other') {
      setSelectedType(mappedCategory as DocumentCategory);
    }

    if (detected) {
      setDocumentName(detected);
    }

    setDynamicFields(result.fields);
    setValidatedFields(result.validatedFields || {});
    setValidationIssues(result.validationIssues || []);
    setFieldConfidence(result.fieldConfidence || {});

    // Use string confidence tier from ocrService directly
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
    setImageQualityBlocked(false);
    setImageQualityMessage('');
    setImageQualityWarning('');

    try {
      const result = await extractDocumentDetails(uri, selectedType);
      applyOcrResult(result);

      // Show non-blocking quality warning for MEDIUM quality images
      if (result.imageQuality?.quality === 'MEDIUM' && result.imageQuality.issues.length > 0) {
        setImageQualityWarning(result.imageQuality.issues[0]);
      }
    } catch (err: any) {
      console.warn(`[OCR] Extraction failed: ${err?.message}`);

      // Quality block — show dedicated quality card, not the generic OCR error card
      if (err?.isQualityBlock === true) {
        setImageQualityBlocked(true);
        setImageQualityMessage(err.message);
        setOcrConfidence('none');
      } else {
        setOcrFailed(true);
        setOcrFailMessage(err?.message || 'Automatic extraction could not read this document clearly.');
        setOcrConfidence('none');
      }
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
    setImageQualityBlocked(false);
    setImageQualityMessage('');
    setImageQualityWarning('');
    setIsAddingField(false);
    setNewFieldKey('');
    setNewFieldValue('');
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

  // Open Camera
  const handleOpenCamera = async () => {
    try {
      if (Platform.OS === 'android') {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.CAMERA,
          {
            title: 'Camera Permission',
            message: 'Digital Document Assistant requires camera access to capture documents.',
            buttonPositive: 'Allow',
            buttonNegative: 'Deny',
          },
        );
        if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
          Alert.alert('Permission Denied', 'Camera permission was not granted.');
          return;
        }
      }

      const result = await launchCamera({
        mediaType: 'photo',
        quality: 1.0,
        saveToPhotos: false,
        includeBase64: false,
      });

      if (result.didCancel) return;
      if (result.errorCode) {
        Alert.alert('Camera Error', result.errorMessage || 'Failed to capture photo.');
        return;
      }
      if (result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        openCropScreen(
          asset.uri || '',
          asset.width || 0,
          asset.height || 0,
          asset.fileName || `capture_${Date.now()}.jpg`,
          asset.type || 'image/jpeg',
        );
      }
    } catch (err: any) {
      Alert.alert('Camera Exception', err?.message || 'Could not launch camera.');
    }
  };

  // Pick File / Image
  const handlePickFile = async () => {
    try {
      const res = await pick({ type: [types.images, types.pdf] });
      if (res && res[0]) {
        const file = res[0];
        if (file.type?.startsWith('image/') && file.uri) {
          Image.getSize(
            file.uri,
            (w, h) => openCropScreen(file.uri!, w, h, file.name || 'document.jpg', file.type || 'image/jpeg'),
            () => openCropScreen(file.uri!, 1080, 1920, file.name || 'document.jpg', file.type || 'image/jpeg'),
          );
        } else {
          setOriginalImageUri(file.uri || '');
          setFinalImageUri(file.uri || '');
          setFileName(file.name || 'document.pdf');
          setMimeType(file.type || 'application/pdf');
        }
      }
    } catch (err: any) {
      if (!isErrorWithCode(err) || err.code !== errorCodes.OPERATION_CANCELED) {
        try {
          const imgRes = await launchImageLibrary({ mediaType: 'photo', includeBase64: false });
          if (imgRes.assets && imgRes.assets.length > 0) {
            const asset = imgRes.assets[0];
            openCropScreen(
              asset.uri || '',
              asset.width || 0,
              asset.height || 0,
              asset.fileName || `picked_${Date.now()}.jpg`,
              asset.type || 'image/jpeg',
            );
          }
        } catch (fallbackErr: any) {
          Alert.alert('File Picker Error', err?.message || 'Could not pick file.');
        }
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
            {originalImageUri && mimeType?.startsWith('image/') ? (
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

        {/* Image Quality Block Card — shown when image is too poor to attempt extraction */}
        {imageQualityBlocked ? (
          <View style={styles.qualityBlockCard}>
            <Text style={styles.qualityBlockIcon}>📷</Text>
            <Text style={styles.qualityBlockTitle}>Image Quality Too Low</Text>
            <Text style={styles.qualityBlockMessage}>{imageQualityMessage}</Text>
            <View style={styles.ocrFailActions}>
              <TouchableOpacity style={styles.ocrFailBtn} onPress={handleCropAgain}>
                <Text style={styles.ocrFailBtnText}>Re-Crop</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.ocrFailBtn} onPress={handleOpenCamera}>
                <Text style={styles.ocrFailBtnText}>Retake Photo</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.ocrFailBtn, styles.ocrFailBtnSecondary]}
                onPress={() => {
                  setImageQualityBlocked(false);
                  setImageQualityMessage('');
                }}
              >
                <Text style={[styles.ocrFailBtnText, styles.ocrFailBtnTextSecondary]}>Enter Manually</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}

        {/* Image Quality Warning Banner — shown for MEDIUM quality images that proceeded */}
        {imageQualityWarning && !imageQualityBlocked ? (
          <View style={styles.qualityWarnBanner}>
            <Text style={styles.qualityWarnIcon}>⚠️</Text>
            <Text style={styles.qualityWarnText}>{imageQualityWarning}</Text>
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
                const valInfo = validatedFields[field.key] || validatedFields[Object.keys(validatedFields).find(k => k.toLowerCase() === field.key.toLowerCase()) || ''];
                const fieldValue = dynamicFields[field.key] ?? dynamicFields[Object.keys(dynamicFields).find(k => k.toLowerCase() === field.key.toLowerCase()) || ''] ?? '';

                return (
                  <View key={field.key} style={styles.fieldWrapper}>
                    <Input
                      label={field.label + (field.required ? ' *' : '')}
                      value={fieldValue}
                      onChangeText={text => {
                        setDynamicFields(prev => {
                          const updated = { ...prev };
                          for (const k of Object.keys(updated)) {
                            if (k.toLowerCase() === field.key.toLowerCase() && k !== field.key) {
                              delete updated[k];
                            }
                          }
                          updated[field.key] = text;
                          return updated;
                        });
                        if (valInfo?.needsReview) {
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
                      error={valInfo?.needsReview && valInfo.issue ? valInfo.issue : undefined}
                    />
                  </View>
                );
              })}

              {/* Additional AI extracted fields not in template */}
              {(() => {
                const extraFields = Object.entries(dynamicFields).filter(([k]) => {
                  return !currentTemplate.fields.some(f => f.key.toLowerCase() === k.toLowerCase());
                });
                if (extraFields.length === 0) return null;

                return (
                  <View style={styles.extraFieldsSection}>
                    <Text style={styles.extraFieldsHeader}>Additional Extracted Details</Text>
                    {extraFields.map(([key, value]) => {
                      const valInfo = validatedFields[key];
                      const formattedLabel = key
                        .replace(/([A-Z])/g, ' $1')
                        .replace(/_/g, ' ')
                        .replace(/^\w/, c => c.toUpperCase())
                        .trim();

                      return (
                        <View key={key} style={styles.fieldWrapper}>
                          <View style={styles.fieldHeaderRow}>
                            <Text style={styles.fieldHeaderLabel}>{formattedLabel}</Text>
                            <TouchableOpacity
                              onPress={() => {
                                setDynamicFields(prev => {
                                  const copy = { ...prev };
                                  delete copy[key];
                                  return copy;
                                });
                              }}
                            >
                              <Text style={styles.removeFieldText}>✕ Remove</Text>
                            </TouchableOpacity>
                          </View>
                          <Input
                            value={value || ''}
                            onChangeText={text => {
                              setDynamicFields(prev => ({ ...prev, [key]: text }));
                            }}
                            placeholder={`Enter ${formattedLabel.toLowerCase()}`}
                            error={valInfo?.needsReview && valInfo.issue ? valInfo.issue : undefined}
                          />
                        </View>
                      );
                    })}
                  </View>
                );
              })()}
            </>
          ) : (
            Object.entries(dynamicFields).length > 0 ? (
              <>
                {Object.entries(dynamicFields).map(([key, value]) => {
                  const valInfo = validatedFields[key];
                  const formattedLabel = key
                    .replace(/([A-Z])/g, ' $1')
                    .replace(/_/g, ' ')
                    .replace(/^\w/, c => c.toUpperCase())
                    .trim();

                  return (
                    <View key={key} style={styles.fieldWrapper}>
                      <View style={styles.fieldHeaderRow}>
                        <Text style={styles.fieldHeaderLabel}>{formattedLabel}</Text>
                        <TouchableOpacity
                          onPress={() => {
                            setDynamicFields(prev => {
                              const copy = { ...prev };
                              delete copy[key];
                              return copy;
                            });
                          }}
                        >
                          <Text style={styles.removeFieldText}>✕ Remove</Text>
                        </TouchableOpacity>
                      </View>
                      <Input
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

          {/* Add Custom Field Section */}
          <View style={styles.addFieldContainer}>
            {isAddingField ? (
              <View style={styles.addFieldForm}>
                <Input
                  label="Field Name"
                  value={newFieldKey}
                  onChangeText={setNewFieldKey}
                  placeholder="e.g. Serial Number, Color, Tax ID"
                />
                <Input
                  label="Field Value"
                  value={newFieldValue}
                  onChangeText={setNewFieldValue}
                  placeholder="e.g. 12345, Blue, 18%"
                />
                <View style={styles.addFieldActions}>
                  <TouchableOpacity
                    style={[styles.addFieldBtn, styles.addFieldBtnCancel]}
                    onPress={() => {
                      setIsAddingField(false);
                      setNewFieldKey('');
                      setNewFieldValue('');
                    }}
                  >
                    <Text style={styles.addFieldBtnCancelText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.addFieldBtn, styles.addFieldBtnSave]}
                    onPress={() => {
                      if (newFieldKey.trim()) {
                        setDynamicFields(prev => ({
                          ...prev,
                          [newFieldKey.trim()]: newFieldValue.trim(),
                        }));
                        setIsAddingField(false);
                        setNewFieldKey('');
                        setNewFieldValue('');
                      } else {
                        Alert.alert('Field Name Required', 'Please enter a name for the custom field.');
                      }
                    }}
                  >
                    <Text style={styles.addFieldBtnSaveText}>Add Field</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <TouchableOpacity
                style={styles.addFieldTriggerBtn}
                onPress={() => setIsAddingField(true)}
              >
                <Text style={styles.addFieldTriggerText}>➕ Add Custom Field</Text>
              </TouchableOpacity>
            )}
          </View>

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
  // Quality block card — shown when image is unusable
  qualityBlockCard: {
    backgroundColor: '#FFF7ED',
    borderColor: '#FED7AA',
    borderWidth: 1,
    borderRadius: 10,
    padding: 16,
    marginBottom: theme.spacing.md,
    alignItems: 'center',
  },
  qualityBlockIcon: {
    fontSize: 36,
    marginBottom: 8,
  },
  qualityBlockTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#9A3412',
    marginBottom: 8,
    textAlign: 'center',
  },
  qualityBlockMessage: {
    fontSize: 13,
    color: '#7C2D12',
    textAlign: 'center',
    marginBottom: 14,
    lineHeight: 19,
  },
  // Quality warning banner — non-blocking caution for MEDIUM quality
  qualityWarnBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#FFFBEB',
    borderColor: '#FDE68A',
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    marginBottom: theme.spacing.sm,
  },
  qualityWarnIcon: {
    fontSize: 16,
    marginRight: 8,
    marginTop: 1,
  },
  qualityWarnText: {
    fontSize: 12,
    color: '#92400E',
    flex: 1,
    lineHeight: 18,
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
  extraFieldsSection: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
  },
  extraFieldsHeader: {
    fontSize: 13,
    fontWeight: '700',
    color: '#475569',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  fieldHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  fieldHeaderLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#334155',
  },
  removeFieldText: {
    fontSize: 11,
    color: '#EF4444',
    fontWeight: '600',
  },
  addFieldContainer: {
    marginTop: 8,
    marginBottom: 12,
  },
  addFieldTriggerBtn: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#3B82F6',
    borderStyle: 'dashed',
    alignItems: 'center',
    backgroundColor: '#EFF6FF',
  },
  addFieldTriggerText: {
    color: '#2563EB',
    fontWeight: '600',
    fontSize: 13,
  },
  addFieldForm: {
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    padding: 12,
  },
  addFieldActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 8,
  },
  addFieldBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 6,
    marginLeft: 8,
  },
  addFieldBtnCancel: {
    backgroundColor: '#E2E8F0',
  },
  addFieldBtnCancelText: {
    color: '#475569',
    fontWeight: '600',
    fontSize: 12,
  },
  addFieldBtnSave: {
    backgroundColor: '#2563EB',
  },
  addFieldBtnSaveText: {
    color: '#FFF',
    fontWeight: '700',
    fontSize: 12,
  },
});