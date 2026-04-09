require("dotenv").config();

const fs = require("fs");
const path = require("path");
const pool = require("../src/config/db");

const migrationsDir = path.join(__dirname, "..", "src", "migrations");

const ensureSchemaMigrationsTable = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      executed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
};

const getExecutedMigrationSet = async () => {
  const result = await pool.query("SELECT filename FROM schema_migrations");
  return new Set(result.rows.map((row) => row.filename));
};

const getMigrationFiles = () =>
  fs.readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort((left, right) => left.localeCompare(right));

const run = async () => {
  const migrationFiles = getMigrationFiles();

  if (migrationFiles.length === 0) {
    console.log("No migration files found.");
    return;
  }

  await ensureSchemaMigrationsTable();
  const executedSet = await getExecutedMigrationSet();

  for (const filename of migrationFiles) {
    if (executedSet.has(filename)) {
      console.log(`Skipping ${filename}`);
      continue;
    }

    const fullPath = path.join(migrationsDir, filename);
    const sql = fs.readFileSync(fullPath, "utf8").trim();

    if (!sql) {
      console.log(`Skipping empty migration ${filename}`);
      await pool.query(
        "INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT (filename) DO NOTHING",
        [filename]
      );
      continue;
    }

    const client = await pool.connect();

    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(
        "INSERT INTO schema_migrations (filename) VALUES ($1)",
        [filename]
      );
      await client.query("COMMIT");
      console.log(`Applied ${filename}`);
    } catch (error) {
      await client.query("ROLLBACK");
      console.error(`Failed ${filename}: ${error.message}`);
      throw error;
    } finally {
      client.release();
    }
  }
};

run()
  .then(async () => {
    console.log("Migrations completed.");
    await pool.end();
  })
  .catch(async (error) => {
    console.error("Migration run failed.");
    await pool.end();
    process.exitCode = 1;
  });
