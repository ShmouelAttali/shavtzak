-- H6c: per-soldier position whitelist (null = unrestricted).
alter table soldiers add column if not exists allowed_positions text[];
update soldiers set allowed_positions = array['סיור'] where full_name = 'אריאל ביר';
