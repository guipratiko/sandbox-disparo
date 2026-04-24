/**
 * Helper para buscar informações do usuário do backend principal
 */

import axios from 'axios';
import { DEFAULT_TIMEZONE } from '../config/constants';
import {
  getOnlyflowBackendBaseUrl,
  ONLYFLOW_BACKEND_HTTP_TIMEOUT_MS,
  onlyflowBackendAuthHeaders,
} from './onlyflowBackendUrl';

/**
 * Buscar timezone do usuário do backend principal
 */
export const getUserTimezone = async (userId: string, token?: string): Promise<string> => {
  try {
    const response = await axios.get(`${getOnlyflowBackendBaseUrl()}/api/auth/me`, {
      headers: onlyflowBackendAuthHeaders(token),
      timeout: ONLYFLOW_BACKEND_HTTP_TIMEOUT_MS,
    });

    if (response.data && response.data.user && response.data.user.timezone) {
      return response.data.user.timezone;
    }
  } catch (error) {
    // Silenciar erro - usar padrão
  }

  return DEFAULT_TIMEZONE;
};

