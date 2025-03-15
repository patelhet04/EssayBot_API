const express = require("express");
const path = require("path");
const fs = require("fs");
const logger = require("../utils/logger");
const { verifyToken } = require("../utils/middleware");
const {
  getProfessorRubric,
  saveProfessorRubric,
  updateAgentGradingDistribution,
} = require("../utils/rubricHandler");
const config = require("../utils/config");
const { runPythonInCondaEnv } = require("../utils/python-helpers");

const router = express.Router();

// Apply authentication middleware to all rubric routes
router.use(verifyToken);

// Get the current rubric for the authenticated professor
router.get("/current-rubric", (req, res) => {
  try {
    const professorUsername = req.user.username;
    const rubric = getProfessorRubric(professorUsername);

    if (!rubric) {
      return res.status(404).json({
        success: false,
        message: "No rubric found for this professor",
      });
    }

    res.status(200).json({
      success: true,
      rubric: rubric,
    });
  } catch (error) {
    logger.error("Error fetching professor rubric", {
      error: error.message,
      professor: req.user.username,
    });

    res.status(500).json({
      success: false,
      message: "Error fetching rubric",
      error: error.message,
    });
  }
});

router.post("/generate-sample-rubrics", async (req, res) => {
  try {
    const professorUsername = req.user.username;
    const question = req.body.question;
    const model = req.body.model || "llama3.1:8b"; // Default model if not provided

    if (!question) {
      return res.status(400).json({
        success: false,
        message: "Question is required for rubric generation",
      });
    }

    logger.info(`Generating sample rubrics for professor ${professorUsername}`);
    logger.info(
      `Question: ${
        typeof question === "string"
          ? question.substring(0, 100) + "..."
          : "Complex question object"
      }`
    );
    logger.info(`Using model: ${model}`);

    // Check if RAG pipeline is initialized
    const indicesPath = path.join(
      config.paths.getUploadsPath(professorUsername, "indices"),
      "faiss_index.pkl"
    );

    if (!fs.existsSync(indicesPath)) {
      return res.status(400).json({
        success: false,
        message:
          "RAG pipeline not initialized. Please upload course materials first.",
      });
    }

    const questionText =
      typeof question === "string"
        ? question
        : question.text || JSON.stringify(question);

    // Run Python script to generate sample rubrics
    const pythonProcess = runPythonInCondaEnv(null, "generate_rubrics", {
      question: questionText,
      professorUsername: professorUsername,
      projectRoot: config.paths.root,
      numSamples: 3,
      model: model, // Pass the model parameter to Python script
    });

    let stdoutData = "";
    let scriptError = "";

    // Capture stdout
    pythonProcess.stdout.on("data", (data) => {
      stdoutData += data.toString();
      logger.info(`Python stdout: ${data.toString().trim()}`);
    });

    // Capture stderr for logging
    pythonProcess.stderr.on("data", (data) => {
      scriptError += data.toString();
      logger.error(`Python stderr: ${data.toString().trim()}`);
    });

    pythonProcess.on("error", (err) => {
      logger.error("Error spawning Python process", { error: err });
      return res.status(500).json({
        success: false,
        message: "Error spawning Python process",
        error: err.message,
      });
    });

    // On process close, send the captured output as response
    pythonProcess.on("close", (code) => {
      logger.info(`Python process closed with code ${code}`);
      if (code !== 0) {
        logger.error(`Python script exited with code ${code}`, {
          error: scriptError,
        });
        return res.status(500).json({
          success: false,
          message: "Error generating sample rubrics",
          error: scriptError || "Unknown error during processing",
        });
      }
      try {
        const outputData = JSON.parse(stdoutData);
        return res.status(200).json({
          success: true,
          message: "Sample rubrics generated successfully",
          sampleRubrics: outputData.sampleRubrics || [],
        });
      } catch (parseError) {
        logger.error("Error parsing Python script output", {
          error: parseError.message,
          rawOutput: stdoutData,
        });
        return res.status(500).json({
          success: false,
          message: "Error parsing the generated rubrics",
          error: parseError.message,
        });
      }
    });
  } catch (error) {
    logger.error("Error generating sample rubrics", {
      error: error.message,
      stack: error.stack,
    });
    return res.status(500).json({
      success: false,
      message: "Error generating sample rubrics",
      error: error.message,
    });
  }
});

function waitForFile(filePath, maxWaitTime = 30000, interval = 1000) {
  return new Promise((resolve, reject) => {
    let waited = 0;
    function check() {
      if (fs.existsSync(filePath)) {
        return resolve();
      }
      waited += interval;
      if (waited >= maxWaitTime) {
        return reject(
          new Error(`File not found after waiting ${maxWaitTime}ms`)
        );
      }
      setTimeout(check, interval);
    }
    check();
  });
}

// Save or update the professor's rubric
router.post("/save-rubric", express.json(), (req, res) => {
  try {
    const rubricData = req.body;
    const professorUsername = req.user.username;

    if (
      !rubricData ||
      !rubricData.criteria ||
      !Array.isArray(rubricData.criteria)
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid rubric data",
      });
    }

    // Save the rubric
    const saved = saveProfessorRubric(professorUsername, rubricData);

    if (!saved) {
      return res.status(500).json({
        success: false,
        message: "Failed to save rubric",
      });
    }

    res.status(200).json({
      success: true,
      message: "Rubric saved successfully",
    });
  } catch (error) {
    logger.error("Error saving rubric", {
      error: error.message,
      professor: req.user.username,
    });

    res.status(500).json({
      success: false,
      message: "Error saving rubric",
      error: error.message,
    });
  }
});

// Update agent grading distribution (points/weights)
// router.post("/update-grading-distribution", express.json(), (req, res) => {
//   try {
//     const { criteria } = req.body;
//     const professorUsername = req.user.username;

//     if (!criteria || !Array.isArray(criteria)) {
//       return res.status(400).json({
//         success: false,
//         message: "Invalid criteria data",
//       });
//     }

//     // Update the agent grading distribution
//     const updated = updateAgentGradingDistribution(professorUsername, criteria);

//     if (!updated) {
//       return res.status(500).json({
//         success: false,
//         message: "Failed to update agent grading distribution",
//       });
//     }

//     // Also update the stored rubric if it exists
//     const currentRubric = getProfessorRubric(professorUsername);
//     if (currentRubric) {
//       currentRubric.criteria = criteria;
//       saveProfessorRubric(professorUsername, currentRubric);
//     }

//     res.status(200).json({
//       success: true,
//       message: "Grading distribution updated successfully",
//     });
//   } catch (error) {
//     logger.error("Error updating grading distribution", {
//       error: error.message,
//       professor: req.user.username,
//     });

//     res.status(500).json({
//       success: false,
//       message: "Error updating grading distribution",
//       error: error.message,
//     });
//   }
// });

module.exports = router;
