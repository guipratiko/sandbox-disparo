/**
 * Scheduler para gerenciar agendamento de disparos
 * Processa disparos diretamente sem usar jobs
 */

import { DispatchService } from '../services/dispatchService';
import { DispatchSchedule } from '../types/dispatch';
import { TemplateService } from '../services/templateService';
import { processContact, calculateDelay } from '../services/dispatchProcessor';
import { pgQuery } from '../config/databases';
import { parseJsonbField } from '../utils/dbHelpers';
import {
  hasStartDatePassed,
  isWithinAllowedHours,
  getScheduleTimezone,
  getWeekdayInTimezone,
} from '../utils/timezoneHelper';
import { DEFAULT_TIMEZONE } from '../config/constants';
import { isDispatchQueueComplete } from '../utils/dispatchQueueComplete';

// Set para rastrear disparos em processamento (evitar processamento duplicado)
// Usa Map com timestamp para limpeza automática de entradas antigas
const processingDispatches = new Map<string, number>();
const PROCESSING_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutos

/**
 * Limpar entradas antigas do Map de processamento
 */
const cleanupOldProcessingEntries = (): void => {
  const now = Date.now();
  for (const [dispatchId, timestamp] of processingDispatches.entries()) {
    if (now - timestamp > PROCESSING_TIMEOUT_MS) {
      processingDispatches.delete(dispatchId);
    }
  }
};

/** Dia da semana no fuso da agenda (não usar getDay() do servidor). */
const isAllowedDay = (schedule: DispatchSchedule, userTimezone: string): boolean => {
  const tz = getScheduleTimezone(schedule, userTimezone);
  const today = getWeekdayInTimezone(new Date(), tz);
  const suspended = schedule.suspendedDays ?? [];
  return !suspended.includes(today);
};

// Funções de verificação movidas para timezoneHelper.ts

/**
 * Processar um disparo - enviar mensagens para todos os contatos
 */
const processDispatch = async (dispatchId: string, userId: string): Promise<void> => {
  try {
    const dispatch = await DispatchService.getById(dispatchId, userId);
    
    if (!dispatch) {
      return;
    }
    
    if (dispatch.status !== 'running') {
      return;
    }

    // Validar instanceName antes de processar
    if (!dispatch.instanceName) {
      await DispatchService.update(dispatchId, dispatch.userId, {
        status: 'failed',
      });
      return;
    }

    // Verificar se há agendamento e se já passou a hora
    if (dispatch.schedule && dispatch.schedule.startDate) {
      const userTimezone = dispatch.userTimezone || DEFAULT_TIMEZONE;
      
      // Verificar se a data/hora de início já passou (considerando timezone)
      if (!hasStartDatePassed(dispatch.schedule, userTimezone)) {
        return;
      }
      
      // Verificar se está dentro do horário permitido (considerando timezone)
      if (!isWithinAllowedHours(dispatch.schedule, userTimezone)) {
        return;
      }
      
      // Verificar se é dia permitido
      if (!isAllowedDay(dispatch.schedule, userTimezone)) {
        return;
      }
    }

    if (isDispatchQueueComplete(dispatch)) {
      await DispatchService.update(dispatchId, dispatch.userId, {
        status: 'completed',
        completedAt: new Date(),
      });
      return;
    }

    if (!dispatch.templateId) {
      return;
    }

    const template = await TemplateService.getById(dispatch.templateId, dispatch.userId);
    if (!template) {
      return;
    }

    const speed = dispatch.settings.speed;
    
    // Processar apenas um contato por vez para evitar duplicação
    // Buscar stats atualizadas para saber qual contato processar
    const currentDispatch = await DispatchService.getById(dispatchId, dispatch.userId);
    if (!currentDispatch || currentDispatch.status !== 'running') {
      return;
    }

    const processedCount = currentDispatch.stats.sent + currentDispatch.stats.failed;

    if (isDispatchQueueComplete(currentDispatch)) {
      await DispatchService.update(dispatchId, dispatch.userId, {
        status: 'completed',
        completedAt: new Date(),
      });
      return;
    }

    if (processedCount >= currentDispatch.stats.total) {
      return;
    }

    // Processar apenas o próximo contato
    if (processedCount < dispatch.contactsData.length) {
      // Verificar novamente as stats ANTES de processar para evitar race condition
      const latestDispatch = await DispatchService.getById(dispatchId, dispatch.userId);
      if (!latestDispatch || latestDispatch.status !== 'running') {
        return;
      }
      
      const latestProcessedCount = latestDispatch.stats.sent + latestDispatch.stats.failed;
      
      // Se o contato já foi processado por outra chamada, não processar novamente
      if (latestProcessedCount > processedCount) {
        return;
      }
      
      // Se o número de processados mudou, usar o valor atualizado
      const actualProcessedCount = latestProcessedCount;
      if (actualProcessedCount >= dispatch.contactsData.length) {
        return;
      }
      
      const contact = dispatch.contactsData[actualProcessedCount];
      
      await processContact(
        dispatchId,
        dispatch.userId,
        dispatch.instanceName,
        dispatch.templateId,
        contact,
        dispatch.defaultName || null,
        dispatch.settings,
        dispatch.integration ?? undefined,
        dispatch.phone_number_id ?? undefined
      );

      // Delay entre mensagens (exceto a última)
      // Para 'randomized', recalcular delay a cada mensagem para gerar novo valor aleatório
      if (actualProcessedCount + 1 < dispatch.contactsData.length) {
        const delay = calculateDelay(speed);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    // Verificar se todos foram processados
    const finalDispatch = await DispatchService.getById(dispatchId, dispatch.userId);
    if (finalDispatch && isDispatchQueueComplete(finalDispatch)) {
      await DispatchService.update(dispatchId, dispatch.userId, {
        status: 'completed',
        completedAt: new Date(),
      });
    }
  } catch (error) {
    console.error(`❌ Erro ao processar disparo ${dispatchId}:`, error);
  }
};

/**
 * Processar disparos agendados e running
 */
export const processScheduledDispatches = async (): Promise<void> => {
  try {
    await runProcessScheduledDispatches();
  } catch (error) {
    console.error('❌ Scheduler: erro ao processar fila de disparos:', error);
  }
};

const runProcessScheduledDispatches = async (): Promise<void> => {
  const scheduledDispatches = await DispatchService.getScheduledDispatches();

  for (const dispatch of scheduledDispatches) {
    try {
      if (!dispatch.schedule) continue;
      
      // Usar timezone salvo no dispatch (ou padrão)
      const userTimezone = dispatch.userTimezone || DEFAULT_TIMEZONE;
      
      // Verificar se a data/hora de início já passou (considerando timezone)
      if (!hasStartDatePassed(dispatch.schedule, userTimezone)) continue;
      if (!isAllowedDay(dispatch.schedule, userTimezone)) continue;

      // Verificar se está dentro do horário permitido (considerando timezone)
      if (!isWithinAllowedHours(dispatch.schedule, userTimezone)) {
        if (dispatch.status === 'running') {
          await DispatchService.update(dispatch.id, dispatch.userId, { status: 'paused' });
        }
        continue;
      }

      if (dispatch.status === 'paused') {
        await DispatchService.update(dispatch.id, dispatch.userId, { status: 'running' });
      }

      if (dispatch.status === 'pending') {
        await DispatchService.update(dispatch.id, dispatch.userId, {
          status: 'running',
          startedAt: new Date(),
        });
      }
    } catch (error) {
      // Ignorar erros individuais
    }
  }

  // Processar disparos 'running' (incluindo os que têm agendamento)
  // Buscar apenas disparos 'running' que não têm agendamento OU já passou a hora agendada
  // IMPORTANTE: Selecionar explicitamente instance_name para garantir que está disponível
  
  // Limpar entradas antigas do Map de processamento
  cleanupOldProcessingEntries();
  
  const runningDispatches = await pgQuery(
    `SELECT id, user_id, instance_id, instance_name, template_id, name, status, 
            settings, schedule, contacts_data, stats, default_name, user_timezone,
            created_at, updated_at, started_at, completed_at 
     FROM dispatches WHERE status = 'running'`
  );

  for (const row of runningDispatches.rows) {
    try {
      // Buscar dispatch completo (inclui userTimezone)
      const dispatch = await DispatchService.getById(row.id, row.user_id);
      if (!dispatch) {
        continue;
      }

      // Validar instanceName antes de processar
      if (!dispatch.instanceName) {
        await DispatchService.update(dispatch.id, dispatch.userId, {
          status: 'failed',
        });
        continue;
      }

      // Se tem agendamento, verificar se já passou a hora antes de processar
      if (dispatch.schedule && dispatch.schedule.startDate) {
        const userTimezone = dispatch.userTimezone || DEFAULT_TIMEZONE;
        
        // Verificar se a data/hora de início já passou (considerando timezone)
        if (!hasStartDatePassed(dispatch.schedule, userTimezone)) {
          continue;
        }
        
        // Verificar se está dentro do horário permitido (considerando timezone)
        if (!isWithinAllowedHours(dispatch.schedule, userTimezone)) {
          continue;
        }
        
        // Verificar se é dia permitido
        if (!isAllowedDay(dispatch.schedule, userTimezone)) {
          continue;
        }
      }

      if (isDispatchQueueComplete(dispatch)) {
        await DispatchService.update(dispatch.id, dispatch.userId, {
          status: 'completed',
          completedAt: new Date(),
        });
        continue;
      }

      const processedCount = dispatch.stats.sent + dispatch.stats.failed;
      if (processedCount >= dispatch.stats.total) {
        continue;
      }

      // Verificar se já está sendo processado antes de chamar processDispatch
      // Usar verificação atômica para evitar race condition
      if (processingDispatches.has(dispatch.id)) {
        continue;
      }

      // Adicionar ao Map ANTES de chamar processDispatch para evitar race condition
      processingDispatches.set(dispatch.id, Date.now());

      // Processar disparo em background (não await para não bloquear)
      // IMPORTANTE: Garantir remoção no finally para evitar memory leak
      processDispatch(dispatch.id, dispatch.userId)
        .finally(() => {
          // Sempre remover do Map, mesmo em caso de erro
          processingDispatches.delete(dispatch.id);
        })
        .catch((error) => {
          console.error(`❌ Scheduler: Erro ao processar disparo ${dispatch.id}:`, error);
        });
    } catch (error) {
      console.error(`❌ Erro ao processar disparo ${row.id}:`, error);
    }
  }
};

/**
 * Retomar disparos em andamento após reinicialização do serviço
 * Esta função é chamada na inicialização para garantir que disparos que estavam
 * sendo processados quando o serviço foi reiniciado sejam retomados
 */
export const resumeInProgressDispatches = async (): Promise<void> => {
  try {
    // Buscar todos os disparos com status 'running' que não foram concluídos
    const runningDispatches = await pgQuery(
      `SELECT id, user_id, instance_id, instance_name, template_id, name, status, 
              settings, schedule, contacts_data, stats, default_name, user_timezone,
              created_at, updated_at, started_at, completed_at 
       FROM dispatches 
       WHERE status = 'running' 
       AND (stats->>'sent')::int + (stats->>'failed')::int < (stats->>'total')::int`
    );

    for (const row of runningDispatches.rows) {
      try {
        // Buscar dispatch completo
        const dispatch = await DispatchService.getById(row.id, row.user_id);
        if (!dispatch) {
          continue;
        }

        const processedCount = dispatch.stats.sent + dispatch.stats.failed;

        // Verificar se o disparo ainda está válido para processar
        if (isDispatchQueueComplete(dispatch)) {
          await DispatchService.update(dispatch.id, dispatch.userId, {
            status: 'completed',
            completedAt: new Date(),
          });
          continue;
        }

        if (processedCount >= dispatch.stats.total) {
          continue;
        }

        // Validar instanceName
        if (!dispatch.instanceName) {
          await DispatchService.update(dispatch.id, dispatch.userId, {
            status: 'failed',
          });
          continue;
        }

        // Verificar se tem agendamento e se ainda é válido
        if (dispatch.schedule && dispatch.schedule.startDate) {
          const userTimezone = dispatch.userTimezone || DEFAULT_TIMEZONE;
          
          // Se ainda não passou a hora, manter como 'running' e aguardar
          if (!hasStartDatePassed(dispatch.schedule, userTimezone)) {
            continue;
          }
          
          // Se está fora do horário permitido, pausar
          if (!isWithinAllowedHours(dispatch.schedule, userTimezone)) {
            await DispatchService.update(dispatch.id, dispatch.userId, { status: 'paused' });
            continue;
          }
          
          // Verificar se é dia permitido
          if (!isAllowedDay(dispatch.schedule, userTimezone)) {
            await DispatchService.update(dispatch.id, dispatch.userId, { status: 'paused' });
            continue;
          }
        }
      } catch (error) {
        console.error(`❌ Erro ao retomar disparo ${row.id}:`, error);
      }
    }
  } catch (error) {
    console.error(`❌ Erro ao verificar disparos em andamento:`, error);
  }
};

/**
 * Iniciar scheduler
 */
export const startScheduler = async (): Promise<void> => {
  // Primeiro, retomar disparos em andamento
  await resumeInProgressDispatches();
  
  // Depois, processar disparos agendados e running normalmente
  await processScheduledDispatches();

  // Limpar entradas antigas periodicamente (a cada 5 minutos)
  setInterval(() => {
    cleanupOldProcessingEntries();
  }, 5 * 60 * 1000);

  setInterval(() => {
    void processScheduledDispatches();
  }, 1000); // Verificar a cada 1 segundo
};
