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

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
    handlers=[
        logging.FileHandler("rag_pipeline_mktg2201.log"),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

# ============================
# 1️⃣ Load Course Materials
# ============================

def extract_text_from_pdf(file_path):
    """Extracts text from a PDF file."""
    logger.info(f"Extracting text from PDF: {file_path}...")
    reader = PdfReader(file_path)
    text = []
    for page in reader.pages:
        if page.extract_text():
            text.append(page.extract_text().strip())
    return "\n".join(text)

def extract_text_from_docx(file_path):
    """Extracts text from a DOCX file."""
    logger.info(f"Extracting text from DOCX: {file_path}...")
    doc = Document(file_path)
    text = []
    for paragraph in doc.paragraphs:
        if paragraph.text.strip():
            text.append(paragraph.text.strip())
    return "\n".join(text)

def extract_text_from_txt(file_path):
    """Extracts text from a TXT file."""
    logger.info(f"Extracting text from TXT: {file_path}...")
    with open(file_path, 'r', encoding='utf-8') as file:
        return file.read()

def load_course_materials(file_path):
    """Loads and extracts text from the course material file."""
    logger.info(f"Loading course material from {file_path}")
    
    if not os.path.exists(file_path):
        error_msg = f"File not found: {file_path}"
        logger.error(error_msg)
        raise FileNotFoundError(error_msg)
    
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
    
    logger.info(f"Course material extracted successfully. Total length: {len(extracted_text)} characters")
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
    
    embeddings_model = HuggingFaceEmbeddings(model_name="sentence-transformers/all-MiniLM-L6-v2")
    
    category_embeddings = {cat: embeddings_model.embed_query(desc) for cat, desc in categories.items()}
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
    embeddings_model = HuggingFaceEmbeddings(model_name="sentence-transformers/all-MiniLM-L6-v2")

    # Adjusted chunk size for better context retention
    text_splitter = RecursiveCharacterTextSplitter(chunk_size=800, chunk_overlap=200)
    chunks = text_splitter.split_text(extracted_text)

    for chunk in chunks:
        # Exclude long, non-explanatory case studies
        if "case study" in chunk.lower() and len(chunk) > 800:
            continue  

        chunk_embedding = embeddings_model.embed_query(chunk)
        best_category = min(category_embeddings.keys(),
                            key=lambda cat: cosine(chunk_embedding, category_embeddings[cat]))
        
        structured_knowledge[best_category].append(chunk)

    logger.info(f"Extracted knowledge successfully categorized. Categories: {', '.join(structured_knowledge.keys())}")
    logger.info(f"Total chunks processed: {len(chunks)}")
    for category, texts in structured_knowledge.items():
        logger.info(f"  - {category}: {len(texts)} chunks")
    
    return structured_knowledge

# ============================
# 3️⃣ Create FAISS Vector Store
# ============================

def create_faiss_indices(structured_knowledge, output_file="faiss_indices_mktg2201.pkl"):
    """Creates FAISS vector store for each knowledge category."""
    embeddings_model = HuggingFaceEmbeddings(model_name="sentence-transformers/all-MiniLM-L6-v2")
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
    logger.info(f"Saving FAISS indices to {output_file}")
    with open(output_file, "wb") as f:
        pickle.dump(faiss_indices, f)

    logger.info("FAISS vector stores created and saved successfully.")
    return faiss_indices

# ============================
# 4️⃣ Retrieve Relevant Context
# ============================

def load_faiss_indices(indices_file="faiss_indices_mktg2201.pkl"):
    """Loads FAISS indices from saved file."""
    try:
        logger.info(f"Loading FAISS indices from {indices_file}")
        with open(indices_file, "rb") as f:
            indices = pickle.load(f)
        logger.info(f"Loaded {len(indices)} FAISS indices successfully")
        return indices
    except FileNotFoundError:
        logger.error(f"FAISS indices file not found: {indices_file}")
        return None
    except Exception as e:
        logger.error(f"Error loading FAISS indices: {str(e)}")
        return None

def retrieve_relevant_text(query, category, k=5, indices_file="faiss_indices_mktg2201.pkl"):
    """
    Retrieves relevant context from FAISS category index with multi-step prioritization.
    - Prefers sections discussing multiple steps together.
    """
    faiss_indices = load_faiss_indices(indices_file)
    if not faiss_indices or category not in faiss_indices:
        logger.warning(f"Category '{category}' not found in FAISS indices. Returning empty context.")
        return []

    retriever = faiss_indices[category].as_retriever(
        search_kwargs={"k": k, "fetch_k": 10, "score_threshold": 0.7, "search_type": "similarity"}
    )
    retrieved_docs = retriever.invoke(query)
    # Prioritize context that discusses multiple steps together
    prioritized_docs = [doc for doc in retrieved_docs if all(
        step in doc.page_content.lower() for step in ["segmentation", "targeting", "differentiation", "positioning"]
    )]

    return [doc.page_content for doc in (prioritized_docs if prioritized_docs else retrieved_docs)]

# ============================
# 5️⃣ Main Execution
# ============================

def initialize_rag_pipeline(file_path=None, output_file="faiss_indices_mktg2201.pkl"):
    """
    Loads course materials, categorizes them, and creates FAISS indexes.
    
    Args:
        file_path: Path to the course material file
        output_file: Path to save the FAISS indices
        
    Returns:
        Dictionary with processing results
    """
    result = {
        "success": True,
        "message": "",
        "steps_completed": [],
        "stats": {}
    }
    
    try:
        logger.info(f"Initializing RAG pipeline with file: {file_path}")
        
        # If file_path is not provided, use default
        if not file_path:
            file_path = "MKTG_2201_Study_Textbook.pdf"
            logger.info(f"No file specified, using default: {file_path}")
        
        # Step 1: Load course materials
        extracted_text = load_course_materials(file_path)
        result["steps_completed"].append("load_course_materials")
        result["stats"]["extracted_text_length"] = len(extracted_text)
        
        # Step 2: Categorize extracted knowledge
        structured_knowledge = categorize_extracted_text(extracted_text)
        result["steps_completed"].append("categorize_extracted_text")
        result["stats"]["categories"] = {category: len(texts) for category, texts in structured_knowledge.items()}
        
        # Step 3: Create FAISS vector store
        create_faiss_indices(structured_knowledge, output_file)
        result["steps_completed"].append("create_faiss_indices")
        
        result["message"] = "RAG pipeline initialized successfully"
        logger.info("RAG pipeline initialized successfully")
    except Exception as e:
        result["success"] = False
        result["message"] = f"Error initializing RAG pipeline: {str(e)}"
        logger.error(f"Error initializing RAG pipeline: {str(e)}")
    
    return result

def parse_arguments():
    """Parse command line arguments."""
    parser = argparse.ArgumentParser(description="RAG Pipeline for Course Materials")
    parser.add_argument("--file", help="Path to the course material file")
    parser.add_argument("--output", default="faiss_indices_mktg2201.pkl", 
                        help="Path to save FAISS indices (default: faiss_indices_mktg2201.pkl)")
    return parser.parse_args()

def main():
    """Main entry point for the script."""
    args = parse_arguments()
    
    # Initialize the RAG pipeline
    result = initialize_rag_pipeline(args.file, args.output)
    
    # Output result as JSON for the Node.js server to capture
    print(json.dumps(result))
    
    # Return appropriate exit code
    sys.exit(0 if result["success"] else 1)

if __name__ == "__main__":
    main()