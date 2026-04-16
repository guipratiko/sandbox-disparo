/**
 * Processador de disparos - processa mensagens diretamente sem jobs
 */

import { requestEvolutionAPI } from '../utils/evolutionAPI';
import { sendViaOficialAPI } from '../utils/oficialAPI';
import { replaceVariablesInContent } from '../utils/variableReplacer';
import { ensureNormalizedPhone } from '../utils/numberNormalizer';
import { TemplateService } from './templateService';
import { DispatchService } from './dispatchService';
import { ContactData, SequenceStep, DispatchSettings } from '../types/dispatch';
import { registerDispatchCrmOutboundSuppress } from './dispatchCrmSuppressRegistration';

async function maybeRegisterOutboundCrmSuppress(
  instanceId: string | undefined,
  messageId: string | undefined,
  settings: DispatchSettings
): Promise<void> {
  if (!instanceId?.trim() || !messageId?.trim()) return;
  if (settings.showMessagesInCrmChat !== false) return;
  await registerDispatchCrmOutboundSuppress(instanceId.trim(), messageId.trim());
}

type OfficialContext = { integration: string; phone_number_id: string } | undefined;

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
  text: string,
  official?: OfficialContext
): Promise<SendResult> => {
  if (official?.integration === 'WHATSAPP-CLOUD' && official?.phone_number_id) {
    return sendViaOficialAPI(official.phone_number_id, remoteJid, { text });
  }
  const number = cleanPhoneForEvolutionAPI(remoteJid);
  const response = await requestEvolutionAPI(
    'POST',
    `/message/sendText/${encodeURIComponent(instanceName)}`,
    { number, text }
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
  caption?: string,
  official?: OfficialContext
): Promise<SendResult> => {
  if (official?.integration === 'WHATSAPP-CLOUD' && official?.phone_number_id) {
    return sendViaOficialAPI(official.phone_number_id, remoteJid, { image: imageUrl, caption });
  }
  const number = cleanPhoneForEvolutionAPI(remoteJid);
  const response = await requestEvolutionAPI(
    'POST',
    `/message/sendMedia/${encodeURIComponent(instanceName)}`,
    { number, mediatype: 'image', media: imageUrl, caption: caption || '' }
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
  caption?: string,
  official?: OfficialContext
): Promise<SendResult> => {
  if (official?.integration === 'WHATSAPP-CLOUD' && official?.phone_number_id) {
    return sendViaOficialAPI(official.phone_number_id, remoteJid, { video: videoUrl, caption });
  }
  const number = cleanPhoneForEvolutionAPI(remoteJid);
  const response = await requestEvolutionAPI(
    'POST',
    `/message/sendMedia/${encodeURIComponent(instanceName)}`,
    { number, mediatype: 'video', media: videoUrl, caption: caption || '' }
  );
  return extractSendResult(response, remoteJid);
};

/**
 * Enviar áudio
 */
const sendAudioMessage = async (
  instanceName: string,
  remoteJid: string,
  audioUrl: string,
  official?: OfficialContext
): Promise<SendResult> => {
  if (official?.integration === 'WHATSAPP-CLOUD' && official?.phone_number_id) {
    return sendViaOficialAPI(official.phone_number_id, remoteJid, { audio: audioUrl });
  }
  const number = cleanPhoneForEvolutionAPI(remoteJid);
  const response = await requestEvolutionAPI(
    'POST',
    `/message/sendWhatsAppAudio/${encodeURIComponent(instanceName)}`,
    { number, audio: audioUrl }
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
  fileName: string,
  official?: OfficialContext
): Promise<SendResult> => {
  if (official?.integration === 'WHATSAPP-CLOUD' && official?.phone_number_id) {
    return sendViaOficialAPI(official.phone_number_id, remoteJid, { document: fileUrl, fileName });
  }
  const number = cleanPhoneForEvolutionAPI(remoteJid);
  const response = await requestEvolutionAPI(
    'POST',
    `/message/sendMedia/${encodeURIComponent(instanceName)}`,
    { number, mediatype: 'document', media: fileUrl, fileName }
  );
  return extractSendResult(response, remoteJid);
};

/** Converte o delay configurado na etapa (antes do envio da própria etapa) em ms */
const stepDelayBeforeSendMs = (step: SequenceStep): number => {
  let delayMs = step.delay * 1000;
  if (step.delayUnit === 'minutes') {
    delayMs = step.delay * 60 * 1000;
  } else if (step.delayUnit === 'hours') {
    delayMs = step.delay * 60 * 60 * 1000;
  }
  return delayMs;
};

/**
 * Etapas 2+ da sequência rodam em background: não bloqueiam o próximo contato do disparo.
 * - Ritmo **entre contatos** continua sendo só a velocidade do disparo (fast/normal/slow/randomized) no scheduler.
 * - Ritmo **entre etapas** da sequência usa apenas os delays configurados em cada etapa do template (sem somar jitter randomized por etapa).
 */
const runSequenceTailAsync = async (params: {
  dispatchId: string;
  userId: string;
  instanceName: string;
  instanceId: string;
  steps: SequenceStep[];
  startIndex: number;
  normalizedContact: ContactData;
  defaultName?: string;
  official: OfficialContext;
  settings: DispatchSettings;
  initialRemoteJid: string;
  initialLastResult: SendResult;
}): Promise<void> => {
  let lastResult: SendResult = params.initialLastResult;

  for (let i = params.startIndex; i < params.steps.length; i++) {
    const dispatch = await DispatchService.getById(params.dispatchId, params.userId);
    if (!dispatch || dispatch.status !== 'running') {
      console.log(
        `[sequence tail] interrompido (dispatch ${params.dispatchId} status=${dispatch?.status ?? 'não encontrado'})`
      );
      return;
    }

    const step = params.steps[i];
    const templateDelayMs = stepDelayBeforeSendMs(step);
    if (templateDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, templateDelayMs));
    }

    const stepRemoteJid = lastResult?.remoteJid || params.initialRemoteJid;

    try {
      lastResult = await retryWithBackoff(() =>
        processSequenceStep(
          params.instanceName,
          stepRemoteJid,
          step,
          params.normalizedContact,
          params.defaultName,
          params.official
        )
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`❌ [sequence tail] etapa ${i + 1} falhou (dispatch ${params.dispatchId}):`, msg);
      return;
    }

    await maybeRegisterOutboundCrmSuppress(
      params.instanceId,
      lastResult.messageId,
      params.settings
    );

    if (params.settings.autoDelete && lastResult.messageId && params.settings.deleteDelay) {
      const unit = params.settings.deleteDelayUnit;
      const deleteDelayMs = calculateDeleteDelay(
        params.settings.deleteDelay,
        unit === 'seconds' || unit === 'minutes' || unit === 'hours' ? unit : undefined
      );
      const mid = lastResult.messageId;
      const rjid = lastResult.remoteJid;
      const iname = params.instanceName;
      setTimeout(async () => {
        try {
          await deleteMessage(iname, rjid, mid);
        } catch (err) {
          console.error(`❌ Erro ao deletar mensagem ${mid} (sequence tail):`, err);
        }
      }, deleteDelayMs);
    }
  }
};

/**
 * Processar uma etapa de sequência
 */
const processSequenceStep = async (
  instanceName: string,
  remoteJid: string,
  step: SequenceStep,
  contact: ContactData,
  defaultName?: string,
  official?: OfficialContext
): Promise<SendResult> => {
  const personalizedContent = replaceVariablesInContent(step.content, contact, defaultName || 'Cliente');

  switch (step.type) {
    case 'text':
      return await sendTextMessage(instanceName, remoteJid, personalizedContent.text, official);
    case 'image':
      return await sendImageMessage(instanceName, remoteJid, personalizedContent.imageUrl, undefined, official);
    case 'image_caption':
      return await sendImageMessage(instanceName, remoteJid, personalizedContent.imageUrl, personalizedContent.caption, official);
    case 'video':
      return await sendVideoMessage(instanceName, remoteJid, personalizedContent.videoUrl, undefined, official);
    case 'video_caption':
      return await sendVideoMessage(instanceName, remoteJid, personalizedContent.videoUrl, personalizedContent.caption, official);
    case 'audio':
      return await sendAudioMessage(instanceName, remoteJid, personalizedContent.audioUrl, official);
    case 'file':
      return await sendFileMessage(instanceName, remoteJid, personalizedContent.fileUrl, personalizedContent.fileName, official);
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
  settings: DispatchSettings,
  integration?: string | null,
  phone_number_id?: string | null
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
    const official: OfficialContext =
      integration === 'WHATSAPP-CLOUD' && phone_number_id
        ? { integration, phone_number_id }
        : undefined;

    const du = settings.deleteDelayUnit;
    const dispatchSettings: DispatchSettings = {
      speed: settings.speed as DispatchSettings['speed'],
      autoDelete: settings.autoDelete,
      deleteDelay: settings.deleteDelay,
      deleteDelayUnit:
        du === 'seconds' || du === 'minutes' || du === 'hours' ? du : undefined,
      showMessagesInCrmChat: settings.showMessagesInCrmChat,
    };

    /** Sequência: 1ª etapa bloqueia o disparo (inclui delay configurado nela); demais etapas em background */
    if (template.type === 'sequence') {
      const steps = personalizedContent.steps as SequenceStep[] | undefined;
      if (!steps?.length) {
        await DispatchService.updateStats(dispatchId, userId, { failed: 1 });
        return { success: false, error: 'Sequência sem etapas' };
      }

      const firstStep = steps[0];
      const firstDelayMs = stepDelayBeforeSendMs(firstStep);
      if (firstDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, firstDelayMs));
      }

      const dispatchAfterFirstDelay = await DispatchService.getById(dispatchId, userId);
      if (!dispatchAfterFirstDelay || dispatchAfterFirstDelay.status !== 'running') {
        await DispatchService.updateStats(dispatchId, userId, { failed: 1 });
        return {
          success: false,
          error: 'Disparo interrompido antes da 1ª etapa (pausado ou cancelado)',
        };
      }

      try {
        sendResult = await retryWithBackoff(() =>
          processSequenceStep(
            instanceName,
            remoteJid,
            firstStep,
            normalizedContact,
            defaultName || undefined,
            official
          )
        );
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Erro desconhecido ao enviar mensagem';
        console.error(
          `❌ processContact: Erro na 1ª etapa da sequência após ${MAX_RETRY_ATTEMPTS} tentativas:`,
          errorMessage
        );
        await DispatchService.updateStats(dispatchId, userId, { failed: 1 });
        return { success: false, error: errorMessage };
      }

      const messageId = sendResult.messageId;
      const realRemoteJid = sendResult.remoteJid || remoteJid;

      await maybeRegisterOutboundCrmSuppress(dispatch.instanceId, messageId, dispatchSettings);
      await DispatchService.updateStats(dispatchId, userId, { sent: 1 });

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

      if (steps.length > 1) {
        await DispatchService.updateStats(dispatchId, userId, { pendingSequenceTailsDelta: 1 });
        void runSequenceTailAsync({
          dispatchId,
          userId,
          instanceName,
          instanceId: dispatch.instanceId,
          steps,
          startIndex: 1,
          normalizedContact,
          defaultName: defaultName || undefined,
          official,
          settings: dispatchSettings,
          initialRemoteJid: remoteJid,
          initialLastResult: sendResult,
        })
          .catch((err) => console.error('❌ [sequence tail] não tratado:', err))
          .finally(async () => {
            try {
              await DispatchService.updateStats(dispatchId, userId, { pendingSequenceTailsDelta: -1 });
              await DispatchService.tryFinalizeIfComplete(dispatchId, userId);
            } catch (e) {
              console.error('❌ [sequence tail] erro ao finalizar stats/disparo:', e);
            }
          });
      }

      return { success: true, messageId };
    }

    const sendMessageWithRetry = async (): Promise<SendResult> => {
      switch (template.type) {
        case 'text':
          return await sendTextMessage(instanceName, remoteJid, personalizedContent.text, official);

        case 'image':
          return await sendImageMessage(instanceName, remoteJid, personalizedContent.imageUrl, undefined, official);

        case 'image_caption':
          return await sendImageMessage(instanceName, remoteJid, personalizedContent.imageUrl, personalizedContent.caption, official);

        case 'video':
          return await sendVideoMessage(instanceName, remoteJid, personalizedContent.videoUrl, undefined, official);

        case 'video_caption':
          return await sendVideoMessage(instanceName, remoteJid, personalizedContent.videoUrl, personalizedContent.caption, official);

        case 'audio':
          return await sendAudioMessage(instanceName, remoteJid, personalizedContent.audioUrl, official);

        case 'file':
          return await sendFileMessage(instanceName, remoteJid, personalizedContent.fileUrl, personalizedContent.fileName, official);

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

    await maybeRegisterOutboundCrmSuppress(dispatch.instanceId, messageId, settings);
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
