const { execSync } = require('child_process');
require('dotenv').config();

// Explicitly set the environment variable just in case
process.env.DATABASE_URL = "postgresql://ibshi:l6871F0PyOVU@103.141.177.194:15432/ibshi";

try {
  console.log("Running DB Cleanup script directly...");
  execSync('npx tsx scripts/db-cleanup.ts', { stdio: 'inherit' });
  console.log("DB Cleanup script finished successfully!");
} catch (error) {
  console.error("Failed to run DB Cleanup logic.");
}
