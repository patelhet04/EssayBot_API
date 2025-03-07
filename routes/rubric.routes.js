// routes/rubric.routes.js
const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");
const logger = require("../utils/logger");

const router = express.Router();

// Configure multer for rubric file uploads
const rubricStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, "..", "uploads", "rubrics");
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, `rubric-${uniqueSuffix}${ext}`);
  },
});

const rubricUpload = multer({
  storage: rubricStorage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === ".pdf" || ext === ".docx" || ext === ".doc") {
      cb(null, true);
    } else {
      cb(new Error("Only PDF, DOC, and DOCX files are allowed for rubrics"));
    }
  },
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

// API endpoint to upload and process rubric files
router.post("/upload-rubric", rubricUpload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No file uploaded",
        stage: "upload_validation",
      });
    }

    const filePath = req.file.path;
    const fileName = req.file.originalname;
    const fileType = path.extname(fileName).toLowerCase();

    logger.info(`Processing uploaded rubric: ${fileName}`, {
      filePath,
      fileType,
    });

    // Extract text based on file type
    let extractedText = "";
    let tableData = null;

    if (fileType === ".pdf") {
      const dataBuffer = fs.readFileSync(filePath);
      const pdfData = await pdfParse(dataBuffer);
      extractedText = pdfData.text;
      tableData = extractRubricTableFromPDF(extractedText);
    } else if (fileType === ".docx" || fileType === ".doc") {
      const result = await mammoth.extractRawText({ path: filePath });
      extractedText = result.value;
      tableData = extractRubricTableFromText(extractedText);
    }

    if (!tableData || !tableData.criteria || tableData.criteria.length === 0) {
      logger.warn("No valid rubric table found in uploaded document");
      return res.status(400).json({
        success: false,
        message: "Could not extract a valid rubric table from the document",
        stage: "table_extraction",
      });
    }

    // Update Python agent prompts if needed
    const agentUpdated = await updateAgentPrompts(tableData);

    // Save the rubric data for future use
    const rubricData = {
      id: `rubric-${Date.now()}`,
      name: req.body.name || "Unnamed Rubric",
      dateUploaded: new Date().toISOString(),
      filePath: filePath,
      criteria: tableData.criteria,
    };

    // Save to a JSON file for persistence
    const rubricStorePath = path.join(__dirname, "..", "data", "rubrics.json");
    let existingRubrics = [];

    if (fs.existsSync(rubricStorePath)) {
      const rubricFileContent = fs.readFileSync(rubricStorePath, "utf8");
      existingRubrics = JSON.parse(rubricFileContent);
    } else {
      // Create the data directory if it doesn't exist
      if (!fs.existsSync(path.dirname(rubricStorePath))) {
        fs.mkdirSync(path.dirname(rubricStorePath), { recursive: true });
      }
    }

    existingRubrics.push(rubricData);
    fs.writeFileSync(rubricStorePath, JSON.stringify(existingRubrics, null, 2));

    res.status(200).json({
      success: true,
      message: "Rubric processed successfully",
      rubric: tableData,
      agentUpdated: agentUpdated,
      id: rubricData.id,
    });
  } catch (error) {
    logger.error("Error processing rubric file", {
      error: error.message,
      stack: error.stack,
    });

    res.status(500).json({
      success: false,
      message: "Error processing rubric file",
      error: error.message,
    });
  }
});

// Save the finalized rubric
router.post("/save-rubric", express.json(), async (req, res) => {
  try {
    const { rubricId, criteria } = req.body;

    if (!rubricId || !criteria || !Array.isArray(criteria)) {
      return res.status(400).json({
        success: false,
        message: "Invalid rubric data",
      });
    }

    // Update existing rubric
    const rubricStorePath = path.join(__dirname, "..", "data", "rubrics.json");
    if (!fs.existsSync(rubricStorePath)) {
      return res.status(404).json({
        success: false,
        message: "No rubrics found",
      });
    }

    const rubricFileContent = fs.readFileSync(rubricStorePath, "utf8");
    const rubrics = JSON.parse(rubricFileContent);

    const rubricIndex = rubrics.findIndex((r) => r.id === rubricId);
    if (rubricIndex === -1) {
      return res.status(404).json({
        success: false,
        message: "Rubric not found",
      });
    }

    // Update the criteria
    rubrics[rubricIndex].criteria = criteria;

    // Save updated rubrics
    fs.writeFileSync(rubricStorePath, JSON.stringify(rubrics, null, 2));

    // Update the Python agent prompts
    const tableData = { criteria };
    const agentUpdated = await updateAgentPrompts(tableData);

    res.status(200).json({
      success: true,
      message: "Rubric saved successfully",
      agentUpdated,
    });
  } catch (error) {
    logger.error("Error saving rubric", {
      error: error.message,
      stack: error.stack,
    });

    res.status(500).json({
      success: false,
      message: "Error saving rubric",
      error: error.message,
    });
  }
});

// Endpoint to get a specific rubric
router.get("/rubric/:id", (req, res) => {
  try {
    const { id } = req.params;
    const rubricStorePath = path.join(__dirname, "..", "data", "rubrics.json");

    if (!fs.existsSync(rubricStorePath)) {
      return res.status(404).json({
        success: false,
        message: "No rubrics found",
      });
    }

    const rubricFileContent = fs.readFileSync(rubricStorePath, "utf8");
    const rubrics = JSON.parse(rubricFileContent);

    const rubric = rubrics.find((r) => r.id === id);
    if (!rubric) {
      return res.status(404).json({
        success: false,
        message: "Rubric not found",
      });
    }

    res.status(200).json({
      success: true,
      rubric,
    });
  } catch (error) {
    logger.error("Error retrieving rubric", {
      error: error.message,
      stack: error.stack,
    });

    res.status(500).json({
      success: false,
      message: "Error retrieving rubric",
      error: error.message,
    });
  }
});

function extractRubricTableFromPDF(text) {
  try {
    // Look for the rubric table section
    const rubricSection = text.match(
      /Grading Rubric:([\s\S]*?)Sample Answer:/i
    );

    if (!rubricSection) {
      logger.warn('Could not find "Grading Rubric:" section in PDF');
      return { criteria: getDefaultCriteria() };
    }

    const rubricText = rubricSection[1];

    // Extract criteria - handle parentheses in criteria names
    const criteriaPattern = /([\w\s&()]+)\s*\((\d+)\s*points?\)/gi;
    const matches = [...rubricText.matchAll(criteriaPattern)];

    if (matches.length === 0) {
      logger.warn("No criteria matches found in rubric text, using defaults");
      return { criteria: getDefaultCriteria() };
    }

    // First pass to get criteria names
    const extractedCriteria = matches.map((match) => {
      // Clean up the name, remove numbers and standardize
      let name = match[1].trim().replace(/^\d+\)?\s*/, "");
      const points = parseInt(match[2]) || 0;
      return { name, points };
    });

    // Check if we found all expected criteria
    const expectedNames = [
      "Identification and Order of Steps",
      "Explanation of Steps",
      "Understanding the Goals of the Steps",
      "Clarity and Organization",
    ];

    // If any key criteria are missing, return defaults
    const foundAllCriteria = expectedNames.every((expected) =>
      extractedCriteria.some((c) =>
        c.name.toLowerCase().includes(expected.toLowerCase())
      )
    );

    if (!foundAllCriteria) {
      logger.warn("Not all expected criteria found, using defaults");
      return { criteria: getDefaultCriteria() };
    }

    const criteria = [];

    for (const { name, points } of extractedCriteria) {
      // Get the appropriate scoring levels based on criteria name
      const scoringInfo = getScoringInfoForCriteria(name);

      criteria.push({
        name: scoringInfo.standardName,
        description: scoringInfo.description,
        weight: points,
        scoringLevels: {
          full: scoringInfo.full,
          partial: scoringInfo.partial,
          minimal: scoringInfo.minimal,
        },
        subCriteria: [],
      });
    }

    return { criteria };
  } catch (error) {
    logger.error("Error extracting rubric from PDF", { error });
    return { criteria: getDefaultCriteria() };
  }
}

// Helper function to get predetermined scoring info based on criteria name
function getScoringInfoForCriteria(name) {
  // Normalize the name for matching
  const normalizedName = name.toLowerCase();

  if (
    normalizedName.includes("identification") ||
    normalizedName.includes("order of steps")
  ) {
    return {
      standardName: "Identification and Order of Steps",
      description:
        "Clearly lists all four major steps (segmentation, targeting, differentiation, positioning) in correct order.",
      full: "Lists all four steps in the correct order.",
      partial: "Lists three steps or has them out of order.",
      minimal: "Lists fewer than three steps or omits key terminology.",
    };
  } else if (normalizedName.includes("explanation of steps")) {
    return {
      standardName: "Explanation of Steps",
      description:
        "Provides accurate, concise explanations of each step, aligned with textbook definitions.",
      full: "Explanations are accurate, clear, and concise.",
      partial: "Explanations are mostly accurate but lack detail or depth.",
      minimal: "Explanations are vague or contain inaccuracies.",
    };
  } else if (
    normalizedName.includes("understanding") ||
    normalizedName.includes("goals")
  ) {
    return {
      standardName: "Understanding the Goals of the Steps",
      description:
        "Clearly explains what the company seeks to achieve in the first two steps (selecting customers) versus the last two (creating value proposition).",
      full: "Explanation is clear and aligns with course concepts.",
      partial:
        "Explanation is somewhat clear but lacks connection to course material.",
      minimal: "Explanation is unclear or missing.",
    };
  } else if (
    normalizedName.includes("clarity") ||
    normalizedName.includes("organization")
  ) {
    return {
      standardName: "Clarity and Organization",
      description:
        "Response is well-structured, logical, and free from errors in grammar or spelling.",
      full: "Response is clear, well-organized, and error-free.",
      partial: "Response has minor organization or clarity issues.",
      minimal: "Response is poorly organized or difficult to follow.",
    };
  } else {
    // Default for unknown criteria
    return {
      standardName: name,
      description: "",
      full: "",
      partial: "",
      minimal: "",
    };
  }
}

// Get default criteria when extraction fails
function getDefaultCriteria() {
  return [
    {
      name: "Identification and Order of Steps",
      description:
        "Clearly lists all four major steps (segmentation, targeting, differentiation, positioning) in correct order.",
      weight: 30,
      scoringLevels: {
        full: "Lists all four steps in the correct order.",
        partial: "Lists three steps or has them out of order.",
        minimal: "Lists fewer than three steps or omits key terminology.",
      },
      subCriteria: [],
    },
    {
      name: "Explanation of Steps",
      description:
        "Provides accurate, concise explanations of each step, aligned with textbook definitions.",
      weight: 30,
      scoringLevels: {
        full: "Explanations are accurate, clear, and concise.",
        partial: "Explanations are mostly accurate but lack detail or depth.",
        minimal: "Explanations are vague or contain inaccuracies.",
      },
      subCriteria: [],
    },
    {
      name: "Understanding the Goals of the Steps",
      description:
        "Clearly explains what the company seeks to achieve in the first two steps (selecting customers) versus the last two (creating value proposition).",
      weight: 30,
      scoringLevels: {
        full: "Explanation is clear and aligns with course concepts.",
        partial:
          "Explanation is somewhat clear but lacks connection to course material.",
        minimal: "Explanation is unclear or missing.",
      },
      subCriteria: [],
    },
    {
      name: "Clarity and Organization",
      description:
        "Response is well-structured, logical, and free from errors in grammar or spelling.",
      weight: 10,
      scoringLevels: {
        full: "Response is clear, well-organized, and error-free.",
        partial: "Response has minor organization or clarity issues.",
        minimal: "Response is poorly organized or difficult to follow.",
      },
      subCriteria: [],
    },
  ];
}

// Update the Python agent prompts based on the rubric
async function updateAgentPrompts(tableData) {
  try {
    // Path to the agents.py file
    const agentsFilePath = path.join(__dirname, "..", "python", "agents.py");

    if (!fs.existsSync(agentsFilePath)) {
      logger.error("agents.py file not found");
      return false;
    }

    // Read the current content
    let agentsContent = fs.readFileSync(agentsFilePath, "utf8");

    // Define mapping between criteria names and agent numbers
    const criteriaToAgentMap = {
      "Identification and Order of Steps": 1,
      "Explanation of Steps": 2,
      "Understanding the Goals of the Steps": 3,
      "Clarity and Organization": 4,
    };

    // Update each agent prompt based on the criteria
    tableData.criteria.forEach((criterion) => {
      const agentNumber = criteriaToAgentMap[criterion.name];

      if (!agentNumber) {
        logger.warn(`No matching agent found for criterion: ${criterion.name}`);
        return; // Skip this criterion
      }

      // Update agent header with correct points
      const agentHeaderPattern = new RegExp(
        `(### \\*\\*Agent ${agentNumber}:[^\\(]*?)\\(\\d+\\s*Points\\)`,
        "i"
      );
      if (agentHeaderPattern.test(agentsContent)) {
        agentsContent = agentsContent.replace(
          agentHeaderPattern,
          `$1(${criterion.weight} Points)`
        );
        logger.info(
          `Updated agent ${agentNumber} header with ${criterion.weight} points`
        );
      }

      // Update JSON output format with correct points
      const jsonFormatPattern = new RegExp(
        `(json_output_format.replace\\('30', ')(\\d+)('\\))`,
        "g"
      );
      if (agentNumber === 4 && jsonFormatPattern.test(agentsContent)) {
        agentsContent = agentsContent.replace(
          jsonFormatPattern,
          `$1${criterion.weight}$3`
        );
        logger.info(`Updated JSON output format for agent ${agentNumber}`);
      }

      // Update points in evaluation criteria sections
      const evaluationPattern = new RegExp(
        `(#### \\*\\*Evaluation Criteria\\*\\*[\\s\\S]*?worth\\s+)\\d+(\\.\\d+)?\\s*(marks|points)`,
        "i"
      );
      if (evaluationPattern.test(agentsContent)) {
        const pointsPerItem = criterion.weight / 4; // Assuming 4 items in criteria
        agentsContent = agentsContent.replace(
          evaluationPattern,
          `$1${pointsPerItem.toFixed(1)} $3`
        );
        logger.info(
          `Updated evaluation criteria points for agent ${agentNumber}`
        );
      }
    });

    // Write the updated content back
    fs.writeFileSync(agentsFilePath, agentsContent);
    logger.info("Successfully updated all agent prompts");

    return true;
  } catch (error) {
    logger.error("Error updating agent prompts", {
      error: error.message,
      stack: error.stack,
    });
    return false;
  }
}

module.exports = router;
