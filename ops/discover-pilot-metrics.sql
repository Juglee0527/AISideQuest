-- Task 33 input. Bind $1 = inclusive UTC start and $2 = exclusive UTC end.
-- The interval must be seven consecutive UTC dates. Reporting timezone is UTC.
WITH
session_users AS (
  SELECT DISTINCT user_id
  FROM ai_sessions
  WHERE started_at >= $1::timestamptz AND started_at < $2::timestamptz
),
events AS (
  SELECT user_id, event_name, source, category, occurred_at
  FROM discover_analytics_events
  WHERE occurred_at >= $1::timestamptz AND occurred_at < $2::timestamptz
    AND expires_at > clock_timestamp()
),
visitors AS (
  SELECT DISTINCT user_id FROM events WHERE event_name = 'DISCOVER_VIEW'
),
clickers AS (
  SELECT DISTINCT user_id FROM events WHERE event_name = 'OUTBOUND_CLICK'
),
savers AS (
  SELECT DISTINCT user_id FROM events WHERE event_name = 'SAVE'
),
repeat_visitors AS (
  SELECT user_id
  FROM events
  WHERE event_name = 'DISCOVER_VIEW'
  GROUP BY user_id
  HAVING count(DISTINCT (occurred_at AT TIME ZONE 'UTC')::date) >= 2
)
SELECT
  (SELECT count(*) FROM session_users) AS ai_session_users,
  (SELECT count(*) FROM visitors) AS discover_users,
  (SELECT count(*) FROM clickers JOIN visitors USING (user_id)) AS outbound_users,
  (SELECT count(*) FROM savers JOIN visitors USING (user_id)) AS save_users,
  (SELECT count(*) FROM repeat_visitors JOIN visitors USING (user_id)) AS repeat_users,
  (SELECT count(*) FROM events) AS event_count,
  (SELECT count(*) FROM events WHERE event_name = 'TAB_VIEW') AS tab_view_events,
  (SELECT count(*) FROM events WHERE event_name = 'OUTBOUND_CLICK') AS outbound_events,
  (SELECT count(*) FROM events WHERE event_name = 'SAVE') AS save_events,
  (SELECT count(*) FROM visitors)::numeric
    / nullif((SELECT count(*) FROM session_users), 0) AS discover_entry_rate,
  (SELECT count(*) FROM clickers JOIN visitors USING (user_id))::numeric
    / nullif((SELECT count(*) FROM visitors), 0) AS outbound_rate,
  (SELECT count(*) FROM savers JOIN visitors USING (user_id))::numeric
    / nullif((SELECT count(*) FROM visitors), 0) AS save_rate,
  (SELECT count(*) FROM repeat_visitors JOIN visitors USING (user_id))::numeric
    / nullif((SELECT count(*) FROM visitors), 0) AS repeat_visit_rate;

-- Supporting category/source counts. These are aggregates only.
SELECT event_name, coalesce(source, 'NONE') AS source,
       coalesce(category, 'NONE') AS category,
       count(*) AS event_count, count(DISTINCT user_id) AS unique_users
FROM discover_analytics_events
WHERE occurred_at >= $1::timestamptz AND occurred_at < $2::timestamptz
  AND expires_at > clock_timestamp()
GROUP BY event_name, source, category
ORDER BY event_name, source, category;
