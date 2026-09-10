/**
 * assistantService.ts — Client API Service for AI Document Assistant
 */

import { Platform } from 'react-native';

const API_BASE_URL = Platform.OS === 'android' ? 'http://10.0.2.2:5000' : 'http://localhost:5000';

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

  try {
    const res = await fetch(`${API_BASE_URL}/api/assistant/chat`, {
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
    });

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
    console.warn('[AssistantService] Fetch error:', err?.message);
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
