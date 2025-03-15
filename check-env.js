// check-env.js - Script to verify the environment before starting the server
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const config = require("./utils/config");
require("dotenv").config();

const CONDA_ENV_NAME = process.env.CONDA_ENV_NAME || "essay_bot";

console.log("Checking Python environment...");

// Check if the conda environment exists
try {
  let envList = execSync("conda env list").toString();

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

// // Check for root requirements.txt file
// const requirementsPath = path.join(__dirname, "requirements.txt");
// if (!fs.existsSync(requirementsPath)) {
//   console.warn("⚠️ requirements.txt not found in root directory");
//   console.warn("Dependencies may not be properly installed");
// }

// Check the uploads directory
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) {
  console.log("Creating uploads directory...");
  fs.mkdirSync(uploadsDir, { recursive: true });
} else {
  // Check for professor directories
  const professorDirs = fs
    .readdirSync(uploadsDir, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => dirent.name);

  if (professorDirs.length === 0) {
    console.log("No professor directories found in uploads directory");
    console.log("System will create these as needed");
  } else {
    console.log(`Found ${professorDirs.length} professor directories`);

    // Check for critical Python files in each professor directory
    let allProfessorsHaveScripts = true;

    for (const professor of professorDirs) {
      const professorScriptsExist = checkProfessorScripts(professor);
      allProfessorsHaveScripts =
        allProfessorsHaveScripts && professorScriptsExist;
    }

    if (!allProfessorsHaveScripts) {
      console.warn(
        "⚠️ Some professor directories are missing critical Python scripts"
      );
    }
  }
}

// Function to check if a professor directory has the required Python scripts
function checkProfessorScripts(professorName) {
  const scriptsToCheck = ["agents.py", "rag_pipeline.py", "script.py"];
  const professorDir = config.paths.getUploadsPath(professorName);
  let allScriptsExist = true;

  for (const script of scriptsToCheck) {
    const scriptPath = path.join(professorDir, script);
    if (!fs.existsSync(scriptPath)) {
      allScriptsExist = false;
    }
  }

  return allScriptsExist;
}

console.log("✅ Environment check completed. Starting server...");
