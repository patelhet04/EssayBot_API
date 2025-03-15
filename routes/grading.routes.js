// routes/grading.routes.js
const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { runPythonInCondaEnv } = require("../utils/python-helpers");
const logger = require("../utils/logger");
const { verifyToken } = require("../utils/middleware");

const router = express.Router();

router.use(verifyToken);

// Configure storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Use the professor's username from req.user; fallback to "default" if not available.
    const profUsername = req.user.username;
    const uploadDir = path.join(
      __dirname,
      "..",
      "uploads",
      profUsername,
      "essays"
    );
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, `essays-${uniqueSuffix}${ext}`);
  },
});

const upload = multer({ storage });

// Upload and analyze Excel file
router.post("/upload-essays", upload.single("file"), (req, res) => {
  if (!req.file) {
    return res
      .status(400)
      .json({ success: false, message: "No file uploaded" });
  }

  const filePath = req.file.path;

  // For debugging, log the exact command being run
  console.log(`Analyzing file: ${filePath}`);

  // Run Python script to analyze the file
  const analyzeProcess = runPythonInCondaEnv(null, "analyze_excel", {
    file: filePath,
  });

  let output = "";

  analyzeProcess.stdout.on("data", (data) => {
    output += data.toString();
    console.log(`Python stdout: ${data.toString()}`);
  });

  analyzeProcess.stderr.on("data", (data) => {
    console.log(`Python stderr: ${data.toString()}`);
  });

  analyzeProcess.on("close", (code) => {
    console.log(`Python process exited with code ${code}`);
    console.log(`Raw output: ${output}`);

    try {
      // Try to parse the JSON output
      const analysisResult = JSON.parse(output.trim());

      return res.status(200).json({
        success: true,
        fileInfo: {
          name: req.file.originalname,
          path: filePath,
          rowCount: analysisResult.total_rows || 0,
          hasResponseColumn: analysisResult.has_response || false,
          columns: analysisResult.columns || [],
          previewData: analysisResult.preview_data || [],
        },
      });
    } catch (error) {
      console.error("Parse error:", error.message);
      return res.status(500).json({
        success: false,
        message: "Error parsing analysis results",
      });
    }
  });
});

// Start grading process
router.post("/grade-essays", express.json(), (req, res) => {
  const { filePath, model, professorUsername } = req.body;
  console.log(filePath);
  if (!filePath) {
    return res
      .status(400)
      .json({ success: false, message: "No file path provided" });
  }

  // Ensure professor username is available (either from request body or from auth)
  const username = professorUsername || req.user.username;

  if (!username) {
    return res
      .status(400)
      .json({ success: false, message: "Professor username is required" });
  }

  // Start grading in the background
  const jobId = `job-${username}-${Date.now()}`;

  // Respond immediately
  res.status(202).json({ success: true, jobId });

  // Run grading script in background with essential parameters
  // Output directory will be handled inside runPythonInCondaEnv
  const gradingProcess = runPythonInCondaEnv(filePath, "script", {
    professor: username,
    model: model || "llama3.1:latest",
    "job-id": jobId,
  });

  // Log output (but don't wait for completion)
  gradingProcess.stdout.on("data", (data) => {
    logger.info(`Grading output [${username}]: ${data}`);
  });

  gradingProcess.stderr.on("data", (data) => {
    logger.error(`Grading error [${username}]: ${data}`);
  });
});

// Check grading status
router.get("/grading-status/:jobId", (req, res) => {
  const { jobId } = req.params;

  // Extract professor username from jobId (assuming format job-username-timestamp)
  const match = jobId.match(/^job-([^-]+)-/);
  const professorUsername = match ? match[1] : null;

  // If no professor username in jobId, use authenticated user
  const username = professorUsername || req.user.username;

  // Determine correct status file path
  const statusPath = path.join(
    __dirname,
    "..",
    "outputs",
    username,
    `${jobId}.status`
  );

  if (fs.existsSync(statusPath)) {
    try {
      const statusContent = fs.readFileSync(statusPath, "utf8");
      const status = JSON.parse(statusContent);

      return res.status(200).json({
        success: true,
        status: status.status || "unknown",
        progress: status.progress || 0,
        outputUrl:
          status.status === "complete"
            ? `/api/download/${username}/${jobId}`
            : null,
        rowCount: status.rowCount || 0,
        completed: status.completed || 0,
        message: status.message || "",
      });
    } catch (error) {
      logger.error(`Error reading status file: ${error.message}`);
      return res.status(500).json({
        success: false,
        message: "Error reading job status",
      });
    }
  }

  return res.status(404).json({
    success: false,
    message: "Job not found",
  });
});

// Download graded file
router.get("/download/:username/:jobId", (req, res) => {
  const { username, jobId } = req.params;

  // Check if the requesting user has permission to access this file
  const requestingUser = req.user.username;

  // Only allow admins or the file owner to download
  if (requestingUser !== username && !req.user.isAdmin) {
    return res.status(403).json({
      success: false,
      message: "You don't have permission to access this file",
    });
  }

  const outputPath = path.join(
    __dirname,
    "..",
    "outputs",
    username,
    `graded_responses_${jobId}.xlsx`
  );

  if (fs.existsSync(outputPath)) {
    // Set response headers to indicate a file download
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=graded_${jobId}.xlsx`
    );
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );

    return res.download(outputPath, `graded_${jobId}.xlsx`, (err) => {
      if (err) {
        logger.error(`Error sending file: ${err}`);
        return res
          .status(500)
          .json({ success: false, message: "Error downloading file" });
      }
    });
  }

  logger.error(`File not found: ${outputPath}`);
  return res.status(404).json({ success: false, message: "File not found" });
});

module.exports = router;
