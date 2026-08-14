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

  // Save state
  const [isSaving, setIsSaving] = useState<boolean>(false);

  // Template key resolution
  const effectiveTemplateKey = detectedDocumentType || categoryToTemplateKey(selectedType) || '';
  const currentTemplate = DOCUMENT_TEMPLATES[effectiveTemplateKey];

  // Category selection handler
  const handleSelectCategory = (cat: DocumentCategory) => {
    setSelectedType(cat);
    const match = DOCUMENT_TYPES.find(t => t.type === cat);
    if (match) { setDocumentName(match.label); }
    setDetectedDocumentType('');
    setDynamicFields({});
    setOcrConfidence(null);
    setOcrFailed(false);
  };

  // Process & apply OCR extraction results
  const applyOcrResult = (result: { documentType: string; fields: Record<string, string>; confidence: number }) => {
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

    const fieldCount = Object.keys(result.fields).length;
    setOcrConfidence(fieldCount >= 2 ? 'high' : fieldCount === 1 ? 'medium' : 'none');
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

    const vaultUri = finalImageUri || originalImageUri;

    setIsSaving(true);
    try {
      await documentService.addDocument(user.uid, {
        documentType: selectedType,
        documentName: documentName.trim(),
        documentNumber: dynamicFields?.documentNumber || dynamicFields?.aadhaarNumber || dynamicFields?.panNumber || dynamicFields?.passportNumber || dynamicFields?.epicNumber || '',
        issueDate: dynamicFields?.issueDate,
        expiryDate: dynamicFields?.expiryDate,
        localFileUri: vaultUri || undefined,
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
              Automatic extraction could not read this document clearly. You can retry with a clearer crop or enter the details manually.
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
          <Input
            label="Document Name *"
            value={documentName}
            onChangeText={setDocumentName}
            placeholder="e.g. Aadhaar Card, Passport, Voter ID"
          />

          {currentTemplate ? (
            <>
              {currentTemplate.fields.map(field => (
                <Input
                  key={field.key}
                  label={field.label + (field.required ? ' *' : '')}
                  value={dynamicFields[field.key] || ''}
                  onChangeText={text =>
                    setDynamicFields(prev => ({ ...prev, [field.key]: text }))
                  }
                />
              ))}
            </>
          ) : (
            Object.entries(dynamicFields).length > 0 ? (
              <>
                {Object.entries(dynamicFields).map(([key, value]) => (
                  <Input
                    key={key}
                    label={key.replace(/_/g, ' ')}
                    value={value}
                    onChangeText={text =>
                      setDynamicFields(prev => ({ ...prev, [key]: text }))
                    }
                  />
                ))}
              </>
            ) : null
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
});