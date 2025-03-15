import os
import sys
import pickle
import logging
import argparse
import json
from PyPDF2 import PdfReader
from docx import Document
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_community.vectorstores import FAISS
from scipy.spatial.distance import cosine


def setup_logging(professor_username=None):
    """Configure logging with professor-specific log file if provided."""
    log_filename = f"rag_pipeline_{professor_username}.log" if professor_username else "rag_pipeline.log"

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s - %(levelname)s - %(message)s",
        handlers=[
            logging.FileHandler(log_filename),
            logging.StreamHandler()
        ]
    )
    return logging.getLogger(__name__)


# Create logger with default name initially
logger = logging.getLogger(__name__)

# ============================
# Directory Structure Functions
# ============================


def get_professor_directories(professor_username, project_root=None):
    """Get directory paths for a specific professor."""
    if not professor_username:
        logger.error("Professor username not provided")
        raise ValueError("Professor username not provided")

    # ALWAYS use the provided project root and stop calculating it
    if not project_root:
        logger.error("Project root not provided")
        raise ValueError("Project root not provided")

    logger.info(f"Using provided project root: {project_root}")

    professor_base_dir = os.path.join(
        project_root, "uploads", professor_username)
    logger.info(f"Professor base directory: {professor_base_dir}")

    directories = {
        "base": professor_base_dir,
        "materials": os.path.join(professor_base_dir, "materials"),
        "indices": os.path.join(professor_base_dir, "indices")
    }

    # Create directories if they don't exist
    for dir_path in directories.values():
        if not os.path.exists(dir_path):
            os.makedirs(dir_path, exist_ok=True)
            logger.info(f"Created directory: {dir_path}")

    return directories


def get_indices_path(professor_username, project_root=None):
    """Get the path to the FAISS indices file for a specific professor."""
    directories = get_professor_directories(professor_username, project_root)
    return os.path.join(directories["indices"], "faiss_index.pkl")

# ============================
# 1️⃣ Load Course Materials
# ============================


def extract_text_from_pdf(file_path):
    """Extracts text from a PDF file."""
    logger.info(f"Extracting text from PDF: {file_path}...")
    try:
        reader = PdfReader(file_path)
        text = []
        for page in reader.pages:
            if page.extract_text():
                text.append(page.extract_text().strip())
        return "\n".join(text)
    except Exception as e:
        logger.error(f"Error extracting text from PDF {file_path}: {str(e)}")
        raise Exception(f"PDF extraction error: {str(e)}")


def extract_text_from_docx(file_path):
    """Extracts text from a DOCX file."""
    logger.info(f"Extracting text from DOCX: {file_path}...")
    try:
        doc = Document(file_path)
        text = []
        for paragraph in doc.paragraphs:
            if paragraph.text.strip():
                text.append(paragraph.text.strip())
        return "\n".join(text)
    except Exception as e:
        logger.error(f"Error extracting text from DOCX {file_path}: {str(e)}")
        raise Exception(f"DOCX extraction error: {str(e)}")


def extract_text_from_txt(file_path):
    """Extracts text from a TXT file."""
    logger.info(f"Extracting text from TXT: {file_path}...")
    try:
        with open(file_path, 'r', encoding='utf-8') as file:
            return file.read()
    except Exception as e:
        logger.error(f"Error extracting text from TXT {file_path}: {str(e)}")
        raise Exception(f"TXT extraction error: {str(e)}")


def load_course_materials(file_path):
    """Loads and extracts text from the course material file."""
    logger.info(f"Loading course material from {file_path}")

    if not file_path:
        error_msg = "Empty file path provided"
        logger.error(error_msg)
        raise ValueError(error_msg)

    if not os.path.exists(file_path):
        error_msg = f"File not found: {file_path}"
        logger.error(error_msg)
        raise FileNotFoundError(error_msg)

    if os.path.isdir(file_path):
        error_msg = f"Expected a file but got a directory: {file_path}"
        logger.error(error_msg)
        raise IsADirectoryError(error_msg)

    file_extension = os.path.splitext(file_path)[1].lower()

    if file_extension == '.pdf':
        extracted_text = extract_text_from_pdf(file_path)
    elif file_extension == '.docx':
        extracted_text = extract_text_from_docx(file_path)
    elif file_extension == '.txt':
        extracted_text = extract_text_from_txt(file_path)
    else:
        error_msg = f"Unsupported file format: {file_extension}"
        logger.error(error_msg)
        raise ValueError(error_msg)

    if not extracted_text or len(extracted_text.strip()) == 0:
        error_msg = f"No text could be extracted from file: {file_path}"
        logger.error(error_msg)
        raise ValueError(error_msg)

    logger.info(
        f"Course material extracted successfully. Total length: {len(extracted_text)} characters")
    return extracted_text

# ============================
# 2️⃣ Structure Extracted Knowledge
# ============================


def get_category_embeddings():
    """Generate embeddings for category descriptions for semantic classification."""
    categories = {
        "Market Segmentation": "Defining market segmentation, types of segmentation (demographic, geographic, psychographic, behavioral).",
        "Targeting": "Market targeting strategies, choosing a target market, evaluating segments.",
        "Differentiation & Positioning": "Positioning strategy, points of differentiation, value proposition.",
        "Marketing Mix (4Ps)": "Product strategy, pricing strategy, placement/distribution, promotion strategy.",
        "Marketing Strategy & Planning": "Customer-driven marketing strategy, strategic planning process, competitive advantage.",
    }

    embeddings_model = HuggingFaceEmbeddings(
        model_name="sentence-transformers/all-MiniLM-L6-v2")

    category_embeddings = {cat: embeddings_model.embed_query(
        desc) for cat, desc in categories.items()}
    return category_embeddings


def categorize_extracted_text(extracted_text):
    """Categorizes extracted text using semantic similarity, filtering long case studies while keeping short useful ones."""
    structured_knowledge = {
        "Market Segmentation": [],
        "Targeting": [],
        "Differentiation & Positioning": [],
        "Marketing Mix (4Ps)": [],
        "Marketing Strategy & Planning": []
    }

    category_embeddings = get_category_embeddings()
    embeddings_model = HuggingFaceEmbeddings(
        model_name="sentence-transformers/all-MiniLM-L6-v2")

    # Adjusted chunk size for better context retention
    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=800, chunk_overlap=200)
    chunks = text_splitter.split_text(extracted_text)

    for chunk in chunks:
        # Exclude long, non-explanatory case studies
        if "case study" in chunk.lower() and len(chunk) > 800:
            continue

        chunk_embedding = embeddings_model.embed_query(chunk)
        best_category = min(category_embeddings.keys(),
                            key=lambda cat: cosine(chunk_embedding, category_embeddings[cat]))

        structured_knowledge[best_category].append(chunk)

    logger.info(
        f"Extracted knowledge successfully categorized. Categories: {', '.join(structured_knowledge.keys())}")
    logger.info(f"Total chunks processed: {len(chunks)}")
    for category, texts in structured_knowledge.items():
        logger.info(f"  - {category}: {len(texts)} chunks")

    return structured_knowledge

# ============================
# 3️⃣ Create FAISS Vector Store
# ============================


def create_faiss_indices(structured_knowledge, indices_path):
    """Creates FAISS vector store for each knowledge category."""
    # Create the directory if it doesn't exist
    os.makedirs(os.path.dirname(indices_path), exist_ok=True)

    embeddings_model = HuggingFaceEmbeddings(
        model_name="sentence-transformers/all-MiniLM-L6-v2")
    faiss_indices = {}

    for category, texts in structured_knowledge.items():
        if not texts:
            logger.warning(f"No texts found for category: {category}")
            continue

        # Create FAISS index
        logger.info(f"Creating FAISS index for category: {category}")
        faiss_store = FAISS.from_texts(texts, embeddings_model)
        faiss_indices[category] = faiss_store

    # Save FAISS indices
    logger.info(f"Saving FAISS indices to {indices_path}")
    with open(indices_path, "wb") as f:
        pickle.dump(faiss_indices, f)

    logger.info("FAISS vector stores created and saved successfully.")
    return faiss_indices

# ============================
# 4️⃣ Retrieve Relevant Context
# ============================


def load_faiss_indices(indices_path):
    """Loads FAISS indices from saved file."""
    try:
        logger.info(f"Loading FAISS indices from {indices_path}")
        if os.path.exists(indices_path):
            with open(indices_path, "rb") as f:
                indices = pickle.load(f)
            logger.info(f"Loaded {len(indices)} FAISS indices successfully")
            return indices
        else:
            logger.warning(f"FAISS indices file not found: {indices_path}")
            return None
    except Exception as e:
        logger.error(f"Error loading FAISS indices: {str(e)}")
        return None


def retrieve_relevant_text(query, category, k=5, professor_username=None, project_root=None):
    indices_path = get_indices_path(
        professor_username, project_root) if professor_username else "faiss_indices.pkl"
    logger.info(f"Attempting to retrieve text from indices at: {indices_path}")
    faiss_indices = load_faiss_indices(indices_path)
    if not faiss_indices or category not in faiss_indices:
        logger.warning(
            f"Category '{category}' not found in FAISS indices. Returning empty context.")
        return []
    retriever = faiss_indices[category].as_retriever(
        search_kwargs={"k": k, "fetch_k": 10,
                       "score_threshold": 0.7, "search_type": "similarity"}
    )
    retrieved_docs = retriever.invoke(query)
    prioritized_docs = [doc for doc in retrieved_docs if all(
        step in doc.page_content.lower() for step in ["segmentation", "targeting", "differentiation", "positioning"]
    )]
    return [doc.page_content for doc in (prioritized_docs if prioritized_docs else retrieved_docs)]


# ============================
# 5️⃣ Process Multiple Files
# ============================


def process_directory(directory_path, indices_path):
    """
    Process all supported files in a directory and create FAISS indices.

    Args:
        directory_path: Path to the directory containing course materials
        indices_path: Path where FAISS indices will be saved

    Returns:
        Dictionary with processing results
    """
    logger.info(f"Processing directory: {directory_path}")

    if not os.path.exists(directory_path):
        error_msg = f"Directory not found: {directory_path}"
        logger.error(error_msg)
        raise FileNotFoundError(error_msg)

    if not os.path.isdir(directory_path):
        error_msg = f"Expected a directory: {directory_path}"
        logger.error(error_msg)
        raise NotADirectoryError(error_msg)

    # Find all supported files in the directory
    all_texts = []
    processed_files = []

    for filename in os.listdir(directory_path):
        ext = os.path.splitext(filename)[1].lower()
        if ext in ['.pdf', '.docx', '.txt']:
            try:
                file_path = os.path.join(directory_path, filename)
                logger.info(f"Processing file: {file_path}")
                extracted_text = load_course_materials(file_path)
                all_texts.append(extracted_text)
                processed_files.append(filename)
            except Exception as e:
                logger.error(f"Error processing file {filename}: {str(e)}")

    if not all_texts:
        error_msg = "No valid documents found in directory"
        logger.error(error_msg)
        raise ValueError(error_msg)

    # Combine all extracted texts
    combined_text = "\n\n".join(all_texts)

    # Process the combined text
    structured_knowledge = categorize_extracted_text(combined_text)

    # Create FAISS vector store
    create_faiss_indices(structured_knowledge, indices_path)

    return {
        "success": True,
        "message": "Directory processed successfully",
        "processed_files": processed_files,
        "stats": {
            "num_files": len(processed_files),
            "total_text_length": len(combined_text),
            "categories": {category: len(texts) for category, texts in structured_knowledge.items()}
        }
    }

# ============================
# 6️⃣ Main Functions
# ============================


def process_full_pipeline(file_path, indices_path, result):
    """Process the full pipeline to create FAISS indices from scratch."""
    try:
        # Check if file_path is a directory
        if os.path.isdir(file_path):
            logger.info(f"Processing directory: {file_path}")
            # Process all supported files in the directory
            all_texts = []
            file_count = 0

            for filename in os.listdir(file_path):
                ext = os.path.splitext(filename)[1].lower()
                if ext in ['.pdf', '.docx', '.txt']:
                    try:
                        full_path = os.path.join(file_path, filename)
                        logger.info(f"Processing file: {full_path}")
                        text = load_course_materials(full_path)
                        all_texts.append(text)
                        file_count += 1
                    except Exception as e:
                        logger.error(
                            f"Error processing file {filename}: {str(e)}")

            if not all_texts:
                raise ValueError("No valid documents found in directory")

            # Combine all extracted texts
            extracted_text = "\n\n".join(all_texts)
            result["stats"]["file_count"] = file_count
        else:
            # Process a single file
            extracted_text = load_course_materials(file_path)
            result["stats"]["file_count"] = 1

        result["steps_completed"].append("load_course_materials")
        result["stats"]["extracted_text_length"] = len(extracted_text)

        # Step 2: Categorize extracted knowledge
        structured_knowledge = categorize_extracted_text(extracted_text)
        result["steps_completed"].append("categorize_extracted_text")
        result["stats"]["categories"] = {category: len(
            texts) for category, texts in structured_knowledge.items()}

        # Step 3: Create FAISS vector store
        create_faiss_indices(structured_knowledge, indices_path)
        result["steps_completed"].append("create_faiss_indices")

        result["message"] = "RAG pipeline initialized successfully"
        return result

    except Exception as e:
        logger.error(f"Error in process_full_pipeline: {str(e)}")
        result["success"] = False
        result["message"] = f"Error in process_full_pipeline: {str(e)}"
        return result


def initialize_rag_pipeline(file_path, professor_username=None, project_root=None):
    global logger
    # Set up professor-specific logging
    if professor_username:
        logger = setup_logging(professor_username)

    result = {
        "success": True,
        "message": "",
        "steps_completed": [],
        "stats": {}
    }

    try:
        logger.info(
            f"Initializing RAG pipeline for professor: {professor_username or 'Unknown'}")

        # Validate the project root
        if not project_root:
            error_msg = "Project root not provided"
            logger.error(error_msg)
            raise ValueError(error_msg)

        # Validate the file path
        if not file_path:
            error_msg = "Empty file path provided"
            logger.error(error_msg)
            raise ValueError(error_msg)

        if not os.path.exists(file_path):
            error_msg = f"Path does not exist: '{file_path}'"
            logger.error(error_msg)
            raise FileNotFoundError(error_msg)

        logger.info(f"Processing path: {file_path}")

        # Get professor-specific indices path, always passing project_root
        indices_path = get_indices_path(professor_username, project_root)
        logger.info(f"FAISS indices path: {indices_path}")

        # Check if FAISS indices already exist
        if os.path.exists(indices_path):
            logger.info(f"FAISS indices already exist at {indices_path}")
            existing_indices = load_faiss_indices(indices_path)
            if existing_indices:
                logger.info(
                    "Successfully loaded existing FAISS indices. Will append new content.")
                result["steps_completed"].append("load_existing_faiss_indices")

                # Process new content and update existing indices
                try:
                    if os.path.isdir(file_path):
                        # Process directory and update indices
                        dir_result = process_directory(file_path, indices_path)
                        result["steps_completed"].extend(
                            ["process_directory", "update_faiss_indices"])
                        result["stats"].update(dir_result["stats"])
                    else:
                        # Process single file and update indices
                        extracted_text = load_course_materials(file_path)
                        result["steps_completed"].append(
                            "load_course_materials")
                        result["stats"]["extracted_text_length"] = len(
                            extracted_text)

                        structured_knowledge = categorize_extracted_text(
                            extracted_text)
                        result["steps_completed"].append(
                            "categorize_extracted_text")
                        result["stats"]["categories"] = {category: len(
                            texts) for category, texts in structured_knowledge.items()}

                        # For now, we'll just create new indices
                        create_faiss_indices(
                            structured_knowledge, indices_path)
                        result["steps_completed"].append(
                            "update_faiss_indices")

                    result["message"] = "Updated FAISS indices with new content"
                except Exception as e:
                    logger.error(f"Error updating indices: {str(e)}")
                    # If updating fails, start from scratch
                    logger.info("Retrying with full pipeline from scratch")
                    return process_full_pipeline(file_path, indices_path, result)
            else:
                logger.warning(
                    f"Failed to load existing indices at {indices_path}, creating new ones")
                # Proceed with full pipeline
                return process_full_pipeline(file_path, indices_path, result)
        else:
            logger.info(
                f"No existing FAISS indices found at {indices_path}, creating new ones")
            # Proceed with full pipeline
            return process_full_pipeline(file_path, indices_path, result)

        logger.info(
            f"RAG pipeline initialized successfully for professor: {professor_username or 'Unknown'}")
    except Exception as e:
        result["success"] = False
        result["message"] = f"Error initializing RAG pipeline: {str(e)}"
        logger.error(f"Error initializing RAG pipeline: {str(e)}")

    return result


def parse_arguments():
    """Parse command line arguments."""
    parser = argparse.ArgumentParser(
        description="RAG Pipeline for Course Materials")
    parser.add_argument(
        "file", help="Path to the course material file or directory")
    parser.add_argument("--professorUsername",
                        help="Username of the professor (for multi-professor support)")
    parser.add_argument("--projectRoot", help="Absolute path to project root")
    parser.add_argument("--reinitialize", action="store_true",
                        help="Force reinitialization of indices")
    return parser.parse_args()


def main():
    """Main entry point for the script."""
    logger.info(f"Raw command line arguments: {sys.argv}")
    args = parse_arguments()
    logger.info(
        f"Parsed arguments: file={args.file}, professorUsername={args.professorUsername}, projectRoot={getattr(args, 'projectRoot', 'NOT_PRESENT')}")
    print(f"ARGSSSSS", args)
    # If reinitialize flag is set and it's a directory, use process_directory
    if args.reinitialize and os.path.isdir(args.file):
        try:
            indices_path = get_indices_path(
                args.professorUsername) if args.professorUsername else "faiss_indices.pkl"
            # Delete existing indices if they exist
            if os.path.exists(indices_path):
                os.remove(indices_path)
                logger.info(f"Deleted existing indices at {indices_path}")

            result = process_directory(args.file, indices_path)
        except Exception as e:
            result = {
                "success": False,
                "message": f"Error reinitializing RAG pipeline: {str(e)}",
                "steps_completed": [],
                "stats": {}
            }

    else:
        # Initialize the RAG pipeline with professor username

        result = initialize_rag_pipeline(
            args.file, args.professorUsername, args.projectRoot)

    # Output result as JSON for the Node.js server to capture
    print(json.dumps(result))

    # Return appropriate exit code
    sys.exit(0 if result["success"] else 1)


if __name__ == "__main__":
    main()
