-- חפק is a daily crew — its card shows seat names without shift times.
update positions set config = config || '{"yomi_display": true}'::jsonb where name = 'חפק';
-- נהג קו is לא מגויס — outside scheduling entirely
update soldiers set is_schedulable = false where full_name = 'נהג קו';
