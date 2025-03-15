const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const CONDA_ENV_NAME = process.env.CONDA_ENV_NAME || "essay_bot";

console.log("🔄 Setting up the Python environment...");

// Check if Conda is installed
try {
  execSync("conda --version", { stdio: "ignore" });
  console.log("✅ Conda is installed");
} catch (error) {
  console.error(
    "❌ Conda is not installed or not in PATH. Please install Conda and try again."
  );
  process.exit(1);
}

// Check if requirements.txt exists
const requirementsPath = path.join(__dirname, "requirements.txt");
if (!fs.existsSync(requirementsPath)) {
  console.error(
    "❌ requirements.txt not found. Please create the file with Python dependencies."
  );
  process.exit(1);
}

console.log(`🔨 Creating Conda environment: ${CONDA_ENV_NAME}...`);

// Create Conda environment
try {
  execSync(`conda create -y -n ${CONDA_ENV_NAME} python=3.10`, {
    stdio: "inherit",
  });
  console.log(`✅ Conda environment '${CONDA_ENV_NAME}' created successfully!`);
} catch (error) {
  console.error("❌ Failed to create Conda environment.");
  process.exit(1);
}

// Install dependencies inside the environment
try {
  execSync(
    `conda run -n ${CONDA_ENV_NAME} pip install -r "${requirementsPath}"`,
    { stdio: "inherit" }
  );
  console.log("✅ Dependencies installed successfully!");
} catch (error) {
  console.error("❌ Failed to install dependencies.");
  process.exit(1);
}

// Create a .env file if it doesn't exist
const envPath = path.join(__dirname, ".env");
if (!fs.existsSync(envPath)) {
  fs.writeFileSync(envPath, `CONDA_ENV_NAME=${CONDA_ENV_NAME}\n`);
  console.log("✅ Created .env file with environment settings");
}

console.log("🚀 Setup complete! You can now activate the environment with:");
console.log(`   conda activate ${CONDA_ENV_NAME}`);
console.log("Then, run the server with:");
console.log("   npm start");
