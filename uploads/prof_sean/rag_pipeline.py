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

# ============================
# 🔹 Setup Logging
# ============================


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


logger = logging.getLogger(__name__)

# ============================
# 🔹 Directory Structure
# ============================


def get_professor_directories(professor_username, project_root):
    """Ensure professor-specific directories exist."""
    if not professor_username or not project_root:
        raise ValueError(
            "Professor username and project root must be provided.")

    logger.info(f"Using project root: {project_root}")

    professor_base_dir = os.path.join(
        project_root, "uploads", professor_username)
    directories = {
        "base": professor_base_dir,
        "materials": os.path.join(professor_base_dir, "materials"),
        "indices": os.path.join(professor_base_dir, "indices")
    }

    for dir_path in directories.values():
        os.makedirs(dir_path, exist_ok=True)

    return directories


def get_indices_path(professor_username, project_root):
    """Get FAISS indices path for a professor."""
    directories = get_professor_directories(professor_username, project_root)
    return os.path.join(directories["indices"], "faiss_index.pkl")

# ============================
# 🔹 Load Course Materials
# ============================


def extract_text(file_path):
    """Extracts text from PDF, DOCX, or TXT files."""
    logger.info(f"Extracting text from: {file_path}")

    if not os.path.exists(file_path):
        raise FileNotFoundError(f"File not found: {file_path}")

    file_extension = os.path.splitext(file_path)[1].lower()

    try:
        if file_extension == '.pdf':
            reader = PdfReader(file_path)
            return "\n".join(page.extract_text() for page in reader.pages if page.extract_text())

        elif file_extension == '.docx':
            doc = Document(file_path)
            return "\n".join(paragraph.text for paragraph in doc.paragraphs if paragraph.text.strip())

        elif file_extension == '.txt':
            with open(file_path, 'r', encoding='utf-8') as file:
                return file.read()

        else:
            raise ValueError(f"Unsupported file format: {file_extension}")

    except Exception as e:
        logger.error(f"Error extracting text from {file_path}: {e}")
        raise

# ============================
# 🔹 FAISS Vector Store Handling
# ============================


def create_faiss_index(text_chunks, indices_path):
    """Creates and saves FAISS vector store using BAAI/bge-large-en embeddings."""
    os.makedirs(os.path.dirname(indices_path), exist_ok=True)

    embeddings_model = HuggingFaceEmbeddings(model_name="BAAI/bge-large-en")
    faiss_store = FAISS.from_texts(text_chunks, embeddings_model)

    with open(indices_path, "wb") as f:
        pickle.dump(faiss_store, f)

    logger.info(f"FAISS vector store saved at {indices_path}")


def load_faiss_index(indices_path):
    """Loads FAISS index from storage."""
    if os.path.exists(indices_path):
        with open(indices_path, "rb") as f:
            return pickle.load(f)
    else:
        logger.warning(f"No FAISS index found at {indices_path}")
        return None


def retrieve_relevant_text(query, indices_path, k=5):
    """Retrieves relevant text from FAISS using query."""
    faiss_store = load_faiss_index(indices_path)

    if not faiss_store:
        return []

    retriever = faiss_store.as_retriever(
        search_kwargs={"k": k, "search_type": "similarity"})
    retrieved_docs = retriever.invoke(query)

    return [doc.page_content for doc in retrieved_docs]

# ============================
# 🔹 Full Pipeline Execution
# ============================


def process_materials(file_path, indices_path):
    """Extracts text, splits into chunks, embeds, and stores in FAISS."""
    extracted_text = extract_text(file_path)

    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=800, chunk_overlap=200)
    text_chunks = text_splitter.split_text(extracted_text)

    create_faiss_index(text_chunks, indices_path)

    return {
        "success": True,
        "message": "Processed successfully",
        "text_chunks": len(text_chunks),
        "total_text_length": len(extracted_text)
    }


def process_directory(directory_path, indices_path):
    """Processes all files in a directory."""
    if not os.path.isdir(directory_path):
        raise NotADirectoryError(f"Expected a directory: {directory_path}")

    all_text = []
    for filename in os.listdir(directory_path):
        ext = os.path.splitext(filename)[1].lower()
        if ext in ['.pdf', '.docx', '.txt']:
            try:
                file_path = os.path.join(directory_path, filename)
                all_text.append(extract_text(file_path))
            except Exception as e:
                logger.error(f"Error processing file {filename}: {e}")

    if not all_text:
        raise ValueError("No valid documents found in directory")

    combined_text = "\n\n".join(all_text)
    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=800, chunk_overlap=200)
    text_chunks = text_splitter.split_text(combined_text)

    create_faiss_index(text_chunks, indices_path)

    return {"success": True, "message": "Directory processed successfully"}


def initialize_rag_pipeline(file_path, professor_username, project_root):
    """Initializes RAG pipeline and processes input file or directory."""
    logger = setup_logging(professor_username)

    if not project_root or not file_path:
        raise ValueError("File path and project root must be provided.")

    indices_path = get_indices_path(professor_username, project_root)

    if os.path.isdir(file_path):
        return process_directory(file_path, indices_path)
    else:
        return process_materials(file_path, indices_path)

# ============================
# 🔹 CLI Handling
# ============================


def parse_arguments():
    """Parses command-line arguments."""
    parser = argparse.ArgumentParser(
        description="RAG Pipeline for Course Materials")
    parser.add_argument(
        "file", help="Path to the course material file or directory")
    parser.add_argument("--professorUsername",
                        help="Professor username (for multi-professor support)")
    parser.add_argument("--projectRoot", help="Absolute path to project root")
    return parser.parse_args()


def main():
    """Main script execution."""
    args = parse_arguments()
    result = initialize_rag_pipeline(
        args.file, args.professorUsername, args.projectRoot)
    print(json.dumps(result))
    sys.exit(0 if result["success"] else 1)


if __name__ == "__main__":
    main()
