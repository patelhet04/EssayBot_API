// routes/grading.routes.js
const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { runPythonInCondaEnv } = require("../utils/python-helpers");
const logger = require("../utils/logger");

const router = express.Router();

// Configure storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, "..", "uploads", "essays");
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
  const analyzeProcess = runPythonInCondaEnv(filePath, "analyze_excel");

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
  const { filePath, model } = req.body;
  console.log(filePath, "FILEEEEEE");
  if (!filePath) {
    return res
      .status(400)
      .json({ success: false, message: "No file path provided" });
  }

  // Start grading in the background
  const jobId = `job-${Date.now()}`;

  // Respond immediately
  res.status(202).json({ success: true, jobId });

  // Run grading script in background
  const gradingProcess = runPythonInCondaEnv(filePath, "script", {
    model: model,
    job_id: jobId,
  });

  // Log output (but don't wait for completion)
  gradingProcess.stdout.on("data", (data) => {
    logger.info(`Grading output: ${data}`);
  });

  gradingProcess.stderr.on("data", (data) => {
    logger.error(`Grading error: ${data}`);
  });
});

// Check grading status
router.get("/grading-status/:jobId", (req, res) => {
    const { jobId } = req.params;
    const statusPath = path.join(__dirname, "..", "outputs", `${jobId}.status`);
  
    if (fs.existsSync(statusPath)) {
      const status = JSON.parse(fs.readFileSync(statusPath));
  
      return res.status(200).json({
        success: true,
        status: "complete",  // ✅ Ensure this is included
        outputUrl: `/api/download/${jobId}`,  // ✅ Ensure this is included
        rowCount: status.rowCount || 0,
      });
    }
  
    return res.status(404).json({ success: false, message: "Job not found" });
  });
  
  

// Download graded file
router.get("/download/:jobId", (req, res) => {
  const { jobId } = req.params;
  const outputPath = path.join(__dirname, "..", "outputs", `${jobId}.xlsx`);

  if (fs.existsSync(outputPath)) {
    // Set response headers to indicate a file download
    res.setHeader("Content-Disposition", `attachment; filename=${jobId}.xlsx`);
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );

    return res.download(outputPath, `${jobId}.xlsx`, (err) => {
      if (err) {
        console.error("Error sending file:", err);
        return res
          .status(500)
          .json({ success: false, message: "Error downloading file" });
      }
    });
  }

  console.error(`File not found: ${outputPath}`);
  return res.status(404).json({ success: false, message: "File not found" });
});

module.exports = router;
