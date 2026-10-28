/**
 * networkConfig.ts — Centralized Backend Network Configuration & Diagnostics
 *
 * Resolves the reachable backend URL for the mobile app, ensuring production
 * standalone release builds target the live public HTTPS backend and never
 * fall back to a local laptop IP address or localhost.
 */

import { Platform } from 'react-native';
import Constants from 'expo-constants';

// Verified Production HTTPS Backend URL
export const PRODUCTION_API_URL = 'https://dda-backend-q70w.onrender.com';

// Local development fallback constants
export const LAN_WIFI_IP = '10.42.190.198';
export const LAN_ETHERNET_IP = '172.16.11.223';
export const BACKEND_PORT = 5000;

export interface NetworkConfigInfo {
  baseUrl: string;
  targetHost: string;
  targetPort: number;
  connectionMode: string;
}

export function resolveBackendNetwork(): NetworkConfigInfo {
  // 1. Explicit environment variable override takes absolute priority
  if (process.env.EXPO_PUBLIC_API_URL) {
    const envUrl = process.env.EXPO_PUBLIC_API_URL.replace(/\/+$/, '');
    const isHttps = envUrl.startsWith('https://');
    const hostMatch = envUrl.match(/^https?:\/\/([^/:]+)(?::(\d+))?/);
    const targetHost = hostMatch ? hostMatch[1] : 'unknown';
    const targetPort = hostMatch && hostMatch[2] ? parseInt(hostMatch[2], 10) : (isHttps ? 443 : 80);
    return {
      baseUrl: envUrl,
      targetHost,
      targetPort,
      connectionMode: 'EXPO_PUBLIC_API_URL',
    };
  }

  // 2. Standalone / Release APK build — strictly use public production URL
  const isDev = typeof __DEV__ !== 'undefined' ? __DEV__ : false;
  if (!isDev) {
    const hostMatch = PRODUCTION_API_URL.match(/^https?:\/\/([^/:]+)(?::(\d+))?/);
    return {
      baseUrl: PRODUCTION_API_URL,
      targetHost: hostMatch ? hostMatch[1] : 'dda-backend-q70w.onrender.com',
      targetPort: 443,
      connectionMode: 'PRODUCTION_DEFAULT_URL',
    };
  }

  // 3. Web platform in development talks to localhost
  if (Platform.OS === 'web') {
    return {
      baseUrl: 'http://localhost:5000',
      targetHost: 'localhost',
      targetPort: 5000,
      connectionMode: 'WEB_LOCALHOST',
    };
  }

  // 4. Inspect Expo runtime host configuration in development
  const hostUri =
    Constants.expoConfig?.hostUri ||
    (Constants as any).manifest2?.extra?.expoGo?.debuggerHost ||
    (Constants as any).manifest?.debuggerHost ||
    (Constants as any).experienceUrl;

  if (typeof hostUri === 'string' && hostUri.trim()) {
    const hostPart = hostUri.replace(/^[a-zA-Z]+:\/\//, '').split('/')[0];
    const hostIp = hostPart.split(':')[0];

    const isTunnel =
      hostPart.includes('exp.direct') ||
      hostPart.includes('ngrok') ||
      hostPart.includes('localtunnel') ||
      hostPart.includes('trycloudflare.com');

    const isIpv4 = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/.test(hostIp);

    if (isTunnel) {
      console.warn(
        `[BACKEND_NETWORK][WARN] Expo tunnel detected (${hostPart}). Tunnel domains proxy Metro (8081) only and do NOT forward backend port 5000. Routing to verified Wi-Fi LAN IP.`
      );
      return {
        baseUrl: `http://${LAN_WIFI_IP}:${BACKEND_PORT}`,
        targetHost: LAN_WIFI_IP,
        targetPort: BACKEND_PORT,
        connectionMode: 'TUNNEL_BYPASS_LAN_FALLBACK',
      };
    }

    if (isIpv4 && hostIp !== '127.0.0.1' && hostIp !== 'localhost') {
      return {
        baseUrl: `http://${hostIp}:${BACKEND_PORT}`,
        targetHost: hostIp,
        targetPort: BACKEND_PORT,
        connectionMode: 'EXPO_LAN_PACKAGER',
      };
    }
  }

  // 5. Development fallback for emulator or local test
  const fallbackIp = Platform.OS === 'android' ? LAN_WIFI_IP : 'localhost';
  return {
    baseUrl: `http://${fallbackIp}:${BACKEND_PORT}`,
    targetHost: fallbackIp,
    targetPort: BACKEND_PORT,
    connectionMode: Platform.OS === 'android' ? 'DEV_STANDALONE_LAN_FALLBACK' : 'DEV_LOCALHOST',
  };
}

let lastLoggedUrl = '';

export function getBackendBaseUrl(): string {
  const config = resolveBackendNetwork();

  if (config.baseUrl !== lastLoggedUrl) {
    lastLoggedUrl = config.baseUrl;
    console.log(`[BACKEND_NETWORK] API_BASE_URL=${config.baseUrl}`);
    console.log(`[BACKEND_NETWORK] TARGET_HOST=${config.targetHost}`);
    console.log(`[BACKEND_NETWORK] TARGET_PORT=${config.targetPort}`);
    console.log(`[BACKEND_NETWORK] CONNECTION_MODE=${config.connectionMode}`);

    const isLocal =
      config.baseUrl.includes('localhost') ||
      config.baseUrl.includes('127.0.0.1') ||
      config.baseUrl.includes('10.') ||
      config.baseUrl.includes('192.168.') ||
      config.baseUrl.includes('172.');
    if (typeof __DEV__ !== 'undefined' && !__DEV__ && isLocal) {
      console.warn(
        `[BACKEND_NETWORK][CRITICAL_CONFIG] Production standalone build is currently pointing to a local IP (${config.baseUrl}). For full independence across networks, configure EXPO_PUBLIC_API_URL with your public HTTPS backend.`
      );
    }
  }

  return config.baseUrl;
}

export async function verifyBackendHealth(): Promise<{ ok: boolean; status: number; message: string }> {
  const baseUrl = getBackendBaseUrl();
  const healthUrl = `${baseUrl}/health`;

  console.log(`[BACKEND_NETWORK] HEALTH_CHECK_START: ${healthUrl}`);

  try {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), 10000) : null;

    const res = await fetch(healthUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller?.signal,
    });

    if (timer) clearTimeout(timer);

    const status = res.status;
    console.log(`[BACKEND_NETWORK] HEALTH_CHECK_STATUS=${status}`);

    if (res.ok) {
      const data = await res.json();
      console.log(`[BACKEND_NETWORK] HEALTH_CHECK_RESULT=SUCCESS`);
      return { ok: true, status, message: data.message || 'Healthy' };
    } else {
      console.warn(`[BACKEND_NETWORK] HEALTH_CHECK_RESULT=FAILED`);
      return { ok: false, status, message: `HTTP ${status}` };
    }
  } catch (err: any) {
    console.warn(`[BACKEND_NETWORK] HEALTH_CHECK_STATUS=0`);
    console.warn(`[BACKEND_NETWORK] HEALTH_CHECK_RESULT=FAILED: ${err?.message}`);
    return { ok: false, status: 0, message: err?.message || 'Network error' };
  }
}
