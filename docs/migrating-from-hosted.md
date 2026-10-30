# Moving from the original hosted setup

Earlier versions ran on Vercel with Supabase, with the worker on Railway. To move an existing install to
docker compose:

1. Set `DATABASE_URL` to your Supabase Postgres connection string (or restore a dump into the compose
   database). On first start, the worker recognizes the existing schema and records the baseline
   migration as already applied. Nothing is recreated.
2. Videos already stored in Supabase Storage keep working as external URLs. New media goes to the
   storage driver you configure.
3. Replace `RAILWAY_WORKER_URL`/`RAILWAY_WORKER_SECRET` with `WORKER_URL`/`WORKER_SECRET` (the old
   names still work), and remove the Vercel cron configuration: the worker runs the schedule now.
