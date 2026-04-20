const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const envFiles = ['.env.local', '.env'];

for (const filename of envFiles) {
  const envPath = path.join(process.cwd(), filename);
  if (!fs.existsSync(envPath)) continue;
  dotenv.config({ path: envPath, override: false });
}

