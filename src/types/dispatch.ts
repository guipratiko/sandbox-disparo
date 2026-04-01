/**
 * Tipos e interfaces para o sistema de Disparos
 */

export type TemplateType =
  | 'text'
  | 'image'
  | 'image_caption'
  | 'video'
  | 'video_caption'
  | 'audio'
  | 'file'
  | 'sequence';

// Tipo union para conteúdo de template
export type TemplateContent = 
  | TextTemplateContent
  | ImageTemplateContent
  | VideoTemplateContent
  | AudioTemplateContent
  | FileTemplateContent
  | SequenceTemplateContent;

export interface Template {
  id: string;
  userId: string;
  name: string;
  type: TemplateType;
  content: TemplateContent; // JSONB - estrutura varia por tipo
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateTemplateData {
  userId: string;
  name: string;
  type: TemplateType;
  content: TemplateContent;
}

export interface UpdateTemplateData {
  name?: string;
  content?: TemplateContent;
}

// Estruturas de conteúdo por tipo
export interface TextTemplateContent {
  text: string;
}

export interface ImageTemplateContent {
  imageUrl: string;
  caption?: string;
}

export interface VideoTemplateContent {
  videoUrl: string;
  caption?: string;
}

export interface AudioTemplateContent {
  audioUrl: string;
}

export interface FileTemplateContent {
  fileUrl: string;
  fileName: string;
  mimeType?: string;
}

// Tipos de conteúdo por tipo de step
export type StepContent = 
  | TextTemplateContent
  | ImageTemplateContent
  | VideoTemplateContent
  | AudioTemplateContent
  | FileTemplateContent;

export interface SequenceStep {
  type: 'text' | 'image' | 'image_caption' | 'video' | 'video_caption' | 'audio' | 'file';
  content: StepContent;
  delay: number;
  delayUnit: 'seconds' | 'minutes' | 'hours';
}

export interface SequenceTemplateContent {
  steps: SequenceStep[];
}

export type DispatchStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed';

export interface Dispatch {
  id: string;
  userId: string;
  instanceId: string;
  instanceName: string;
  integration?: string | null;
  phone_number_id?: string | null;
  templateId: string | null;
  name: string;
  status: DispatchStatus;
  settings: DispatchSettings;
  schedule: DispatchSchedule | null;
  contactsData: ContactData[];
  stats: DispatchStats;
  defaultName: string | null;
  userTimezone?: string; // Fuso horário do usuário (salvo ao criar o dispatch)
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
}

export interface DispatchSettings {
  speed: 'fast' | 'normal' | 'slow' | 'randomized';
  autoDelete?: boolean;
  deleteDelay?: number;
  deleteDelayUnit?: 'seconds' | 'minutes' | 'hours';
}

export interface DispatchSchedule {
  startDate?: string; // YYYY-MM-DD
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  suspendedDays: number[]; // 0=domingo, 6=sábado
  timezone?: string; // Fuso horário opcional (ex: 'America/Sao_Paulo')
}

export interface ContactData {
  phone: string;
  name?: string;
  formattedPhone?: string;
  columnId?: string;
}

export interface DispatchStats {
  sent: number;
  failed: number;
  invalid: number;
  total: number;
  /** Número de etapas do template (sequência); omitido ou 1 = disparo “simples”. */
  sequenceStepCount?: number;
  /** Caudas assíncronas (etapas 2+) ainda em execução; só concluir disparo quando 0. */
  pendingSequenceTails?: number;
}

/** Atualização atômica de stats (delta para pendingSequenceTails). */
export type DispatchStatsUpdate = Partial<DispatchStats> & {
  pendingSequenceTailsDelta?: number;
};

export interface CreateDispatchData {
  userId: string;
  instanceId: string;
  instanceName: string;
  integration?: string | null;
  phone_number_id?: string | null;
  templateId?: string | null;
  name: string;
  settings: DispatchSettings;
  schedule?: DispatchSchedule | null;
  contactsData: ContactData[];
  defaultName?: string | null;
  userTimezone?: string; // Fuso horário do usuário
  /** Etapas do template (sequência); padrão 1. */
  sequenceStepCount?: number;
}

export interface UpdateDispatchData {
  name?: string;
  status?: DispatchStatus;
  settings?: DispatchSettings;
  schedule?: DispatchSchedule | null;
  stats?: DispatchStats;
  startedAt?: Date | null;
  completedAt?: Date | null;
  defaultName?: string | null;
}

