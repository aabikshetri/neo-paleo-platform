CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- Slowest normalized statements by total execution time.
SELECT calls,
       round(total_exec_time::numeric, 2) AS total_ms,
       round(mean_exec_time::numeric, 2) AS mean_ms,
       rows,
       left(query, 180) AS query
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 25;
