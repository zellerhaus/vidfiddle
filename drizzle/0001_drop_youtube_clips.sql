-- YouTube clips were removed. Empty tables are dropped; tables holding clips (an install moved from
-- the hosted setup) are renamed instead, so the data stays until you drop it yourself.
DO $$
DECLARE
  has_rows boolean := false;
BEGIN
  IF to_regclass('public.youtube_sources') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.youtube_sources)' INTO has_rows;
  END IF;
  IF NOT has_rows AND to_regclass('public.youtube_clips') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.youtube_clips)' INTO has_rows;
  END IF;
  IF has_rows THEN
    ALTER TABLE IF EXISTS public.youtube_clips RENAME TO youtube_clips_removed;
    ALTER TABLE IF EXISTS public.youtube_sources RENAME TO youtube_sources_removed;
  ELSE
    DROP TABLE IF EXISTS public.youtube_clips CASCADE;
    DROP TABLE IF EXISTS public.youtube_sources CASCADE;
  END IF;
END $$;
