-- Preenche sequenceStepCount / pendingSequenceTails em disparos antigos com template em sequência
-- (necessário para não marcar completed antes das etapas 2+).

UPDATE dispatches d
SET stats = jsonb_set(
  jsonb_set(
    COALESCE(d.stats, '{}'::jsonb),
    '{sequenceStepCount}',
    to_jsonb(GREATEST(1, jsonb_array_length(t.content->'steps')))
  ),
  '{pendingSequenceTails}',
  to_jsonb(COALESCE((d.stats->>'pendingSequenceTails')::int, 0))
)
FROM templates t
WHERE d.template_id = t.id
  AND t.type = 'sequence'
  AND jsonb_typeof(t.content->'steps') = 'array'
  AND (d.stats->'sequenceStepCount') IS NULL;
