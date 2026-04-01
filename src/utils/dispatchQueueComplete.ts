import { Dispatch, DispatchStats } from '../types/dispatch';

/** Primeira onda: um “slot” por contato (sent/failed após 1ª etapa ou único envio). */
export function isFirstWaveComplete(stats: DispatchStats): boolean {
  return stats.sent + stats.failed >= stats.total;
}

/**
 * Disparo totalmente concluído para efeito de status `completed`.
 * Em sequência com mais de uma etapa, exige também `pendingSequenceTails === 0`.
 */
export function isDispatchQueueComplete(dispatch: Dispatch): boolean {
  if (!isFirstWaveComplete(dispatch.stats)) {
    return false;
  }
  const steps = dispatch.stats.sequenceStepCount ?? 1;
  if (steps > 1) {
    return (dispatch.stats.pendingSequenceTails ?? 0) === 0;
  }
  return true;
}
