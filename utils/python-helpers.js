// utils/python-helpers.js
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const logger = require("./logger");
const config = require("./config");

const CONDA_ENV_NAME = process.env.CONDA_ENV_NAME || "essay_bot";

function runPythonInCondaEnv(
  filePath,
  scriptName = "rag_pipeline",
  options = {}
) {
  const professorUsername = options.professor;

  // Determine which Python script to run
  let pythonScript;
  if (professorUsername) {
    const professorScriptPath = path.join(
      config.paths.getUploadsPath(professorUsername),
      `${scriptName}.py`
    );
    if (fs.existsSync(professorScriptPath)) {
      pythonScript = professorScriptPath;
      logger.info(`Using professor-specific script: ${pythonScript}`);
    }
  }
  if (!pythonScript) {
    pythonScript = path.join(config.paths.root, `${scriptName}.py`);
    logger.info(`Using default script: ${pythonScript}`);
  }

  // Build command-line arguments
  let pythonArgs = [];
  // Add filePath as first positional argument if provided
  if (filePath) {
    pythonArgs.push("--file", filePath);
  }

  // Append all options as named arguments, including the model parameter if it exists
  Object.entries(options).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      pythonArgs.push(`--${key}`);
      if (value !== true) {
        // For string values with spaces, ensure proper quoting
        if (typeof value === "string" && value.includes(" ")) {
          pythonArgs.push(`"${value.replace(/"/g, '\\"')}"`);
        } else {
          pythonArgs.push(value.toString());
        }
      }
    }
  });

  // Log the command being executed (with model parameter if present)
  if (options.model) {
    logger.info(`Using model: ${options.model}`);
  }
  logger.info(`Python script command arguments: ${pythonArgs.join(" ")}`);

  // Use JSON.stringify to properly quote each argument
  const bashCommand =
    `source $(conda info --base)/etc/profile.d/conda.sh && ` +
    `conda activate ${CONDA_ENV_NAME} && ` +
    `python ${JSON.stringify(pythonScript)} ` +
    pythonArgs.map((arg) => JSON.stringify(arg)).join(" ");

  logger.info(`Bash command: ${bashCommand}`);

  const childProcess = spawn("bash", ["-c", bashCommand]);

  childProcess.stdout.on("data", (data) => {
    logger.info(`Python output: ${data.toString().trim()}`);
  });

  childProcess.stderr.on("data", (data) => {
    const message = data.toString();
    message.split("\n").forEach((line) => {
      if (!line.trim()) return;
      if (line.includes(" - INFO - ") || line.includes(" - WARNING - ")) {
        logger.info(`Python: ${line}`);
      } else if (line.includes(" - ERROR - ")) {
        logger.error(`Python: ${line}`);
      } else {
        logger.info(`Python (unclassified): ${line}`);
      }
    });
  });

  childProcess.on("close", (code) => {
    logger.info(`Python process exited with code ${code}`);
  });

  return childProcess;
}

module.exports = {
  runPythonInCondaEnv,
};
