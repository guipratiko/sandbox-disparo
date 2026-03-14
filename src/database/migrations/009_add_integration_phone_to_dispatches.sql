-- Migration: Adicionar integration e phone_number_id para suporte à API Oficial (WhatsApp Cloud)
ALTER TABLE dispatches
  ADD COLUMN IF NOT EXISTS integration VARCHAR(50),
  ADD COLUMN IF NOT EXISTS phone_number_id VARCHAR(100);

COMMENT ON COLUMN dispatches.integration IS 'Tipo de integração: WHATSAPP-BAILEYS (Evolution) ou WHATSAPP-CLOUD (Meta)';
COMMENT ON COLUMN dispatches.phone_number_id IS 'ID do número no Meta (apenas para WHATSAPP-CLOUD)';
