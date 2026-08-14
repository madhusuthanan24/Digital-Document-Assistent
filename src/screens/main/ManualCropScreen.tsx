/**
 * ManualCropScreen.tsx
 *
 * Ground-up rewrite of Manual Crop Overlay (Adobe Scan Style)
 *
 * Features & Architecture:
 *  1. Single Source of Truth: cropRect = { left, top, right, bottom } in display coordinates.
 *  2. Deferred Layout Measurement: Image container onLayout calculates contain-scale & offsets
 *     before initializing cropRect (prevents 0-width collapse).
 *  3. 8 Independent Responders + 1 Body Drag Responder:
 *     - 4 Corners (TL, TR, BL, BR): circular dots (20px)
 *     - 4 Edges (TC, ML, MR, BC): rectangular tabs (32x8 / 8x32)
 *     - Large 48px touch targets centered on handles.
 *     - Single-snapshot anti-jitter calculation relative to grant state.
 *     - Strict clamping within image display bounds and 80dp minimum size.
 *  4. 4 Segmented Dim Overlay Strips with pointerEvents="none" to prevent touch swallowed events.
 *  5. Real-Time On-Screen Debug HUD showing live crop bounds & active handle logs.
 *  6. Coordinate Conversion & Pixel-Accurate Crop via @react-native-community/image-editor.
 */

import React, { useRef, useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  PanResponder,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Modal,
  LayoutChangeEvent,
} from 'react-native';
import ImageEditor from '@react-native-community/image-editor';
import { theme } from '../../constants/theme';

export interface ManualCropResult {
  uri: string;
  width: number;
  height: number;
}

export interface ManualCropScreenProps {
  visible: boolean;
  imageUri: string;
  imageWidth: number;
  imageHeight: number;
  onCrop: (result: ManualCropResult) => void;
  onCancel: () => void;
}

export interface CropRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const HANDLE_TOUCH_SIZE = 48;
const CORNER_VISUAL_SIZE = 20;
const MIN_CROP_SIZE = 80;

export const ManualCropScreen: React.FC<ManualCropScreenProps> = ({
  visible,
  imageUri,
  imageWidth,
  imageHeight,
  onCrop,
  onCancel,
}) => {
  const [containerSize, setContainerSize] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });
  const [measuredSize, setMeasuredSize] = useState<{ width: number; height: number }>({
    width: imageWidth || 0,
    height: imageHeight || 0,
  });

  const [rotation, setRotation] = useState<number>(0);
  const [isCropping, setIsCropping] = useState<boolean>(false);
  const [lastTouchedHandle, setLastTouchedHandle] = useState<string>('None');

  // Measure image dimensions if zero/missing
  useEffect(() => {
    if (imageUri) {
      if (imageWidth > 0 && imageHeight > 0) {
        setMeasuredSize({ width: imageWidth, height: imageHeight });
      } else {
        Image.getSize(
          imageUri,
          (w, h) => {
            console.log(`[CropScreen] Image.getSize resolved: ${w}x${h}`);
            setMeasuredSize({ width: w, height: h });
          },
          (err) => {
            console.warn('[CropScreen] Image.getSize error:', err);
          }
        );
      }
    }
  }, [imageUri, imageWidth, imageHeight]);

  const rawImgW = measuredSize.width || 1000;
  const rawImgH = measuredSize.height || 1000;

  const isRotated90 = rotation === 90 || rotation === 270;
  const effImgW = isRotated90 ? rawImgH : rawImgW;
  const effImgH = isRotated90 ? rawImgW : rawImgH;

  const containerW = containerSize.width;
  const containerH = containerSize.height;

  let displayW = 0;
  let displayH = 0;
  let offsetX = 0;
  let offsetY = 0;

  if (containerW > 0 && containerH > 0 && effImgW > 0 && effImgH > 0) {
    const scale = Math.min(containerW / effImgW, containerH / effImgH);
    displayW = effImgW * scale;
    displayH = effImgH * scale;
    offsetX = (containerW - displayW) / 2;
    offsetY = (containerH - displayH) / 2;
  }

  // Ref layout snapshot for PanResponders
  const layoutRef = useRef({ offsetX, offsetY, displayW, displayH });
  layoutRef.current = { offsetX, offsetY, displayW, displayH };

  // Single Source of Truth for Crop Rectangle (Display Coordinates)
  const [cropRect, setCropRect] = useState<CropRect | null>(null);

  const cropRectRef = useRef<CropRect | null>(cropRect);
  cropRectRef.current = cropRect;

  const startRectRef = useRef<CropRect>({ left: 0, top: 0, right: 0, bottom: 0 });

  // Initialize crop box once layout is ready (~90% centered box)
  useEffect(() => {
    if (displayW > 0 && displayH > 0) {
      const marginX = displayW * 0.05;
      const marginY = displayH * 0.05;

      const initialRect: CropRect = {
        left: Math.round(offsetX + marginX),
        top: Math.round(offsetY + marginY),
        right: Math.round(offsetX + displayW - marginX),
        bottom: Math.round(offsetY + displayH - marginY),
      };

      setCropRect(initialRect);
      cropRectRef.current = initialRect;
    }
  }, [containerW, containerH, displayW, displayH, rotation, imageUri]);

  const handleContainerLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setContainerSize({ width, height });
  };

  const resetToFullImage = useCallback(() => {
    const { offsetX: ox, offsetY: oy, displayW: dW, displayH: dH } = layoutRef.current;
    if (dW > 0 && dH > 0) {
      const fullRect: CropRect = {
        left: ox,
        top: oy,
        right: ox + dW,
        bottom: oy + dH,
      };
      setCropRect(fullRect);
      cropRectRef.current = fullRect;
      setLastTouchedHandle('Reset Full');
    }
  }, []);

  // Helper helper to clamp crop updates
  const clampRect = (left: number, top: number, right: number, bottom: number): CropRect => {
    const { offsetX: minX, offsetY: minY, displayW: dW, displayH: dH } = layoutRef.current;
    const maxX = minX + dW;
    const maxY = minY + dH;

    let cLeft = Math.max(minX, Math.min(left, maxX - MIN_CROP_SIZE));
    let cTop = Math.max(minY, Math.min(top, maxY - MIN_CROP_SIZE));
    let cRight = Math.min(maxX, Math.max(right, cLeft + MIN_CROP_SIZE));
    let cBottom = Math.min(maxY, Math.max(bottom, cTop + MIN_CROP_SIZE));

    return { left: cLeft, top: cTop, right: cRight, bottom: cBottom };
  };

  // -------------------------------------------------------------------------
  // 8 Independent Responders + 1 Body Drag Responder (Capture Phase Enabled)
  // -------------------------------------------------------------------------

  // 1. Top-Left Corner (TL) -> Moves left & top
  const tlPan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      onPanResponderGrant: () => {
        if (cropRectRef.current) startRectRef.current = { ...cropRectRef.current };
        setLastTouchedHandle('Top-Left Corner');
        console.log('[CropTouch] Top-Left Corner Grant');
      },
      onPanResponderMove: (_, gs) => {
        const s = startRectRef.current;
        const newLeft = s.left + gs.dx;
        const newTop = s.top + gs.dy;
        const updated = clampRect(newLeft, newTop, s.right, s.bottom);
        setCropRect(updated);
      },
    }),
  ).current;

  // 2. Top-Center Edge (TC) -> Moves top only
  const tcPan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      onPanResponderGrant: () => {
        if (cropRectRef.current) startRectRef.current = { ...cropRectRef.current };
        setLastTouchedHandle('Top Edge');
        console.log('[CropTouch] Top Edge Grant');
      },
      onPanResponderMove: (_, gs) => {
        const s = startRectRef.current;
        const newTop = s.top + gs.dy;
        const updated = clampRect(s.left, newTop, s.right, s.bottom);
        setCropRect(updated);
      },
    }),
  ).current;

  // 3. Top-Right Corner (TR) -> Moves right & top
  const trPan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      onPanResponderGrant: () => {
        if (cropRectRef.current) startRectRef.current = { ...cropRectRef.current };
        setLastTouchedHandle('Top-Right Corner');
        console.log('[CropTouch] Top-Right Corner Grant');
      },
      onPanResponderMove: (_, gs) => {
        const s = startRectRef.current;
        const newRight = s.right + gs.dx;
        const newTop = s.top + gs.dy;
        const updated = clampRect(s.left, newTop, newRight, s.bottom);
        setCropRect(updated);
      },
    }),
  ).current;

  // 4. Middle-Left Edge (ML) -> Moves left only
  const mlPan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      onPanResponderGrant: () => {
        if (cropRectRef.current) startRectRef.current = { ...cropRectRef.current };
        setLastTouchedHandle('Left Edge');
        console.log('[CropTouch] Left Edge Grant');
      },
      onPanResponderMove: (_, gs) => {
        const s = startRectRef.current;
        const newLeft = s.left + gs.dx;
        const updated = clampRect(newLeft, s.top, s.right, s.bottom);
        setCropRect(updated);
      },
    }),
  ).current;

  // 5. Middle-Right Edge (MR) -> Moves right only
  const mrPan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      onPanResponderGrant: () => {
        if (cropRectRef.current) startRectRef.current = { ...cropRectRef.current };
        setLastTouchedHandle('Right Edge');
        console.log('[CropTouch] Right Edge Grant');
      },
      onPanResponderMove: (_, gs) => {
        const s = startRectRef.current;
        const newRight = s.right + gs.dx;
        const updated = clampRect(s.left, s.top, newRight, s.bottom);
        setCropRect(updated);
      },
    }),
  ).current;

  // 6. Bottom-Left Corner (BL) -> Moves left & bottom
  const blPan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      onPanResponderGrant: () => {
        if (cropRectRef.current) startRectRef.current = { ...cropRectRef.current };
        setLastTouchedHandle('Bottom-Left Corner');
        console.log('[CropTouch] Bottom-Left Corner Grant');
      },
      onPanResponderMove: (_, gs) => {
        const s = startRectRef.current;
        const newLeft = s.left + gs.dx;
        const newBottom = s.bottom + gs.dy;
        const updated = clampRect(newLeft, s.top, s.right, newBottom);
        setCropRect(updated);
      },
    }),
  ).current;

  // 7. Bottom-Center Edge (BC) -> Moves bottom only
  const bcPan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      onPanResponderGrant: () => {
        if (cropRectRef.current) startRectRef.current = { ...cropRectRef.current };
        setLastTouchedHandle('Bottom Edge');
        console.log('[CropTouch] Bottom Edge Grant');
      },
      onPanResponderMove: (_, gs) => {
        const s = startRectRef.current;
        const newBottom = s.bottom + gs.dy;
        const updated = clampRect(s.left, s.top, s.right, newBottom);
        setCropRect(updated);
      },
    }),
  ).current;

  // 8. Bottom-Right Corner (BR) -> Moves right & bottom
  const brPan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      onPanResponderGrant: () => {
        if (cropRectRef.current) startRectRef.current = { ...cropRectRef.current };
        setLastTouchedHandle('Bottom-Right Corner');
        console.log('[CropTouch] Bottom-Right Corner Grant');
      },
      onPanResponderMove: (_, gs) => {
        const s = startRectRef.current;
        const newRight = s.right + gs.dx;
        const newBottom = s.bottom + gs.dy;
        const updated = clampRect(s.left, s.top, newRight, newBottom);
        setCropRect(updated);
      },
    }),
  ).current;

  // 9. Inside Body Drag -> Moves all 4 edges together
  const bodyPan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      onPanResponderGrant: () => {
        if (cropRectRef.current) startRectRef.current = { ...cropRectRef.current };
        setLastTouchedHandle('Body Drag');
        console.log('[CropTouch] Body Drag Grant');
      },
      onPanResponderMove: (_, gs) => {
        const { offsetX: minX, offsetY: minY, displayW: dW, displayH: dH } = layoutRef.current;
        const s = startRectRef.current;
        const width = s.right - s.left;
        const height = s.bottom - s.top;

        const maxX = minX + dW - width;
        const maxY = minY + dH - height;

        const newLeft = Math.min(Math.max(minX, s.left + gs.dx), maxX);
        const newTop = Math.min(Math.max(minY, s.top + gs.dy), maxY);

        setCropRect({
          left: newLeft,
          top: newTop,
          right: newLeft + width,
          bottom: newTop + height,
        });
      },
    }),
  ).current;

  const handleRotate = () => {
    setRotation(r => (r + 90) % 360);
  };

  // Crop execution
  const handleUseSelection = async () => {
    if (!imageUri || !cropRect || displayW <= 0 || displayH <= 0) return;
    setIsCropping(true);

    try {
      const current = cropRectRef.current || cropRect;
      const { offsetX: ox, offsetY: oy, displayW: dW, displayH: dH } = layoutRef.current;

      const cropDisplayX = Math.max(0, current.left - ox);
      const cropDisplayY = Math.max(0, current.top - oy);
      const cropDisplayW = Math.min(dW - cropDisplayX, current.right - current.left);
      const cropDisplayH = Math.min(dH - cropDisplayY, current.bottom - current.top);

      const scaleX = effImgW / dW;
      const scaleY = effImgH / dH;

      const pixelX = Math.max(0, Math.round(cropDisplayX * scaleX));
      const pixelY = Math.max(0, Math.round(cropDisplayY * scaleY));
      const pixelW = Math.max(1, Math.min(Math.round(cropDisplayW * scaleX), effImgW - pixelX));
      const pixelH = Math.max(1, Math.min(Math.round(cropDisplayH * scaleY), effImgH - pixelY));

      let origX: number;
      let origY: number;
      let origW: number;
      let origH: number;

      switch (rotation) {
        case 90:
          origX = pixelY;
          origY = rawImgH - pixelX - pixelW;
          origW = pixelH;
          origH = pixelW;
          break;
        case 180:
          origX = rawImgW - pixelX - pixelW;
          origY = rawImgH - pixelY - pixelH;
          origW = pixelW;
          origH = pixelH;
          break;
        case 270:
          origX = rawImgW - pixelY - pixelH;
          origY = pixelX;
          origW = pixelH;
          origH = pixelW;
          break;
        default:
          origX = pixelX;
          origY = pixelY;
          origW = pixelW;
          origH = pixelH;
      }

      origX = Math.max(0, Math.min(origX, rawImgW - 1));
      origY = Math.max(0, Math.min(origY, rawImgH - 1));
      origW = Math.max(1, Math.min(origW, rawImgW - origX));
      origH = Math.max(1, Math.min(origH, rawImgH - origY));

      console.log(`[Crop] Original URI: ${imageUri}`);
      console.log(`[Crop] Original dimensions: ${rawImgW}x${rawImgH}`);
      console.log(`[Crop] Display dimensions: ${dW.toFixed(1)}x${dH.toFixed(1)}`);
      console.log(`[Crop] Crop display rect: left=${current.left.toFixed(1)}, top=${current.top.toFixed(1)}, right=${current.right.toFixed(1)}, bottom=${current.bottom.toFixed(1)}`);
      console.log(`[Crop] Crop original rect: origX=${origX}, origY=${origY}, origW=${origW}, origH=${origH}`);

      const cropResult = await ImageEditor.cropImage(imageUri, {
        offset: { x: origX, y: origY },
        size: { width: origW, height: origH },
        quality: 0.92,
        format: 'jpeg',
      });

      let finalSavedUri = cropResult.uri;
      try {
        const RNFS = require('react-native-fs');
        const timestamp = Date.now();
        const destPath = `${RNFS.CachesDirectoryPath}/cropped_${timestamp}.jpg`;
        const cleanSourcePath = cropResult.uri.replace('file://', '');
        await RNFS.copyFile(cleanSourcePath, destPath);
        finalSavedUri = `file://${destPath}`;
      } catch (copyErr) {
        console.warn('[Crop] Copy to persistent file skipped:', copyErr);
      }

      console.log(`[Crop] Cropped image URI: ${finalSavedUri}`);

      onCrop({
        uri: finalSavedUri,
        width: cropResult.width || origW,
        height: cropResult.height || origH,
      });
    } catch (err: any) {
      console.error('[Crop] Error executing crop:', err);
      Alert.alert('Crop Error', err?.message || 'Could not crop the selection.');
    } finally {
      setIsCropping(false);
    }
  };

  if (!visible) return null;

  const isLayoutReady = containerW > 0 && containerH > 0 && displayW > 0 && displayH > 0 && cropRect !== null;
  const c = cropRect || { left: 0, top: 0, right: 0, bottom: 0 };
  const cropW = c.right - c.left;
  const cropH = c.bottom - c.top;

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onCancel}>
      <View style={styles.root}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity style={styles.headerBtn} onPress={onCancel}>
            <Text style={styles.headerBtnText}>✕ Cancel</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Manual Crop v2 (HUD Active)</Text>
          <TouchableOpacity style={styles.headerBtn} onPress={handleRotate}>
            <Text style={styles.headerBtnText}>↻ Rotate ({rotation}°)</Text>
          </TouchableOpacity>
        </View>

        {/* Temporary Unmistakable Build Marker Banner */}
        <View style={{ backgroundColor: '#F59E0B', paddingVertical: 4, alignItems: 'center' }}>
          <Text style={{ color: '#000', fontSize: 12, fontWeight: '800' }}>
            ⚡ LIVE BUILD MARKER: GROUND-UP REWRITE V2 (DEBUG HUD ACTIVE) ⚡
          </Text>
        </View>

        {/* Canvas Area */}
        <View style={styles.canvasContainer} onLayout={handleContainerLayout}>
          {isLayoutReady ? (
            <>
              {/* Main Displayed Image */}
              <Image
                source={{ uri: imageUri }}
                style={[
                  styles.image,
                  {
                    left: offsetX,
                    top: offsetY,
                    width: displayW,
                    height: displayH,
                  },
                  rotation > 0 && { transform: [{ rotate: `${rotation}deg` }] },
                ]}
                resizeMode="stretch"
              />

              {/* 4 Segmented Dim Overlay Strips (pointerEvents="none") */}
              <View pointerEvents="none" style={[styles.dim, { left: 0, top: 0, right: 0, height: Math.max(0, c.top) }]} />
              <View pointerEvents="none" style={[styles.dim, { left: 0, top: c.bottom, right: 0, bottom: 0 }]} />
              <View pointerEvents="none" style={[styles.dim, { left: 0, top: c.top, width: Math.max(0, c.left), height: cropH }]} />
              <View pointerEvents="none" style={[styles.dim, { left: c.right, top: c.top, right: 0, height: cropH }]} />

              {/* Active Crop Border & Move-Whole-Box Body Drag */}
              <View
                style={[styles.cropBorder, { left: c.left, top: c.top, width: cropW, height: cropH }]}
                {...bodyPan.panHandlers}
              />

              {/* Real-time Debug HUD */}
              <View pointerEvents="none" style={styles.debugHud}>
                <Text style={styles.debugHudText}>
                  RECT: L:{Math.round(c.left)} T:{Math.round(c.top)} R:{Math.round(c.right)} B:{Math.round(c.bottom)} ({Math.round(cropW)}x{Math.round(cropH)})
                </Text>
                <Text style={styles.debugHudTextSub}>
                  ACTIVE: {lastTouchedHandle}
                </Text>
              </View>

              {/* ── 8 ADOBE SCAN TOUCH HANDLES ── */}

              {/* 1. Top-Left Corner (TL) */}
              <View
                style={[styles.handleTouchArea, { left: c.left - HANDLE_TOUCH_SIZE / 2, top: c.top - HANDLE_TOUCH_SIZE / 2 }]}
                {...tlPan.panHandlers}
              >
                <View style={styles.cornerHandleDot} />
              </View>

              {/* 2. Top-Center Edge Tab (TC) */}
              <View
                style={[styles.handleTouchArea, { left: c.left + cropW / 2 - HANDLE_TOUCH_SIZE / 2, top: c.top - HANDLE_TOUCH_SIZE / 2 }]}
                {...tcPan.panHandlers}
              >
                <View style={styles.edgeTabHorizontal} />
              </View>

              {/* 3. Top-Right Corner (TR) */}
              <View
                style={[styles.handleTouchArea, { left: c.right - HANDLE_TOUCH_SIZE / 2, top: c.top - HANDLE_TOUCH_SIZE / 2 }]}
                {...trPan.panHandlers}
              >
                <View style={styles.cornerHandleDot} />
              </View>

              {/* 4. Middle-Left Edge Tab (ML) */}
              <View
                style={[styles.handleTouchArea, { left: c.left - HANDLE_TOUCH_SIZE / 2, top: c.top + cropH / 2 - HANDLE_TOUCH_SIZE / 2 }]}
                {...mlPan.panHandlers}
              >
                <View style={styles.edgeTabVertical} />
              </View>

              {/* 5. Middle-Right Edge Tab (MR) */}
              <View
                style={[styles.handleTouchArea, { left: c.right - HANDLE_TOUCH_SIZE / 2, top: c.top + cropH / 2 - HANDLE_TOUCH_SIZE / 2 }]}
                {...mrPan.panHandlers}
              >
                <View style={styles.edgeTabVertical} />
              </View>

              {/* 6. Bottom-Left Corner (BL) */}
              <View
                style={[styles.handleTouchArea, { left: c.left - HANDLE_TOUCH_SIZE / 2, top: c.bottom - HANDLE_TOUCH_SIZE / 2 }]}
                {...blPan.panHandlers}
              >
                <View style={styles.cornerHandleDot} />
              </View>

              {/* 7. Bottom-Center Edge Tab (BC) */}
              <View
                style={[styles.handleTouchArea, { left: c.left + cropW / 2 - HANDLE_TOUCH_SIZE / 2, top: c.bottom - HANDLE_TOUCH_SIZE / 2 }]}
                {...bcPan.panHandlers}
              >
                <View style={styles.edgeTabHorizontal} />
              </View>

              {/* 8. Bottom-Right Corner (BR) */}
              <View
                style={[styles.handleTouchArea, { left: c.right - HANDLE_TOUCH_SIZE / 2, top: c.bottom - HANDLE_TOUCH_SIZE / 2 }]}
                {...brPan.panHandlers}
              >
                <View style={styles.cornerHandleDot} />
              </View>
            </>
          ) : (
            <ActivityIndicator color={theme.colors.primary} size="large" />
          )}
        </View>

        {/* Footer Controls */}
        <View style={styles.footer}>
          <TouchableOpacity style={styles.footerSecondaryBtn} onPress={resetToFullImage}>
            <Text style={styles.footerSecondaryText}>↺ Reset</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.footerPrimaryBtn, isCropping && styles.btnDisabled]}
            onPress={handleUseSelection}
            disabled={isCropping}
          >
            {isCropping ? (
              <ActivityIndicator color="#FFF" size="small" />
            ) : (
              <Text style={styles.footerPrimaryText}>✂ Use Selection</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#090D16',
  },
  header: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    backgroundColor: '#111827',
    borderBottomWidth: 1,
    borderBottomColor: '#1F2937',
  },
  headerTitle: {
    color: '#F9FAFB',
    fontSize: 16,
    fontWeight: '700',
  },
  headerBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  headerBtnText: {
    color: '#F9FAFB',
    fontSize: 13,
    fontWeight: '600',
  },
  canvasContainer: {
    flex: 1,
    position: 'relative',
    backgroundColor: '#030712',
    justifyContent: 'center',
    alignItems: 'center',
  },
  image: {
    position: 'absolute',
  },
  dim: {
    position: 'absolute',
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
  },
  cropBorder: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: '#2563EB',
    backgroundColor: 'transparent',
    zIndex: 90,
  },
  debugHud: {
    position: 'absolute',
    top: 12,
    alignSelf: 'center',
    backgroundColor: 'rgba(17, 24, 39, 0.85)',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#374151',
    alignItems: 'center',
    zIndex: 110,
  },
  debugHudText: {
    color: '#60A5FA',
    fontSize: 11,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  debugHudTextSub: {
    color: '#10B981',
    fontSize: 10,
    fontWeight: '600',
    marginTop: 2,
  },
  handleTouchArea: {
    position: 'absolute',
    width: HANDLE_TOUCH_SIZE,
    height: HANDLE_TOUCH_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
    elevation: 20,
  },
  cornerHandleDot: {
    width: CORNER_VISUAL_SIZE,
    height: CORNER_VISUAL_SIZE,
    borderRadius: CORNER_VISUAL_SIZE / 2,
    backgroundColor: '#2563EB',
    borderWidth: 2.5,
    borderColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 3,
    elevation: 4,
  },
  edgeTabHorizontal: {
    width: 32,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#2563EB',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.3,
    shadowRadius: 2,
    elevation: 3,
  },
  edgeTabVertical: {
    width: 8,
    height: 32,
    borderRadius: 4,
    backgroundColor: '#2563EB',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.3,
    shadowRadius: 2,
    elevation: 3,
  },
  footer: {
    height: 80,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    backgroundColor: '#111827',
    borderTopWidth: 1,
    borderTopColor: '#1F2937',
  },
  footerSecondaryBtn: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
  },
  footerSecondaryText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '600',
  },
  footerPrimaryBtn: {
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 12,
    backgroundColor: '#2563EB',
    minWidth: 160,
    alignItems: 'center',
  },
  btnDisabled: {
    opacity: 0.6,
  },
  footerPrimaryText: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: '700',
  },
});
