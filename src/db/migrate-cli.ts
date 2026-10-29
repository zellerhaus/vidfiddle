// `npm run migrate`: apply database migrations and exit.
import { closeDb } from "./index";
import { runMigrations } from "./migrate";

runMigrations()
  .then(() => console.log("Migrations applied"))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
