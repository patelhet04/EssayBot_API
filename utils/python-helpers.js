// utils/python-helpers.js
const { spawn } = require("child_process");
const path = require("path");
const logger = require("./logger");

// Environment configuration
const CONDA_ENV_NAME = process.env.CONDA_ENV_NAME || "essay_bot";
const IS_WINDOWS = process.platform === "win32";

/**
 * Runs a Python script in the specified Conda environment
 *
 * @param {string} filePath - Path to the file to process
 * @param {string} scriptName - Name of the Python script (without .py)
 * @param {object} options - Additional options for the Python script
 * @returns {ChildProcess} - The spawned process
 */
function runPythonInCondaEnv(
  filePath,
  scriptName = "rag_pipeline",
  options = {}
) {
  // Path to the Python script
  const pythonScript = path.join(__dirname, "..", "python", `${scriptName}.py`);
  // Build command-line arguments
  let pythonArgs = ["--file", filePath];
  logger.info(`Python script command: ${pythonScript} ${pythonArgs.join(" ")}`);

  // Add any additional options
  Object.entries(options).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      pythonArgs.push(`--${key}`);
      if (value !== true) {
        pythonArgs.push(value.toString());
      }
    }
  });

  logger.info(`Starting Python script with conda environment`, {
    env: CONDA_ENV_NAME,
    script: pythonScript,
    file: filePath,
    args: pythonArgs,
  });

  // Determine the appropriate command based on the operating system
  if (IS_WINDOWS) {
    // For Windows, we need to use cmd to run conda activate
    const cmdArgs = [
      "/c",
      `conda activate ${CONDA_ENV_NAME} && python "${pythonScript}" ${pythonArgs
        .map((arg) => `"${arg}"`)
        .join(" ")}`,
    ];

    return spawn("cmd.exe", cmdArgs, { shell: true });
  } else {
    // For macOS/Linux, we use bash
    const bashCommand =
      `source $(conda info --base)/etc/profile.d/conda.sh && ` +
      `conda activate ${CONDA_ENV_NAME} && ` +
      `python "${pythonScript}" ${pythonArgs
        .map((arg) => `"${arg}"`)
        .join(" ")}`;

    return spawn("bash", ["-c", bashCommand]);
  }
}

module.exports = {
  runPythonInCondaEnv,
};
