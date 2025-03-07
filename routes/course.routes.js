// routes/course.routes.js
const express = require("express");
const multer = require("multer");
const path = require("path");
const { spawn } = require("child_process");
const fs = require("fs");
const logger = require("../utils/logger");
const { runPythonInCondaEnv } = require("../utils/python-helpers");

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, "..", "uploads", "course-materials");
    // Create directory if it doesn't exist
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Create unique filename with original extension
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    const fileName =
      file.originalname.replace(ext, "") + "-" + uniqueSuffix + ext;
    cb(null, fileName);
  },
});

// File filter for supported formats
const fileFilter = (req, file, cb) => {
  const allowedTypes = [".pdf", ".docx", ".txt"];
  const ext = path.extname(file.originalname).toLowerCase();

  if (allowedTypes.includes(ext)) {
    cb(null, true);
  } else {
    cb(
      new Error(
        "Unsupported file format. Please upload PDF, DOCX, or TXT files."
      )
    );
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB file size limit
});

// Enhanced upload endpoint for course materials
router.post(
  "/upload-course-material",
  upload.single("file"),
  async (req, res) => {
    try {
      if (!req.file) {
        logger.warn("Upload attempted without file");
        return res.status(400).json({
          success: false,
          message: "No file uploaded",
          stage: "upload_validation",
        });
      }

      const filePath = req.file.path;
      const fileName = req.file.originalname;
      const fileSize = req.file.size;
      const fileType = path.extname(fileName).toLowerCase();

      logger.info(`Processing uploaded course material`, {
        fileName,
        fileSize,
        fileType,
        filePath,
      });

      // Run Python script with the uploaded file path
      const pythonProcess = runPythonInCondaEnv(filePath);

      // Handle the Python script process
      let scriptOutput = "";
      let scriptError = "";

      pythonProcess.stdout.on("data", (data) => {
        const output = data.toString().trim();
        scriptOutput += output;
        logger.info(`Python output: ${output}`);
      });

      pythonProcess.stderr.on("data", (data) => {
        const error = data.toString().trim();
        scriptError += error;
        logger.error(`Python error: ${error}`);
      });

      pythonProcess.on("close", (code) => {
        if (code !== 0) {
          logger.error(`Python script exited with code ${code}`, {
            error: scriptError,
            filePath,
          });
          return res.status(500).json({
            success: false,
            message: "Error processing course material",
            error: scriptError || "Unknown error during processing",
            stage: "python_processing",
            file: {
              name: fileName,
              size: fileSize,
              type: fileType,
            },
          });
        }

        try {
          // Parse the JSON output from the Python script
          const outputData = JSON.parse(scriptOutput);
          logger.info("Python processing completed successfully", {
            steps: outputData.steps_completed || [],
            stats: outputData.stats || {},
          });

          // Prepare the response with detailed information
          const response = {
            success: true,
            message: "Course material processed successfully",
            stage: "complete",
            file: {
              name: fileName,
              size: fileSize,
              type: fileType,
              path: filePath,
            },
            processing: {
              steps_completed: outputData.steps_completed || [],
              stats: outputData.stats || {},
              message: outputData.message || "Processing complete",
            },
            next_steps: [
              "You can now upload a rubric to configure the grading parameters.",
              "After setting up the rubric, you'll be able to upload student essays for grading.",
            ],
          };

          // Send the success response
          res.status(200).json(response);
        } catch (parseError) {
          logger.error(`Error parsing Python script output`, {
            error: parseError.message,
            rawOutput: scriptOutput,
          });

          // Send a success response even if we couldn't parse the details
          res.status(200).json({
            success: true,
            message:
              "Course material processed successfully, but output parsing failed",
            stage: "complete_with_warnings",
            file: {
              name: fileName,
              size: fileSize,
              type: fileType,
            },
          });
        }
      });
    } catch (error) {
      logger.error("Server error during file upload", {
        error: error.message,
        stack: error.stack,
      });
      res.status(500).json({
        success: false,
        message: "Server error during file upload",
        error: error.message,
        stage: "server_error",
      });
    }
  }
);

// Check RAG pipeline status
router.get("/rag-status", (req, res) => {
  try {
    // Check if FAISS indices file exists
    const faissExists = fs.existsSync(
      path.join(__dirname, "..", "python", "faiss_indices_mktg2201.pkl")
    );

    logger.info(
      `RAG status check: ${faissExists ? "Initialized" : "Not initialized"}`
    );

    res.status(200).json({
      success: true,
      initialized: faissExists,
      message: faissExists
        ? "RAG pipeline is initialized"
        : "RAG pipeline needs initialization",
    });
  } catch (error) {
    logger.error("Error checking RAG status", {
      error: error.message,
      stack: error.stack,
    });
    res.status(500).json({
      success: false,
      message: "Error checking RAG pipeline status",
      error: error.message,
    });
  }
});

module.exports = router;
