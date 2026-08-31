-- Bật cầu Task→PR (materialize) qua SystemConfig (đảo ngược: đổi 'true'→'false').
INSERT INTO system_config (key, value, updated_at)
VALUES ('ff_pr_materialize', 'true', NOW())
ON CONFLICT (key) DO UPDATE SET value = 'true', updated_at = NOW();
