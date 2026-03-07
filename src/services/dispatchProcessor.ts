/**
 * Processador de disparos - processa mensagens diretamente sem jobs
 */

import { requestEvolutionAPI } from '../utils/evolutionAPI';
import { replaceVariablesInContent } from '../utils/variableReplacer';
import { ensureNormalizedPhone } from '../utils/numberNormalizer';
import { TemplateService } from './templateService';
import { DispatchService } from './dispatchService';
import { ContactData } from '../types/dispatch';

// Número máximo de tentativas para retry
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1000; // 1 segundo

/**
 * Calcular delay baseado na velocidade
 * Valores ajustados para anti-detecção do WhatsApp
 */
export const calculateDelay = (speed: string): number => {
  switch (speed) {
    case 'fast':
      return 1000; // 1 segundo - Para listas pequenas
    case 'normal':
      return 30000; // 30 segundos - Recomendado
    case 'slow':
      return 60000; // 1 minuto - Mais seguro
    case 'randomized':
      // Randomized: 55-85 segundos (Anti-detection)
      // Amplitude: 85 - 55 = 30 segundos = 30000ms
      // Gera um valor aleatório entre 55 e 85 segundos
      return Math.floor(Math.random() * 30000) + 55000; // 55-85 segundos (55000-85000ms)
    default:
      return 30000; // Default: normal (30 segundos)
  }
};

/**
 * Converter número para remoteJid
 */
const phoneToRemoteJid = (phone: string): string => {
  if (phone.includes('@')) {
    return phone;
  }
  return `${phone}@s.whatsapp.net`;
};

/**
 * Remover @s.whatsapp.net do número para usar na Evolution API
 */
const cleanPhoneForEvolutionAPI = (remoteJid: string): string => {
  return remoteJid.replace('@s.whatsapp.net', '');
};

/**
 * Deletar mensagem via Evolution API
 */
const deleteMessage = async (
  instanceName: string,
  remoteJid: string,
  messageId: string
): Promise<void> => {
  await requestEvolutionAPI(
    'DELETE',
    `/chat/deleteMessageForEveryone/${encodeURIComponent(instanceName)}`,
    {
      id: messageId,
      remoteJid: remoteJid,
      fromMe: true,
    }
  );
};

/**
 * Interface para retorno das funções de envio
 */
interface SendResult {
  messageId: string;
  remoteJid: string; // remoteJid real retornado pela Evolution API
}

/**
 * Extrair messageId e remoteJid da resposta da Evolution API
 */
const extractSendResult = (response: any, fallbackRemoteJid: string): SendResult => {
  const responseData = response?.data || response;
  const messageId = responseData?.key?.id || responseData?.messageId;
  const realRemoteJid = responseData?.key?.remoteJid || fallbackRemoteJid;
  
  if (!messageId) {
    throw new Error('Não foi possível obter messageId válido da Evolution API');
  }

  return { messageId, remoteJid: realRemoteJid };
};

/**
 * Enviar mensagem de texto
 */
const sendTextMessage = async (
  instanceName: string,
  remoteJid: string,
  text: string
): Promise<SendResult> => {
  const number = cleanPhoneForEvolutionAPI(remoteJid);
  
  const response = await requestEvolutionAPI(
    'POST',
    `/message/sendText/${encodeURIComponent(instanceName)}`,
    {
      number: number,
      text,
    }
  );

  return extractSendResult(response, remoteJid);
};

/**
 * Enviar imagem
 */
const sendImageMessage = async (
  instanceName: string,
  remoteJid: string,
  imageUrl: string,
  caption?: string
): Promise<SendResult> => {
  const number = cleanPhoneForEvolutionAPI(remoteJid);
  
  const response = await requestEvolutionAPI(
    'POST',
    `/message/sendMedia/${encodeURIComponent(instanceName)}`,
    {
      number: number,
      mediatype: 'image',
      media: imageUrl,
      caption: caption || '',
    }
  );

  return extractSendResult(response, remoteJid);
};

/**
 * Enviar vídeo
 */
const sendVideoMessage = async (
  instanceName: string,
  remoteJid: string,
  videoUrl: string,
  caption?: string
): Promise<SendResult> => {
  const number = cleanPhoneForEvolutionAPI(remoteJid);
  
  const response = await requestEvolutionAPI(
    'POST',
    `/message/sendMedia/${encodeURIComponent(instanceName)}`,
    {
      number: number,
      mediatype: 'video',
      media: videoUrl,
      caption: caption || '',
    }
  );

  return extractSendResult(response, remoteJid);
};

/**
 * Enviar áudio (usa sendWhatsAppAudio - mesmo endpoint do CRM/Postman, suporta .ogg)
 */
const sendAudioMessage = async (
  instanceName: string,
  remoteJid: string,
  audioUrl: string
): Promise<SendResult> => {
  const number = cleanPhoneForEvolutionAPI(remoteJid);

  const response = await requestEvolutionAPI(
    'POST',
    `/message/sendWhatsAppAudio/${encodeURIComponent(instanceName)}`,
    {
      number,
      audio: audioUrl,
    }
  );

  return extractSendResult(response, remoteJid);
};

/**
 * Enviar arquivo
 */
const sendFileMessage = async (
  instanceName: string,
  remoteJid: string,
  fileUrl: string,
  fileName: string
): Promise<SendResult> => {
  const number = cleanPhoneForEvolutionAPI(remoteJid);
  
  const response = await requestEvolutionAPI(
    'POST',
    `/message/sendMedia/${encodeURIComponent(instanceName)}`,
    {
      number: number,
      mediatype: 'document',
      media: fileUrl,
      fileName,
    }
  );

  return extractSendResult(response, remoteJid);
};

/**
 * Processar uma etapa de sequência
 */
import { SequenceStep } from '../types/dispatch';

const processSequenceStep = async (
  instanceName: string,
  remoteJid: string,
  step: SequenceStep,
  contact: ContactData,
  defaultName?: string
): Promise<SendResult> => {
  const personalizedContent = replaceVariablesInContent(step.content, contact, defaultName || 'Cliente');

  switch (step.type) {
    case 'text':
      return await sendTextMessage(instanceName, remoteJid, personalizedContent.text);
    case 'image':
      return await sendImageMessage(instanceName, remoteJid, personalizedContent.imageUrl);
    case 'image_caption':
      return await sendImageMessage(instanceName, remoteJid, personalizedContent.imageUrl, personalizedContent.caption);
    case 'video':
      return await sendVideoMessage(instanceName, remoteJid, personalizedContent.videoUrl);
    case 'video_caption':
      return await sendVideoMessage(instanceName, remoteJid, personalizedContent.videoUrl, personalizedContent.caption);
    case 'audio':
      return await sendAudioMessage(instanceName, remoteJid, personalizedContent.audioUrl);
    case 'file':
      return await sendFileMessage(instanceName, remoteJid, personalizedContent.fileUrl, personalizedContent.fileName);
    default:
      throw new Error(`Tipo de etapa não suportado: ${step.type}`);
  }
};

/**
 * Calcular delay de delete em milissegundos
 */
const calculateDeleteDelay = (deleteDelay: number, deleteDelayUnit?: string): number => {
  if (!deleteDelay) return 0;
  
  switch (deleteDelayUnit) {
    case 'seconds':
      return deleteDelay * 1000;
    case 'minutes':
      return deleteDelay * 60 * 1000;
    case 'hours':
      return deleteDelay * 60 * 60 * 1000;
    default:
      return deleteDelay * 1000;
  }
};

/**
 * Retry com backoff exponencial
 */
const retryWithBackoff = async <T>(
  fn: () => Promise<T>,
  maxAttempts: number = MAX_RETRY_ATTEMPTS,
  delay: number = RETRY_DELAY_MS
): Promise<T> => {
  let lastError: Error | unknown;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      
      // Se não for o último attempt, aguardar antes de tentar novamente
      if (attempt < maxAttempts) {
        const backoffDelay = delay * Math.pow(2, attempt - 1);
        await new Promise(resolve => setTimeout(resolve, backoffDelay));
      }
    }
  }
  
  throw lastError;
};

/**
 * Processar um contato de um disparo
 */
export const processContact = async (
  dispatchId: string,
  userId: string,
  instanceName: string,
  templateId: string,
  contact: ContactData,
  defaultName: string | null,
  settings: { speed: string; autoDelete?: boolean; deleteDelay?: number; deleteDelayUnit?: string }
): Promise<{ success: boolean; error?: string; messageId?: string }> => {
  try {
    // Validar instanceName
    if (!instanceName) {
      console.error(`❌ processContact: instanceName não fornecido para disparo ${dispatchId}`);
      await DispatchService.updateStats(dispatchId, userId, { failed: 1 });
      return { success: false, error: 'InstanceName não fornecido' };
    }

    const dispatch = await DispatchService.getById(dispatchId, userId);
    if (!dispatch) {
      return { success: false, error: 'Disparo não encontrado' };
    }

    if (dispatch.status !== 'running') {
      return { success: false, error: 'Disparo não está em execução' };
    }

    const normalizedPhone = ensureNormalizedPhone(contact.phone) || contact.phone;
    const formattedPhone = contact.formattedPhone 
      ? ensureNormalizedPhone(contact.formattedPhone) || contact.formattedPhone
      : normalizedPhone;

    const normalizedContact: ContactData = {
      phone: normalizedPhone,
      name: contact.name,
      formattedPhone,
    };

    const template = await TemplateService.getById(templateId, userId);
    if (!template) {
      return { success: false, error: 'Template não encontrado' };
    }

    const personalizedContent = replaceVariablesInContent(
      template.content,
      normalizedContact,
      defaultName || 'Cliente'
    );

    const remoteJid = phoneToRemoteJid(formattedPhone);
    let sendResult: SendResult | undefined;

    // Função para enviar mensagem com retry
    const sendMessageWithRetry = async (): Promise<SendResult> => {
      switch (template.type) {
        case 'text':
          return await sendTextMessage(instanceName, remoteJid, personalizedContent.text);

        case 'image':
          return await sendImageMessage(instanceName, remoteJid, personalizedContent.imageUrl);

        case 'image_caption':
          return await sendImageMessage(instanceName, remoteJid, personalizedContent.imageUrl, personalizedContent.caption);

        case 'video':
          return await sendVideoMessage(instanceName, remoteJid, personalizedContent.videoUrl);

        case 'video_caption':
          return await sendVideoMessage(instanceName, remoteJid, personalizedContent.videoUrl, personalizedContent.caption);

        case 'audio':
          return await sendAudioMessage(instanceName, remoteJid, personalizedContent.audioUrl);

        case 'file':
          return await sendFileMessage(instanceName, remoteJid, personalizedContent.fileUrl, personalizedContent.fileName);

        case 'sequence':
          let lastResult: SendResult | undefined;
          
          for (const step of personalizedContent.steps) {
            let delayMs = step.delay * 1000;
            if (step.delayUnit === 'minutes') {
              delayMs = step.delay * 60 * 1000;
            } else if (step.delayUnit === 'hours') {
              delayMs = step.delay * 60 * 60 * 1000;
            }
            
            if (delayMs > 0) {
              await new Promise(resolve => setTimeout(resolve, delayMs));
            }

            const stepRemoteJid = lastResult?.remoteJid || remoteJid;
            lastResult = await processSequenceStep(
              instanceName,
              stepRemoteJid,
              step,
              normalizedContact,
              defaultName || undefined
            );
          }
          if (!lastResult) {
            throw new Error('Falha ao processar sequência de mensagens');
          }
          return lastResult;

        default:
          throw new Error(`Tipo de template não suportado: ${template.type}`);
      }
    };

    // Tentar enviar com retry para falhas temporárias
    try {
      sendResult = await retryWithBackoff(sendMessageWithRetry);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido ao enviar mensagem';
      console.error(`❌ processContact: Erro ao enviar mensagem após ${MAX_RETRY_ATTEMPTS} tentativas:`, errorMessage);
      await DispatchService.updateStats(dispatchId, userId, { failed: 1 });
      return { success: false, error: errorMessage };
    }

    const messageId = sendResult?.messageId;
    const realRemoteJid = sendResult?.remoteJid || remoteJid;

    await DispatchService.updateStats(dispatchId, userId, { sent: 1 });

    // AutoDelete: usar realRemoteJid (retornado pela Evolution API)
    if (settings.autoDelete && messageId && settings.deleteDelay) {
      const deleteDelayMs = calculateDeleteDelay(settings.deleteDelay, settings.deleteDelayUnit);
      
      setTimeout(async () => {
        try {
          await deleteMessage(instanceName, realRemoteJid, messageId);
        } catch (error) {
          console.error(`❌ Erro ao deletar mensagem ${messageId}:`, error);
        }
      }, deleteDelayMs);
    }

    return { success: true, messageId };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    console.error(`❌ processContact: Erro inesperado ao processar contato:`, errorMessage);
    await DispatchService.updateStats(dispatchId, userId, { failed: 1 });
    return { success: false, error: errorMessage };
  }
};
