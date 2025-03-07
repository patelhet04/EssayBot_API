// check-env.js - Script to verify the environment before starting the server
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const CONDA_ENV_NAME = process.env.CONDA_ENV_NAME || "essay_bot";
// const IS_WINDOWS = process.platform === 'win32';

console.log("Checking Python environment...");

// Check if the conda environment exists
try {
  let envList;

  envList = execSync("conda env list").toString();

  if (envList.includes(CONDA_ENV_NAME)) {
    console.log(`✅ Conda environment '${CONDA_ENV_NAME}' exists`);
  } else {
    console.error(
      `❌ Conda environment '${CONDA_ENV_NAME}' not found. Run 'npm run setup' first.`
    );
    process.exit(1);
  }
} catch (error) {
  console.error("❌ Failed to check conda environments:", error.message);
  process.exit(1);
}

// Check the Python directory structure
const pythonDir = path.join(__dirname, "python");
if (!fs.existsSync(pythonDir)) {
  console.log("Creating Python directory...");
  fs.mkdirSync(pythonDir, { recursive: true });
}

const scriptPath = path.join(pythonDir, "rag_pipeline.py");
if (!fs.existsSync(scriptPath)) {
  console.warn("⚠️ rag_pipeline.py not found in the python directory");
  console.warn(
    "Please ensure the Python script is properly set up before using the API"
  );
}

// Check the uploads directory
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) {
  console.log("Creating uploads directory...");
  fs.mkdirSync(uploadsDir, { recursive: true });
}

console.log("✅ Environment check completed. Starting server...");
