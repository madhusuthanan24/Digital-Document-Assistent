/**
 * assistantService.ts — Client API Service for AI Document Assistant
 */

import { Platform } from 'react-native';
import Constants from 'expo-constants';

const getBackendBaseUrl = () => {
  if (Platform.OS === 'web') {
    return 'http://localhost:5000';
  }
  const hostUri = Constants.expoConfig?.hostUri || (Constants as any).manifest?.debuggerHost;
  if (hostUri) {
    const hostIp = hostUri.split(':')[0];
    if (hostIp && hostIp !== 'localhost' && hostIp !== '127.0.0.1') {
      return `http://${hostIp}:5000`;
    }
  }
  return Platform.OS === 'android' ? 'http://10.1.1.88:5000' : 'http://localhost:5000';
};

const API_BASE_URL = getBackendBaseUrl();

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  proposal?: CorrectionProposal | null;
  proposalStatus?: 'pending' | 'confirmed' | 'cancelled';
}

export interface CorrectionProposal {
  type: 'correction_proposal';
  field: string;
  currentValue: string;
  proposedValue: string;
  reason?: string;
  requiresConfirmation?: boolean;
}

export interface SendChatParams {
  userId: string;
  message: string;
  documentId?: string | null;
  conversationHistory?: { role: 'user' | 'assistant'; content: string }[];
}

export async function sendChatMessage(params: SendChatParams): Promise<{
  reply: string;
  proposal?: CorrectionProposal | null;
}> {
  const { userId, message, documentId, conversationHistory } = params;

  const requestUrl = `${API_BASE_URL}/api/assistant/chat`;
  const reqStartTime = Date.now();
  console.log(`[ASSISTANT] REQUEST_URL: ${requestUrl}`);
  console.log(`[ASSISTANT] REQUEST_START: ${new Date(reqStartTime).toISOString()}`);

  try {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeoutId = controller ? setTimeout(() => {
      console.warn(`[ASSISTANT] REQUEST_ABORT: Timed out after 45 seconds`);
      controller.abort();
    }, 45000) : null;

    const res = await fetch(requestUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': userId,
      },
      body: JSON.stringify({
        message,
        documentId: documentId || null,
        conversationHistory: conversationHistory || [],
      }),
      signal: controller?.signal,
    });

    if (timeoutId) clearTimeout(timeoutId);

    const resTime = Date.now();
    console.log(`[ASSISTANT] RESPONSE_RECEIVED: ${new Date(resTime).toISOString()}`);
    console.log(`[ASSISTANT] RESPONSE_STATUS: ${res.status}`);
    console.log(`[ASSISTANT] TOTAL_TIME_MS: ${resTime - reqStartTime}ms`);

    const data = await res.json();
    if (res.ok && data.success) {
      return {
        reply: data.data?.reply || 'I processed your request.',
        proposal: data.data?.proposal || null,
      };
    } else {
      if (res.status === 403) {
        return {
          reply: 'Access Denied: You do not have permission to view or manage this document.',
        };
      }
      return {
        reply: data.message || 'AI Assistant is temporarily unavailable. Please try again.',
      };
    }
  } catch (err: any) {
    const errTime = Date.now();
    console.warn(`[ASSISTANT] FETCH_ERROR (${errTime - reqStartTime}ms):`, err?.message);
    if (err?.name === 'AbortError') {
      return {
        reply: 'AI Assistant request timed out. Please check your connection and try again.',
      };
    }
    return {
      reply: 'AI Assistant is temporarily unavailable. Please try again.',
    };
  }
}

export async function confirmDocumentCorrection(
  userId: string,
  documentId: string,
  field: string,
  value: string
): Promise<{ success: boolean; message: string }> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/documents/${documentId}/correction`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': userId,
      },
      body: JSON.stringify({ field, value }),
    });

    const data = await res.json();
    if (res.ok && data.success) {
      return { success: true, message: `Field "${field}" updated successfully!` };
    } else {
      return { success: false, message: data.message || 'Could not update field' };
    }
  } catch (err: any) {
    return { success: false, message: err?.message || 'Network error updating field' };
  }
}
