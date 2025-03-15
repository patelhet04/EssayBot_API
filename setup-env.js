// setup-env.js - Setup script to create the conda environment
const { spawn, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const CONDA_ENV_NAME = process.env.CONDA_ENV_NAME || "essay_bot";
// const IS_WINDOWS = process.platform === 'win32';

console.log("Setting up the Python environment...");

// Check if conda is installed
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
    "❌ requirements.txt not found. Please create the file with your Python dependencies."
  );
  process.exit(1);
}

console.log(`Creating conda environment: ${CONDA_ENV_NAME}...`);

// Create the conda environment and install dependencies
let setupProcess;

setupProcess = spawn(
  "bash",
  [
    "-c",
    `source $(conda info --base)/etc/profile.d/conda.sh && ` +
      `conda create -y -n ${CONDA_ENV_NAME} python=3.10 && ` +
      `conda activate ${CONDA_ENV_NAME} && ` +
      `pip install -r "${requirementsPath}"`,
  ],
  { stdio: "inherit" }
);

setupProcess.on("close", (code) => {
  if (code !== 0) {
    console.error(`❌ Environment setup failed with code ${code}`);
    process.exit(1);
  }

  console.log(
    `✅ Conda environment '${CONDA_ENV_NAME}' created successfully with all dependencies!`
  );

  // Create a .env file if it doesn't exist
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) {
    fs.writeFileSync(envPath, `CONDA_ENV_NAME=${CONDA_ENV_NAME}\n`);
    console.log("✅ Created .env file with environment settings");
  }

  console.log("✅ Setup complete! You can now run the server with: npm start");
});
