/**
 * assistantController.js — DDA AI Assistant Backend Controller
 */

const prisma = require('../db');
const fetch = require('node-fetch');
const { successResponse, errorResponse } = require('../utils/responseHandler');

const NVIDIA_ENDPOINT = 'https://integrate.api.nvidia.com/v1/chat/completions';
const NVIDIA_MODEL = 'meta/llama-3.2-11b-vision-instruct';

const SYSTEM_PROMPT = "You are the AI Document Assistant for Digital Document Assistant (DDA).\nYour purpose is to help users understand and manage information associated with their documents.\n\nRULES:\n1. Never invent document information.\n2. Never guess missing values.\n3. Use document context when answering document-specific questions.\n4. If a field is missing, clearly state that it is missing.\n5. Never fabricate names, document numbers, dates, addresses, or other identity information.\n6. Never silently modify stored document information.\n7. If the user requests a correction, create a correction proposal JSON block AND a helpful explanation.\n8. Do not modify the database merely because the user typed a correction.\n9. Only modify a document after explicit user confirmation.\n10. If the document information is unclear, tell the user to verify the original document.\n11. Protect private document information.\n12. Keep responses concise and easy to understand.\n13. If the question cannot be answered from the supplied document context, say so clearly.\n14. Do not claim that an action was completed unless the application actually completed it.\n\nCORRECTION PROPOSAL INSTRUCTIONS:\nIf the user requests to update, fix, or change a document field (e.g. \"My name is wrong, change it to MADHU\", \"Fix my DOB to 01/01/1995\", \"The PAN number should be ABCDE1234F\"), you MUST include a JSON block formatted exactly like this inside your response:\n\n```json\n{\n  \"type\": \"correction_proposal\",\n  \"field\": \"<field_name>\",\n  \"currentValue\": \"<current_value>\",\n  \"proposedValue\": \"<new_value>\",\n  \"reason\": \"User requested correction\",\n  \"requiresConfirmation\": true\n}\n```\n\nValid field_name options: name, documentNumber, fatherName, gender, address, dateOfBirth, issueDate, expiryDate, documentType, documentName.";

/**
 * Process Chat Message
 * POST /api/assistant/chat
 */
const processChatMessage = async (req, res) => {
  try {
    const userId = req.user?.userId || req.user?.id || req.headers['x-user-id'];
    const { message, documentId, conversationHistory = [] } = req.body;

    if (!userId) {
      return errorResponse(res, 'Authentication required', 401);
    }

    if (!message || typeof message !== 'string' || !message.trim()) {
      return errorResponse(res, 'Message is required', 400);
    }

    let documentContextStr = '';
    let docObj = null;

    if (documentId) {
      docObj = await prisma.document.findUnique({
        where: { id: documentId },
      });

      if (!docObj) {
        return errorResponse(res, 'Document not found', 404);
      }

      if (docObj.userId !== userId) {
        console.warn("[SECURITY] Unauthorized document chat attempt by user " + userId + " on document " + documentId + " owned by " + docObj.userId);
        return errorResponse(res, 'Access denied: You do not own this document', 403);
      }

      let fieldsObj = {};
      if (docObj.fields) {
        try {
          fieldsObj = typeof docObj.fields === 'string' ? JSON.parse(docObj.fields) : docObj.fields;
        } catch (pErr) {
          fieldsObj = {};
        }
      }

      const contextData = {
        documentId: docObj.id,
        documentType: docObj.documentType,
        documentName: docObj.documentName,
        extractedFields: {
          documentNumber: docObj.documentNumber || fieldsObj.documentNumber || fieldsObj.panNumber || fieldsObj.aadhaarNumber || null,
          name: docObj.name || fieldsObj.name || null,
          fatherName: docObj.fatherName || fieldsObj.fatherName || null,
          gender: docObj.gender || fieldsObj.gender || null,
          address: docObj.address || fieldsObj.address || null,
          dateOfBirth: docObj.dateOfBirth || fieldsObj.dateOfBirth || fieldsObj.dob || null,
          issueDate: docObj.issueDate || fieldsObj.issueDate || null,
          expiryDate: docObj.expiryDate || fieldsObj.expiryDate || null,
          ...fieldsObj,
        },
      };

      documentContextStr = "\n\nCURRENT DOCUMENT CONTEXT:\n" + JSON.stringify(contextData, null, 2);
    }

    const messagesPayload = [
      { role: 'system', content: SYSTEM_PROMPT + documentContextStr },
    ];

    if (Array.isArray(conversationHistory)) {
      const recentHistory = conversationHistory.slice(-6);
      for (const msg of recentHistory) {
        if (msg.role && msg.content) {
          messagesPayload.push({ role: msg.role, content: String(msg.content) });
        }
      }
    }

    messagesPayload.push({ role: 'user', content: message.trim() });

    const apiKey = process.env.NVIDIA_API_KEY || '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';

    console.log("[Assistant] Sending chat query (User: " + userId + ", DocContext: " + (documentId || 'None') + ")");

    const aiRes = await fetch(NVIDIA_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': "Bearer " + apiKey,
      },
      body: JSON.stringify({
        model: NVIDIA_MODEL,
        messages: messagesPayload,
        temperature: 0.2,
        max_tokens: 1000,
        stream: false,
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      console.warn("[Assistant] NVIDIA API HTTP " + aiRes.status + ": " + errText.substring(0, 200));
      return successResponse(
        res,
        { reply: 'AI Assistant is temporarily unavailable. Please try again.', proposal: null },
        'AI Assistant API Error Fallback'
      );
    }

    const aiData = await aiRes.json();
    const rawReply = aiData?.choices?.[0]?.message?.content || 'I could not generate a response. Please try again.';

    let proposal = null;
    const jsonMatch = rawReply.match(/```jsons*([sS]*?)s*``/) || rawReply.match(/({[sS]*?"type"s*:s*"correction_proposal"[sS]*?})/);

    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[1]);
        if (parsed.type === 'correction_proposal' && parsed.field && parsed.proposedValue) {
          proposal = parsed;
        }
      } catch (jsonErr) {
        console.warn('[Assistant] Failed to parse proposal JSON:', jsonErr.message);
      }
    }

    let cleanReply = rawReply.replace(/```json[sS]*?```/g, '').trim();
    if (!cleanReply && proposal) {
      cleanReply = "I have created a correction proposal to update your document's " + proposal.field + " to \"" + proposal.proposedValue + "\". Please review and confirm the change below.";
    }

    return successResponse(res, {
      reply: cleanReply,
      proposal,
      documentId: documentId || null,
    }, 'Chat response generated');

  } catch (error) {
    console.error('[ASSISTANT_ERROR]', error);
    return successResponse(
      res,
      { reply: 'AI Assistant is temporarily unavailable. Please try again.', proposal: null },
      'AI Assistant System Failure Fallback'
    );
  }
};

module.exports = {
  processChatMessage,
};
