-- Cover the repair-log foreign key lookup without exposing its private records.
create index if not exists spv_followup_context_repair_log_followup_idx
  on private.spv_followup_context_repair_log(followup_id);
