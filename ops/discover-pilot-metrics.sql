-- Task 33 input. Bind $1 = inclusive UTC start and $2 = exclusive UTC end.
-- Both boundaries must be UTC midnight exactly seven days apart.
-- The result contains aggregates only; no user or item identifier is returned.
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
  SELECT DISTINCT events.user_id
  FROM events JOIN visitors USING (user_id)
  WHERE event_name = 'OUTBOUND_CLICK'
),
savers AS (
  SELECT DISTINCT events.user_id
  FROM events JOIN visitors USING (user_id)
  WHERE event_name = 'SAVE'
),
repeat_visitors AS (
  SELECT events.user_id
  FROM events JOIN visitors USING (user_id)
  WHERE event_name = 'DISCOVER_VIEW'
  GROUP BY events.user_id
  HAVING count(DISTINCT (occurred_at AT TIME ZONE 'UTC')::date) >= 2
),
counts AS (
  SELECT
    (SELECT count(*)::integer FROM session_users) AS ai_session_users,
    (SELECT count(*)::integer FROM visitors) AS discover_users,
    (SELECT count(*)::integer FROM clickers) AS outbound_users,
    (SELECT count(*)::integer FROM savers) AS save_users,
    (SELECT count(*)::integer FROM repeat_visitors) AS repeat_users,
    (SELECT count(*)::integer FROM events) AS event_count,
    (SELECT count(*)::integer FROM events WHERE event_name = 'DISCOVER_VIEW') AS discover_view_events,
    (SELECT count(*)::integer FROM events WHERE event_name = 'TAB_VIEW') AS tab_view_events,
    (SELECT count(*)::integer FROM events WHERE event_name = 'OUTBOUND_CLICK') AS outbound_events,
    (SELECT count(*)::integer FROM events WHERE event_name = 'SAVE') AS save_events
),
breakdown_rows AS (
  SELECT event_name, coalesce(source, 'NONE') AS source,
         coalesce(category, 'NONE') AS category,
         count(*)::integer AS event_count,
         count(DISTINCT user_id)::integer AS unique_users
  FROM events
  GROUP BY event_name, source, category
),
breakdown AS (
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'eventName', event_name,
    'source', source,
    'category', category,
    'eventCount', event_count,
    'uniqueUsers', unique_users
  ) ORDER BY event_name, source, category), '[]'::jsonb) AS event_breakdown
  FROM breakdown_rows
),
hourly_rows AS (
  SELECT date_trunc('hour', occurred_at AT TIME ZONE 'UTC') AS hour_utc,
         event_name, coalesce(source, 'NONE') AS source,
         coalesce(category, 'NONE') AS category,
         count(*)::integer AS event_count,
         count(DISTINCT user_id)::integer AS unique_users
  FROM events
  GROUP BY hour_utc, event_name, source, category
),
hourly_breakdown AS (
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'hourUtc', to_char(hour_utc, 'YYYY-MM-DD"T"HH24:00:00.000"Z"'),
    'eventName', event_name,
    'source', source,
    'category', category,
    'eventCount', event_count,
    'uniqueUsers', unique_users
  ) ORDER BY hour_utc, event_name, source, category), '[]'::jsonb) AS hourly_event_breakdown
  FROM hourly_rows
)
SELECT counts.*,
       discover_users::numeric / nullif(ai_session_users, 0) AS discover_entry_rate,
       outbound_users::numeric / nullif(discover_users, 0) AS outbound_rate,
       save_users::numeric / nullif(discover_users, 0) AS save_rate,
       repeat_users::numeric / nullif(discover_users, 0) AS repeat_visit_rate,
       breakdown.event_breakdown,
       hourly_breakdown.hourly_event_breakdown
FROM counts CROSS JOIN breakdown CROSS JOIN hourly_breakdown;
