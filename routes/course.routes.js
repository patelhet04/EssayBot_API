// routes/course.routes.js
const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const logger = require("../utils/logger");
const { runPythonInCondaEnv } = require("../utils/python-helpers");
const { verifyToken } = require("../utils/middleware");
const config = require("../utils/config");

const router = express.Router();

// Apply authentication middleware to all course routes
router.use(verifyToken);

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Get professor username from authenticated user
    const professorUsername = req.user.username;

    const uploadDir = path.join(
      __dirname,
      "..",
      "uploads",
      professorUsername,
      "materials"
    );

    // Create directory if it doesn't exist
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Create unique filename with original extension
    const professorUsername = req.user.username;
    const fileName = `${professorUsername}_${file.originalname}`;
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

// Get list of course materials for the authenticated professor
router.get("/course-materials", (req, res) => {
  try {
    const professorUsername = req.user.username;
    const materialsDir = config.paths.getUploadsPath(
      professorUsername,
      "materials"
    );

    if (!fs.existsSync(materialsDir)) {
      return res.status(200).json({
        success: true,
        materials: [],
        message: "No course materials found",
      });
    }

    const files = fs.readdirSync(materialsDir);
    const materials = files.map((file) => {
      const filePath = path.join(materialsDir, file);
      const stats = fs.statSync(filePath);
      return {
        name: file,
        original_name: file.split("-")[0], // Simplified - might need regex for accuracy
        size: stats.size,
        type: path.extname(file).toLowerCase(),
        uploaded_at: stats.mtime,
      };
    });

    res.status(200).json({
      success: true,
      materials: materials,
    });
  } catch (error) {
    logger.error("Error fetching course materials", {
      error: error.message,
      stack: error.stack,
    });
    res.status(500).json({
      success: false,
      message: "Error fetching course materials",
      error: error.message,
    });
  }
});

// Enhanced upload endpoint for multiple course materials
router.post(
  "/upload-course-material",
  upload.array("files", 10), // Allow up to 10 files
  async (req, res) => {
    try {
      if (!req.files || req.files.length === 0) {
        logger.warn("Upload attempted without files");
        return res.status(400).json({
          success: false,
          message: "No files uploaded",
          stage: "upload_validation",
        });
      }

      logger.info(`Processing ${req.files.length} uploaded course materials`);

      // Process each file and collect results
      const processingResults = [];
      const processingErrors = [];

      // Process files sequentially to avoid overloading system
      for (const file of req.files) {
        const filePath = file.path;
        const fileName = file.originalname;
        const fileSize = file.size;
        const fileType = path.extname(fileName).toLowerCase();

        logger.info(`Processing uploaded course material`, {
          fileName,
          fileSize,
          fileType,
          filePath,
          professor: req.user.username,
        });

        try {
          // Run Python script with the uploaded file path and professor username
          const pythonProcess = runPythonInCondaEnv(filePath, "rag_pipeline", {
            professorUsername: req.user.username,
          });

          // Create a promise to handle the Python process completion
          const processResult = await new Promise((resolve, reject) => {
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
                reject({
                  success: false,
                  message: "Error processing course material",
                  error: scriptError || "Unknown error during processing",
                  file: {
                    name: fileName,
                    size: fileSize,
                    type: fileType,
                  },
                });
                return;
              }

              try {
                // Parse the JSON output from the Python script
                const outputData = JSON.parse(scriptOutput);
                logger.info("Python processing completed successfully", {
                  file: fileName,
                  steps: outputData.steps_completed || [],
                  stats: outputData.stats || {},
                });

                resolve({
                  success: true,
                  message: "Course material processed successfully",
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
                });
              } catch (parseError) {
                logger.error(`Error parsing Python script output`, {
                  error: parseError.message,
                  rawOutput: scriptOutput,
                });

                resolve({
                  success: true,
                  message:
                    "Course material processed but output parsing failed",
                  file: {
                    name: fileName,
                    size: fileSize,
                    type: fileType,
                  },
                  warning: "Output parsing failed",
                });
              }
            });
          });

          processingResults.push(processResult);
        } catch (error) {
          logger.error(`Error processing file ${fileName}`, {
            error: error.message,
          });
          processingErrors.push({
            file: fileName,
            error: error.message,
          });
        }
      }

      // Return the combined results
      res.status(200).json({
        success: true,
        message: `Processed ${processingResults.length} files with ${processingErrors.length} errors`,
        processed_files: processingResults,
        errors: processingErrors,
        next_steps: [
          "You can now upload a rubric to configure the grading parameters.",
          "After setting up the rubric, you'll be able to upload student essays for grading.",
        ],
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

// Delete a course material
router.delete("/course-materials/:filename", (req, res) => {
  try {
    const professorUsername = req.user.username;
    const filename = req.params.filename;
    const filePath = path.join(
      __dirname,
      "..",
      "uploads",
      professorUsername,
      "materials",
      filename
    );

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        message: "File not found",
      });
    }

    fs.unlinkSync(filePath);

    res.status(200).json({
      success: true,
      message: "Course material deleted successfully",
    });
  } catch (error) {
    logger.error("Error deleting course material", {
      error: error.message,
      stack: error.stack,
    });
    res.status(500).json({
      success: false,
      message: "Error deleting course material",
      error: error.message,
    });
  }
});

// Check RAG pipeline status
router.get("/rag-status", (req, res) => {
  try {
    const professorUsername = req.user.username;

    // Check if FAISS indices file exists for this specific professor
    const indicesPath = path.join(
      __dirname,
      "..",
      "uploads",
      professorUsername,
      "indices",
      "faiss_index.pkl"
    );

    const faissExists = fs.existsSync(indicesPath);

    logger.info(
      `RAG status check for professor ${professorUsername}: ${
        faissExists ? "Initialized" : "Not initialized"
      }`
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

// Force re-initialization of RAG pipeline
router.post("/reinitialize-rag", async (req, res) => {
  try {
    const professorUsername = req.user.username;

    // Get all materials for this professor
    const materialsDir = path.join(
      __dirname,
      "..",
      "uploads",
      professorUsername,
      "materials"
    );

    if (!fs.existsSync(materialsDir)) {
      return res.status(400).json({
        success: false,
        message: "No course materials found to initialize RAG pipeline",
      });
    }

    const files = fs.readdirSync(materialsDir);
    if (files.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No course materials found to initialize RAG pipeline",
      });
    }

    // Run Python script for RAG initialization
    const pythonProcess = runPythonInCondaEnv(
      materialsDir, // Pass the materials directory
      "rag_initialize",
      {
        professorUsername: professorUsername,
        reinitialize: true,
      }
    );

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
        });
        return res.status(500).json({
          success: false,
          message: "Error initializing RAG pipeline",
          error: scriptError || "Unknown error during processing",
        });
      }

      try {
        // Parse the JSON output from the Python script
        const outputData = JSON.parse(scriptOutput);

        res.status(200).json({
          success: true,
          message: "RAG pipeline reinitialized successfully",
          details: outputData,
        });
      } catch (parseError) {
        logger.error(`Error parsing Python script output`, {
          error: parseError.message,
          rawOutput: scriptOutput,
        });

        res.status(200).json({
          success: true,
          message: "RAG pipeline reinitialized but output parsing failed",
        });
      }
    });
  } catch (error) {
    logger.error("Error reinitializing RAG pipeline", {
      error: error.message,
      stack: error.stack,
    });
    res.status(500).json({
      success: false,
      message: "Error reinitializing RAG pipeline",
      error: error.message,
    });
  }
});

module.exports = router;
